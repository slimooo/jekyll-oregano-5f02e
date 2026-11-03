# Valeur Fondamentale

Application web mobile (Next.js) qui indique s'il est pertinent d'acheter une action, selon les critères de Warren Buffett et Benjamin Graham.

- **Critères** : dividendes (ancienneté, régularité, rendement, taux de distribution), endettement (dette/capitaux propres, dette nette/EBITDA, couverture et taux moyen de la dette, règle Buffett des années de bénéfices), trésorerie, valorisation au prix actuel (PER, P/B, nombre de Graham, VE/EBITDA, rendement FCF, rendement des bénéfices vs taux 10 ans), chiffre d'affaires, EBITDA, qualité (ROE, marges, Piotroski F-Score, Altman Z-Score) et comparaison avec les concurrents de la même industrie.
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

Outil pédagogique, pas un conseil en investissement.
