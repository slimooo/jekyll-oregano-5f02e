/* Moteur de notation fondamentale — fonction pure, sans accès réseau.
 * Uniquement des données publiées (comptes annuels, dividendes versés, cours actuel).
 * Aucune prise en compte de l'évolution du cours, des objectifs d'analystes ou des prévisions.
 *
 * Utilisé par l'application (lib/analysis.ts, données Yahoo Finance) et par le backtest
 * (scripts/backtest, données SEC « point-in-time ») : les deux appellent exactement ce code.
 * Ce module ne doit importer aucun autre module à l'exécution (exécutable tel quel par Node).
 *
 * Version 2 (novembre 2026) : corrections issues de l'analyse mathématique et du backtest 2014-2026
 * (poids ramenés à 100, PER compté une seule fois, dette inconnue ≠ dette nulle, rachats d'actions,
 * Altman Z'', croissance passée plafonnée…). Détails : scripts/backtest/RESULTATS.md.
 */

export type Status = 'good' | 'mid' | 'bad' | 'na';
/** Échelle visuelle d'un critère (zones défavorable / moyen / favorable), alignée sur la notation. */
export type GaugeUnit = 'pct' | 'x' | 'num' | 'yrs' | 'pts';
export interface GaugeBand { from: number; to: number; s: 'good' | 'mid' | 'bad' }
export interface Gauge { v: number; lo: number; hi: number; bands: GaugeBand[]; unit: GaugeUnit }
export interface Criterion { id: string; label: string; value: string; score: number | null; weight: number; rule: string; comment?: string; gauge?: Gauge }
/** Prix d'achat issus de chaque méthode de valorisation, dans la devise de cotation. */
export interface PriceMethod { id: string; label: string; buy: number; fair: number; rule: string }
export interface PriceTargets { price: number | null; currency: string; methods: PriceMethod[]; buy: number | null; fair: number | null; note?: string }
export interface Category { id: string; label: string; weight: number; score: number | null; criteria: Criterion[]; note?: string }
export interface PeerRow { symbol: string; name: string; self?: boolean; pe: number | null; evEbitda: number | null; pb: number | null; dy: number | null; netMargin: number | null; roe: number | null; de: number | null }
export interface Analysis {
  symbol: string; name: string; exchange: string; currency: string; price: number | null; marketCap: number | null; financialCurrency: string;
  sector: string; industry: string; country: string; summary: string; isFinancial: boolean;
  score: number; verdict: string; verdictLevel: 'buy' | 'watch' | 'avoid'; verdictText: string;
  strengths: string[]; weaknesses: string[]; redFlags: string[];
  categories: Category[];
  history: { years: number[]; revenue: (number | null)[]; ebitda: (number | null)[]; netIncome: (number | null)[]; fcf: (number | null)[] };
  dividends: { byYear: { year: number; amount: number }[]; consecutiveYears: number; firstYear: number | null; noCutYears: number; currency: string };
  peers: PeerRow[]; peerSource: string;
  graham: { number: number | null; marginOfSafety: number | null };
  priceTargets: PriceTargets;
  riskFree: number; updatedAt: string; warnings: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Loose = Record<string, any>;
/** Sous-ensemble de `quoteSummary` (Yahoo) utilisé par le moteur. */
export interface QS { price?: Loose; summaryDetail?: Loose; financialData?: Loose; defaultKeyStatistics?: Loose; assetProfile?: Loose }
/** Ligne annuelle au format `fundamentalsTimeSeries` (Yahoo) : clés totalRevenue, EBITDA, netIncome… */
export type AnnualRow = Record<string, unknown> & { date: Date | string | number };

export interface AnalysisInput {
  symbol: string;
  q: QS;
  /** Exercices annuels publiés (au plus les 5 derniers sont retenus). */
  rows: AnnualRow[];
  /** Dividendes versés (date de détachement, montant par action dans la devise de cotation). */
  dividends: { amount: number; date: Date | string | number }[];
  firstTradeDate?: Date | string | number | null;
  /** Taux d'État à 10 ans, en % (ex. 4,2). */
  riskFreePct?: number | null;
  /** Facteur de conversion devise de cotation -> devise des comptes. */
  conv: number;
  /** Concurrents déjà chargés ; null si la recherche a échoué. */
  peers: PeerRow[] | null;
  peerSource: string;
  /** Secteur de repli si Yahoo n'en fournit pas. */
  fallbackSector?: string;
  /** Avertissements issus du chargement des données (ex. taux de change). */
  warnings?: string[];
  /** Date de l'analyse (par défaut : maintenant). Le backtest fixe une date passée. */
  asOf?: Date;
}

export const SECTOR_FR: Record<string, string> = {
  'Basic Materials': 'Matériaux de base', 'Communication Services': 'Communication', 'Consumer Cyclical': 'Consommation cyclique',
  'Consumer Defensive': 'Consommation de base', Energy: 'Énergie', 'Financial Services': 'Services financiers', Healthcare: 'Santé',
  Industrials: 'Industrie', 'Real Estate': 'Immobilier', Technology: 'Technologie', Utilities: 'Services publics',
};

// ---------- utilitaires
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const num = (v: unknown): number | null => (isNum(v) ? v : null);
const clamp = (v: number, a = 0, b = 10) => Math.max(a, Math.min(b, v));
/** Interpolation linéaire : `bad` -> 0, `good` -> 10 (fonctionne dans les deux sens). */
const lin = (v: number, bad: number, good: number) => clamp(((v - bad) / (good - bad)) * 10);
/** Échelle pour un critère noté par `lin(v, bad, good)` : zones aux notes 4 et 7 (seuils de couleur de l'interface). */
function gz(v: number | null, bad: number, good: number, unit: GaugeUnit, floor?: number, ceil?: number): Gauge | undefined {
  if (v === null || !Number.isFinite(v)) return undefined;
  const at = (sc: number) => bad + (good - bad) * (sc / 10);
  const b4 = at(4), b7 = at(7);
  const span = Math.abs(good - bad);
  let lo = Math.min(bad, good) - span * 0.3, hi = Math.max(bad, good) + span * 0.3;
  if (floor !== undefined) lo = Math.max(lo, floor);
  if (ceil !== undefined) hi = Math.min(hi, ceil);
  const bands: GaugeBand[] = good > bad
    ? [{ from: lo, to: b4, s: 'bad' }, { from: b4, to: b7, s: 'mid' }, { from: b7, to: hi, s: 'good' }]
    : [{ from: lo, to: b7, s: 'good' }, { from: b7, to: b4, s: 'mid' }, { from: b4, to: hi, s: 'bad' }];
  return { v, lo, hi, bands, unit };
}
/** Échelle à zones explicites (critères notés par paliers). */
function gzB(v: number | null, unit: GaugeUnit, lo: number, ...cuts: [number, GaugeBand['s']][]): Gauge | undefined {
  if (v === null || !Number.isFinite(v)) return undefined;
  const bands: GaugeBand[] = []; let from = lo;
  for (const [to, st] of cuts) { bands.push({ from, to, s: st }); from = to; }
  return { v, lo, hi: from, bands, unit };
}
const avg = (a: (number | null)[]) => { const b = a.filter(isNum); return b.length ? b.reduce((x, y) => x + y, 0) / b.length : null; };
const median = (a: (number | null)[]) => { const b = a.filter(isNum).sort((x, y) => x - y); if (!b.length) return null; const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const nf = (d: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d });
export const pct = (v: number | null, d = 1) => (v === null ? 'n.d.' : nf(d).format(v * 100) + ' %');
export const x = (v: number | null, d = 1) => (v === null ? 'n.d.' : nf(d).format(v) + ' x');
export const money = (v: number | null, ccy = '') => {
  if (v === null) return 'n.d.';
  const a = Math.abs(v);
  const [div, suf] = a >= 1e12 ? [1e12, ' Bn'] : a >= 1e9 ? [1e9, ' Md'] : a >= 1e6 ? [1e6, ' M'] : [1, ''];
  return nf(div === 1 ? 2 : 1).format(v / div) + suf + (ccy ? ' ' + ccy : '');
};

function catScore(c: Criterion[]): number | null {
  const ok = c.filter(k => k.score !== null);
  const w = ok.reduce((s, k) => s + k.weight, 0);
  if (!w) return null;
  return Math.round((ok.reduce((s, k) => s + (k.score as number) * k.weight, 0) / w) * 10);
}

export const SUBUNIT: Record<string, [string, number]> = { GBp: ['GBP', 100], GBX: ['GBP', 100], ZAc: ['ZAR', 100], ILA: ['ILS', 100] };

/** Informations d'identification communes au chargement des données et au calcul. */
export function describe(q: QS, fallbackSector = '') {
  const pr = q.price ?? ({} as Loose);
  const sd = q.summaryDetail ?? ({} as Loose);
  const fd = q.financialData ?? ({} as Loose);
  const ap = q.assetProfile ?? ({} as Loose);
  const priceCcy: string = pr.currency || 'USD';
  const finCcy: string = fd.financialCurrency || priceCcy.replace(/^GBp$/, 'GBP');
  const price = num(pr.regularMarketPrice) ?? num(fd.currentPrice);
  const mcap = num(pr.marketCap) ?? num(sd.marketCap);
  const sector: string = ap.sector || fallbackSector || '';
  const industry: string = ap.industry || '';
  const isFinancial = sector === 'Financial Services' && /bank|insurance|capital markets|credit|mortgage|asset management|financial conglomerates/i.test(industry);
  const isReit = sector === 'Real Estate' && /reit/i.test(industry);
  return { priceCcy, finCcy, price, mcap, sector, industry, isFinancial, isReit };
}

export function assertEquity(q: QS) {
  const pr = q.price ?? ({} as Loose);
  if (pr.quoteType && pr.quoteType !== 'EQUITY') throw new Error("Ce titre n'est pas une action (ETF, fonds…) : analyse non applicable.");
}

/** Ratios homogènes (Yahoo) d'un concurrent ou du titre analysé. */
export function peerRow(symbol: string, q: QS, self = false): PeerRow {
  const sd: Loose = q.summaryDetail ?? {}; const fd: Loose = q.financialData ?? {}; const ks: Loose = q.defaultKeyStatistics ?? {};
  const pe = num(sd.trailingPE);
  const ev = num(ks.enterpriseToEbitda);
  const pb = num(ks.priceToBook);
  return {
    symbol, self, name: q.price?.longName || q.price?.shortName || symbol,
    pe: pe !== null && pe > 0 && pe < 500 ? pe : null,
    evEbitda: ev !== null && ev > 0 && ev < 200 ? ev : null,
    pb: pb !== null && pb > 0 && pb < 200 ? pb : null,
    dy: num(sd.dividendYield) ?? 0,
    netMargin: num(fd.profitMargins), roe: num(fd.returnOnEquity),
    de: isNum(fd.debtToEquity) ? fd.debtToEquity / 100 : null,
  };
}

// ---------- analyse principale (pure)
export function computeAnalysis(input: AnalysisInput): Analysis {
  const symbol = input.symbol.toUpperCase();
  const q = input.q;
  const warnings: string[] = [...(input.warnings ?? [])];
  const asOf = input.asOf ?? new Date();
  assertEquity(q);

  const pr = q.price ?? ({} as Loose);
  const sd = q.summaryDetail ?? ({} as Loose);
  const fd = q.financialData ?? ({} as Loose);
  const ap = q.assetProfile ?? ({} as Loose);
  const { priceCcy, finCcy, price, mcap, sector, industry, isFinancial, isReit } = describe(q, input.fallbackSector);
  const riskFree = (num(input.riskFreePct) ?? 4.2) / 100;

  const conv = input.conv;
  // la capitalisation Yahoo est exprimée dans l'unité principale (GBP et non GBp)
  const mcapF = mcap !== null ? mcap * conv * (SUBUNIT[priceCcy]?.[1] ?? 1) : null;
  const priceF = price !== null ? price * conv : null;

  // --- historique annuel
  type Row = AnnualRow;
  const rows = (input.rows as Row[]).filter(r => isNum(r.totalRevenue)).sort((a, b) => +new Date(a.date) - +new Date(b.date)).slice(-5);
  const g = (r: Row | undefined, ...keys: string[]) => { if (!r) return null; for (const k of keys) if (isNum(r[k])) return r[k] as number; return null; };
  const years = rows.map(r => new Date(r.date).getFullYear());
  const revenue = rows.map(r => g(r, 'totalRevenue'));
  const ebitdaH = rows.map(r => g(r, 'EBITDA', 'normalizedEBITDA'));
  const ni = rows.map(r => g(r, 'netIncomeCommonStockholders', 'netIncome'));
  const fcfH = rows.map(r => g(r, 'freeCashFlow'));
  const equityH = rows.map(r => g(r, 'commonStockEquity', 'stockholdersEquity'));
  const L = rows[rows.length - 1], P = rows[rows.length - 2];
  if (rows.length < 2) warnings.push('Historique financier limité : certains critères ne peuvent pas être calculés.');

  const ebit = g(L, 'EBIT', 'operatingIncome');
  const interest = g(L, 'interestExpense', 'interestExpenseNonOperating');
  // Dette absente des données : nulle seulement si l'entreprise ne paie pas d'intérêts ; sinon inconnue
  // (v1 la supposait nulle, ce qui faisait passer une société endettée mal renseignée pour non endettée).
  const debtRaw = num(fd.totalDebt) ?? g(L, 'totalDebt');
  const debtKnown = debtRaw !== null || !(interest !== null && interest > 0);
  const debt = debtRaw ?? 0;
  const cash = num(fd.totalCash) ?? g(L, 'cashCashEquivalentsAndShortTermInvestments', 'cashAndCashEquivalents');
  const equity = g(L, 'commonStockEquity', 'stockholdersEquity');
  const netIncome = g(L, 'netIncomeCommonStockholders', 'netIncome');
  const ebitda = num(fd.ebitda) ?? g(L, 'EBITDA', 'normalizedEBITDA');
  const revTTM = num(fd.totalRevenue) ?? g(L, 'totalRevenue');
  const ltDebt = g(L, 'longTermDebt') ?? (debtKnown ? debt : null);
  const totalAssets = g(L, 'totalAssets');
  const shares = g(L, 'ordinarySharesNumber', 'shareIssued') ?? num(q.defaultKeyStatistics?.sharesOutstanding);
  const sh0 = g(rows[0], 'ordinarySharesNumber', 'dilutedAverageShares'), sh1 = g(L, 'ordinarySharesNumber', 'dilutedAverageShares');
  const shP = g(P, 'ordinarySharesNumber', 'dilutedAverageShares');

  const categories: Category[] = [];
  const strengths: string[] = [], weaknesses: string[] = [], redFlags: string[] = [];

  // ===== 1. Dividendes
  const divs = input.dividends ?? [];
  const byYearMap = new Map<number, number>();
  for (const d of divs) { const y = new Date(d.date).getFullYear(); byYearMap.set(y, (byYearMap.get(y) ?? 0) + d.amount); }
  const nowY = asOf.getFullYear();
  const byYear = [...byYearMap.entries()].sort((a, b) => a[0] - b[0]).map(([year, amount]) => ({ year, amount }));
  let consecutive = 0;
  for (let y = byYearMap.has(nowY) ? nowY : nowY - 1; byYearMap.has(y); y--) consecutive++;
  const firstYear = consecutive ? (byYearMap.has(nowY) ? nowY : nowY - 1) - consecutive + 1 : null;
  let noCut = 0;
  for (let y = nowY - 1; byYearMap.has(y) && byYearMap.has(y - 1); y--) {
    if ((byYearMap.get(y) as number) >= 0.9 * (byYearMap.get(y - 1) as number)) noCut++; else break;
  }
  const dy = num(sd.dividendYield) ?? num(sd.trailingAnnualDividendYield) ?? (consecutive ? null : 0);
  const payout = num(sd.payoutRatio);
  const histStart = input.firstTradeDate ? new Date(input.firstTradeDate).getFullYear() : null;
  // Rachats nets sur le dernier exercice (baisse du nombre d'actions), bornés pour neutraliser fusions et scissions.
  const buyback = sh1 && shP ? Math.max(-0.2, Math.min(0.2, 1 - sh1 / shP)) : null;
  const shYield = dy === null && buyback === null ? null : (dy ?? 0) + (buyback ?? 0);
  const shChg = sh0 && sh1 && rows.length >= 2 ? Math.pow(sh1 / sh0, 1 / (rows.length - 1)) - 1 : null;
  const payer = consecutive > 0 && (dy === null || dy > 0);
  const divC: Criterion[] = [
    { id: 'div-shy', gauge: gz(shYield, 0, 0.06, 'pct'), label: 'Rendement pour l’actionnaire (dividendes + rachats nets)', weight: 3,
      value: shYield === null ? 'n.d.' : `${pct(shYield)} (dividende ${pct(dy ?? 0)}, rachats nets ${pct(buyback ?? 0)})`,
      score: shYield === null ? null : lin(shYield, 0, 0.06),
      rule: 'Dividende + baisse nette du nombre d’actions sur un an : ≥ 6 % très favorable ; < 0 = dilution (Boudoukh et al., 2007)' },
    { id: 'div-years', gauge: payer ? gzB(consecutive, 'yrs', 0, [5, 'bad'], [10, 'mid'], [30, 'good']) : undefined, label: 'Ancienneté du dividende', weight: 1,
      value: consecutive ? `${consecutive} an${consecutive > 1 ? 's' : ''} consécutifs (depuis ${firstYear})` : 'Aucun dividende récent',
      score: !payer ? null : consecutive >= 25 ? 10 : consecutive >= 15 ? 9 : consecutive >= 10 ? 8 : consecutive >= 5 ? 6 : consecutive >= 2 ? 3 : 2,
      rule: '≥ 25 ans = « aristocrate » ; ≥ 10 ans = fiable ; < 5 ans = historique court (non noté sans dividende)',
      comment: histStart && firstYear && firstYear <= histStart + 1 ? `Les données commencent en ${histStart} : l'ancienneté réelle est probablement supérieure.` : undefined },
    { id: 'div-nocut', gauge: payer ? gzB(noCut, 'yrs', 0, [2, 'bad'], [10, 'mid'], [25, 'good']) : undefined, label: 'Dividende maintenu ou en hausse', weight: 1,
      value: consecutive ? `${noCut} an${noCut > 1 ? 's' : ''} sans baisse notable` : '—',
      score: !payer ? null : noCut >= 20 ? 10 : noCut >= 10 ? 8.5 : noCut >= 5 ? 6.5 : noCut >= 2 ? 4 : 1,
      rule: 'Années consécutives où le dividende total n’a pas baissé de plus de 10 %' },
    { id: 'div-yield', gauge: payer ? gzB(dy, 'pct', 0, [0.012, 'bad'], [0.021, 'mid'], [0.09, 'good'], [0.12, 'mid']) : undefined, label: 'Rendement du dividende', weight: 1, value: pct(dy, 2),
      score: !payer || dy === null ? null : dy > 0.09 ? 4 : dy >= 0.03 ? 10 : lin(dy, 0, 0.03),
      rule: '3 – 9 % idéal ; > 9 % = risque de « piège à dividende »' },
    { id: 'div-payout', gauge: payer ? (isReit ? gzB(payout, 'pct', 0, [0.9, 'good'], [1.1, 'mid'], [1.4, 'bad']) : gzB(payout, 'pct', 0, [0.6, 'good'], [0.8, 'mid'], [1.2, 'bad'])) : undefined, label: 'Taux de distribution', weight: 2, value: pct(payout, 0),
      score: payout === null || !payer ? null : payout <= 0 ? 2 : isReit ? (payout <= 0.9 ? 9 : payout <= 1.1 ? 5 : 1) : payout <= 0.6 ? 10 : payout <= 0.8 ? 6 : payout <= 1 ? 3 : 0,
      rule: isReit ? 'Foncière : ≤ 90 % des bénéfices (règles REIT/SIIC)' : '≤ 60 % des bénéfices = soutenable ; > 100 % = dividende non couvert' },
    { id: 'q-shares', gauge: gz(shChg, 0.04, -0.02, 'pct'), label: "Évolution du nombre d'actions", weight: 2, value: shChg === null ? 'n.d.' : `${shChg > 0 ? '+' : ''}${nf(1).format(shChg * 100)} %/an`,
      score: shChg === null ? null : lin(shChg, 0.04, -0.02), rule: 'Rachats d’actions (baisse) = favorable ; émissions (dilution) = défavorable (Pontiff et Woodgate, 2008)' },
  ];
  if (payout !== null && payout > 1 && !isReit) redFlags.push('Le dividende dépasse les bénéfices (taux de distribution > 100 %).');
  categories.push({ id: 'dividend', label: 'Dividendes & rachats', weight: 10, score: catScore(divC), criteria: divC,
    note: payer ? undefined : 'Sans dividende, seuls les rachats d’actions et la dilution sont notés (pas de pénalité automatique).' });

  // ===== 2. Endettement
  // Dette / capitaux propres sur le même exercice (v1 rapportait la dette du dernier trimestre aux fonds propres annuels).
  const debtFY = g(L, 'totalDebt') ?? (debtKnown ? debt : null);
  const de = equity && equity > 0 && debtFY !== null ? debtFY / equity : null;
  const netDebt = cash !== null && debtKnown ? debt - cash : null;
  const ndE = netDebt !== null && ebitda && ebitda > 0 ? netDebt / ebitda : null;
  const cover = ebit !== null && interest && interest > 0 ? ebit / interest : null;
  const avgDebt = avg([g(L, 'totalDebt'), g(P, 'totalDebt')]);
  const costDebt = interest && avgDebt && avgDebt > 0 ? interest / avgDebt : null;
  const debtYears = netIncome && netIncome > 0 && ltDebt !== null ? ltDebt / netIncome : null;
  // Capitaux propres négatifs dus aux rachats d'une société rentable qui couvre largement ses intérêts
  // (McDonald's, Home Depot…) : le ratio D/E n'a pas de sens, l'endettement est jugé sur l'EBITDA et les intérêts.
  const negEq = equity !== null && equity <= 0;
  const solidNegEq = negEq && netIncome !== null && netIncome > 0 && (cover !== null ? cover >= 5 : interest === 0) && (ndE === null || ndE <= 3);
  let debtC: Criterion[];
  if (isFinancial) {
    const eqA = equity && totalAssets ? equity / totalAssets : null;
    debtC = [
      { id: 'fin-capital', gauge: gz(eqA, 0.03, 0.12, 'pct', 0), label: 'Fonds propres / total du bilan', weight: 3, value: pct(eqA), score: eqA === null ? null : lin(eqA, 0.03, 0.12),
        rule: 'Banques / assurances : ≥ 10 % = bien capitalisé ; < 5 % = levier élevé' },
      { id: 'debt-na', label: 'Ratios de dette classiques', weight: 0, value: 'Non applicables', score: null,
        rule: 'La dette est la « matière première » d’une banque : on juge plutôt la capitalisation.' },
    ];
  } else {
    debtC = [
      { id: 'debt-de', gauge: de === null ? undefined : gz(de, 2, 0.5, 'x', 0), label: 'Dette / capitaux propres', weight: 3,
        value: de === null ? (negEq ? (solidNegEq ? 'Capitaux propres négatifs (rachats d’actions)' : 'Capitaux propres négatifs') : 'n.d.') : x(de, 2),
        score: de === null ? (negEq && !solidNegEq ? 0 : null) : de <= 0.5 ? 10 : lin(de, 2, 0.5),
        rule: 'Critère Buffett : < 0,5 x excellent ; > 2 x élevé',
        comment: solidNegEq ? 'Fonds propres réduits par les rachats d’actions d’une société rentable : ratio non noté, la dette est jugée sur l’EBITDA et la couverture des intérêts.' : undefined },
      { id: 'debt-nde', gauge: gz(ndE, 4, 1, 'x'), label: 'Dette nette / EBITDA', weight: 3, value: ndE === null ? 'n.d.' : ndE < 0 ? 'Trésorerie nette positive' : x(ndE),
        score: ndE === null ? null : ndE <= 1 ? 10 : lin(ndE, 4, 1), rule: '< 1 x très sain ; 1 – 3 x acceptable ; > 4 x risqué' },
      { id: 'debt-cover', gauge: gz(cover, 1.5, 10, 'x', 0), label: 'Couverture des intérêts (EBIT / intérêts)', weight: 2, value: x(cover),
        score: cover === null ? (interest === 0 ? 10 : null) : lin(cover, 1.5, 10), rule: '> 8 x confortable (Graham : > 5 x) ; < 2 x fragile' },
      { id: 'debt-cost', gauge: gz(costDebt, 0.09, 0.03, 'pct', 0), label: 'Taux moyen de la dette', weight: 1, value: pct(costDebt, 2),
        score: costDebt === null ? null : lin(costDebt, 0.09, 0.03), rule: 'Charges d’intérêts / dette moyenne : < 4 % favorable ; > 8 % coûteux' },
      { id: 'debt-years', gauge: gz(debtYears, 8, 3, 'yrs', 0), label: 'Années de bénéfices pour rembourser la dette LT', weight: 2, value: debtYears === null ? 'n.d.' : `${nf(1).format(debtYears)} ans`,
        score: debtYears === null ? (netIncome !== null && netIncome <= 0 ? 0 : null) : debtYears <= 3 ? 10 : lin(debtYears, 8, 3),
        rule: 'Critère Buffett : dette long terme remboursable en ≤ 3-4 ans de bénéfice net' },
    ];
    if (negEq && !solidNegEq) redFlags.push('Capitaux propres négatifs.');
  }
  categories.push({ id: 'debt', label: 'Endettement', weight: 15, score: catScore(debtC), criteria: debtC,
    note: debtKnown ? undefined : 'Montant de la dette non publié alors que l’entreprise paie des intérêts : ratios de dette non calculés.' });

  // ===== 3. Trésorerie
  const cr = num(fd.currentRatio) ?? (g(L, 'currentAssets') && g(L, 'currentLiabilities') ? (g(L, 'currentAssets') as number) / (g(L, 'currentLiabilities') as number) : null);
  const fcfPos = fcfH.filter(isNum);
  const cashMc = cash !== null && mcapF ? cash / mcapF : null;
  const cashC: Criterion[] = [
    { id: 'cash-debt', gauge: isFinancial || cash === null || !debtKnown || debt <= 0 ? undefined : gz(cash / debt, 0.1, 1, 'pct', 0), label: 'Trésorerie / dette totale', weight: 3, value: cash === null || !debtKnown ? 'n.d.' : debt > 0 ? pct(cash / debt, 0) : 'Aucune dette',
      score: isFinancial ? null : cash === null || !debtKnown ? null : debt <= 0 ? 10 : lin(cash / debt, 0.1, 1), rule: '≥ 100 % = la trésorerie couvre toute la dette' },
    { id: 'cash-level', gauge: isFinancial ? undefined : gz(cashMc, 0, 0.15, 'pct', 0), label: 'Niveau de trésorerie', weight: 1, value: `${money(cash, finCcy)}${cashMc !== null ? ` (${pct(cashMc, 0)} de la capitalisation)` : ''}`,
      score: isFinancial || cashMc === null ? null : lin(cashMc, 0, 0.15), rule: 'Part de la capitalisation détenue en liquidités' },
    { id: 'cash-cr', gauge: isFinancial ? undefined : gz(cr, 0.7, 2, 'x', 0), label: 'Ratio de liquidité générale', weight: 2, value: x(cr, 2),
      score: isFinancial || cr === null ? null : lin(cr, 0.7, 2), rule: 'Actif courant / passif courant : Graham ≥ 2 ; < 1 = tension possible' },
    { id: 'cash-fcf', gauge: isFinancial || !fcfPos.length ? undefined : gz(fcfPos.filter(v => v > 0).length / fcfPos.length, 0, 1, 'pct', 0, 1), label: 'Flux de trésorerie libre positif', weight: 3, value: fcfPos.length ? `${fcfPos.filter(v => v > 0).length} / ${fcfPos.length} années` : 'n.d.',
      score: isFinancial || !fcfPos.length ? null : (fcfPos.filter(v => v > 0).length / fcfPos.length) * 10, rule: 'L’entreprise génère-t-elle du cash chaque année après investissements ?' },
  ];
  if (isFinancial) cashC.forEach(c => { if (c.score === null) c.comment = 'Peu pertinent pour une banque ou une assurance.'; });
  categories.push({ id: 'cash', label: 'Trésorerie', weight: 10, score: catScore(cashC), criteria: cashC });

  // ===== 4. Valorisation (prix actuel)
  const peY = num(sd.trailingPE);
  const pe = peY !== null && peY > 0 ? peY : mcapF && netIncome && netIncome > 0 ? mcapF / netIncome : null;
  const pb = mcapF && equity && equity > 0 ? mcapF / equity : null;
  const ev = mcapF !== null && cash !== null && debtKnown ? mcapF + debt - cash : null;
  const evE = ev !== null && ebitda && ebitda > 0 ? ev / ebitda : null;
  const fcfL = g(L, 'freeCashFlow');
  const fcfY = fcfL !== null && mcapF ? fcfL / mcapF : null;
  const eps = g(L, 'dilutedEPS', 'basicEPS') ?? (netIncome && shares ? netIncome / shares : null);
  const bvps = equity && shares ? equity / shares : null;
  const graham = eps && bvps && eps > 0 && bvps > 0 ? Math.sqrt(22.5 * eps * bvps) : null;
  // Prix par action « ordinaire » = capitalisation / nombre d'actions (évite le biais des ADR)
  const pps = mcapF && shares ? mcapF / shares : priceF;
  const mos = graham && pps ? 1 - pps / graham : null;
  const grahamInPriceCcy = graham && pps && price ? (price * graham) / pps : null;
  const ey = pe ? 1 / pe : null;
  const valC: Criterion[] = [
    { id: 'val-pe', gauge: gz(pe, 35, 15, 'x', 0), label: 'PER (cours / bénéfice)', weight: 3, value: pe === null ? (netIncome !== null && netIncome <= 0 ? 'Pertes' : 'n.d.') : x(pe),
      score: pe === null ? (netIncome !== null && netIncome <= 0 ? 0 : null) : pe <= 15 ? 10 : lin(pe, 35, 15), rule: 'Graham : ≤ 15 x ; > 30 x = cher' },
    { id: 'val-pb', gauge: gz(pb, isFinancial ? 3 : 6, 1.5, 'x', 0), label: 'Cours / valeur comptable', weight: 1, value: x(pb, 2),
      score: pb === null ? null : pb <= 1.5 ? 10 : lin(pb, isFinancial ? 3 : 6, 1.5), rule: 'Graham : ≤ 1,5 x (peu fiable quand les rachats ou l’immatériel réduisent les fonds propres)' },
    // v1 notait aussi « PER × P/B ≤ 22,5 » : c'est la même information que la marge de sécurité de Graham
    // (MdS = 1 − √(PER × P/B / 22,5)), désormais notée une seule fois.
    { id: 'val-mos', gauge: gz(mos, -1, 0.33, 'pct', undefined, 1), label: 'Marge de sécurité (nombre de Graham)', weight: 2,
      value: grahamInPriceCcy ? `${pct(mos, 0)} (valeur ${nf(2).format(grahamInPriceCcy)} ${priceCcy} ; PER × P/B = ${pe && pb ? nf(1).format(pe * pb) : 'n.d.'})` : 'n.d.',
      score: mos === null ? null : lin(mos, -1, 0.33), rule: '√(22,5 × BPA × actif net/action), soit PER × P/B ≤ 22,5 ; Graham exige ≥ 33 % de marge' },
    { id: 'val-ev', gauge: isFinancial ? undefined : gz(evE, 20, 7, 'x', 0), label: 'VE / EBITDA', weight: 2, value: x(evE),
      score: isFinancial || evE === null ? null : evE <= 7 ? 10 : lin(evE, 20, 7), rule: '< 8 x bon marché ; > 15 x cher' },
    { id: 'val-fcfy', gauge: isFinancial ? undefined : gz(fcfY, 0, 0.08, 'pct'), label: 'Rendement du cash-flow libre', weight: 2, value: pct(fcfY),
      score: isFinancial || fcfY === null ? null : lin(fcfY, 0, 0.08), rule: 'FCF / capitalisation : > 6 % attractif ; < 2 % cher' },
    // Indicatif : entre deux actions, l'écart au taux sans risque ne dépend que du PER (déjà noté).
    { id: 'val-ey', label: 'Rendement des bénéfices vs taux 10 ans', weight: 0,
      value: ey === null ? 'n.d.' : `${pct(ey)} vs ${pct(riskFree, 2)}`,
      score: ey === null ? null : lin(ey - riskFree, -0.03, 0.04), rule: 'Indicatif, non noté (redondant avec le PER) — Buffett : 1/PER doit battre l’obligation d’État (taux US 10 ans)' },
  ];
  categories.push({ id: 'value', label: 'Prix actuel (valorisation)', weight: 25, score: catScore(valC), criteria: valC });

  // --- Prix d'achat : cours auquel chaque critère de valorisation obtiendrait la note maximale (« achat »)
  // ou la note 7/10 (« raisonnable »). Calculé par proportion au cours actuel, ce qui reste juste pour les
  // ADR et les cotations en centimes (GBp). Aucune prévision : uniquement les comptes publiés.
  const methods: PriceMethod[] = [];
  const addM = (id: string, label: string, buy: number | null, fair: number | null, rule: string) => {
    if (buy !== null && fair !== null && Number.isFinite(buy) && Number.isFinite(fair) && buy > 0 && fair > 0) methods.push({ id, label, buy, fair: Math.max(fair, buy), rule });
  };
  if (price !== null) {
    if (grahamInPriceCcy) addM('graham', 'Nombre de Graham', grahamInPriceCcy * (1 - 0.33), grahamInPriceCcy,
      'Valeur √(22,5 × BPA × actif net/action) ; achat avec 33 % de marge de sécurité');
    if (pe) addM('pe', 'PER', (price * 15) / pe, (price * 21) / pe, 'Achat à PER 15 (Graham) ; raisonnable jusqu’à 21');
    if (!isFinancial && mcapF && ebitda && ebitda > 0 && cash !== null && debtKnown) {
      const eqAt = (m: number) => (m * ebitda - debt + cash) / mcapF * price;
      addM('ev', 'VE / EBITDA', eqAt(7), eqAt(10.9), 'Achat à 7 x l’EBITDA ; raisonnable jusqu’à 10,9 x (dette nette déduite)');
    }
    if (!isFinancial && mcapF && fcfL !== null && fcfL > 0) addM('fcf', 'Cash-flow libre', (fcfL / 0.08) / mcapF * price, (fcfL / 0.056) / mcapF * price,
      'Achat à 8 % de rendement du cash-flow libre ; raisonnable jusqu’à 5,6 %');
    if (isFinancial && pb) addM('pb', 'Valeur comptable', (price * 1.5) / pb, (price * 1.95) / pb, 'Banques / assurances : achat à 1,5 x l’actif net ; raisonnable jusqu’à 1,95 x');
  }
  const priceTargets: PriceTargets = {
    price, currency: priceCcy, methods, buy: median(methods.map(m => m.buy)), fair: median(methods.map(m => m.fair)),
    note: methods.length ? undefined : (netIncome !== null && netIncome <= 0 ? 'Pas de prix d’achat calculable : l’entreprise est en perte.' : 'Données insuffisantes pour calculer un prix d’achat.'),
  };

  // ===== 5. Chiffre d'affaires
  const revF = revenue.filter(isNum);
  const n = revF.length;
  const cagr = n >= 2 && revF[0] > 0 && revF[n - 1] > 0 ? Math.pow(revF[n - 1] / revF[0], 1 / (n - 1)) - 1 : null;
  let up = 0; for (let i = 1; i < n; i++) if (revF[i] >= revF[i - 1]) up++;
  // La croissance passée ne se prolonge pas (Chan, Karceski & Lakonishok, 2003) et une forte croissance passée
  // annonce plutôt des rendements inférieurs (Lakonishok, Shleifer & Vishny, 1994) : on vérifie seulement que
  // l'activité ne recule pas, sans récompenser une croissance rapide (plafond à +4 %/an).
  const revC: Criterion[] = [
    { id: 'rev-cagr', gauge: gz(cagr, -0.04, 0.04, 'pct'), label: `Croissance annuelle moyenne (${n ? years[0] + '–' + years[years.length - 1] : '—'})`, weight: 2, value: pct(cagr),
      score: cagr === null ? null : lin(cagr, -0.04, 0.04), rule: '≥ +4 %/an = activité en progression (pas de bonus au-delà) ; négative = activité en recul' },
    { id: 'rev-reg', gauge: n >= 2 ? gz(up / (n - 1), 0, 1, 'pct', 0, 1) : undefined, label: 'Régularité de la croissance', weight: 2, value: n >= 2 ? `${up} hausse${up > 1 ? 's' : ''} sur ${n - 1} an${n > 2 ? 's' : ''}` : 'n.d.',
      score: n >= 2 ? (up / (n - 1)) * 10 : null, rule: 'Buffett privilégie les activités prévisibles' },
  ];
  categories.push({ id: 'revenue', label: "Chiffre d'affaires", weight: 5, score: catScore(revC), criteria: revC });

  // ===== 6. EBITDA
  const ebF = ebitdaH.map((e, i) => (isNum(e) && isNum(revenue[i]) && (revenue[i] as number) > 0 ? e / (revenue[i] as number) : null));
  const ebMargin = ebitda && revTTM ? ebitda / revTTM : ebF[ebF.length - 1] ?? null;
  const ebV = ebitdaH.filter(isNum);
  const ebCagr = ebV.length >= 2 && ebV[0] > 0 && ebV[ebV.length - 1] > 0 ? Math.pow(ebV[ebV.length - 1] / ebV[0], 1 / (ebV.length - 1)) - 1 : null;
  const marginTrend = ebF.filter(isNum).length >= 2 ? (ebF.filter(isNum).at(-1) as number) - (ebF.filter(isNum)[0] as number) : null;
  const ebC: Criterion[] = isFinancial ? [
    { id: 'eb-na', label: 'EBITDA', weight: 0, value: 'Non applicable', score: null, rule: 'L’EBITDA n’a pas de sens pour une banque ou une assurance.' },
  ] : [
    { id: 'eb-margin', gauge: gz(ebMargin, 0.05, 0.3, 'pct'), label: "Marge d'EBITDA", weight: 2, value: pct(ebMargin), score: ebMargin === null ? null : lin(ebMargin, 0.05, 0.3),
      rule: '> 25 % = avantage concurrentiel probable ; < 10 % = activité peu rentable' },
    { id: 'eb-cagr', gauge: gz(ebCagr, -0.05, 0.05, 'pct'), label: "Croissance annuelle de l'EBITDA", weight: 1, value: pct(ebCagr), score: ebCagr === null ? (ebV.some(v => v <= 0) ? 0 : null) : lin(ebCagr, -0.05, 0.05),
      rule: 'Évolution historique : ≥ +5 %/an = favorable (pas de bonus au-delà)' },
    { id: 'eb-trend', gauge: gz(marginTrend, -0.05, 0.03, 'pts'), label: 'Évolution de la marge', weight: 1, value: marginTrend === null ? 'n.d.' : `${marginTrend >= 0 ? '+' : ''}${nf(1).format(marginTrend * 100)} pts`,
      score: marginTrend === null ? null : lin(marginTrend, -0.05, 0.03), rule: 'Une marge stable ou en hausse traduit un pouvoir de fixation des prix' },
  ];
  categories.push({ id: 'ebitda', label: 'EBITDA', weight: 5, score: catScore(ebC), criteria: ebC });

  // ===== 7. Qualité (Buffett) & solidité (Piotroski, Altman)
  const roeH = ni.map((v, i) => (isNum(v) && isNum(equityH[i]) && (equityH[i] as number) > 0 ? v / (equityH[i] as number) : null));
  const roeAvg = avg(roeH);
  const nmH = ni.map((v, i) => (isNum(v) && isNum(revenue[i]) && (revenue[i] as number) > 0 ? v / (revenue[i] as number) : null));
  const nmAvg = avg(nmH);
  const gm = g(L, 'grossProfit') !== null && revenue.at(-1) ? (g(L, 'grossProfit') as number) / (revenue.at(-1) as number) : null;
  // Rentabilité brute des actifs (Novy-Marx, 2013) : mesure de rentabilité la mieux validée empiriquement.
  const gpa = g(L, 'grossProfit') !== null && totalAssets && totalAssets > 0 ? (g(L, 'grossProfit') as number) / totalAssets : null;
  const niF = ni.filter(isNum);
  const profitableYears = niF.filter(v => v > 0).length;
  const capex = g(L, 'capitalExpenditure'); const ocf = g(L, 'operatingCashFlow');
  const capexR = capex !== null && ocf && ocf > 0 ? Math.abs(capex) / ocf : null;
  // Accruals (Sloan, 1996) : part du bénéfice non convertie en trésorerie, rapportée à l'actif. Mesuré seulement
  // si l'exercice est bénéficiaire : une perte creusée par des dépréciations (sans effet sur la trésorerie)
  // ferait sinon passer une société en difficulté pour une société aux bénéfices « de qualité ».
  const niL = g(L, 'netIncome', 'netIncomeCommonStockholders');
  const accruals = niL !== null && niL > 0 && ocf !== null && totalAssets && totalAssets > 0 ? (niL - ocf) / totalAssets : null;

  // Piotroski F-Score
  let pio: number | null = null, pioN = 0;
  if (L && P) {
    const tests: (boolean | null)[] = [];
    const nl = g(L, 'netIncome'), np = g(P, 'netIncome'), tal = g(L, 'totalAssets'), tap = g(P, 'totalAssets');
    const ocfL = g(L, 'operatingCashFlow');
    tests.push(nl !== null ? nl > 0 : null);
    tests.push(ocfL !== null ? ocfL > 0 : null);
    tests.push(nl !== null && np !== null && tal && tap ? nl / tal > np / tap : null);
    tests.push(ocfL !== null && nl !== null ? ocfL > nl : null);
    const ldl = g(L, 'longTermDebt'), ldp = g(P, 'longTermDebt');
    tests.push(ldl !== null && ldp !== null && tal && tap ? ldl / tal <= ldp / tap : null);
    const cal = g(L, 'currentAssets'), cll = g(L, 'currentLiabilities'), cap = g(P, 'currentAssets'), clp = g(P, 'currentLiabilities');
    tests.push(cal && cll && cap && clp ? cal / cll > cap / clp : null);
    const sl = g(L, 'ordinarySharesNumber', 'dilutedAverageShares'), sp = g(P, 'ordinarySharesNumber', 'dilutedAverageShares');
    tests.push(sl && sp ? sl <= sp * 1.005 : null);
    const gl = g(L, 'grossProfit'), gp = g(P, 'grossProfit'), rl = g(L, 'totalRevenue'), rp = g(P, 'totalRevenue');
    tests.push(gl !== null && gp !== null && rl && rp ? gl / rl > gp / rp : null);
    tests.push(rl && rp && tal && tap ? rl / tal > rp / tap : null);
    const valid = tests.filter(t => t !== null) as boolean[];
    pioN = valid.length;
    if (pioN >= 6) pio = Math.round((valid.filter(Boolean).length / pioN) * 9);
  }
  // Altman Z''-Score (Altman, 1995) : version prévue pour les entreprises non industrielles, sans le terme
  // ventes / actif (très dépendant du secteur) et sans le cours de bourse. Le Z de 1968, estimé sur des
  // industriels, était appliqué à tous les secteurs en v1.
  let altman: number | null = null;
  const wc = g(L, 'workingCapital') ?? (g(L, 'currentAssets') !== null && g(L, 'currentLiabilities') !== null ? (g(L, 'currentAssets') as number) - (g(L, 'currentLiabilities') as number) : null);
  const re = g(L, 'retainedEarnings'); const tl = g(L, 'totalLiabilitiesNetMinorityInterest');
  // Non pertinent non plus quand les rachats d'actions ont rendu les fonds propres négatifs (termes comptables faussés).
  const altmanOk = !isFinancial && !['Real Estate', 'Utilities'].includes(sector) && !solidNegEq;
  if (altmanOk && totalAssets && wc !== null && re !== null && ebit !== null && tl && equity !== null) {
    altman = 6.56 * wc / totalAssets + 3.26 * re / totalAssets + 6.72 * ebit / totalAssets + 1.05 * equity / tl;
  }
  const qC: Criterion[] = [
    { id: 'q-roe', gauge: gz(roeAvg, 0.04, 0.18, 'pct'), label: 'Rentabilité des capitaux propres (ROE moyen)', weight: 2, value: pct(roeAvg),
      score: roeAvg === null ? null : lin(roeAvg, 0.04, 0.18), rule: 'Buffett : ≥ 15 % durablement, sans dette excessive' },
    { id: 'q-gpa', gauge: isFinancial ? undefined : gz(gpa, 0.05, 0.45, 'pct'), label: 'Rentabilité brute des actifs', weight: 2, value: gpa === null ? 'n.d.' : `${pct(gpa)} (marge brute ${pct(gm)})`,
      score: isFinancial || gpa === null ? null : lin(gpa, 0.05, 0.45),
      rule: 'Marge brute / total de l’actif : ≥ 40 % = rentabilité élevée (Novy-Marx, 2013) ; Buffett : marge brute > 40 % = pouvoir de prix' },
    { id: 'q-accruals', gauge: isFinancial ? undefined : gz(accruals, 0.08, -0.08, 'pct'), label: 'Qualité des bénéfices (cash vs bénéfice)', weight: 2,
      value: accruals === null ? 'n.d.' : `${accruals > 0 ? '+' : ''}${nf(1).format(accruals * 100)} % de l’actif`,
      score: isFinancial || accruals === null ? null : lin(accruals, 0.08, -0.08),
      rule: '(Bénéfice − cash-flow d’exploitation) / actif : négatif = bénéfice bien couvert par le cash ; élevé = bénéfice moins durable (Sloan, 1996)' },
    { id: 'q-nm', gauge: gz(nmAvg, 0, isFinancial ? 0.25 : 0.15, 'pct'), label: 'Marge nette moyenne', weight: 1, value: pct(nmAvg), score: nmAvg === null ? null : lin(nmAvg, 0, isFinancial ? 0.25 : 0.15),
      rule: 'Buffett : > 10 % signale un avantage concurrentiel (« moat »)' },
    { id: 'q-profit', gauge: niF.length ? gz(profitableYears / niF.length, 0, 1, 'pct', 0, 1) : undefined, label: 'Bénéficiaire chaque année', weight: 2, value: niF.length ? `${profitableYears} / ${niF.length} années` : 'n.d.',
      score: niF.length ? (profitableYears / niF.length) * 10 : null, rule: 'Graham : aucun déficit sur la période' },
    { id: 'q-capex', gauge: isFinancial ? undefined : gz(capexR, 0.9, 0.3, 'pct', 0), label: "Investissements / cash-flow d'exploitation", weight: 2, value: pct(capexR, 0),
      score: isFinancial || capexR === null ? null : lin(capexR, 0.9, 0.3), rule: 'Buffett aime les activités peu gourmandes en capital (< 50 %) ; les entreprises qui investissent peu surperforment (Fama-French, 2015)' },
    { id: 'q-pio', gauge: gz(pio, 2, 8, 'num', 0, 9), label: 'Piotroski F-Score', weight: 1, value: pio === null ? 'n.d.' : `${pio} / 9`, score: pio === null ? null : lin(pio, 2, 8),
      rule: '8-9 = santé financière solide ; 0-2 = fragile (9 tests comptables)', comment: pio !== null && pioN < 9 ? `Calculé sur ${pioN} tests disponibles, ramené sur 9.` : undefined },
    { id: 'q-altman', gauge: gz(altman, 1.1, 2.6, 'num'), label: "Altman Z''-Score", weight: 1, value: altman === null ? (!altmanOk ? 'Non applicable' : 'n.d.') : nf(2).format(altman),
      score: altman === null ? null : lin(altman, 1.1, 2.6), rule: '> 2,6 zone sûre ; 1,1 – 2,6 zone grise ; < 1,1 risque de faillite (modèle 1995, sociétés non industrielles)' },
  ];
  if (netIncome !== null && netIncome < 0) redFlags.push('Perte nette lors du dernier exercice.');
  if (altman !== null && altman < 1.1) redFlags.push(`Altman Z''-Score en zone de détresse (${nf(2).format(altman)}).`);
  if (pio !== null && pio <= 2) redFlags.push(`Piotroski F-Score faible (${pio}/9).`);
  categories.push({ id: 'quality', label: 'Qualité & solidité', weight: 20, score: catScore(qC), criteria: qC });

  // ===== 8. Concurrents
  const peers: PeerRow[] = input.peers ?? [];
  const peerSource = input.peers ? input.peerSource : '';
  if (!input.peers) warnings.push('Comparaison avec les concurrents indisponible.');
  const selfRow = peerRow(symbol, q, true);
  const cmp = (key: keyof PeerRow, label: string, lowerIsBetter: boolean, fmt: (v: number | null) => string, weight = 1): Criterion => {
    const mine = selfRow[key] as number | null;
    const others = peers.map(p => p[key] as number | null).filter(isNum);
    const med = median(others);
    let score: number | null = null;
    if (mine !== null && others.length >= 2) {
      const beats = others.filter(o => (lowerIsBetter ? mine < o : mine > o)).length + others.filter(o => o === mine).length / 2;
      score = (beats / others.length) * 10;
    }
    return { id: 'peer-' + String(key), label, weight, value: `${fmt(mine)} vs médiane ${fmt(med)}`, score,
      gauge: score === null ? undefined : gz(score / 10, 0, 1, 'pct', 0, 1),
      rule: lowerIsBetter ? 'Plus bas que les concurrents = mieux' : 'Plus haut que les concurrents = mieux' };
  };
  const peerC: Criterion[] = peers.length >= 2 ? [
    cmp('pe', 'PER', true, v => x(v), 2),
    ...(isFinancial ? [cmp('pb', 'Cours / valeur comptable', true, v => x(v, 2), 2)] : [cmp('evEbitda', 'VE / EBITDA', true, v => x(v), 2)]),
    cmp('dy', 'Rendement du dividende', false, v => pct(v, 2)),
    cmp('netMargin', 'Marge nette', false, v => pct(v), 2),
    cmp('roe', 'ROE', false, v => pct(v), 2),
    ...(isFinancial ? [] : [cmp('de', 'Dette / capitaux propres', true, v => x(v, 2))]),
  ] : [];
  categories.push({ id: 'peers', label: 'Face aux concurrents', weight: 10, score: catScore(peerC), criteria: peerC,
    note: peers.length ? `${peers.length} concurrents retenus (${peerSource}).` : 'Pas assez de concurrents comparables trouvés.' });

  // ===== Synthèse
  const scored = categories.filter(c => c.score !== null);
  const wsum = scored.reduce((s, c) => s + c.weight, 0);
  const score = wsum ? Math.round(scored.reduce((s, c) => s + (c.score as number) * c.weight, 0) / wsum) : 0;
  for (const c of categories) for (const k of c.criteria) {
    if (k.score === null || !k.weight) continue;
    if (k.score >= 8 && k.weight >= 2) strengths.push(`${k.label} : ${k.value}`);
    if (k.score <= 2.5 && k.weight >= 2) weaknesses.push(`${k.label} : ${k.value}`);
  }
  const valScore = categories.find(c => c.id === 'value')?.score ?? 50;
  const qualScore = avg(categories.filter(c => ['debt', 'quality', 'revenue', 'ebitda', 'cash'].includes(c.id)).map(c => c.score)) ?? 50;
  let verdictLevel: Analysis['verdictLevel']; let verdict: string; let verdictText: string;
  // Seuil 70 (68 en v1) : même sélectivité qu'en v1 (≈ un quart des actions), la v2 ne pénalisant plus
  // automatiquement les sociétés sans dividende ni celles qui rachètent massivement leurs actions.
  if (score >= 70 && !redFlags.length && valScore >= 45) {
    verdictLevel = 'buy'; verdict = 'Achat pertinent';
    verdictText = 'Entreprise solide, peu endettée, à un prix raisonnable au regard de ses résultats passés.';
  } else if (score >= 52 && !(redFlags.length >= 2)) {
    verdictLevel = 'watch';
    if (qualScore >= 65 && valScore < 45) { verdict = 'Bonne entreprise, prix élevé'; verdictText = 'Les fondamentaux sont bons mais le prix actuel n’offre pas de marge de sécurité : à surveiller pour un meilleur point d’entrée.'; }
    else { verdict = 'À étudier'; verdictText = 'Profil mitigé : certains critères sont bons, d’autres demandent une analyse plus poussée.'; }
  } else {
    verdictLevel = 'avoid'; verdict = 'Pas pertinent actuellement';
    verdictText = 'Les critères fondamentaux (dette, rentabilité, prix) ne réunissent pas les conditions d’un investissement prudent.';
  }
  if (redFlags.length && verdictLevel !== 'avoid') verdictText += ' Attention aux signaux d’alerte.';

  return {
    symbol, name: pr.longName || pr.shortName || symbol, exchange: pr.exchangeName || '', currency: priceCcy, price, marketCap: mcap, financialCurrency: finCcy,
    sector: SECTOR_FR[sector] ?? sector, industry, country: ap.country || '', summary: ap.longBusinessSummary || '', isFinancial,
    score, verdict, verdictLevel, verdictText, strengths: strengths.slice(0, 6), weaknesses: weaknesses.slice(0, 6), redFlags,
    categories,
    history: { years, revenue, ebitda: ebitdaH, netIncome: ni, fcf: fcfH },
    dividends: { byYear: byYear.filter(d => d.year >= nowY - 25), consecutiveYears: consecutive, firstYear, noCutYears: noCut, currency: priceCcy },
    peers: [selfRow, ...peers], peerSource,
    graham: { number: grahamInPriceCcy, marginOfSafety: mos },
    priceTargets,
    riskFree, updatedAt: asOf.toISOString(), warnings,
  };
}
