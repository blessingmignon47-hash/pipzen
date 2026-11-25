// PipZen - messages WhatsApp (service gratuit CallMeBot, pour usage personnel)
// Le numéro et la clé ne sont jamais écrits dans le code : ils viennent des variables
// CALLMEBOT_TELEPHONE et CALLMEBOT_CLE (secrets GitHub ou fichier .env local non partagé).
const { MARCHES, tailleLots } = require('./moteur');

const sensTexte = (s) => (s > 0 ? 'ACHAT' : 'VENTE');
const nombre = (v, d) => Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const prix = (marche, v) => nombre(v, MARCHES[marche].decimales);

function ligneTaille(marche, ecartStop, px, config) {
  const risque = (config.compteDemo * 1) / 100;
  const lots = Math.floor(tailleLots(marche, risque, ecartStop, px) * 100) / 100;
  if (lots < 0.01) {
    const minimum = Math.ceil((0.01 * tailleLots(marche, 1, ecartStop, px) ** -1) * 100 / 1000) * 1000;
    return `Taille : compte trop petit pour risquer 1 % (il faut au moins ${nombre(minimum, 0)} $ pour 0,01 lot)`;
  }
  return `Taille : ${nombre(lots, 2)} lot pour un compte de ${nombre(config.compteDemo, 0)} $ (1 % risqué, soit ${nombre(risque, 0)} $)`;
}
const pied = (config) => (config.lienApplication ? `\nDétails : ${config.lienApplication}` : '') + '\n_Compte démo - argent fictif_';

function texteOuverture(o, config) {
  return [
    `*PipZen - ${sensTexte(o.sens)} ${o.marche}*`,
    `Confiance : ${o.confiance}/6 méthodes d'accord`,
    `Entrée : ${prix(o.marche, o.entree)} (${o.jourEntree})`,
    `Perte maximum : ${prix(o.marche, o.stop)}`,
    `Objectif : pas de prix fixe, PipZen dira quand sortir`,
    ligneTaille(o.marche, Math.abs(o.entree - o.stop), o.entree, config),
  ].join('\n') + pied(config);
}

function texteSignal(s, config) {
  return [
    `*PipZen - ${sensTexte(s.sens)} ${s.marche} à l'ouverture*`,
    `Confiance : ${s.confiance}/6 méthodes d'accord`,
    `Prix indicatif : ${prix(s.marche, s.prixIndicatif)}`,
    `Perte maximum indicative : ${prix(s.marche, s.stopIndicatif)}`,
    ligneTaille(s.marche, s.ecartStop, s.prixIndicatif, config),
  ].join('\n') + pied(config);
}

function texteSortieAnnoncee(o) {
  return `*PipZen - SORTIR de ${o.marche}* à l'ouverture\nLa tendance s'essouffle. Résultat actuel : ${o.Rlatent > 0 ? '+' : ''}${nombre(o.Rlatent, 1)} % du compte.\n_Compte démo - argent fictif_`;
}

function texteFermeture(f) {
  const gain = f.R * 1;
  return [
    `*PipZen - ${f.marche} fermé* ${gain > 0 ? '✅' : '❌'}`,
    `${sensTexte(f.sens)} du ${f.jourEntree} au ${f.jourSortie} (${f.nuits} nuits)`,
    `Entrée ${prix(f.marche, f.entree)}, sortie ${prix(f.marche, f.sortie)}`,
    `Motif : ${f.motif}`,
    `Résultat : ${gain > 0 ? '+' : ''}${nombre(gain, 1)} % du compte`,
  ].join('\n') + '\n_Compte démo - argent fictif_';
}

function texteBienvenue(demo, situations) {
  const lignes = situations.map((s) => `• ${s.marche} : ${s.vote > 0 ? '+' : ''}${s.vote}/6`);
  return [
    '*PipZen est en marche* 🧘',
    'Analyse chaque matin à 6 h. Vous recevrez un message à chaque entrée et chaque sortie.',
    `Positions démo ouvertes : ${demo.ouvertes.length}`,
    'Votes du jour (+ = hausse, - = baisse, 4 ou plus = position) :',
    ...lignes,
  ].join('\n') + '\n_Compte démo - argent fictif_';
}

async function envoyerWhatsApp(texte) {
  const tel = process.env.CALLMEBOT_TELEPHONE, cle = process.env.CALLMEBOT_CLE;
  if (!tel || !cle) { console.log(`\n(WhatsApp non configuré, message affiché seulement)\n${texte}`); return; }
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(tel)}&apikey=${encodeURIComponent(cle)}&text=${encodeURIComponent(texte)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`WhatsApp a refusé le message (${r.status})`);
  console.log('Message WhatsApp envoyé.');
  await new Promise((ok) => setTimeout(ok, 3000)); // le service demande d'espacer les messages
}

module.exports = { envoyerWhatsApp, texteOuverture, texteFermeture, texteSignal, texteSortieAnnoncee, texteBienvenue };
