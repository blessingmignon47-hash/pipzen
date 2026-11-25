// PipZen - analyse quotidienne
// 1. télécharge les prix journaliers, 2. fait voter les 6 méthodes, 3. tient le compte démo,
// 4. écrit app/donnees/etat.json (lu par l'application), 5. prévient par Telegram et/ou WhatsApp.
// Utilisation : node moteur/analyse.js            (analyse + envoi WhatsApp si configuré)
//               node moteur/analyse.js --sans-envoi (analyse seulement, messages affichés à l'écran)
const fs = require('fs');
const path = require('path');
const { REGLAGE, MARCHES, NOMS_METHODES, lireBougies, rejouer } = require('./moteur');
const { envoyer, texteOuverture, texteFermeture, texteSignal, texteSortieAnnoncee, texteBienvenue } = require('./whatsapp');

const RACINE = path.join(__dirname, '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const FICHIER_ETAT = path.join(RACINE, 'app', 'donnees', 'etat.json');
const SANS_ENVOI = process.argv.includes('--sans-envoi');
const RISQUE_PCT = 1; // 1 % du compte démo par position

async function telecharger(symbole) {
  const debut = Math.floor(new Date('2015-01-01').getTime() / 1000), fin = Math.floor(Date.now() / 1000) + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbole)}?interval=1d&period1=${debut}&period2=${fin}`;
  for (let essai = 1; essai <= 3; essai++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) throw new Error(`réponse ${r.status}`);
      const j = await r.json();
      if (!j.chart?.result?.[0]?.timestamp) throw new Error('réponse vide');
      return j;
    } catch (e) {
      if (essai === 3) throw new Error(`Prix indisponibles pour ${symbole} : ${e.message}`);
      await new Promise((ok) => setTimeout(ok, 5000 * essai));
    }
  }
}

function bilan(fermees, ouvertes = []) {
  const triees = [...fermees].sort((a, b) => a.jourSortie.localeCompare(b.jourSortie));
  let cumul = 0, sommet = 0, chute = 0;
  const courbe = [], annees = {};
  for (const f of triees) {
    cumul += f.R * RISQUE_PCT; sommet = Math.max(sommet, cumul); chute = Math.max(chute, sommet - cumul);
    courbe.push({ jour: f.jourSortie, pct: Number(cumul.toFixed(1)) });
    const an = f.jourSortie.slice(0, 4); annees[an] = (annees[an] || 0) + f.R * RISQUE_PCT;
  }
  const gagnantes = triees.filter((f) => f.R > 0).length;
  const latent = ouvertes.reduce((s, o) => s + o.Rlatent * RISQUE_PCT, 0);
  return {
    positions: triees.length,
    gagnantes,
    reussitePct: triees.length ? Math.round((gagnantes / triees.length) * 100) : 0,
    resultatPct: Number(cumul.toFixed(1)),
    latentPct: Number(latent.toFixed(1)),
    chuteMaxPct: Number(chute.toFixed(1)),
    parAnnee: Object.entries(annees).map(([annee, v]) => ({ annee, pct: Number(v.toFixed(1)) })),
    courbe,
  };
}

async function main() {
  const maintenant = new Date();
  const aujourdhui = maintenant.toISOString().slice(0, 10);
  const precedent = fs.existsSync(FICHIER_ETAT) ? JSON.parse(fs.readFileSync(FICHIER_ETAT, 'utf8')) : null;

  const situations = [], demo = { ouvertes: [], fermees: [], signaux: [] }, histo = { fermees: [], ouvertes: [] };
  for (const [nom, m] of Object.entries(MARCHES)) {
    const bougies = lireBougies(await telecharger(m.symbole), aujourdhui);
    const live = rejouer(nom, bougies, CONFIG.departDemo);
    const passe = rejouer(nom, bougies, '2015-01-01');
    situations.push(live.situation);
    demo.fermees.push(...live.fermees);
    if (live.ouverte) demo.ouvertes.push(live.ouverte);
    if (live.signalEnAttente) demo.signaux.push(live.signalEnAttente);
    histo.fermees.push(...passe.fermees);
    if (passe.ouverte) histo.ouvertes.push(passe.ouverte);
  }
  demo.fermees.sort((a, b) => b.jourSortie.localeCompare(a.jourSortie));

  // Repère les nouveautés depuis la dernière analyse
  const evenements = [];
  for (const o of demo.ouvertes) {
    evenements.push({ cle: `ouverture:${o.marche}:${o.jourEntree}`, texte: () => texteOuverture(o, CONFIG) });
    if (o.sortieAnnoncee) evenements.push({ cle: `sortie:${o.marche}:${o.jourEntree}`, texte: () => texteSortieAnnoncee(o) });
  }
  for (const f of demo.fermees) {
    evenements.push({ cle: `ouverture:${f.marche}:${f.jourEntree}`, texte: () => texteOuverture(f, CONFIG) });
    evenements.push({ cle: `fermeture:${f.marche}:${f.jourEntree}`, texte: () => texteFermeture(f) });
  }
  for (const s of demo.signaux) evenements.push({ cle: `signal:${s.marche}:${s.jourSignal}`, texte: () => texteSignal(s, CONFIG) });

  const dejaPrevenus = new Set(precedent?.notifies || []);
  const nouveaux = evenements.filter((e) => !dejaPrevenus.has(e.cle));
  const messages = [];
  if (!precedent) messages.push(texteBienvenue(demo, situations));
  else for (const e of nouveaux) messages.push(e.texte());

  const etat = {
    application: 'PipZen',
    misAJour: maintenant.toISOString(),
    departDemo: CONFIG.departDemo,
    compteDemo: CONFIG.compteDemo,
    risquePct: RISQUE_PCT,
    reglage: REGLAGE,
    methodes: NOMS_METHODES,
    marches: situations,
    demo: { ...demo, bilan: bilan(demo.fermees, demo.ouvertes) },
    historique: { bilan: bilan(histo.fermees), dernieres: histo.fermees.sort((a, b) => b.jourSortie.localeCompare(a.jourSortie)).slice(0, 30) },
    notifies: [...new Set([...dejaPrevenus, ...evenements.map((e) => e.cle)])],
  };
  fs.mkdirSync(path.dirname(FICHIER_ETAT), { recursive: true });
  fs.writeFileSync(FICHIER_ETAT, JSON.stringify(etat, null, 1));

  console.log(`Analyse du ${aujourdhui} terminée : ${demo.ouvertes.length} position(s) ouverte(s), ${demo.signaux.length} signal(aux) en attente, ${messages.length} message(s).`);
  for (const s of situations) console.log(`  ${s.marche.padEnd(13)} vote ${s.vote > 0 ? '+' : ''}${s.vote}/6 (jour ${s.jour}, prix ${s.prix})`);
  for (const texte of messages) {
    if (SANS_ENVOI) console.log(`\n--- Message WhatsApp (non envoyé) ---\n${texte}`);
    else await envoyer(texte);
  }
}

main().catch((e) => { console.error(`Échec de l'analyse : ${e.message}`); process.exit(1); });
