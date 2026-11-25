// PipZen - test des 3 méthodes sur les prix passés (bougies d'une heure, heure d'Abidjan = UTC)
const fs = require('fs');
const path = require('path');

const MARCHES = {
  'EUR/USD': { fichier: 'EURUSD=X.json', ecart: 0.00015 },
  'GBP/USD': { fichier: 'GBPUSD=X.json', ecart: 0.0002 },
  'USD/JPY': { fichier: 'JPY=X.json', ecart: 0.02 },
  'Or (XAU/USD)': { fichier: 'GC=F.json', ecart: 0.4 },
};
// ecart = frais estimés par position (écart achat/vente d'un compte standard XM)

const RISQUE = 0.01;            // 1 % du compte risqué par position
const PERTES_MAX_JOUR = 2;      // arrêt de la journée après 2 pertes
const CAPITAL = 1000;           // compte démo de départ (en dollars)
const FIN_JOURNEE = 20;         // toute position est fermée à 20 h

function charger(fichier) {
  const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', fichier), 'utf8'));
  const r = j.chart.result[0];
  const q = r.indicators.quote[0];
  const bougies = [];
  r.timestamp.forEach((t, i) => {
    const [o, h, l, c] = [q.open[i], q.high[i], q.low[i], q.close[i]];
    if ([o, h, l, c].some((v) => v == null)) return;
    const d = new Date(t * 1000);
    bougies.push({ t: d, jour: d.toISOString().slice(0, 10), heure: d.getUTCHours(), o, h, l, c });
  });
  return bougies;
}

function mme(valeurs, n) {
  const k = 2 / (n + 1); const out = []; let e = valeurs[0];
  for (const v of valeurs) { e = v * k + e * (1 - k); out.push(e); }
  return out;
}
function atr(b, n = 14) {
  const tr = b.map((x, i) => (i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c))));
  return mme(tr, n * 2 - 1);
}
function rsi(c, n = 14) {
  const out = [50]; let g = 0, p = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n; p = (p * (n - 1) + Math.max(-d, 0)) / n;
    out.push(p === 0 ? 100 : 100 - 100 / (1 + g / p));
  }
  return out;
}

// Suit la position bougie par bougie jusqu'à la perte max, l'objectif ou la fin de journée
function simuler(b, i, sens, stop, objectif, ecart) {
  const entree = b[i + 1].o;
  const risque = Math.abs(entree - stop);
  if (risque <= 0) return null;
  for (let k = i + 1; k < b.length; k++) {
    const x = b[k];
    if (x.jour !== b[i + 1].jour || x.heure >= FIN_JOURNEE) {
      const sortie = b[k - 1].c;
      return { entree: b[i + 1].t, jour: b[i + 1].jour, R: ((sortie - entree) * sens - ecart) / risque };
    }
    const touchePerte = sens > 0 ? x.l <= stop : x.h >= stop;
    const toucheObjectif = sens > 0 ? x.h >= objectif : x.l <= objectif;
    if (touchePerte) return { entree: b[i + 1].t, jour: b[i + 1].jour, R: (-risque - ecart) / risque }; // prudence : la perte d'abord
    if (toucheObjectif) return { entree: b[i + 1].t, jour: b[i + 1].jour, R: (Math.abs(objectif - entree) - ecart) / risque };
  }
  return null;
}

const METHODES = {
  'Suivre la tendance': (b, ecart) => {
    const c = b.map((x) => x.c), e20 = mme(c, 20), e50 = mme(c, 50), e200 = mme(c, 200), a = atr(b);
    const res = []; let libre = 0;
    for (let i = 200; i < b.length - 1; i++) {
      if (i < libre || b[i].heure < 7 || b[i].heure > 16) continue;
      const hausse = e20[i - 1] <= e50[i - 1] && e20[i] > e50[i] && c[i] > e200[i];
      const baisse = e20[i - 1] >= e50[i - 1] && e20[i] < e50[i] && c[i] < e200[i];
      if (!hausse && !baisse) continue;
      const s = hausse ? 1 : -1, en = b[i + 1].o;
      const t = simuler(b, i, s, en - s * 1.5 * a[i], en + s * 3 * a[i], ecart);
      if (t) { res.push(t); libre = i + 2; }
    }
    return res;
  },
  'Cassure de Londres': (b, ecart) => {
    const res = []; const parJour = {};
    b.forEach((x, i) => { (parJour[x.jour] ||= []).push(i); });
    for (const idx of Object.values(parJour)) {
      const nuit = idx.filter((i) => b[i].heure < 7);
      if (nuit.length < 5) continue;
      const haut = Math.max(...nuit.map((i) => b[i].h)), bas = Math.min(...nuit.map((i) => b[i].l));
      const milieu = (haut + bas) / 2;
      for (const i of idx.filter((i) => b[i].heure >= 7 && b[i].heure <= 11)) {
        if (i + 1 >= b.length || b[i + 1].jour !== b[i].jour) break;
        const s = b[i].c > haut ? 1 : b[i].c < bas ? -1 : 0;
        if (!s) continue;
        const en = b[i + 1].o, risque = Math.abs(en - milieu);
        const t = simuler(b, i, s, milieu, en + s * 2 * risque, ecart);
        if (t) res.push(t);
        break; // une seule position par jour
      }
    }
    return res;
  },
  'Rebond dans la tendance': (b, ecart) => {
    const c = b.map((x) => x.c), e50 = mme(c, 50), e200 = mme(c, 200), r = rsi(c), a = atr(b);
    const res = []; let libre = 0;
    for (let i = 200; i < b.length - 1; i++) {
      if (i < libre || b[i].heure < 7 || b[i].heure > 16) continue;
      const hausse = e50[i] > e200[i] && c[i] > e200[i] && r[i - 1] < 40 && r[i] >= 40;
      const baisse = e50[i] < e200[i] && c[i] < e200[i] && r[i - 1] > 60 && r[i] <= 60;
      if (!hausse && !baisse) continue;
      const s = hausse ? 1 : -1, en = b[i + 1].o;
      const t = simuler(b, i, s, en - s * 1.5 * a[i], en + s * 3 * a[i], ecart);
      if (t) { res.push(t); libre = i + 2; }
    }
    return res;
  },
};

// Applique les protections (1 % par position, arrêt après 2 pertes dans la journée) sur l'ensemble des marchés
function compte(positions) {
  positions.sort((x, y) => x.entree - y.entree);
  let solde = CAPITAL, sommet = CAPITAL, chuteMax = 0, serie = 0, pireSerie = 0;
  const pertesJour = {}, mois = {}; const prises = [];
  for (const p of positions) {
    if ((pertesJour[p.jour] || 0) >= PERTES_MAX_JOUR) continue;
    const gain = solde * RISQUE * p.R;
    solde += gain; prises.push(p);
    const m = p.jour.slice(0, 7); mois[m] = (mois[m] || 0) + gain;
    if (p.R < 0) { pertesJour[p.jour] = (pertesJour[p.jour] || 0) + 1; serie++; pireSerie = Math.max(pireSerie, serie); } else serie = 0;
    sommet = Math.max(sommet, solde); chuteMax = Math.max(chuteMax, (sommet - solde) / sommet);
  }
  const gagnants = prises.filter((p) => p.R > 0);
  const gainsR = gagnants.reduce((s, p) => s + p.R, 0), pertesR = -prises.filter((p) => p.R <= 0).reduce((s, p) => s + p.R, 0);
  const jours = new Set(prises.map((p) => p.jour)).size;
  const valeursMois = Object.values(mois);
  return {
    positions: prises.length,
    parJour: jours ? +(prises.length / jours).toFixed(2) : 0,
    reussite: prises.length ? Math.round((gagnants.length / prises.length) * 100) : 0,
    rapportGainsPertes: pertesR ? +(gainsR / pertesR).toFixed(2) : 0,
    soldeFinal: Math.round(solde),
    resultatPct: Math.round((solde / CAPITAL - 1) * 100),
    chuteMaxPct: Math.round(chuteMax * 100),
    pireSeriePertes: pireSerie,
    moisGagnants: valeursMois.filter((v) => v > 0).length,
    moisTotal: valeursMois.length,
  };
}

const donnees = Object.fromEntries(Object.entries(MARCHES).map(([n, m]) => [n, { ...m, bougies: charger(m.fichier) }]));
const premier = donnees['EUR/USD'].bougies[0].jour, dernier = donnees['EUR/USD'].bougies.at(-1).jour;
const resultats = { periode: { du: premier, au: dernier }, methodes: {} };

for (const [nom, methode] of Object.entries(METHODES)) {
  const toutes = []; const parMarche = {};
  for (const [marche, d] of Object.entries(donnees)) {
    const pos = methode(d.bougies, d.ecart);
    parMarche[marche] = compte(pos.map((p) => ({ ...p })));
    toutes.push(...pos);
  }
  const milieu = new Date((new Date(premier).getTime() + new Date(dernier).getTime()) / 2);
  resultats.methodes[nom] = {
    ensemble: compte(toutes.map((p) => ({ ...p }))),
    premiereMoitie: compte(toutes.filter((p) => p.entree < milieu).map((p) => ({ ...p }))),
    secondeMoitie: compte(toutes.filter((p) => p.entree >= milieu).map((p) => ({ ...p }))),
    parMarche,
  };
}

fs.writeFileSync(path.join(__dirname, 'resultats.json'), JSON.stringify(resultats, null, 2));
console.log(JSON.stringify(resultats, null, 1));
