// PipZen - moteur de décision : vote entre 6 méthodes de suivi de tendance (bougies journalières)
// Réglage retenu après le test honnête (choix 2015-2020, vérification 2021-2026) :
// entrée si au moins 4 méthodes sur 6 sont d'accord, sortie quand il en reste 2 ou moins,
// perte maximum à 3 fois la variation moyenne d'une journée (ATR 20 jours).

const REGLAGE = { seuilEntree: 4, seuilSortie: 2, multStop: 3, depart: 220 };

const MARCHES = {
  'EUR/USD': { symbole: 'EURUSD=X', ecart: 0.00015, nuit: 0.00004, decimales: 5, unitesParLot: 100000 },
  'GBP/USD': { symbole: 'GBPUSD=X', ecart: 0.0002, nuit: 0.00005, decimales: 5, unitesParLot: 100000 },
  'USD/JPY': { symbole: 'JPY=X', ecart: 0.02, nuit: 0.006, decimales: 3, unitesParLot: 100000, enYen: true },
  'Or (XAU/USD)': { symbole: 'GC=F', ecart: 0.4, nuit: 0.15, decimales: 2, unitesParLot: 100 },
};

const NOMS_METHODES = [
  'Cassure 20 jours', 'Cassure 55 jours', 'Moyennes 20/100 jours',
  'Moyennes 50/200 jours', 'Élan 3 mois', 'Élan 6 mois',
];

// Transforme la réponse du fournisseur de prix en bougies datées (jour de marché, pas l'heure UTC brute)
function lireBougies(reponse, aujourdhui) {
  const r = reponse.chart.result[0];
  const q = r.indicators.quote[0];
  const parJour = new Map();
  r.timestamp.forEach((t, i) => {
    const [o, h, l, c] = [q.open[i], q.high[i], q.low[i], q.close[i]];
    if (![o, h, l, c].every((v) => v != null && v > 0)) return;
    // +6 h : une bougie notée 23 h UTC (heure d'été de Londres) appartient au jour suivant
    const jour = new Date((t + 6 * 3600) * 1000).toISOString().slice(0, 10);
    parJour.set(jour, { jour, o, h, l, c });
  });
  const bougies = [...parJour.values()].sort((a, b) => a.jour.localeCompare(b.jour));
  for (const x of bougies) x.partiel = x.jour >= aujourdhui; // la journée en cours n'est pas terminée
  return bougies;
}

const mme = (v, n) => { const k = 2 / (n + 1); let e = v[0]; return v.map((x) => (e = x * k + e * (1 - k))); };
const atr = (b, n = 20) => mme(b.map((x, i) => (i ? Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c)) : x.h - x.l)), n);

// Avis de chaque méthode, jour par jour : +1 hausse, -1 baisse, 0 neutre
function avisMethodes(b) {
  const c = b.map((x) => x.c);
  const cassure = (n) => {
    const out = []; let etat = 0; const m = Math.floor(n / 2);
    for (let i = 0; i < b.length; i++) {
      if (i >= n) {
        const fen = b.slice(i - n, i), court = b.slice(i - m, i);
        const haut = Math.max(...fen.map((x) => x.h)), bas = Math.min(...fen.map((x) => x.l));
        const hautC = Math.max(...court.map((x) => x.h)), basC = Math.min(...court.map((x) => x.l));
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

const arrondi = (v, d) => Number(v.toFixed(d));

// Rejoue la méthode jour après jour depuis une date donnée.
// Renvoie les positions fermées, la position ouverte, et le signal en attente de l'ouverture du marché.
function rejouer(nomMarche, b, depuis) {
  const m = MARCHES[nomMarche];
  const avis = avisMethodes(b);
  const votes = b.map((_, i) => avis.reduce((s, a) => s + a[i], 0));
  const a = atr(b);
  const fermees = []; let p = null; let signalEnAttente = null; let sortieAnnoncee = false;
  // depuis = premier jour dont la clôture peut déclencher une décision
  const iDepuis = b.findIndex((x) => x.jour >= depuis);
  const debut = iDepuis < 0 ? b.length : Math.max(REGLAGE.depart, iDepuis);

  const fermer = (px, jour, motif, iSortie) => {
    const nuits = iSortie - p.iEntree;
    const R = ((px - p.entree) * p.sens - m.ecart - nuits * m.nuit) / p.risque;
    fermees.push({ marche: nomMarche, sens: p.sens, jourSignal: p.jourSignal, jourEntree: p.jourEntree, entree: p.entree, stop: p.stop,
      confiance: p.confiance, jourSortie: jour, sortie: arrondi(px, m.decimales), nuits, R: arrondi(R, 2), motif });
    p = null;
  };

  for (let i = debut; i < b.length; i++) {
    const x = b[i];
    if (p && i >= p.iEntree) {
      const stopTouche = p.sens > 0 ? x.l <= p.stop : x.h >= p.stop;
      if (stopTouche) { fermer(p.sens > 0 ? Math.min(x.o, p.stop) : Math.max(x.o, p.stop), x.jour, 'Perte maximum atteinte', i); continue; }
      if (!x.partiel && votes[i] * p.sens <= REGLAGE.seuilSortie) {
        if (b[i + 1]) fermer(b[i + 1].o, b[i + 1].jour, 'La tendance s\'essouffle', i + 1);
        else sortieAnnoncee = true;
      }
      continue;
    }
    if (!p && !x.partiel && Math.abs(votes[i]) >= REGLAGE.seuilEntree) {
      const sens = Math.sign(votes[i]), risque = REGLAGE.multStop * a[i];
      if (b[i + 1]) {
        const entree = b[i + 1].o;
        p = { sens, entree: arrondi(entree, m.decimales), risque, stop: arrondi(entree - sens * risque, m.decimales),
          iEntree: i + 1, jourEntree: b[i + 1].jour, jourSignal: x.jour, confiance: Math.abs(votes[i]) };
      } else {
        signalEnAttente = { marche: nomMarche, sens, jourSignal: x.jour, confiance: Math.abs(votes[i]),
          prixIndicatif: arrondi(x.c, m.decimales), stopIndicatif: arrondi(x.c - sens * risque, m.decimales), ecartStop: risque };
      }
    }
  }

  const der = b[b.length - 1];
  const iAvis = b[b.length - 1].partiel ? b.length - 2 : b.length - 1; // dernier jour terminé
  const ouverte = p && {
    marche: nomMarche, sens: p.sens, jourSignal: p.jourSignal, jourEntree: p.jourEntree, entree: p.entree, stop: p.stop,
    confiance: p.confiance, ecartStop: p.risque, prixActuel: arrondi(der.c, m.decimales),
    Rlatent: arrondi(((der.c - p.entree) * p.sens - m.ecart) / p.risque, 2), sortieAnnoncee,
  };
  return {
    fermees, ouverte, signalEnAttente,
    situation: {
      marche: nomMarche, jour: b[iAvis].jour, prix: arrondi(der.c, m.decimales), vote: votes[iAvis],
      avis: NOMS_METHODES.map((nom, k) => ({ nom, avis: avis[k][iAvis] })),
      variationJour: arrondi(a[iAvis], m.decimales),
    },
  };
}

// Taille de position (en lots) pour risquer un montant donné, avec une perte maximum à "ecartStop" du prix d'entrée
function tailleLots(nomMarche, risqueDollars, ecartStop, prix) {
  const m = MARCHES[nomMarche];
  const parLot = ecartStop * m.unitesParLot / (m.enYen ? prix : 1); // dollars perdus par lot si la perte max est touchée
  return risqueDollars / parLot;
}

module.exports = { REGLAGE, MARCHES, NOMS_METHODES, lireBougies, rejouer, tailleLots };
