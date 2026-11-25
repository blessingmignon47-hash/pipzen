// PipZen - vote entre 6 méthodes (bougies journalières)
// Chaque méthode donne chaque jour un avis : +1 (hausse), -1 (baisse) ou 0.
// PipZen n'ouvre une position que si assez de méthodes sont d'accord.
// Réglages choisis sur 2015-2020, puis vérifiés sur 2021-2026 (jamais vu).
const fs = require('fs');
const path = require('path');

const MARCHES = {
  'EUR/USD': { fichier: 'jour_EURUSD=X.json', ecart: 0.00015, nuit: 0.00004 },
  'GBP/USD': { fichier: 'jour_GBPUSD=X.json', ecart: 0.0002, nuit: 0.00005 },
  'USD/JPY': { fichier: 'jour_JPY=X.json', ecart: 0.02, nuit: 0.006 },
  'Or (XAU/USD)': { fichier: 'jour_GC=F.json', ecart: 0.4, nuit: 0.15 },
};
const FIN_CHOIX = '2021-01-01';
const MISE = 10; // 1 % d'un compte de 1 000 $

function charger(f) {
  const r = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', f), 'utf8')).chart.result[0];
  const q = r.indicators.quote[0];
  return r.timestamp.map((t, i) => ({ jour: new Date(t * 1000).toISOString().slice(0, 10), o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] }))
    .filter((x) => [x.o, x.h, x.l, x.c].every((v) => v != null && v > 0));
}
const mme = (v, n) => { const k = 2 / (n + 1); let e = v[0]; return v.map((x) => (e = x * k + e * (1 - k))); };
const atr = (b, n = 20) => mme(b.map((x, i) => (i ? Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c)) : x.h - x.l)), n);

// Avis de chaque méthode, jour par jour
function avis(b) {
  const c = b.map((x) => x.c);
  const cassure = (n) => {
    const out = []; let etat = 0;
    for (let i = 0; i < b.length; i++) {
      if (i >= n) {
        const haut = Math.max(...b.slice(i - n, i).map((x) => x.h)), bas = Math.min(...b.slice(i - n, i).map((x) => x.l));
        const m = Math.floor(n / 2);
        const hautC = Math.max(...b.slice(i - m, i).map((x) => x.h)), basC = Math.min(...b.slice(i - m, i).map((x) => x.l));
        if (c[i] > haut) etat = 1; else if (c[i] < bas) etat = -1;
        else if (etat > 0 && c[i] < basC) etat = 0; else if (etat < 0 && c[i] > hautC) etat = 0;
      }
      out.push(etat);
    }
    return out;
  };
  const moyennes = (r, l) => { const a = mme(c, r), z = mme(c, l); return c.map((_, i) => Math.sign(a[i] - z[i])); };
  const elan = (n) => c.map((x, i) => (i >= n ? Math.sign(x - c[i - n]) : 0));
  return [cassure(20), cassure(55), moyennes(20, 100), moyennes(50, 200), elan(63), elan(126)];
}

function tester(b, m, votes, seuil, sortieSeuil, multStop) {
  const a = atr(b); const pos = []; let p = null;
  for (let i = 220; i < b.length - 1; i++) {
    const v = votes[i];
    if (p) {
      const x = b[i];
      const stopTouche = p.sens > 0 ? x.l <= p.stop : x.h >= p.stop;
      let px = null;
      if (stopTouche) px = p.sens > 0 ? Math.min(x.o, p.stop) : Math.max(x.o, p.stop);
      else if (v * p.sens <= sortieSeuil) px = b[i + 1].o;
      if (px != null) {
        const nuits = i - p.i;
        pos.push({ entree: p.jour, sortie: x.jour, nuits, R: ((px - p.entree) * p.sens - m.ecart - nuits * m.nuit) / p.risque });
        p = null;
      }
      continue;
    }
    if (Math.abs(v) >= seuil) {
      const s = Math.sign(v), entree = b[i + 1].o, risque = multStop * a[i];
      p = { sens: s, entree, risque, stop: entree - s * risque, i: i + 1, jour: b[i + 1].jour };
    }
  }
  return pos;
}

function bilan(pos) {
  pos = [...pos].sort((x, y) => x.sortie.localeCompare(y.sortie));
  let gain = 0, sommet = 0, chute = 0; const annees = {};
  for (const p of pos) {
    gain += MISE * p.R; sommet = Math.max(sommet, gain); chute = Math.max(chute, sommet - gain);
    annees[p.sortie.slice(0, 4)] = (annees[p.sortie.slice(0, 4)] || 0) + MISE * p.R;
  }
  const g = pos.filter((p) => p.R > 0).reduce((s, p) => s + p.R, 0), pe = -pos.filter((p) => p.R <= 0).reduce((s, p) => s + p.R, 0);
  const an = Object.keys(annees).length || 1;
  return {
    positions: pos.length,
    parMois: +(pos.length / (an * 12)).toFixed(1),
    reussite: pos.length ? Math.round((pos.filter((p) => p.R > 0).length / pos.length) * 100) : 0,
    rapport: pe ? +(g / pe).toFixed(2) : 0,
    resultatPct: Math.round(gain / 10),
    chuteMaxPct: Math.round(chute / 10),
    anneesGagnantes: `${Object.values(annees).filter((v) => v > 0).length}/${an}`,
    parAnnee: Object.fromEntries(Object.entries(annees).map(([k, v]) => [k, Math.round(v / 10)])),
  };
}

const donnees = Object.entries(MARCHES).map(([nom, m]) => {
  const b = charger(m.fichier); const av = avis(b);
  return { nom, m, b, votes: b.map((_, i) => av.reduce((s, x) => s + x[i], 0)) };
});

const essais = [];
for (const seuil of [4, 5, 6]) for (const sortieSeuil of [0, 2]) for (const st of [2, 3]) {
  if (sortieSeuil >= seuil) continue;
  const tout = []; const parMarche = {};
  for (const d of donnees) { const p = tester(d.b, d.m, d.votes, seuil, sortieSeuil, st); parMarche[d.nom] = p; tout.push(...p); }
  essais.push({
    reglage: `${seuil} méthodes sur 6 d'accord, sortie si ${sortieSeuil === 0 ? "plus de majorité" : "moins de 3 d'accord"}, perte max ${st}×`,
    choix: bilan(tout.filter((p) => p.entree < FIN_CHOIX)),
    verif: bilan(tout.filter((p) => p.entree >= FIN_CHOIX)),
    verifParMarche: Object.fromEntries(Object.entries(parMarche).map(([k, p]) => [k, bilan(p.filter((x) => x.entree >= FIN_CHOIX)).resultatPct])),
  });
}
essais.sort((a, b) => b.choix.resultatPct - a.choix.resultatPct);
fs.writeFileSync(path.join(__dirname, 'resultats_vote.json'), JSON.stringify(essais, null, 2));
for (const e of essais) {
  console.log(`${e.reglage.padEnd(70)} | choix ${String(e.choix.resultatPct).padStart(4)} % (rapport ${e.choix.rapport}, chute ${e.choix.chuteMaxPct} %, ${e.choix.anneesGagnantes}) | vérif ${String(e.verif.resultatPct).padStart(4)} % (rapport ${e.verif.rapport}, chute ${e.verif.chuteMaxPct} %, ${e.verif.parMois}/mois, réussite ${e.verif.reussite} %, ${e.verif.anneesGagnantes}) ${JSON.stringify(e.verif.parAnnee)} ${JSON.stringify(e.verifParMarche)}`);
}
