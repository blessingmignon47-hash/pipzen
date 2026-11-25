// PipZen - application (lit donnees/etat.json, produit chaque matin par l'analyse)
'use strict';

const MARCHES = {
  'EUR/USD': { decimales: 5, unitesParLot: 100000 },
  'GBP/USD': { decimales: 5, unitesParLot: 100000 },
  'USD/JPY': { decimales: 3, unitesParLot: 100000, enYen: true },
  'Or (XAU/USD)': { decimales: 2, unitesParLot: 100 },
};

let etat = null;
let page = 'accueil';
const contenu = document.getElementById('contenu');
const bulle = document.getElementById('infobulle');

// ---------- Petits outils ----------
const echap = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nb = (v, d = 0) => Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const signe = (v, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${nb(Math.abs(v), d)}`;
const prix = (m, v) => nb(v, MARCHES[m].decimales);
const date = (j) => new Date(`${j}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const classeGain = (v) => (v > 0 ? 'gain' : v < 0 ? 'perte' : '');
const lire = (cle, defaut) => { try { return localStorage.getItem(cle) ?? defaut; } catch { return defaut; } };
const ecrire = (cle, v) => { try { localStorage.setItem(cle, v); } catch { /* stockage indisponible */ } };
const tailleCompte = () => Number(lire('pipzen-compte', etat?.compteDemo || 50000)) || 50000;

function lots(marche, ecartStop, px) {
  const m = MARCHES[marche];
  const risque = tailleCompte() * (etat.risquePct / 100);
  const parLot = (ecartStop * m.unitesParLot) / (m.enYen ? px : 1);
  // solde minimum pour que 0,01 lot (la plus petite taille) ne risque pas plus de 1 %
  const minimum = Math.ceil(parLot / 1000) * 1000;
  return { lots: Math.floor((risque / parLot) * 100) / 100, risque, minimum };
}
const texteLots = (r) => (r.lots >= 0.01 ? `${nb(r.lots, 2)} lot` : `compte trop petit (il faut ${nb(r.minimum)} $)`);
const pointsConfiance = (n) => `<span class="confiance" aria-label="${n} méthodes sur 6 d'accord">${Array.from({ length: 6 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
const sens = (s) => `<span class="sens ${s > 0 ? 'achat' : 'vente'}">${s > 0 ? 'ACHAT' : 'VENTE'}</span>`;

// Largeur des graphiques = largeur réelle de l'écran (textes lisibles sur téléphone)
const largeurGraph = () => Math.round(Math.max(300, Math.min(640, contenu.clientWidth - 34)));
let derniereLargeur = 0;
addEventListener('resize', () => { if (page === 'resultats' && Math.abs(largeurGraph() - derniereLargeur) > 20) afficher(); });

// ---------- Infobulle ----------
function montrerBulle(html, x, y) {
  bulle.innerHTML = html; bulle.hidden = false;
  const r = bulle.getBoundingClientRect();
  bulle.style.left = `${Math.min(Math.max(8, x - r.width / 2), innerWidth - r.width - 8)}px`;
  bulle.style.top = `${Math.max(8, y - r.height - 14)}px`;
}
const cacherBulle = () => { bulle.hidden = true; };

// ---------- Graphique : courbe du résultat cumulé (une seule série) ----------
function graphiqueCourbe(points, id) {
  if (points.length < 2) return '<p class="vide">Pas encore assez de positions fermées pour tracer la courbe.</p>';
  const L = largeurGraph(), H = 220, g = 40, d = 8, h = 10, b = 24;
  const t = points.map((p) => new Date(p.jour).getTime());
  const v = points.map((p) => p.pct);
  const vMin = Math.min(0, ...v), vMax = Math.max(0, ...v), marge = (vMax - vMin) * 0.08 || 1;
  const y0 = vMin - marge, y1 = vMax + marge;
  const X = (x) => g + ((x - t[0]) / (t.at(-1) - t[0] || 1)) * (L - g - d);
  const Y = (y) => h + (1 - (y - y0) / (y1 - y0)) * (H - h - b);
  const pas = Math.max(5, Math.ceil((y1 - y0) / 4 / 5) * 5);
  const lignes = [];
  for (let y = Math.ceil(y0 / pas) * pas; y <= y1; y += pas)
    lignes.push(`<line x1="${g}" x2="${L - d}" y1="${Y(y)}" y2="${Y(y)}" stroke="var(--grille)"/><text x="${g - 6}" y="${Y(y) + 4}" text-anchor="end">${signe(y, 0)} %</text>`);
  // années entières seulement (sinon la première étiquette chevauche la suivante)
  const ansTous = [...new Set(points.map((p) => p.jour.slice(0, 4)))];
  const ansPleins = ansTous.filter((a) => new Date(`${a}-01-01`).getTime() >= t[0]);
  const ans = ansPleins.length ? ansPleins : ansTous.slice(0, 1);
  const ecartAns = Math.ceil(ans.length / 6);
  const axeX = ans.filter((_, i) => i % ecartAns === 0).map((a) => `<text x="${X(new Date(`${a}-01-01`).getTime() < t[0] ? t[0] : new Date(`${a}-01-01`).getTime())}" y="${H - 6}" text-anchor="start">${a}</text>`).join('');
  const trace = points.map((p, i) => `${i ? 'L' : 'M'}${X(t[i]).toFixed(1)},${Y(p.pct).toFixed(1)}`).join('');
  const dernier = points.at(-1);
  return `<div class="graphique" data-courbe="${id}">
    <svg viewBox="0 0 ${L} ${H}" role="img" aria-label="Résultat cumulé en pourcentage du compte, de ${date(points[0].jour)} à ${date(dernier.jour)} : ${signe(dernier.pct)} %">
      ${lignes.join('')}
      <line x1="${g}" x2="${L - d}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--texte-3)" stroke-width="1"/>
      ${axeX}
      <path d="${trace}" fill="none" stroke="var(--serie)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${X(t.at(-1))}" cy="${Y(dernier.pct)}" r="4" fill="var(--serie)" stroke="var(--carte)" stroke-width="2"/>
      <text class="etiquette" x="${X(t.at(-1)) - 8}" y="${Y(dernier.pct) - 10}" text-anchor="end">${signe(dernier.pct)} %</text>
      <g class="viseur" visibility="hidden"><line y1="${h}" y2="${H - b}" stroke="var(--texte-3)" stroke-dasharray="3 3"/><circle r="5" fill="var(--serie)" stroke="var(--carte)" stroke-width="2"/></g>
      <rect class="zone" x="${g}" y="0" width="${L - g - d}" height="${H - b}" fill="transparent"/>
    </svg></div>`;
}
function activerCourbe(el, points) {
  const svg = el.querySelector('svg'), viseur = el.querySelector('.viseur');
  if (!svg) return;
  const L = largeurGraph(), g = 40, d = 8, h = 10, b = 24, H = 220;
  const t = points.map((p) => new Date(p.jour).getTime()), v = points.map((p) => p.pct);
  const vMin = Math.min(0, ...v), vMax = Math.max(0, ...v), marge = (vMax - vMin) * 0.08 || 1, y0 = vMin - marge, y1 = vMax + marge;
  const X = (x) => g + ((x - t[0]) / (t.at(-1) - t[0] || 1)) * (L - g - d);
  const Y = (y) => h + (1 - (y - y0) / (y1 - y0)) * (H - h - b);
  const bouger = (e) => {
    const r = svg.getBoundingClientRect();
    const xv = ((e.clientX - r.left) / r.width) * L;
    let k = 0; for (let i = 1; i < t.length; i++) if (Math.abs(X(t[i]) - xv) < Math.abs(X(t[k]) - xv)) k = i;
    const p = points[k];
    viseur.setAttribute('visibility', 'visible');
    viseur.querySelector('line').setAttribute('x1', X(t[k])); viseur.querySelector('line').setAttribute('x2', X(t[k]));
    viseur.querySelector('circle').setAttribute('cx', X(t[k])); viseur.querySelector('circle').setAttribute('cy', Y(p.pct));
    montrerBulle(`<b>${date(p.jour)}</b><br>Résultat cumulé : ${signe(p.pct)} %${p.marche ? `<br>${echap(p.marche)} : ${signe(p.R)} %` : ''}`, r.left + (X(t[k]) / L) * r.width, r.top + (Y(p.pct) / H) * r.height);
  };
  svg.addEventListener('pointermove', bouger);
  svg.addEventListener('pointerdown', bouger);
  svg.addEventListener('pointerleave', () => { viseur.setAttribute('visibility', 'hidden'); cacherBulle(); });
}

// ---------- Graphique : résultat par année (barres positives / négatives) ----------
function graphiqueAnnees(annees) {
  const L = largeurGraph(), H = 200, g = 40, d = 8, h = 16, b = 24;
  const v = annees.map((a) => a.pct);
  const max = Math.max(1, ...v.map(Math.abs)) * 1.12;
  const y0 = Math.min(0, ...v) < 0 ? -max : 0, y1 = Math.max(0, ...v) > 0 ? max : 0;
  const Y = (y) => h + (1 - (y - y0) / (y1 - y0)) * (H - h - b);
  const pasX = (L - g - d) / annees.length, larg = Math.min(28, pasX - 2);
  const r = 4;
  const barres = annees.map((a, i) => {
    const x = g + i * pasX + (pasX - larg) / 2, ya = Y(0), yb = Y(a.pct);
    const haut = Math.abs(yb - ya);
    if (haut < 0.5) return `<rect data-i="${i}" x="${x}" y="${ya - 1}" width="${larg}" height="2" fill="var(--texte-3)"/>`;
    const rr = Math.min(r, haut);
    // extrémité arrondie côté valeur, côté zéro bien droit
    const chemin = a.pct > 0
      ? `M${x},${ya}V${yb + rr}Q${x},${yb} ${x + rr},${yb}H${x + larg - rr}Q${x + larg},${yb} ${x + larg},${yb + rr}V${ya}Z`
      : `M${x},${ya}V${yb - rr}Q${x},${yb} ${x + rr},${yb}H${x + larg - rr}Q${x + larg},${yb} ${x + larg},${yb - rr}V${ya}Z`;
    return `<path data-i="${i}" d="${chemin}" fill="${a.pct > 0 ? 'var(--pos)' : 'var(--neg)'}"/>`;
  }).join('');
  const etiquettesX = annees.map((a, i) => (annees.length > 8 && i % 2 ? '' : `<text x="${g + i * pasX + pasX / 2}" y="${H - 6}" text-anchor="middle">${a.annee}</text>`)).join('');
  const iMax = v.indexOf(Math.max(...v)), iMin = v.indexOf(Math.min(...v));
  const etiq = [iMax, iMin].filter((i, k, t) => t.indexOf(i) === k && v[i] !== 0)
    .map((i) => `<text class="etiquette" x="${g + i * pasX + pasX / 2}" y="${v[i] > 0 ? Y(v[i]) - 5 : Y(v[i]) + 13}" text-anchor="middle">${signe(v[i])} %</text>`).join('');
  const cibles = annees.map((_, i) => `<rect class="cible" data-i="${i}" x="${g + i * pasX}" y="0" width="${pasX}" height="${H - b}" fill="transparent"/>`).join('');
  return `<div class="graphique" data-annees>
    <svg viewBox="0 0 ${L} ${H}" role="img" aria-label="Résultat par année en pourcentage du compte">
      <line x1="${g}" x2="${L - d}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--texte-3)"/>
      <text x="${g - 6}" y="${Y(0) + 4}" text-anchor="end">0 %</text>
      ${barres}${etiq}${etiquettesX}${cibles}
    </svg></div>`;
}
function activerAnnees(el, annees) {
  el.querySelectorAll('.cible').forEach((c) => {
    const voir = (e) => { const a = annees[c.dataset.i]; montrerBulle(`<b>${a.annee}</b><br>${a.pct > 0 ? 'Année gagnante' : a.pct < 0 ? 'Année perdante' : 'Année nulle'} : ${signe(a.pct)} %`, e.clientX, e.clientY); };
    c.addEventListener('pointermove', voir); c.addEventListener('pointerdown', voir);
    c.addEventListener('pointerleave', cacherBulle);
  });
}

// ---------- Pages ----------
function carteOuverte(o) {
  const t = lots(o.marche, o.ecartStop, o.entree), risque = t.risque;
  return `<article class="carte position">
    <div class="haut"><span class="nom">${echap(o.marche)}</span>${sens(o.sens)}</div>
    <dl class="grille-infos">
      <div><dt>Entrée (${date(o.jourEntree)})</dt><dd>${prix(o.marche, o.entree)}</dd></div>
      <div><dt>Prix actuel</dt><dd>${prix(o.marche, o.prixActuel)}</dd></div>
      <div><dt>Perte maximum</dt><dd>${prix(o.marche, o.stop)}</dd></div>
      <div><dt>Résultat en cours</dt><dd class="${classeGain(o.Rlatent)}">${signe(o.Rlatent)} %</dd></div>
      <div><dt>Confiance</dt><dd>${o.confiance}/6 ${pointsConfiance(o.confiance)}</dd></div>
      <div><dt>Taille conseillée</dt><dd>${texteLots(t)}</dd></div>
    </dl>
    ${o.sortieAnnoncee ? '<p class="alerte">Sortir à l\'ouverture : la tendance s\'essouffle.</p>' : ''}
    <p class="note">Pas d'objectif fixe : PipZen dira quand sortir. Taille calculée pour risquer ${nb(risque)} $ (1 % de ${nb(tailleCompte())} $).</p>
  </article>`;
}
function carteSignal(s) {
  const t = lots(s.marche, s.ecartStop, s.prixIndicatif);
  return `<article class="carte position">
    <div class="haut"><span class="nom">${echap(s.marche)}</span>${sens(s.sens)}</div>
    <p class="note">Signal du ${date(s.jourSignal)}, à prendre à l'ouverture du marché.</p>
    <dl class="grille-infos">
      <div><dt>Prix indicatif</dt><dd>${prix(s.marche, s.prixIndicatif)}</dd></div>
      <div><dt>Perte maximum indicative</dt><dd>${prix(s.marche, s.stopIndicatif)}</dd></div>
      <div><dt>Confiance</dt><dd>${s.confiance}/6 ${pointsConfiance(s.confiance)}</dd></div>
      <div><dt>Taille conseillée</dt><dd>${texteLots(t)}</dd></div>
    </dl></article>`;
}

// Message quand aucune position n'est ouverte
function aVenir() {
  const s = etat.reglage.seuilEntree;
  const prets = etat.marches.filter((m) => Math.abs(m.vote) >= s).map((m) => echap(m.marche));
  if (prets.length) return `Aucune position ouverte pour l'instant. ${prets.join(', ')} ${prets.length > 1 ? 'ont' : 'a'} déjà ${s} méthodes sur 6 d'accord ou plus : PipZen prendra position après la prochaine clôture du marché, et vous préviendra.`;
  return `Aucune position ouverte. PipZen attend qu'au moins ${s} méthodes sur 6 soient d'accord.`;
}

function pageAccueil() {
  const bi = etat.demo.bilan, total = bi.resultatPct + bi.latentPct;
  const solde = etat.compteDemo * (1 + total / 100);
  return `<h2>Compte démo PipZen</h2>
  <section class="carte">
    <div class="hero">
      <span class="libelle">Solde estimé</span><span class="libelle">Depuis le ${date(etat.departDemo)}</span>
      <span class="valeur">${nb(solde)} $</span><span class="valeur ${classeGain(total)}" style="font-size:24px">${signe(total)} %</span>
      <span class="detail">Départ ${nb(etat.compteDemo)} $ fictifs · 1 % risqué par position · mis à jour le ${new Date(etat.misAJour).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}</span>
    </div>
    <div class="chiffres">
      <div><b>${etat.demo.ouvertes.length}</b><span>ouverte(s)</span></div>
      <div><b>${bi.positions}</b><span>fermée(s)</span></div>
      <div><b>${bi.positions ? `${bi.reussitePct} %` : '–'}</b><span>gagnantes</span></div>
    </div>
  </section>
  ${etat.demo.signaux.length ? `<h2>À prendre à l'ouverture</h2>${etat.demo.signaux.map(carteSignal).join('')}` : ''}
  <h2>Positions ouvertes</h2>
  ${etat.demo.ouvertes.length ? etat.demo.ouvertes.map(carteOuverte).join('') : `<p class="vide carte">${aVenir()}</p>`}
  ${etat.demo.fermees.length ? `<h2>Dernières positions fermées</h2><section class="carte defile">${tableFermees(etat.demo.fermees.slice(0, 10))}</section>` : ''}
  <p class="note">Argent fictif. Les résultats passés ne garantissent pas les résultats futurs.</p>`;
}

function tableFermees(liste) {
  return `<table><thead><tr><th>Marché</th><th>Sens</th><th>Du → au</th><th class="n">Résultat</th></tr></thead><tbody>
    ${liste.map((f) => `<tr><td>${echap(f.marche)}</td><td>${f.sens > 0 ? 'Achat' : 'Vente'}</td><td>${date(f.jourEntree)} → ${date(f.jourSortie)}</td><td class="n ${classeGain(f.R)}">${signe(f.R)} %</td></tr>`).join('')}
  </tbody></table>`;
}

function pageMarches() {
  const seuil = etat.reglage.seuilEntree;
  return `<h2>Vote du ${date(etat.marches[0].jour)}</h2>
  <p class="note" style="margin:0 0 12px">Chaque méthode vote : hausse (+1), baisse (−1) ou rien (0). À ${seuil} sur 6 ou plus, PipZen prend position.</p>
  ${etat.marches.map((s) => {
    const pct = (Math.abs(s.vote) / 6) * 50;
    const couleur = s.vote > 0 ? 'var(--hausse)' : 'var(--baisse)';
    const verdict = s.vote >= seuil ? 'Tendance à la hausse' : s.vote <= -seuil ? 'Tendance à la baisse' : 'Pas de tendance claire';
    return `<article class="carte">
      <div class="position"><div class="haut"><span class="nom">${echap(s.marche)}</span><b style="font-variant-numeric:tabular-nums">${s.vote > 0 ? '+' : ''}${s.vote}/6</b></div></div>
      <p class="note" style="margin-top:2px">${verdict} · prix ${prix(s.marche, s.prix)}</p>
      <div class="jauge" role="img" aria-label="Vote ${s.vote} sur 6">
        <span class="seuil" style="left:${50 - (seuil / 6) * 50}%"></span><span class="seuil" style="left:${50 + (seuil / 6) * 50}%"></span>
        <span class="rempli" style="background:${couleur};${s.vote >= 0 ? `left:50%;width:${pct}%` : `right:50%;width:${pct}%`}"></span>
        <span class="milieu"></span>
      </div>
      <div class="echelle"><span>Baisse −6</span><span>0</span><span>Hausse +6</span></div>
      <ul class="methodes">${s.avis.map((a) => `<li><span>${echap(a.nom)}</span><span class="avis ${a.avis > 0 ? 'h' : a.avis < 0 ? 'b' : 'n'}">${a.avis > 0 ? '▲ Hausse' : a.avis < 0 ? '▼ Baisse' : '– Neutre'}</span></li>`).join('')}</ul>
    </article>`;
  }).join('')}`;
}

function pageResultats() {
  const d = etat.demo.bilan, hi = etat.historique.bilan;
  const courbeDemo = d.courbe.map((c, i) => ({ ...c, R: etat.demo.fermees.slice().reverse()[i]?.R, marche: etat.demo.fermees.slice().reverse()[i]?.marche }));
  return `<h2>Compte démo (en réel, depuis le ${date(etat.departDemo)})</h2>
  <section class="carte">
    <div class="chiffres" style="margin-top:0">
      <div><b class="${classeGain(d.resultatPct)}">${signe(d.resultatPct)} %</b><span>positions fermées</span></div>
      <div><b class="${classeGain(d.latentPct)}">${signe(d.latentPct)} %</b><span>en cours</span></div>
      <div><b>${d.positions}</b><span>fermée(s)</span></div>
    </div>
    ${graphiqueCourbe(courbeDemo, 'demo')}
  </section>

  <h2>Simulation sur le passé (2015 à aujourd'hui)</h2>
  <section class="carte">
    <div class="hero"><span class="libelle">Résultat cumulé</span><span></span>
      <span class="valeur ${classeGain(hi.resultatPct)}">${signe(hi.resultatPct)} %</span><span></span>
      <span class="detail">${hi.positions} positions · ${hi.reussitePct} % gagnantes · pire baisse ${nb(hi.chuteMaxPct, 1)} % · 1 % risqué par position</span>
    </div>
    ${graphiqueCourbe(hi.courbe, 'histo')}
  </section>
  <section class="carte">
    <b>Résultat par année</b>
    ${graphiqueAnnees(hi.parAnnee)}
    <details class="tableau"><summary>Voir le tableau</summary>
      <table><thead><tr><th>Année</th><th class="n">Résultat</th></tr></thead><tbody>
      ${hi.parAnnee.map((a) => `<tr><td>${a.annee}</td><td class="n ${classeGain(a.pct)}">${signe(a.pct)} %</td></tr>`).join('')}</tbody></table>
    </details>
    <p class="note">Beaucoup d'années perdent un peu ; les gains viennent de quelques grandes tendances (2022, 2026). C'est normal pour cette méthode, et rien ne garantit que cela se répète.</p>
  </section>
  <section class="carte defile"><b>30 dernières positions simulées</b>${tableFermees(etat.historique.dernieres)}</section>`;
}

function pageReglages() {
  return `<h2>Mon compte</h2>
  <section class="carte">
    <label class="champ" for="compte">Solde de mon compte démo XM (en $)</label>
    <input id="compte" type="number" min="100" step="100" inputmode="numeric" value="${tailleCompte()}">
    <p class="note">Sert à calculer la taille conseillée (1 % risqué par position). Gardé sur cet appareil seulement.</p>
  </section>
  <h2>Comment PipZen décide</h2>
  <section class="carte">
    <p style="margin-top:0">Chaque matin à 6 h, PipZen fait voter 6 méthodes sur les prix de la veille : ${etat.methodes.map(echap).join(', ')}.</p>
    <ol class="etapes">
      <li><b>Entrée</b> : au moins ${etat.reglage.seuilEntree} méthodes sur 6 d'accord.</li>
      <li><b>Perte maximum</b> : ${etat.reglage.multStop} fois la variation moyenne d'une journée.</li>
      <li><b>Sortie</b> : quand il ne reste que ${etat.reglage.seuilSortie} méthodes d'accord ou moins, ou si la perte maximum est touchée.</li>
      <li><b>Risque</b> : ${etat.risquePct} % du compte par position, jamais plus.</li>
    </ol>
  </section>
  <h2>Recevoir les signaux sur WhatsApp</h2>
  <section class="carte">
    <ol class="etapes">
      <li>Sur le site <b>callmebot.com</b> (service gratuit), rubrique WhatsApp, notez le numéro du service et enregistrez-le dans vos contacts.</li>
      <li>Envoyez-lui sur WhatsApp le message indiqué sur le site (en anglais : « I allow callmebot to send me messages »).</li>
      <li>Vous recevez une clé : ajoutez-la avec votre numéro dans les réglages secrets du projet (voir le guide).</li>
    </ol>
  </section>
  <h2>À savoir</h2>
  <section class="carte"><p style="margin:0">PipZen fonctionne en <b>argent fictif</b>. La majorité des particuliers perdent de l'argent sur le forex. Ne passez en réel qu'après 3 à 6 mois de résultats en démo, et seulement avec de l'argent que vous pouvez perdre.</p></section>`;
}

const PAGES = { accueil: pageAccueil, marches: pageMarches, resultats: pageResultats, reglages: pageReglages };

function afficher() {
  cacherBulle();
  document.querySelectorAll('.barre button').forEach((b) => b.classList.toggle('actif', b.dataset.page === page));
  if (!etat) return;
  contenu.innerHTML = PAGES[page]();
  if (page === 'resultats') {
    derniereLargeur = largeurGraph();
    const d = etat.demo.fermees.slice().reverse();
    const elDemo = contenu.querySelector('[data-courbe="demo"]');
    if (elDemo) activerCourbe(elDemo, etat.demo.bilan.courbe.map((c, i) => ({ ...c, R: d[i]?.R, marche: d[i]?.marche })));
    const elHisto = contenu.querySelector('[data-courbe="histo"]');
    if (elHisto) activerCourbe(elHisto, etat.historique.bilan.courbe);
    activerAnnees(contenu.querySelector('[data-annees]'), etat.historique.bilan.parAnnee);
  }
  if (page === 'reglages') {
    contenu.querySelector('#compte').addEventListener('change', (e) => { ecrire('pipzen-compte', Math.max(100, Number(e.target.value) || 50000)); });
  }
  window.scrollTo(0, 0);
}

document.querySelectorAll('.barre button').forEach((b) => b.addEventListener('click', () => { page = b.dataset.page; ecrire('pipzen-page', page); afficher(); }));
page = PAGES[lire('pipzen-page', 'accueil')] ? lire('pipzen-page', 'accueil') : 'accueil';

async function charger() {
  try {
    const r = await fetch(`donnees/etat.json?t=${Date.now()}`);
    if (!r.ok) throw new Error(r.status);
    etat = await r.json();
    afficher();
  } catch {
    contenu.innerHTML = '<p class="vide">Impossible de charger l\'analyse. Vérifiez votre connexion puis rouvrez PipZen.</p>';
  }
}
charger();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
