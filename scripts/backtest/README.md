# Backtest de l'algorithme « Valeur Fondamentale »

Ce dossier rejoue **le moteur de notation de l'application** (`lib/scoring.ts`, exactement le même code)
sur des données historiques telles qu'elles étaient connues à chaque date, puis mesure les rendements
obtenus ensuite. Il a servi à évaluer la version 1 de l'algorithme et à valider la version 2
(voir la page « Méthode » de l'application et `RESULTATS.md`).

## Principe

1. **Snapshots « point-in-time »** (`build_snapshots.py`) : pour une date de formation F (fin octobre),
   on reconstitue les comptes annuels publiés **avant F** à partir des dépôts XBRL de la SEC (10-K) :
   chaque chiffre porte sa date de dépôt, ce qui élimine le biais d'anticipation. Le cours, la
   capitalisation, les dividendes versés et le taux à 10 ans sont ceux de la date F.
   Les champs sont produits sous les noms Yahoo attendus par le moteur (`totalRevenue`, `EBITDA`…).
2. **Notation** (`run_scoring.ts`) : chaque snapshot passe dans `computeAnalysis` ; les concurrents sont
   choisis comme dans l'app (même industrie Yahoo, capitalisation la plus proche, 6 au plus).
3. **Évaluation** :
   - `evaluate.py` : formation unique (31/10/2016) et détention 10 ans ; rendement total dividendes
     réinvestis, portefeuilles équipondérés et pondérés par la capitalisation par verdict et par quintile,
     comparaison au SPY, corrélation de rang (IC), régressions CAPM et Fama-French 5 facteurs + momentum ;
   - `evaluate_annual.py` : formations annuelles 2014-2025, portefeuilles rééquilibrés chaque année ;
   - `survivorship.py` : sociétés **disparues** après 2016 (faillites, rachats) d'après leurs comptes SEC ;
   - `factors.py` : performance, depuis 1963, des facteurs académiques qui fondent les critères.

## Sources de données

| Donnée | Source | Licence / conditions |
|---|---|---|
| Comptes annuels, actions en circulation, flottant | SEC EDGAR, API `data.sec.gov` (companyfacts, submissions) | Domaine public (limite : 10 requêtes/s) |
| Cours ajustés (splits et scissions), dividendes, splits, secteur/industrie, taux du Trésor | Hugging Face `defeatbeta/yahoo-finance-data` (données Yahoo Finance) | ODC-BY, usage recherche/éducation |
| Facteurs et portefeuilles triés (CRSP) | Ken French Data Library | Usage libre avec citation |

Les données téléchargées ne sont pas versionnées (plusieurs Go).

## Reproduire

```bash
pip install -r scripts/backtest/requirements.txt
DATA=/chemin/vers/donnees   # contient hf_defeatbeta/, sec/companyfacts/, sec/submissions/, french/csv/
python3 -I scripts/backtest/build_snapshots.py --data $DATA --out snap.jsonl --dates 2016-10-31 --gone ciks_disparus.txt
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/backtest/run_scoring.ts --in snap.jsonl --out scores.jsonl
python3 -I scripts/backtest/evaluate.py --data $DATA --scores scores.jsonl --start 2016-10-31 --end 2026-10-30 --out eval.json
python3 -I scripts/backtest/survivorship.py --scores scores.jsonl --asof 2016-10-31 --out surv.json
python3 -I scripts/backtest/factors.py --data $DATA --out factors.json

# Formations annuelles (fin octobre 2014 à 2025, détention 1 an)
python3 -I scripts/backtest/build_snapshots.py --data $DATA --out snap_annual.jsonl --gone ciks_disparus.txt \
  --dates 2014-10-31 2015-10-30 2016-10-31 2017-10-31 2018-10-31 2019-10-31 2020-10-30 2021-10-29 2022-10-31 2023-10-31 2024-10-31 2025-10-31
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/backtest/run_scoring.ts --in snap_annual.jsonl --out scores_annual.jsonl
python3 -I scripts/backtest/evaluate_annual.py --data $DATA --scores scores_annual.jsonl --end 2026-10-30 --out annual.json
python3 -I scripts/backtest/criteria_ic.py --data $DATA --scores scores_annual.jsonl --end 2026-10-30 --out criteria_ic.json
```

`ciks_disparus.txt` : CIK des sociétés dont le flottant SEC dépassait 300 M$ mi-2015 (cadre XBRL
`dei/EntityPublicFloat/USD/CY2015Q2I`) et absentes de la source de cours ; leurs fichiers companyfacts
et submissions doivent être téléchargés comme les autres (débit limité à quelques requêtes par seconde).

Pour rejouer la version 1 : `git show cbf348d:lib/scoring.ts > /tmp/scoring_v1.ts` puis `--engine /tmp/scoring_v1.ts`.

## Limites connues

- **États-Unis uniquement** : seule la SEC publie des comptes historiques structurés et datés gratuitement.
  Les cotations européennes et asiatiques de l'app ne sont pas testées.
- **Biais de survie** : la source de cours ne contient pas les sociétés retirées de la cote avant mi-2025
  (environ un tiers de l'univers 2016, surtout des rachats). Elles sont analysées à part
  (`survivorship.py`) à partir de leurs comptes ; leurs rendements restent inconnus.
- **Données annuelles** : les champs « 12 derniers mois » de Yahoo sont approchés par le dernier
  exercice publié (10 mois de décalage au plus pour un exercice clos en décembre).
- **Reconstitution de concepts** : la dette, l'EBITDA ou la trésorerie sont reconstruits à partir des
  concepts XBRL publiés ; quelques sociétés utilisent des concepts propres et sont moins bien couvertes.
- **Une seule décennie** pour l'horizon de 10 ans (2016-2026), dominée par les très grandes valeurs
  de croissance : un résultat sur une décennie ne prouve pas qu'il se reproduira.
