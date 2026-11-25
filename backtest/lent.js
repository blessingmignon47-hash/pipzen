// PipZen - variantes lentes (bougies journalières, positions gardées plusieurs jours)
// Réglages choisis sur 2015-2020, puis vérifiés sur 2021-2026 (période jamais vue).
const fs = require('fs');
const path = require('path');

const MARCHES = {
  'EUR/USD': { fichier: 'jour_EURUSD=X.json', ecart: 0.00015, nuit: 0.00004 },
  'GBP/USD': { fichier: 'jour_GBPUSD=X.json', ecart: 0.0002, nuit: 0.00005 },
  'USD/JPY': { fichier: 'jour_JPY=X.json', ecart: 0.02, nuit: 0.006 },
  'Or (XAU/USD)': { fichier: 'jour_GC=F.json', ecart: 0.4, nuit: 0.15 },
};
// ecart = frais d'entrée/sortie ; nuit = frais estimés par nuit gardée (le « swap »)
const FIN_CHOIX = '2021-01-01';
const MISE = 10; // 1 % d'un compte de 1 000 $ risqué par position (sans réinvestir les gains)

function charger(f) {
  const r = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', f), 'utf8')).chart.result[0];
  const q = r.indicators.quote[0];
  return r.timestamp.map((t, i) => ({ jour: new Date(t * 1000).toISOString().slice(0, 10), o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] }))
    .filter((x) => [x.o, x.h, x.l, x.c].every((v) => v != null && v > 0));
}
const mme = (v, n) => { const k = 2 / (n + 1); let e = v[0]; return v.map((x) => (e = x * k + e * (1 - k))); };
const atr = (b, n = 20) => mme(b.map((x, i) => (i ? Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c)) : x.h - x.l)), n);
const plusHaut = (b, i, n) => Math.max(...b.slice(i - n, i).map((x) => x.h));
const plusBas = (b, i, n) => Math.min(...b.slice(i - n, i).map((x) => x.l));

// Moteur commun : signal(i) renvoie 1 (achat), -1 (vente) ou 0 ; sortie(i, sens) dit s'il faut fermer
function tester(b, m, signal, sortie, multStop) {
  const a = atr(b); const pos = []; let p = null;
  for (let i = 220; i < b.length - 1; i++) {
    if (p) {
      const x = b[i];
      const stopTouche = p.sens > 0 ? x.l <= p.stop : x.h >= p.stop;
      let px = null;
      if (stopTouche) px = p.sens > 0 ? Math.min(x.o, p.stop) : Math.max(x.o, p.stop);
      else if (sortie(i, p.sens)) px = b[i + 1].o;
      if (px != null) {
        const nuits = i - p.i;
        const R = ((px - p.entree) * p.sens - m.ecart - nuits * m.nuit) / p.risque;
        pos.push({ entree: p.jour, sortie: x.jour, R, nuits });
        p = null;
      }
      continue;
    }
    const s = signal(i);
    if (s) {
      const entree = b[i + 1].o, risque = multStop * a[i];
      p = { sens: s, entree, risque, stop: entree - s * risque, i: i + 1, jour: b[i + 1].jour };
    }
  }
  return pos;
}

const VARIANTES = [];
// 1. Cassure du plus haut / plus bas de N jours (sortie sur le plus bas / plus haut de N/2 jours)
for (const n of [20, 55]) for (const st of [2, 3])
  VARIANTES.push({
    nom: `Cassure ${n} jours (perte max ${st}×)`,
    lancer: (b, m) => tester(b, m,
      (i) => (b[i].c > plusHaut(b, i, n) ? 1 : b[i].c < plusBas(b, i, n) ? -1 : 0),
      (i, s) => (s > 0 ? b[i].c < plusBas(b, i, n / 2) : b[i].c > plusHaut(b, i, n / 2)), st),
  });
// 2. Croisement de moyennes : on garde tant que la tendance ne s'inverse pas
for (const [r, l] of [[20, 100], [50, 200]]) for (const st of [2, 3])
  VARIANTES.push({
    nom: `Moyennes ${r}/${l} jours (perte max ${st}×)`,
    lancer: (b, m) => {
      const c = b.map((x) => x.c), er = mme(c, r), el = mme(c, l);
      return tester(b, m,
        (i) => (er[i - 1] <= el[i - 1] && er[i] > el[i] ? 1 : er[i - 1] >= el[i - 1] && er[i] < el[i] ? -1 : 0),
        (i, s) => (s > 0 ? er[i] < el[i] : er[i] > el[i]), st);
    },
  });
// 3. Élan : on suit la direction des N derniers mois, vérifiée chaque lundi
for (const mois of [3, 6]) for (const st of [3])
  VARIANTES.push({
    nom: `Élan ${mois} mois (perte max ${st}×)`,
    lancer: (b, m) => {
      const n = mois * 21;
      const dir = (i) => Math.sign(b[i].c - b[i - n].c);
      const lundi = (i) => new Date(b[i].jour).getUTCDay() === 1;
      return tester(b, m, (i) => (lundi(i) ? dir(i) : 0), (i, s) => lundi(i) && dir(i) !== s, st);
    },
  });

function bilan(pos) {
  pos = [...pos].sort((x, y) => x.sortie.localeCompare(y.sortie));
  let gain = 0, sommet = 0, chute = 0, serie = 0, pire = 0;
  const annees = {};
  for (const p of pos) {
    gain += MISE * p.R; sommet = Math.max(sommet, gain); chute = Math.max(chute, sommet - gain);
    annees[p.sortie.slice(0, 4)] = (annees[p.sortie.slice(0, 4)] || 0) + MISE * p.R;
    if (p.R < 0) { serie++; pire = Math.max(pire, serie); } else serie = 0;
  }
  const g = pos.filter((p) => p.R > 0).reduce((s, p) => s + p.R, 0), pe = -pos.filter((p) => p.R <= 0).reduce((s, p) => s + p.R, 0);
  const an = Object.keys(annees).length || 1;
  return {
    positions: pos.length,
    parSemaine: +(pos.length / (an * 52)).toFixed(1),
    reussite: pos.length ? Math.round((pos.filter((p) => p.R > 0).length / pos.length) * 100) : 0,
    rapport: pe ? +(g / pe).toFixed(2) : 0,
    resultatPct: Math.round(gain / 10),        // en % du compte de 1 000 $
    parAnPct: Math.round(gain / 10 / an),
    chuteMaxPct: Math.round(chute / 10),
    pireSerie: pire,
    dureeMoyenneJours: pos.length ? Math.round(pos.reduce((s, p) => s + p.nuits, 0) / pos.length) : 0,
    anneesGagnantes: `${Object.values(annees).filter((v) => v > 0).length}/${Object.keys(annees).length}`,
    parAnnee: Object.fromEntries(Object.entries(annees).map(([k, v]) => [k, Math.round(v / 10)])),
  };
}

const donnees = Object.entries(MARCHES).map(([nom, m]) => ({ nom, m, b: charger(m.fichier) }));
const sortie = [];
for (const v of VARIANTES) {
  const parMarche = {}; const tout = [];
  for (const d of donnees) { const p = v.lancer(d.b, d.m).map((x) => ({ ...x, marche: d.nom })); parMarche[d.nom] = p; tout.push(...p); }
  const choix = tout.filter((p) => p.entree < FIN_CHOIX), verif = tout.filter((p) => p.entree >= FIN_CHOIX);
  sortie.push({
    variante: v.nom,
    choix2015_2020: bilan(choix),
    verif2021_2026: bilan(verif),
    verifParMarche: Object.fromEntries(Object.entries(parMarche).map(([k, p]) => [k, bilan(p.filter((x) => x.entree >= FIN_CHOIX)).resultatPct])),
  });
}
fs.writeFileSync(path.join(__dirname, 'resultats_lent.json'), JSON.stringify(sortie, null, 2));
console.log('Classement sur 2015-2020 (période de choix) :');
for (const s of [...sortie].sort((a, b) => b.choix2015_2020.resultatPct - a.choix2015_2020.resultatPct)) {
  const c = s.choix2015_2020, w = s.verif2021_2026;
  console.log(`${s.variante.padEnd(34)} | choix: ${String(c.resultatPct).padStart(4)} % (rapport ${c.rapport}, chute ${c.chuteMaxPct} %) | vérif: ${String(w.resultatPct).padStart(4)} % (rapport ${w.rapport}, chute ${w.chuteMaxPct} %, ${w.parSemaine}/sem, réussite ${w.reussite} %, ${w.dureeMoyenneJours} j, années + ${w.anneesGagnantes}) | marchés ${JSON.stringify(s.verifParMarche)}`);
}
