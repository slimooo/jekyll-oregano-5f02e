# Valeur Fondamentale

Application web mobile (Next.js) qui indique s'il est pertinent d'acheter une action, selon les critères de Warren Buffett et Benjamin Graham.

- **Critères (version 2)** : valorisation au prix actuel (PER, P/B, marge de sécurité de Graham, VE/EBITDA, rendement FCF), qualité (ROE, rentabilité brute des actifs, qualité des bénéfices, marges, régularité des bénéfices, intensité capitalistique, Piotroski F-Score, Altman Z''-Score), endettement (dette/capitaux propres, dette nette/EBITDA, couverture et taux moyen de la dette, règle Buffett des années de bénéfices), trésorerie, dividendes & rachats d'actions, chiffre d'affaires, EBITDA et comparaison avec les concurrents de la même industrie. Détail et pondérations : page « Méthode ».
- **Exclus** : évolution du cours, objectifs d'analystes, prévisions.
- **Base** : ~13 000 actions (`data/stocks.json`, cotations principales US / Europe / Asie-Pacifique / Canada) + recherche en ligne (nom, ticker, ISIN).
- **Favoris** : enregistrés sur l'appareil (localStorage).
- **Données** : Yahoo Finance (`yahoo-finance2`), aucune clé d'API requise.

## Développement

```bash
npm install
npm run dev        # http://localhost:3000
npm run build-db   # régénère la base d'actions (facultatif)
```

## Déploiement Vercel

Importer le dépôt sur Vercel (framework Next.js détecté automatiquement), ou :

```bash
npx vercel --prod
```

## Moteur et backtest

- `lib/scoring.ts` : moteur de notation pur (sans réseau), utilisé par l'app et par le backtest.
- `lib/analysis.ts` : chargement des données Yahoo puis appel du moteur.
- `scripts/backtest/` : rejeu de l'algorithme sur les comptes SEC « point-in-time » de 2014 à 2025 et mesure des rendements ultérieurs (voir `scripts/backtest/README.md` et `scripts/backtest/RESULTATS.md`).

Outil pédagogique, pas un conseil en investissement.
