export const metadata = { title: 'Méthode — Valeur Fondamentale' };

const CATS: [string, string, string[]][] = [
  ['Prix actuel (valorisation)', '20 %', [
    'PER ≤ 15 et cours / valeur comptable ≤ 1,5 (Benjamin Graham, « The Intelligent Investor »).',
    'Produit PER × P/B ≤ 22,5 et nombre de Graham √(22,5 × BPA × actif net par action) : marge de sécurité visée ≥ 33 %.',
    'VE / EBITDA et rendement du cash-flow libre (FCF / capitalisation).',
    'Rendement des bénéfices (1 / PER) comparé au taux d’État à 10 ans : l’argument de Buffett pour préférer une action à une obligation.',
  ]],
  ['Dividendes', '15 %', [
    'Nombre d’années consécutives de versement (≥ 25 ans = « aristocrate du dividende »).',
    'Nombre d’années sans baisse notable du dividende.',
    'Rendement (3 – 9 % idéal ; au-delà, risque de piège à dividende) et taux de distribution (≤ 60 % soutenable).',
  ]],
  ['Endettement', '15 %', [
    'Dette / capitaux propres < 0,5 (Buffett) ; dette nette / EBITDA < 2-3.',
    'Couverture des intérêts par l’EBIT et taux moyen payé sur la dette (charges d’intérêts / dette).',
    'Règle de Buffett : la dette long terme doit pouvoir être remboursée avec ≤ 3-4 années de bénéfice net.',
    'Banques et assurances : on mesure plutôt les fonds propres rapportés au bilan.',
  ]],
  ['Qualité & solidité', '15 %', [
    'ROE ≥ 15 %, marge nette > 10 %, marge brute > 40 % : signes d’un avantage concurrentiel durable (« moat »).',
    'Bénéficiaire chaque année (Graham), rachats d’actions plutôt que dilution, faibles besoins d’investissement.',
    'Piotroski F-Score (9 tests comptables, Joseph Piotroski, 2000) et Altman Z-Score (risque de faillite, Edward Altman, 1968).',
  ]],
  ['Trésorerie', '10 %', ['Trésorerie / dette, part de la capitalisation en liquidités, ratio de liquidité générale (Graham ≥ 2), régularité du cash-flow libre.']],
  ['Chiffre d’affaires', '10 %', ['Croissance annuelle moyenne sur les derniers exercices publiés et régularité (nombre d’années en hausse).']],
  ['EBITDA', '10 %', ['Marge d’EBITDA, croissance historique et évolution de la marge (pouvoir de fixation des prix).']],
  ['Face aux concurrents', '10 %', ['Position de l’action par rapport à des concurrents de la même industrie et de taille comparable : PER, VE/EBITDA, rendement, marge nette, ROE, dette.']],
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
        <p className="muted">Un critère sans donnée ou non applicable (ex. EBITDA d’une banque) est exclu du calcul plutôt que noté zéro.</p>
      </section>
      <section className="card">
        <h2>Verdict</h2>
        <ul style={{ fontSize: '.92rem' }}>
          <li><strong className="lvl-buy">Achat pertinent</strong> : score ≥ 68, valorisation raisonnable et aucun signal d’alerte.</li>
          <li><strong className="lvl-watch">Bonne entreprise, prix élevé / À étudier</strong> : score entre 52 et 68, ou excellente qualité mais sans marge de sécurité.</li>
          <li><strong className="lvl-avoid">Pas pertinent actuellement</strong> : score &lt; 52 ou plusieurs signaux d’alerte (pertes, capitaux propres négatifs, dividende non couvert, Altman Z en zone de détresse…).</li>
        </ul>
      </section>
      <section className="card">
        <h2>Sources & limites</h2>
        <p style={{ fontSize: '.9rem' }}>
          Données Yahoo Finance : cours différé, comptes annuels (jusqu’à 5 exercices), historique des dividendes. Ces données peuvent comporter
          des erreurs ou des retraitements. L’historique des dividendes est limité aux années disponibles. Les comparaisons de concurrents utilisent des ratios calculés de façon homogène.
        </p>
        <p className="disclaimer">Cette application est un outil pédagogique d’aide à la réflexion et ne constitue pas un conseil en investissement. Investir en bourse comporte un risque de perte en capital.</p>
      </section>
    </>
  );
}
