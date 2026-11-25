# PipZen : guide de mise en route

PipZen analyse chaque matin à 6 h (heure d'Abidjan) l'EUR/USD, le GBP/USD, l'USD/JPY et l'or.
Six méthodes votent. Quand au moins 4 sont d'accord, PipZen prend position sur son compte démo,
vous prévient sur WhatsApp et affiche tout dans l'application. Tout est gratuit.

**Argent fictif uniquement** pendant 3 à 6 mois avant de penser au réel.

## Ce qui est déjà prêt

| Partie | Où | Rôle |
|---|---|---|
| Moteur de décision | `moteur/moteur.js` | Les 6 méthodes, le vote, la perte maximum, la sortie |
| Analyse du matin | `moteur/analyse.js` | Télécharge les prix, tient le compte démo, écrit `app/donnees/etat.json` |
| Messages WhatsApp | `moteur/whatsapp.js` | Entrée, sortie et résultat de chaque position |
| Application | `app/` | Web et Android (installable depuis Chrome) |
| Automatisation | `.github/workflows/analyse.yml` | Lance l'analyse chaque matin sur les serveurs gratuits de GitHub |
| Tests sur le passé | `backtest/` | Les études qui ont permis de choisir la méthode |

## Étapes à faire une seule fois

### 1. Mettre le projet sur GitHub
1. Sur github.com, cliquez sur **New repository**.
2. Nom : `pipzen`. Visibilité : **Public**, car c'est obligatoire pour avoir le site gratuit.
   Le code et les signaux démo seront visibles par tous, mais aucun secret ne s'y trouve.
3. Ne cochez rien d'autre, puis cliquez sur **Create repository**.
4. Dites-le à Claude : il enverra le projet.

### 2. Activer le site de l'application
Dans le dépôt : **Settings → Pages → Source : GitHub Actions**.

### 3. Recevoir les messages WhatsApp (gratuit, CallMeBot)
1. Sur **callmebot.com**, rubrique WhatsApp, notez le numéro du service et enregistrez-le dans vos contacts.
2. Envoyez-lui sur WhatsApp le message indiqué sur le site (« I allow callmebot to send me messages »).
3. Vous recevez une **clé** (apikey).
4. Dans le dépôt : **Settings → Secrets and variables → Actions → New repository secret**, puis créez deux secrets :
   - `CALLMEBOT_TELEPHONE` : votre numéro au format international, par exemple `+225XXXXXXXXXX` ;
   - `CALLMEBOT_CLE` : la clé reçue.

   Ces secrets restent cachés, même si le dépôt est public.

### 4. Première analyse
Dans le dépôt : **Actions → Analyse quotidienne PipZen → Run workflow**.
Après 1 à 2 minutes, vous recevez le message « PipZen est en marche » sur WhatsApp.
Ensuite, l'analyse se lance toute seule chaque matin, du lundi au samedi.

### 5. Installer l'application sur Android
1. Ouvrez **https://blessingmignon47-hash.github.io/pipzen/** dans Chrome.
2. Menu **⋮ → Ajouter à l'écran d'accueil**.

### 6. Compte démo XM
1. Ouvrez un compte **démo MT5** chez XM avec **50 000 $** fictifs. Avec moins, la plus petite
   position possible sur l'or risquerait plus de 1 % du compte.
2. À chaque message PipZen, passez l'ordre sur MT5 avec la taille indiquée, puis la perte maximum (« Stop Loss »).
3. Si vous choisissez un autre montant, indiquez-le dans **Réglages** de l'application.

## Lancer l'analyse sur l'ordinateur (facultatif)

```powershell
cd C:\Users\hp\Documents\pipzen
node moteur/analyse.js --sans-envoi
```

## La méthode, en résumé
- **Entrée :** au moins 4 méthodes sur 6 d'accord (2 cassures, 2 croisements de moyennes, 2 élans).
- **Perte maximum :** 3 fois la variation moyenne d'une journée.
- **Sortie :** quand il ne reste que 2 méthodes d'accord ou moins.
- **Risque :** 1 % du compte par position.
- **Sur le passé (2015-2026) :** environ +17 % au total, 30 % de positions gagnantes, pire baisse de 13 %.
  La plupart des années perdent un peu ; les gains viennent de quelques grandes tendances.
  Rien ne garantit que cela se répète.

## Étapes suivantes (après 3 à 6 mois de démo)
- **Niveau 2 :** PipZen prépare l'ordre sur MT5 et vous le validez d'un clic (ordinateur Windows allumé).
- **Niveau 3 :** PipZen passe les ordres lui-même.
- **Plus tard :** comptes clients et abonnements.
