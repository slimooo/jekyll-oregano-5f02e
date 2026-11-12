export const metadata = { title: 'Méthode — Valeur Fondamentale' };

const CATS: [string, string, string[]][] = [
  ['Prix actuel (valorisation)', '25 %', [
    'PER ≤ 15 et cours / valeur comptable ≤ 1,5 (Benjamin Graham, « The Intelligent Investor »).',
    'Marge de sécurité du nombre de Graham √(22,5 × BPA × actif net par action), soit PER × P/B ≤ 22,5 : marge visée ≥ 33 %.',
    'VE / EBITDA et rendement du cash-flow libre (FCF / capitalisation).',
    'Rendement des bénéfices (1 / PER) comparé au taux d’État à 10 ans : affiché à titre indicatif, non noté (entre deux actions, il ne dépend que du PER).',
  ]],
  ['Qualité & solidité', '20 %', [
    'ROE ≥ 15 %, marge nette > 10 %, bénéficiaire chaque année (Graham) : signes d’un avantage concurrentiel durable (« moat »).',
    'Rentabilité brute des actifs (marge brute / actif, Robert Novy-Marx, 2013) et qualité des bénéfices : un bénéfice couvert par le cash-flow d’exploitation (Richard Sloan, 1996).',
    'Faibles besoins d’investissement (Buffett ; facteur « investissement » de Fama et French, 2015).',
    'Piotroski F-Score (9 tests comptables, 2000) et Altman Z’’-Score (risque de faillite, version 1995 adaptée aux entreprises non industrielles).',
  ]],
  ['Endettement', '15 %', [
    'Dette / capitaux propres < 0,5 (Buffett) ; dette nette / EBITDA < 2-3.',
    'Couverture des intérêts par l’EBIT et taux moyen payé sur la dette (charges d’intérêts / dette).',
    'Règle de Buffett : la dette long terme doit pouvoir être remboursée avec ≤ 3-4 années de bénéfice net.',
    'Capitaux propres négatifs dus aux rachats d’actions d’une société rentable (ex. McDonald’s) : jugés sur l’EBITDA et les intérêts, sans pénalité automatique.',
    'Banques et assurances : on mesure plutôt les fonds propres rapportés au bilan.',
  ]],
  ['Trésorerie', '10 %', ['Trésorerie / dette, part de la capitalisation en liquidités, ratio de liquidité générale (Graham ≥ 2), régularité du cash-flow libre.']],
  ['Dividendes & rachats', '10 %', [
    'Rendement pour l’actionnaire : dividende + rachats nets d’actions sur un an (Boudoukh et al., 2007).',
    'Évolution du nombre d’actions : les rachats sont favorables, la dilution défavorable (Pontiff et Woodgate, 2008).',
    'Pour les sociétés qui versent un dividende : ancienneté (≥ 25 ans = « aristocrate »), absence de baisse, rendement (3 – 9 % ; au-delà, risque de piège) et taux de distribution (≤ 60 % soutenable).',
  ]],
  ['Face aux concurrents', '10 %', ['Position de l’action par rapport à des concurrents de la même industrie et de taille comparable : PER, VE/EBITDA, rendement, marge nette, ROE, dette.']],
  ['Chiffre d’affaires', '5 %', ['Croissance annuelle moyenne (plafonnée à +4 %/an : une croissance rapide n’apporte pas de points supplémentaires) et régularité (nombre d’années en hausse).']],
  ['EBITDA', '5 %', ['Marge d’EBITDA, croissance historique (plafonnée à +5 %/an) et évolution de la marge (pouvoir de fixation des prix).']],
];

const CHANGES: string[] = [
  'Les poids des thèmes totalisent désormais 100 % (105 % auparavant).',
  'Le PER n’est plus compté quatre fois : la règle « PER × P/B ≤ 22,5 » faisait double emploi avec la marge de sécurité de Graham, et l’écart au taux à 10 ans avec le PER.',
  'Une dette absente des données n’est plus supposée nulle quand l’entreprise paie des intérêts.',
  'Les sociétés sans dividende ne sont plus pénalisées automatiquement : les rachats d’actions comptent comme une rémunération de l’actionnaire.',
  'La croissance passée du chiffre d’affaires pèse moins et n’est plus récompensée au-delà de +4 %/an : elle ne se prolonge pas (Chan, Karceski et Lakonishok, 2003) et une forte croissance passée annonce plutôt des rendements inférieurs (Lakonishok, Shleifer et Vishny, 1994).',
  'L’Altman Z (1968, estimé sur des industriels) est remplacé par le Z’’ (1995), conçu pour tous les secteurs non financiers ; il n’est pas appliqué quand les rachats d’actions ont rendu les fonds propres négatifs.',
  'Le seuil « Achat pertinent » passe de 68 à 70 pour garder la même sélectivité (environ un quart des actions).',
];

export default function Methode() {
  return (
    <>
      <h1>Méthode</h1>
      <p className="sub">Une approche « value investing » inspirée de Warren Buffett et Benjamin Graham, fondée uniquement sur des faits publiés.</p>
      <section className="card">
        <h2>Ce qui est exclu</h2>
        <ul>
          <li>L’évolution passée du cours de bourse (momentum, plus-hauts, tendances).</li>
          <li>Les objectifs de cours, recommandations et prévisions des analystes.</li>
          <li>Toute hypothèse de croissance future : seuls les comptes annuels publiés et les dividendes effectivement versés sont utilisés.</li>
        </ul>
      </section>
      <section className="card">
        <h2>Calcul du score</h2>
        <p style={{ fontSize: '.92rem' }}>Chaque critère reçoit une note de 0 à 10 selon des seuils reconnus. Les notes forment un score par thème, puis un score global sur 100 pondéré :</p>
        {CATS.map(([t, w, items]) => (
          <div key={t} className="crit">
            <div className="crit-top"><span className="crit-label">{t}</span><span className="tag">{w}</span></div>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: '.88rem' }}>{items.map(i => <li key={i}>{i}</li>)}</ul>
          </div>
        ))}
        <p className="muted">Un critère sans donnée ou non applicable (ex. EBITDA d’une banque, ancienneté du dividende d’une société qui n’en verse pas) est exclu du calcul plutôt que noté zéro.</p>
      </section>
      <section className="card">
        <h2>Prix d’achat</h2>
        <p style={{ fontSize: '.92rem' }}>Pour chaque méthode de valorisation, l’application calcule le cours auquel le critère obtiendrait la note maximale (<strong>prix d’achat intéressant</strong>) et celui où il resterait favorable (<strong>prix raisonnable maximum</strong>). Les prix affichés sont la médiane des méthodes disponibles :</p>
        <ul style={{ fontSize: '.88rem' }}>
          <li><strong>Nombre de Graham</strong> : √(22,5 × BPA × actif net par action), acheté avec 33 % de marge de sécurité.</li>
          <li><strong>PER</strong> : achat à 15 fois le bénéfice (Graham), raisonnable jusqu’à 21.</li>
          <li><strong>VE / EBITDA</strong> : achat à 7 fois l’EBITDA, raisonnable jusqu’à 10,9, dette nette déduite.</li>
          <li><strong>Cash-flow libre</strong> : achat à 8 % de rendement, raisonnable jusqu’à 5,6 %.</li>
          <li><strong>Banques et assurances</strong> : 1,5 fois l’actif net (raisonnable jusqu’à 1,95) à la place de l’EBITDA et du cash-flow.</li>
        </ul>
        <p className="muted">Zone verte : cours ≤ prix d’achat. Jaune : jusqu’au prix raisonnable. Rouge : au-delà. Une entreprise en perte n’a pas de prix d’achat calculable.</p>
      </section>
      <section className="card">
        <h2>Lire les échelles</h2>
        <p style={{ fontSize: '.92rem' }}>Chaque critère est placé sur une échelle rouge / jaune / vert. Les seuils correspondent exactement à la notation : rouge sous 4/10, jaune de 4 à 7/10, vert au-delà.</p>
      </section>
      <section className="card">
        <h2>Verdict</h2>
        <ul style={{ fontSize: '.92rem' }}>
          <li><strong className="lvl-buy">Achat pertinent</strong> : score ≥ 70, valorisation raisonnable et aucun signal d’alerte.</li>
          <li><strong className="lvl-watch">Bonne entreprise, prix élevé / À étudier</strong> : score entre 52 et 70, ou excellente qualité mais sans marge de sécurité.</li>
          <li><strong className="lvl-avoid">Pas pertinent actuellement</strong> : score &lt; 52 ou plusieurs signaux d’alerte (pertes, capitaux propres négatifs, dividende non couvert, Altman Z’’ en zone de détresse…).</li>
        </ul>
      </section>
      <section className="card">
        <h2>Ce que disent les données</h2>
        <p style={{ fontSize: '.9rem' }}>
          L’algorithme a été rejoué sur les comptes publiés à la SEC tels qu’ils étaient connus au 31 octobre 2016
          (environ 1 500 actions américaines de plus de 300 M$), puis sur chaque fin octobre de 2014 à 2025.
        </p>
        <ul style={{ fontSize: '.88rem' }}>
          <li>Il <strong>n’a pas battu l’indice</strong> : sur 2016-2026, les actions « Achat pertinent » ont rapporté 13,0 %/an en moyenne (équipondéré), contre 15,3 %/an pour le S&amp;P 500 et 12,8 %/an pour les actions « Pas pertinent ».</li>
          <li>Le score classe les actions un peu mieux que le hasard (corrélation de rang de 0,06 à 0,10, statistiquement significative), sans permettre de sélectionner les plus fortes hausses : la valeur et les petites capitalisations ont été délaissées pendant la décennie.</li>
          <li>Il a bien <strong>repéré les sociétés fragiles</strong> : parmi les 20 % de sociétés les moins bien notées en 2016 sur leurs fondamentaux (dette, trésorerie, rentabilité), 12 % ont fait faillite dans les dix ans, contre 1 à 2 % parmi les 40 % les mieux notées.</li>
          <li>Sur 60 ans de données (1963-2026), les primes associées à la valeur, à la rentabilité et aux rachats d’actions sont significatives ; celle du rendement du dividende ne l’est pas, d’où la place réduite du dividende.</li>
        </ul>
        <p className="muted">Limites : actions américaines uniquement, une seule décennie pour l’horizon de 10 ans, sociétés rachetées absentes des cours. Détails et code : dossier scripts/backtest du projet.</p>
      </section>
      <section className="card">
        <h2>Changements de la version 2</h2>
        <ul style={{ fontSize: '.88rem' }}>{CHANGES.map(c => <li key={c}>{c}</li>)}</ul>
      </section>
      <section className="card">
        <h2>Sources & limites</h2>
        <p style={{ fontSize: '.9rem' }}>
          Données Yahoo Finance : cours différé, comptes annuels (jusqu’à 5 exercices), historique des dividendes. Ces données peuvent comporter
          des erreurs ou des retraitements. L’historique des dividendes est limité aux années disponibles. Les comparaisons de concurrents utilisent des ratios calculés de façon homogène.
        </p>
        <p className="disclaimer">Cette application est un outil pédagogique d’aide à la réflexion et ne constitue pas un conseil en investissement. Investir en bourse comporte un risque de perte en capital. Les performances passées ne préjugent pas des performances futures.</p>
      </section>
    </>
  );
}
