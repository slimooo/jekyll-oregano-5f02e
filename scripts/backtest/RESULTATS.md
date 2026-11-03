# Résultats du backtest — novembre 2026

Rejeu du moteur de notation de l'application (`lib/scoring.ts`) sur les comptes publiés à la SEC tels qu'ils étaient connus à chaque date, puis mesure des rendements totaux (dividendes réinvestis) obtenus ensuite. Protocole, sources et limites : `README.md` de ce dossier.

## En bref

- **Base mathématique : partiellement fiable.** Les ingrédients sont documentés par la recherche (valeur, rentabilité, endettement, rachats d'actions, risque de faillite), mais leur assemblage est heuristique : pondérations et seuils fixés à la main, sans calibration ni validation, critères redondants (le PER comptait quatre fois), poids totalisant 105 %, et une part importante du score (dividendes, croissance passée) sans pouvoir prédictif démontré.
- **Efficacité sur 2016-2026 : l'algorithme n'aurait pas battu le S&P 500.** Actions « Achat pertinent » au 31/10/2016 : 12,2 %/an (portefeuille équipondéré) contre 15,3 %/an pour le SPY et 13,4 %/an pour les actions « Pas pertinent ».
- **Il classe toutefois mieux que le hasard** : corrélation de rang score/rendement de +0,082 sur 10 ans (p = 0,001) et de +0,066 en moyenne annuelle (t = 2,34, positive 10 années sur 12). À exposition factorielle égale, la sélection « Achat » dégage un alpha Fama-French de +2,0 %/an (t = 2,28), mais son exposition à la valeur et aux petites capitalisations, délaissées pendant la décennie, l'a fait finir sous l'indice.
- **Sa vraie force : écarter les sociétés fragiles.** Parmi les 20 % de sociétés les moins bien notées sur leurs fondamentaux en 2016, 12,4 % ont fait faillite dans les dix ans, contre 0,7 % à 2,0 % parmi les 40 % les mieux notées (AUC 0,76).
- **Version 2** : corrige les incohérences relevées ; gains de performance faibles et non significatifs (IC 10 ans +0,082 → +0,101, « Achat » 12,2 % → 13,0 %/an, écart « Achat − Éviter » en formations annuelles −0,8 % → +0,1 %/an) ; détection des faillites préservée.

## 1. Analyse mathématique de la version 1

Le score est une moyenne pondérée de notes 0-10 obtenues par interpolation linéaire entre des seuils fixes, agrégées par thème puis globalement ; un critère sans donnée est retiré et les poids sont renormalisés. Ce n'est pas un modèle statistique : rien n'est estimé sur des données.

| # | Constat | Conséquence | Version 2 |
|---|---|---|---|
| 1 | Les poids des thèmes totalisent 105 (20+15+15+15+10+10+10+10). | Les pourcentages affichés sont faux (la valorisation pèse 19 %, pas 20 %). | Poids ramenés à 100. |
| 2 | Le PER intervient 4 fois : PER, PER × P/B, marge de Graham (= 1 − √(PER × P/B / 22,5), même information que PER × P/B) et 1/PER − taux 10 ans (constante près). | 60 % du thème valorisation dépend du PER ; double comptage. | Une seule marge de Graham ; écart au taux 10 ans affiché mais non noté. |
| 3 | Dette absente des données = 0. | Une société endettée mal renseignée obtient 10/10 sur trois critères de dette. | Dette inconnue si l'entreprise paie des intérêts. |
| 4 | Dette / capitaux propres : dette du dernier trimestre rapportée aux fonds propres du dernier exercice. | Ratio incohérent dans le temps. | Même exercice au numérateur et au dénominateur. |
| 5 | Capitaux propres négatifs = signal d'alerte et 0/10. | Pénalise des sociétés très rentables qui rachètent leurs actions (McDonald's, AutoZone…). | Jugées sur EBITDA et intérêts si rentables et couvrant leurs intérêts. |
| 6 | Altman Z (1968, estimé sur des industriels) appliqué à tous les secteurs. | Le terme ventes / actif dépend du secteur ; 12 % de l'univers 2016 en « détresse ». | Altman Z'' (1995) pour les sociétés non industrielles. |
| 7 | Dividendes : 15 % du score, non-payeurs notés 0 sur trois critères. | Un zéro sur un thème qui pèse 14 % du score : environ −8 à −10 points pour une société sans dividende par ailleurs bien notée ; or le rendement du dividende n'a pas de prime significative depuis 1963. | 10 %, rachats d'actions inclus, pas de pénalité automatique. |
| 8 | Croissance passée du chiffre d'affaires et de l'EBITDA récompensée jusqu'à +10 %/an (19 % du score avec les marges). | La croissance passée ne se prolonge pas et prédit plutôt de moins bons rendements. | 10 % au total, plafond à +4 / +5 %/an. |
| 9 | Seuils absolus identiques pour tous les secteurs et toutes les époques ; taux américain à 10 ans pour toutes les cotations. | Biais sectoriels permanents ; part des « Achat » dépendante du niveau du marché. | Inchangé (atténué par la comparaison aux concurrents). |
| 10 | Discontinuités (rendement > 9 % : la note passe de 10 à 4). | Instabilité du verdict pour de petites variations. | Inchangé. |

## 2. Protocole

- **Univers** : actions américaines déposant des 10-K, capitalisation ≥ 300 M$ à la date de formation (1 497 au 31/10/2016), hors coquilles et émetteurs étrangers.
- **Point-in-time** : seuls les chiffres déposés à la SEC avant la date de formation sont utilisés ; cours, dividendes et taux à 10 ans de la date.
- **Rendements** : cours ajustés des splits et scissions + dividendes réinvestis ; titre retiré de la cote après mi-2025 : produit réinvesti dans le SPY.
- **Références** : SPY (S&P 500, dividendes réinvestis), moyenne équipondérée de l'univers, facteurs Fama-French 5 + momentum (CRSP).
- **Tests** : formation unique au 31/10/2016 (10 ans) ; 12 formations annuelles de fin octobre 2014 à fin octobre 2025 (détention 1 an) ; sociétés disparues après 2016.

## 3. Version 1 — formation au 31/10/2016, détention 10 ans

SPY : **15,3 %/an** ; moyenne équipondérée de l'univers : **13,1 %/an**.

| Verdict 2016 | Actions | Équipondéré | Pondéré capi. | Médiane par titre | Titres battant le SPY | Alpha FF6 (t) |
|---|---|---|---|---|---|---|
| Achat pertinent | 369 | 12,2 % | 16,7 % | 8,9 % | 20 % | −0,5 % (−0,50) |
| À étudier / prix élevé | 617 | 13,3 % | 16,0 % | 9,0 % | 23 % | −1,0 % (−0,88) |
| Pas pertinent | 511 | 13,4 % | 14,2 % | 7,8 % | 24 % | −0,8 % (−0,72) |

- Le portefeuille « Achat » pondéré par la capitalisation bat le SPY uniquement grâce à Apple (10 % du portefeuille, +29,5 %/an) : sans Apple, 14,1 %/an.
- Quintiles de score (équipondéré, Q1 → Q5) : 13,9 % ; 11,9 % ; 14,0 % ; 13,2 % ; 12,1 %. Écart Q5 − Q1 : −2,3 %/an (t = −0,70).
- Grandes capitalisations (≥ 10 Md$, 346 actions) : IC +0,172 ; « Achat » 16,0 %/an, « Pas pertinent » 15,0 %/an.
- Les plus fortes hausses 2016-2026 étaient des valeurs chères ou en pertes, donc mal notées : Nvidia (« À étudier », 59), AMD (« Pas pertinent », 8), Micron, Tesla (16), Broadcom, Eli Lilly.

## 4. Version 1 — formations annuelles 2014-2025 (détention 1 an)

IC moyen +0,066 (t = 2,34) ; intra-secteur +0,047 (t = 1,65).

| Groupe | Rendement annuel | Volatilité | Perte max. | Sharpe | Alpha FF6 (t) |
|---|---|---|---|---|---|
| Achat pertinent | 12,1 % | 18,7 % | −33,7 % | 0,60 | +2,0 % (2,28) |
| À étudier | 11,0 % | 16,9 % | −29,2 % | 0,59 | −0,7 % (−0,84) |
| Pas pertinent | 12,4 % | 21,4 % | −30,9 % | 0,56 | +0,6 % (0,66) |
| Quintile 1 (scores bas) | 14,0 % | 24,3 % | −36,3 % | 0,58 | +2,2 % (1,79) |
| Quintile 5 (scores hauts) | 12,0 % | 18,5 % | −32,8 % | 0,60 | +1,9 % (2,22) |
| Univers équipondéré | 11,8 % | 18,6 % | −30,9 % | 0,59 | +0,3 % (0,41) |
| SPY | 13,5 % | 14,8 % | −23,9 % | 0,80 | −0,1 % (−0,47) |

| Formation | Actions | IC | SPY | Achat | À étudier | Pas pertinent |
|---|---|---|---|---|---|---|
| 2014 | 1 377 | +0,042 | +5,2 % | +2,9 % | +3,1 % | +1,3 % |
| 2015 | 1 457 | +0,099 | +4,4 % | +9,0 % | +7,7 % | +4,3 % |
| 2016 | 1 497 | +0,054 | +23,4 % | +30,4 % | +28,5 % | +28,9 % |
| 2017 | 1 602 | +0,014 | +7,2 % | +2,9 % | +5,6 % | +5,7 % |
| 2018 | 1 659 | +0,073 | +14,3 % | +11,9 % | +11,6 % | +8,8 % |
| 2019 | 1 739 | −0,138 | +9,8 % | −13,3 % | −1,6 % | +12,1 % |
| 2020 | 1 776 | +0,066 | +42,6 % | +61,9 % | +51,5 % | +68,4 % |
| 2021 | 1 984 | +0,248 | −14,6 % | −1,5 % | −11,9 % | −18,4 % |
| 2022 | 2 108 | +0,116 | +10,0 % | −4,1 % | +0,1 % | −9,7 % |
| 2023 | 2 092 | +0,053 | +37,8 % | +33,0 % | +28,7 % | +36,7 % |
| 2024 | 2 186 | −0,024 | +21,4 % | +4,8 % | +5,8 % | +20,4 % |
| 2025 | 2 271 | +0,192 | +12,0 % | +26,2 % | +16,0 % | +13,4 % |

## 5. Sociétés disparues après 2016 (biais de survie)

Les cours des sociétés retirées de la cote avant mi-2025 sont absents ; leurs comptes SEC restent disponibles. Sur 2 254 sociétés de plus de 300 M$ en 2016 : 1 497 encore cotées, 644 rachetées ou fusionnées, 91 en faillite.

| Quintile du score « fondamentaux seuls » (2016) | Faillite | Rachat / fusion |
|---|---|---|
| Q1 (le plus faible) | 12,4 % | 35,0 % |
| Q2 | 3,5 % | 34,8 % |
| Q3 | 1,6 % | 27,1 % |
| Q4 | 0,7 % | 25,9 % |
| Q5 (le plus élevé) | 2,0 % | 20,0 % |

AUC de détection des faillites : 0,76 (v2 : 0,75). Avec un signal d'alerte fondamental (perte, Piotroski faible, capitaux propres négatifs) : 9,6 % de faillites, contre 2,0 % sans. Les faillites, concentrées dans les scores bas, manquent au backtest principal : celui-ci est donc défavorable à l'algorithme ; les rachats (souvent avec prime), plus fréquents aussi dans les scores bas, jouent en sens inverse.

## 6. Quels critères prédisent les rendements ?

IC moyen sur les 12 formations annuelles (horizon 1 an), version 1 :

| Critère | IC moyen | t | Années positives |
|---|---|---|---|
| Bénéficiaire chaque année | +0,070 | 2,43 | 8/12 |
| Cash-flow libre positif | +0,066 | 2,46 | 10/12 |
| Évolution du nombre d'actions | +0,060 | 2,69 | 9/12 |
| ROE moyen | +0,058 | 2,29 | 8/12 |
| Ancienneté du dividende | +0,048 | 1,25 | 7/12 |
| Taux de distribution | +0,047 | 2,04 | 8/12 |
| PER | +0,047 | 1,31 | 8/12 |
| Couverture des intérêts | +0,043 | 1,67 | 9/12 |
| Rendement du dividende | +0,042 | 0,98 | 8/12 |
| Années de bénéfices pour rembourser la dette | +0,041 | 2,40 | 10/12 |
| Altman Z | +0,024 | 0,87 | 7/12 |
| Marge de sécurité de Graham | +0,023 | 0,47 | 7/12 |
| Piotroski F-Score | +0,014 | 0,68 | 6/12 |
| Régularité du chiffre d'affaires | +0,014 | 0,56 | 7/12 |
| Cours / valeur comptable | −0,005 | −0,09 | 4/12 |
| VE / EBITDA | −0,006 | −0,16 | 6/12 |
| Croissance du chiffre d'affaires | −0,010 | −0,35 | 6/12 |
| Dette / capitaux propres | −0,014 | −0,75 | 6/12 |
| Niveau de trésorerie | −0,017 | −0,62 | 6/12 |
| Ratio de liquidité générale | −0,023 | −0,98 | 4/12 |

Sur l'horizon de 10 ans (formation 2016), la croissance passée du chiffre d'affaires a un IC négatif (−0,054, p = 0,04) et l'ancienneté du dividende est neutre (+0,012).

## 7. Ce que dit la recherche (données CRSP de Ken French, sans biais de survie)

Écart annuel moyen entre le groupe « favorable » et le groupe « défavorable » de chaque critère, portefeuilles pondérés par la capitalisation : 30 % extrêmes (dividende : parmi les sociétés qui en versent ; investissement : faible contre forte croissance des actifs) ; émissions nettes : sociétés qui rachètent contre les 20 % qui émettent le plus ; accruals : quintiles extrêmes.

| Critère | 1963-2026 | t | 2016-2026 | t |
|---|---|---|---|---|
| E/P (bénéfice / cours) | +2,9 % | 2,15 | −3,4 % | −0,72 |
| B/M (valeur comptable / cours) | +3,0 % | 2,13 | −0,9 % | −0,17 |
| CF/P (cash-flow / cours) | +2,2 % | 1,64 | −4,6 % | −0,98 |
| D/P (rendement du dividende) | +0,3 % | 0,17 | −6,4 % | −1,36 |
| OP (rentabilité opérationnelle) | +2,8 % | 2,41 | +3,6 % | 1,03 |
| INV (croissance des actifs) | +2,2 % | 1,90 | −1,4 % | −0,36 |
| NI (émissions nettes d'actions) | +5,7 % | 4,55 | +4,5 % | 1,02 |
| AC (accruals) | +3,3 % | 3,20 | +2,1 % | 0,75 |

Le facteur valeur (HML) a rapporté +3,0 %/an sur 1963-2026, mais −13,2 %/an entre fin 2016 et fin 2020 (5e plus mauvaise période de quatre ans sur 712 depuis 1963), puis +7,3 %/an ensuite ; sur les dix ans du test, −1,5 %/an, parmi les 20 % des plus mauvaises décennies.

## 8. Version 2 — changements et résultats

Les changements découlent de l'analyse mathématique (§ 1) et de travaux publiés avant 2016 (Lakonishok, Shleifer et Vishny 1994 ; Sloan 1996 ; Altman 1995 ; Chan, Karceski et Lakonishok 2003 ; Boudoukh et al. 2007 ; Pontiff et Woodgate 2008 ; Novy-Marx 2013 ; Fama et French 2015). Ils ont toutefois été arrêtés après examen des résultats 2016 : le test 2016-2026 de la v2 n'est donc **pas** un test hors échantillon pur.

| Mesure | Version 1 | Version 2 |
|---|---|---|
| IC sur 10 ans (formation 2016) | +0,082 | +0,101 |
| IC sur 10 ans, grandes capitalisations | +0,172 | +0,195 |
| « Achat » sur 10 ans, équipondéré | 12,2 % | 13,0 % |
| « Pas pertinent » sur 10 ans, équipondéré | 13,4 % | 12,8 % |
| Écart Q5 − Q1 sur 10 ans | −2,3 % | −0,8 % |
| IC annuel moyen (12 formations) | +0,066 (t = 2,34) | +0,064 (t = 2,08) |
| « Achat », formations annuelles | 12,1 % | 12,3 % |
| Alpha FF6 « Achat », formations annuelles | +2,0 % (t = 2,28) | +2,1 % (t = 2,48) |
| Écart « Achat − Éviter », formations annuelles | −0,8 % | +0,1 % |
| AUC de détection des faillites | 0,76 | 0,75 |

La v2 est plus cohérente et légèrement meilleure sur la plupart des mesures, mais les écarts restent dans la marge statistique. Aucune version ne bat le S&P 500 sur la période.

## 9. Limites

- États-Unis uniquement ; les cotations européennes et asiatiques de l'application ne sont pas testées.
- Une seule décennie pour l'horizon de 10 ans, particulière (domination des très grandes valeurs de croissance, crise de la valeur 2017-2020).
- Sociétés rachetées absentes des rendements (voir § 5).
- Comptes annuels uniquement (les champs « 12 derniers mois » de Yahoo sont approchés par le dernier exercice) ; reconstitution imparfaite de certains postes (dette, EBITDA) pour quelques sociétés.
- Les performances passées ne préjugent pas des performances futures.
