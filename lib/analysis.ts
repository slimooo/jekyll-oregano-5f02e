/* Moteur d'analyse fondamentale.
 * Uniquement des données publiées (comptes annuels, dividendes versés, cours actuel).
 * Aucune prise en compte de l'évolution du cours, des objectifs d'analystes ou des prévisions.
 */
import { yf, retry, cached, screenIndustry } from './yahoo';
import { BY_SYMBOL, STOCKS, EUROPE, SECTOR_FR, type StockEntry } from './stocks';

export type Status = 'good' | 'mid' | 'bad' | 'na';
export interface Criterion { id: string; label: string; value: string; score: number | null; weight: number; rule: string; comment?: string }
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
  riskFree: number; updatedAt: string; warnings: string[];
}

// ---------- utilitaires
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const num = (v: unknown): number | null => (isNum(v) ? v : null);
const clamp = (v: number, a = 0, b = 10) => Math.max(a, Math.min(b, v));
/** Interpolation linéaire : `bad` -> 0, `good` -> 10 (fonctionne dans les deux sens). */
const lin = (v: number, bad: number, good: number) => clamp(((v - bad) / (good - bad)) * 10);
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

const SUBUNIT: Record<string, [string, number]> = { GBp: ['GBP', 100], GBX: ['GBP', 100], ZAc: ['ZAR', 100], ILA: ['ILS', 100] };

/** Facteur pour convertir un montant de la devise de cotation vers la devise des comptes. */
async function conversion(priceCcy: string, finCcy: string): Promise<number> {
  let factor = 1;
  let p = priceCcy;
  if (SUBUNIT[p]) { factor = 1 / SUBUNIT[p][1]; p = SUBUNIT[p][0]; }
  if (p === finCcy || !finCcy) return factor;
  const rate = await cached(`fx:${p}${finCcy}`, 6 * 3600_000, async () => {
    const q = await retry(() => yf.quote(`${p}${finCcy}=X`));
    return num((q as { regularMarketPrice?: number }).regularMarketPrice);
  }).catch(() => null);
  if (!rate) throw new Error(`taux de change ${p}/${finCcy} indisponible`);
  return factor * rate;
}

function regionOf(symbol: string): string {
  const e = BY_SYMBOL.get(symbol);
  if (e) return e.r;
  const suf = symbol.includes('.') ? symbol.split('.').pop()!.toUpperCase() : '';
  const map: Record<string, string> = { PA: 'fr', DE: 'de', F: 'de', L: 'gb', AS: 'nl', MC: 'es', MI: 'it', SW: 'ch', ST: 'se', CO: 'dk', OL: 'no', HE: 'fi', BR: 'be', VI: 'at', IR: 'ie', LS: 'pt', WA: 'pl', AT: 'gr', T: 'jp', HK: 'hk', AX: 'au', TO: 'ca', KS: 'kr', TW: 'tw', SI: 'sg', TA: 'il' };
  return map[suf] ?? 'us';
}

// ---------- données concurrentes (ratios Yahoo homogènes)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;
interface QS { price?: Loose; summaryDetail?: Loose; financialData?: Loose; defaultKeyStatistics?: Loose; assetProfile?: Loose }
async function fetchSummary(symbol: string): Promise<QS> {
  return retry(() => yf.quoteSummary(symbol, { modules: ['price', 'summaryDetail', 'financialData', 'defaultKeyStatistics', 'assetProfile'] })) as Promise<QS>;
}

function peerRow(symbol: string, q: QS, self = false): PeerRow {
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

// Taux approximatifs vers l'USD, uniquement pour comparer des tailles d'entreprises.
const USD: Record<string, number> = { USD: 1, EUR: 1.08, GBP: 1.27, GBp: 1.27, CHF: 1.13, SEK: 0.095, DKK: 0.145, NOK: 0.093, PLN: 0.25, JPY: 0.0067,
  HKD: 0.128, KRW: 0.00072, TWD: 0.031, CAD: 0.73, AUD: 0.65, SGD: 0.74, ILS: 0.27, ILA: 0.27, CNY: 0.14 };
const usd = (mc: number, ccy: string) => mc * (USD[ccy] ?? 1);

async function findPeers(symbol: string, industry: string, sector: string, mcap: number): Promise<{ list: StockEntry[]; source: string }> {
  const region = regionOf(symbol);
  const group = EUROPE.includes(region) ? EUROPE : [region];
  const allRegions = [...new Set([...group, 'us', 'ca', 'gb', 'fr', 'de', 'ch', 'nl', 'jp'])];
  const pick = (cands: StockEntry[]) => {
    const lm = Math.log10(Math.max(mcap, 1)); // mcap déjà en USD
    const self = BY_SYMBOL.get(symbol);
    return cands
      .filter(c => c.s !== symbol && c.mc > 0 && !(self && c.n === self.n))
      .map(c => ({ c, d: Math.abs(Math.log10(usd(c.mc, c.c)) - lm) + (group.includes(c.r) ? 0 : 0.5) }))
      .sort((a, b) => a.d - b.d)
      .filter((v, i, arr) => arr.findIndex(w => w.c.n === v.c.n) === i)
      .slice(0, 6).map(v => v.c);
  };
  if (industry) {
    try {
      const quotes = await cached(`ind:${industry}`, 24 * 3600_000, () => screenIndustry(industry.replace(/ - /g, '—'), allRegions));
      const inDb = quotes.map(q => BY_SYMBOL.get(q.symbol)).filter((e): e is StockEntry => !!e);
      const list = pick(inDb);
      if (list.length >= 3) return { list, source: `même industrie (${industry})` };
    } catch { /* repli ci-dessous */ }
  }
  const sameSector = STOCKS.filter(s => s.sec === sector && (group.includes(s.r) || s.r === 'us'));
  return { list: pick(sameSector), source: `même secteur (${SECTOR_FR[sector] ?? sector})` };
}

// ---------- analyse principale
export async function analyze(symbolIn: string): Promise<Analysis> {
  const symbol = symbolIn.toUpperCase();
  const warnings: string[] = [];
  const since = new Date(); since.setFullYear(since.getFullYear() - 6);

  const [q, ts, chart, tnx] = await Promise.all([
    fetchSummary(symbol),
    retry(() => yf.fundamentalsTimeSeries(symbol, { period1: since, type: 'annual', module: 'all' })).catch(() => [] as Record<string, unknown>[]),
    retry(() => yf.chart(symbol, { period1: '1970-01-01', interval: '1mo', events: 'div' })).catch(() => null),
    cached('tnx', 6 * 3600_000, () => retry(() => yf.quote('^TNX'))).catch(() => null),
  ]);

  const pr = q.price ?? ({} as Loose);
  const sd = q.summaryDetail ?? ({} as Loose);
  const fd = q.financialData ?? ({} as Loose);
  const ap = q.assetProfile ?? ({} as Loose);
  if (pr.quoteType && pr.quoteType !== 'EQUITY') throw new Error("Ce titre n'est pas une action (ETF, fonds…) : analyse non applicable.");

  const priceCcy = pr.currency || 'USD';
  const finCcy = fd.financialCurrency || priceCcy.replace(/^GBp$/, 'GBP');
  const price = num(pr.regularMarketPrice) ?? num(fd.currentPrice);
  const mcap = num(pr.marketCap) ?? num(sd.marketCap);
  const sector = ap.sector || BY_SYMBOL.get(symbol)?.sec || '';
  const industry = ap.industry || '';
  const isFinancial = sector === 'Financial Services' && /bank|insurance|capital markets|credit|mortgage|asset management|financial conglomerates/i.test(industry);
  const isReit = sector === 'Real Estate' && /reit/i.test(industry);
  const riskFree = (num((tnx as { regularMarketPrice?: number } | null)?.regularMarketPrice) ?? 4.2) / 100;

  let conv = 1;
  try { conv = await conversion(priceCcy, finCcy); } catch (e) { warnings.push(String((e as Error).message)); }
  // la capitalisation Yahoo est exprimée dans l'unité principale (GBP et non GBp)
  const mcapF = mcap !== null ? mcap * conv * (SUBUNIT[priceCcy]?.[1] ?? 1) : null;
  const priceF = price !== null ? price * conv : null;

  // --- historique annuel
  type Row = Record<string, unknown> & { date: Date };
  const rows = (ts as Row[]).filter(r => isNum(r.totalRevenue)).sort((a, b) => +new Date(a.date) - +new Date(b.date)).slice(-5);
  const g = (r: Row | undefined, ...keys: string[]) => { if (!r) return null; for (const k of keys) if (isNum(r[k])) return r[k] as number; return null; };
  const years = rows.map(r => new Date(r.date).getFullYear());
  const revenue = rows.map(r => g(r, 'totalRevenue'));
  const ebitdaH = rows.map(r => g(r, 'EBITDA', 'normalizedEBITDA'));
  const ni = rows.map(r => g(r, 'netIncomeCommonStockholders', 'netIncome'));
  const fcfH = rows.map(r => g(r, 'freeCashFlow'));
  const equityH = rows.map(r => g(r, 'commonStockEquity', 'stockholdersEquity'));
  const L = rows[rows.length - 1], P = rows[rows.length - 2];
  if (rows.length < 2) warnings.push('Historique financier limité : certains critères ne peuvent pas être calculés.');

  const debt = num(fd.totalDebt) ?? g(L, 'totalDebt') ?? 0;
  const cash = num(fd.totalCash) ?? g(L, 'cashCashEquivalentsAndShortTermInvestments', 'cashAndCashEquivalents');
  const equity = g(L, 'commonStockEquity', 'stockholdersEquity');
  const netIncome = g(L, 'netIncomeCommonStockholders', 'netIncome');
  const ebitda = num(fd.ebitda) ?? g(L, 'EBITDA', 'normalizedEBITDA');
  const revTTM = num(fd.totalRevenue) ?? g(L, 'totalRevenue');
  const ebit = g(L, 'EBIT', 'operatingIncome');
  const interest = g(L, 'interestExpense', 'interestExpenseNonOperating');
  const ltDebt = g(L, 'longTermDebt') ?? debt;
  const totalAssets = g(L, 'totalAssets');
  const shares = g(L, 'ordinarySharesNumber', 'shareIssued') ?? num(q.defaultKeyStatistics?.sharesOutstanding);

  const categories: Category[] = [];
  const strengths: string[] = [], weaknesses: string[] = [], redFlags: string[] = [];

  // ===== 1. Dividendes
  const divs = (chart?.events?.dividends ?? []) as { amount: number; date: Date }[];
  const byYearMap = new Map<number, number>();
  for (const d of divs) { const y = new Date(d.date).getFullYear(); byYearMap.set(y, (byYearMap.get(y) ?? 0) + d.amount); }
  const nowY = new Date().getFullYear();
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
  const histStart = chart?.meta?.firstTradeDate ? new Date(chart.meta.firstTradeDate).getFullYear() : null;
  const divC: Criterion[] = [
    { id: 'div-years', label: 'Ancienneté du dividende', weight: 3,
      value: consecutive ? `${consecutive} an${consecutive > 1 ? 's' : ''} consécutifs (depuis ${firstYear})` : 'Aucun dividende récent',
      score: consecutive >= 25 ? 10 : consecutive >= 15 ? 9 : consecutive >= 10 ? 8 : consecutive >= 5 ? 6 : consecutive >= 2 ? 3 : consecutive ? 2 : 0,
      rule: '≥ 25 ans = « aristocrate » ; ≥ 10 ans = fiable ; < 5 ans = historique court',
      comment: histStart && firstYear && firstYear <= histStart + 1 ? `Les données commencent en ${histStart} : l'ancienneté réelle est probablement supérieure.` : undefined },
    { id: 'div-nocut', label: 'Dividende maintenu ou en hausse', weight: 2,
      value: consecutive ? `${noCut} an${noCut > 1 ? 's' : ''} sans baisse notable` : '—',
      score: consecutive ? (noCut >= 20 ? 10 : noCut >= 10 ? 8.5 : noCut >= 5 ? 6.5 : noCut >= 2 ? 4 : 1) : 0,
      rule: 'Années consécutives où le dividende total n’a pas baissé de plus de 10 %' },
    { id: 'div-yield', label: 'Rendement du dividende', weight: 2, value: pct(dy, 2),
      score: dy === null ? null : dy === 0 ? 0 : dy > 0.09 ? 4 : dy >= 0.03 ? 10 : lin(dy, 0, 0.03),
      rule: '3 – 9 % idéal ; > 9 % = risque de « piège à dividende »' },
    { id: 'div-payout', label: 'Taux de distribution', weight: 3, value: pct(payout, 0),
      score: payout === null || !consecutive ? null : payout <= 0 ? 2 : isReit ? (payout <= 0.9 ? 9 : payout <= 1.1 ? 5 : 1) : payout <= 0.6 ? 10 : payout <= 0.8 ? 6 : payout <= 1 ? 3 : 0,
      rule: isReit ? 'Foncière : ≤ 90 % des bénéfices (règles REIT/SIIC)' : '≤ 60 % des bénéfices = soutenable ; > 100 % = dividende non couvert' },
  ];
  if (payout !== null && payout > 1 && !isReit) redFlags.push('Le dividende dépasse les bénéfices (taux de distribution > 100 %).');
  categories.push({ id: 'dividend', label: 'Dividendes', weight: 15, score: catScore(divC), criteria: divC });

  // ===== 2. Endettement
  const de = equity && equity > 0 ? debt / equity : null;
  const netDebt = cash !== null ? debt - cash : null;
  const ndE = netDebt !== null && ebitda && ebitda > 0 ? netDebt / ebitda : null;
  const cover = ebit !== null && interest && interest > 0 ? ebit / interest : null;
  const avgDebt = avg([g(L, 'totalDebt'), g(P, 'totalDebt')]);
  const costDebt = interest && avgDebt && avgDebt > 0 ? interest / avgDebt : null;
  const debtYears = netIncome && netIncome > 0 ? ltDebt / netIncome : null;
  let debtC: Criterion[];
  if (isFinancial) {
    const eqA = equity && totalAssets ? equity / totalAssets : null;
    debtC = [
      { id: 'fin-capital', label: 'Fonds propres / total du bilan', weight: 3, value: pct(eqA), score: eqA === null ? null : lin(eqA, 0.03, 0.12),
        rule: 'Banques / assurances : ≥ 10 % = bien capitalisé ; < 5 % = levier élevé' },
      { id: 'debt-na', label: 'Ratios de dette classiques', weight: 0, value: 'Non applicables', score: null,
        rule: 'La dette est la « matière première » d’une banque : on juge plutôt la capitalisation.' },
    ];
  } else {
    debtC = [
      { id: 'debt-de', label: 'Dette / capitaux propres', weight: 3, value: de === null ? (equity !== null && equity <= 0 ? 'Capitaux propres négatifs' : 'n.d.') : x(de, 2),
        score: de === null ? (equity !== null && equity <= 0 ? 0 : null) : de <= 0.5 ? 10 : lin(de, 2, 0.5),
        rule: 'Critère Buffett : < 0,5 x excellent ; > 2 x élevé' },
      { id: 'debt-nde', label: 'Dette nette / EBITDA', weight: 3, value: ndE === null ? 'n.d.' : ndE < 0 ? 'Trésorerie nette positive' : x(ndE),
        score: ndE === null ? null : ndE <= 1 ? 10 : lin(ndE, 4, 1), rule: '< 1 x très sain ; 1 – 3 x acceptable ; > 4 x risqué' },
      { id: 'debt-cover', label: 'Couverture des intérêts (EBIT / intérêts)', weight: 2, value: x(cover),
        score: cover === null ? (interest === 0 ? 10 : null) : lin(cover, 1.5, 10), rule: '> 8 x confortable (Graham : > 5 x) ; < 2 x fragile' },
      { id: 'debt-cost', label: 'Taux moyen de la dette', weight: 1, value: pct(costDebt, 2),
        score: costDebt === null ? null : lin(costDebt, 0.09, 0.03), rule: 'Charges d’intérêts / dette moyenne : < 4 % favorable ; > 8 % coûteux' },
      { id: 'debt-years', label: 'Années de bénéfices pour rembourser la dette LT', weight: 2, value: debtYears === null ? 'n.d.' : `${nf(1).format(debtYears)} ans`,
        score: debtYears === null ? (netIncome !== null && netIncome <= 0 ? 0 : null) : debtYears <= 3 ? 10 : lin(debtYears, 8, 3),
        rule: 'Critère Buffett : dette long terme remboursable en ≤ 3-4 ans de bénéfice net' },
    ];
    if (equity !== null && equity <= 0) redFlags.push('Capitaux propres négatifs.');
  }
  categories.push({ id: 'debt', label: 'Endettement', weight: 15, score: catScore(debtC), criteria: debtC });

  // ===== 3. Trésorerie
  const cr = num(fd.currentRatio) ?? (g(L, 'currentAssets') && g(L, 'currentLiabilities') ? (g(L, 'currentAssets') as number) / (g(L, 'currentLiabilities') as number) : null);
  const fcfPos = fcfH.filter(isNum);
  const cashMc = cash !== null && mcapF ? cash / mcapF : null;
  const cashC: Criterion[] = [
    { id: 'cash-debt', label: 'Trésorerie / dette totale', weight: 3, value: cash === null ? 'n.d.' : debt > 0 ? pct(cash / debt, 0) : 'Aucune dette',
      score: isFinancial ? null : cash === null ? null : debt <= 0 ? 10 : lin(cash / debt, 0.1, 1), rule: '≥ 100 % = la trésorerie couvre toute la dette' },
    { id: 'cash-level', label: 'Niveau de trésorerie', weight: 1, value: `${money(cash, finCcy)}${cashMc !== null ? ` (${pct(cashMc, 0)} de la capitalisation)` : ''}`,
      score: isFinancial || cashMc === null ? null : lin(cashMc, 0, 0.15), rule: 'Part de la capitalisation détenue en liquidités' },
    { id: 'cash-cr', label: 'Ratio de liquidité générale', weight: 2, value: x(cr, 2),
      score: isFinancial || cr === null ? null : lin(cr, 0.7, 2), rule: 'Actif courant / passif courant : Graham ≥ 2 ; < 1 = tension possible' },
    { id: 'cash-fcf', label: 'Flux de trésorerie libre positif', weight: 3, value: fcfPos.length ? `${fcfPos.filter(v => v > 0).length} / ${fcfPos.length} années` : 'n.d.',
      score: isFinancial || !fcfPos.length ? null : (fcfPos.filter(v => v > 0).length / fcfPos.length) * 10, rule: 'L’entreprise génère-t-elle du cash chaque année après investissements ?' },
  ];
  if (isFinancial) cashC.forEach(c => { if (c.score === null) c.comment = 'Peu pertinent pour une banque ou une assurance.'; });
  categories.push({ id: 'cash', label: 'Trésorerie', weight: 10, score: catScore(cashC), criteria: cashC });

  // ===== 4. Valorisation (prix actuel)
  const peY = num(sd.trailingPE);
  const pe = peY !== null && peY > 0 ? peY : mcapF && netIncome && netIncome > 0 ? mcapF / netIncome : null;
  const pb = mcapF && equity && equity > 0 ? mcapF / equity : null;
  const ev = mcapF !== null && cash !== null ? mcapF + debt - cash : null;
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
    { id: 'val-pe', label: 'PER (cours / bénéfice)', weight: 3, value: pe === null ? (netIncome !== null && netIncome <= 0 ? 'Pertes' : 'n.d.') : x(pe),
      score: pe === null ? (netIncome !== null && netIncome <= 0 ? 0 : null) : pe <= 15 ? 10 : lin(pe, 35, 15), rule: 'Graham : ≤ 15 x ; > 30 x = cher' },
    { id: 'val-pb', label: 'Cours / valeur comptable', weight: 2, value: x(pb, 2),
      score: pb === null ? null : pb <= 1.5 ? 10 : lin(pb, isFinancial ? 3 : 6, 1.5), rule: 'Graham : ≤ 1,5 x' },
    { id: 'val-graham', label: 'PER × P/B (règle de Graham)', weight: 1, value: pe && pb ? nf(1).format(pe * pb) : 'n.d.',
      score: pe && pb ? (pe * pb <= 22.5 ? 10 : lin(pe * pb, 80, 22.5)) : null, rule: 'Graham : produit ≤ 22,5' },
    { id: 'val-mos', label: 'Marge de sécurité (nombre de Graham)', weight: 3,
      value: grahamInPriceCcy ? `${pct(mos, 0)} (valeur ${nf(2).format(grahamInPriceCcy)} ${priceCcy})` : 'n.d.',
      score: mos === null ? null : lin(mos, -1, 0.33), rule: '√(22,5 × BPA × actif net/action) ; Graham exige ≥ 33 % de marge' },
    { id: 'val-ev', label: 'VE / EBITDA', weight: 2, value: x(evE),
      score: isFinancial || evE === null ? null : evE <= 7 ? 10 : lin(evE, 20, 7), rule: '< 8 x bon marché ; > 15 x cher' },
    { id: 'val-fcfy', label: 'Rendement du cash-flow libre', weight: 2, value: pct(fcfY),
      score: isFinancial || fcfY === null ? null : lin(fcfY, 0, 0.08), rule: 'FCF / capitalisation : > 6 % attractif ; < 2 % cher' },
    { id: 'val-ey', label: 'Rendement des bénéfices vs taux 10 ans', weight: 2,
      value: ey === null ? 'n.d.' : `${pct(ey)} vs ${pct(riskFree, 2)}`,
      score: ey === null ? null : lin(ey - riskFree, -0.03, 0.04), rule: 'Buffett : 1/PER doit battre nettement l’obligation d’État (taux US 10 ans)' },
  ];
  categories.push({ id: 'value', label: 'Prix actuel (valorisation)', weight: 20, score: catScore(valC), criteria: valC });

  // ===== 5. Chiffre d'affaires
  const revF = revenue.filter(isNum);
  const n = revF.length;
  const cagr = n >= 2 && revF[0] > 0 && revF[n - 1] > 0 ? Math.pow(revF[n - 1] / revF[0], 1 / (n - 1)) - 1 : null;
  let up = 0; for (let i = 1; i < n; i++) if (revF[i] >= revF[i - 1]) up++;
  const revC: Criterion[] = [
    { id: 'rev-cagr', label: `Croissance annuelle moyenne (${n ? years[0] + '–' + years[years.length - 1] : '—'})`, weight: 3, value: pct(cagr),
      score: cagr === null ? null : lin(cagr, -0.05, 0.1), rule: '> 8 %/an solide ; négative = activité en recul' },
    { id: 'rev-reg', label: 'Régularité de la croissance', weight: 2, value: n >= 2 ? `${up} hausse${up > 1 ? 's' : ''} sur ${n - 1} an${n > 2 ? 's' : ''}` : 'n.d.',
      score: n >= 2 ? (up / (n - 1)) * 10 : null, rule: 'Buffett privilégie les activités prévisibles' },
  ];
  categories.push({ id: 'revenue', label: "Chiffre d'affaires", weight: 10, score: catScore(revC), criteria: revC });

  // ===== 6. EBITDA
  const ebF = ebitdaH.map((e, i) => (isNum(e) && isNum(revenue[i]) && (revenue[i] as number) > 0 ? e / (revenue[i] as number) : null));
  const ebMargin = ebitda && revTTM ? ebitda / revTTM : ebF[ebF.length - 1] ?? null;
  const ebV = ebitdaH.filter(isNum);
  const ebCagr = ebV.length >= 2 && ebV[0] > 0 && ebV[ebV.length - 1] > 0 ? Math.pow(ebV[ebV.length - 1] / ebV[0], 1 / (ebV.length - 1)) - 1 : null;
  const marginTrend = ebF.filter(isNum).length >= 2 ? (ebF.filter(isNum).at(-1) as number) - (ebF.filter(isNum)[0] as number) : null;
  const ebC: Criterion[] = isFinancial ? [
    { id: 'eb-na', label: 'EBITDA', weight: 0, value: 'Non applicable', score: null, rule: 'L’EBITDA n’a pas de sens pour une banque ou une assurance.' },
  ] : [
    { id: 'eb-margin', label: "Marge d'EBITDA", weight: 3, value: pct(ebMargin), score: ebMargin === null ? null : lin(ebMargin, 0.05, 0.3),
      rule: '> 25 % = avantage concurrentiel probable ; < 10 % = activité peu rentable' },
    { id: 'eb-cagr', label: "Croissance annuelle de l'EBITDA", weight: 2, value: pct(ebCagr), score: ebCagr === null ? (ebV.some(v => v <= 0) ? 0 : null) : lin(ebCagr, -0.05, 0.1),
      rule: 'Évolution historique des dernières années' },
    { id: 'eb-trend', label: 'Évolution de la marge', weight: 1, value: marginTrend === null ? 'n.d.' : `${marginTrend >= 0 ? '+' : ''}${nf(1).format(marginTrend * 100)} pts`,
      score: marginTrend === null ? null : lin(marginTrend, -0.05, 0.03), rule: 'Une marge stable ou en hausse traduit un pouvoir de fixation des prix' },
  ];
  categories.push({ id: 'ebitda', label: 'EBITDA', weight: 10, score: catScore(ebC), criteria: ebC });

  // ===== 7. Qualité (Buffett) & solidité (Piotroski, Altman)
  const roeH = ni.map((v, i) => (isNum(v) && isNum(equityH[i]) && (equityH[i] as number) > 0 ? v / (equityH[i] as number) : null));
  const roeAvg = avg(roeH);
  const nmH = ni.map((v, i) => (isNum(v) && isNum(revenue[i]) && (revenue[i] as number) > 0 ? v / (revenue[i] as number) : null));
  const nmAvg = avg(nmH);
  const gm = g(L, 'grossProfit') !== null && revenue.at(-1) ? (g(L, 'grossProfit') as number) / (revenue.at(-1) as number) : null;
  const niF = ni.filter(isNum);
  const profitableYears = niF.filter(v => v > 0).length;
  const sh0 = g(rows[0], 'ordinarySharesNumber', 'dilutedAverageShares'), sh1 = g(L, 'ordinarySharesNumber', 'dilutedAverageShares');
  const shChg = sh0 && sh1 && rows.length >= 2 ? Math.pow(sh1 / sh0, 1 / (rows.length - 1)) - 1 : null;
  const capex = g(L, 'capitalExpenditure'); const ocf = g(L, 'operatingCashFlow');
  const capexR = capex !== null && ocf && ocf > 0 ? Math.abs(capex) / ocf : null;

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
  // Altman Z-Score (entreprises non financières)
  let altman: number | null = null;
  const wc = g(L, 'workingCapital') ?? (g(L, 'currentAssets') !== null && g(L, 'currentLiabilities') !== null ? (g(L, 'currentAssets') as number) - (g(L, 'currentLiabilities') as number) : null);
  const re = g(L, 'retainedEarnings'); const tl = g(L, 'totalLiabilitiesNetMinorityInterest');
  const altmanOk = !isFinancial && !['Real Estate', 'Utilities'].includes(sector);
  if (altmanOk && totalAssets && wc !== null && re !== null && ebit !== null && tl && mcapF && revenue.at(-1)) {
    altman = 1.2 * wc / totalAssets + 1.4 * re / totalAssets + 3.3 * ebit / totalAssets + 0.6 * mcapF / tl + 1.0 * (revenue.at(-1) as number) / totalAssets;
  }
  const qC: Criterion[] = [
    { id: 'q-roe', label: 'Rentabilité des capitaux propres (ROE moyen)', weight: 3, value: pct(roeAvg),
      score: roeAvg === null ? null : lin(roeAvg, 0.04, 0.18), rule: 'Buffett : ≥ 15 % durablement, sans dette excessive' },
    { id: 'q-nm', label: 'Marge nette moyenne', weight: 2, value: pct(nmAvg), score: nmAvg === null ? null : lin(nmAvg, 0, isFinancial ? 0.25 : 0.15),
      rule: 'Buffett : > 10 % signale un avantage concurrentiel (« moat »)' },
    { id: 'q-gm', label: 'Marge brute', weight: 1, value: pct(gm), score: isFinancial || gm === null ? null : lin(gm, 0.15, 0.45),
      rule: 'Buffett : > 40 % = pouvoir de prix' },
    { id: 'q-profit', label: 'Bénéficiaire chaque année', weight: 2, value: niF.length ? `${profitableYears} / ${niF.length} années` : 'n.d.',
      score: niF.length ? (profitableYears / niF.length) * 10 : null, rule: 'Graham : aucun déficit sur la période' },
    { id: 'q-shares', label: "Évolution du nombre d'actions", weight: 1, value: shChg === null ? 'n.d.' : `${shChg > 0 ? '+' : ''}${nf(1).format(shChg * 100)} %/an`,
      score: shChg === null ? null : lin(shChg, 0.04, -0.02), rule: 'Rachats d’actions (baisse) = favorable ; émissions (dilution) = défavorable' },
    { id: 'q-capex', label: "Investissements / cash-flow d'exploitation", weight: 1, value: pct(capexR, 0),
      score: isFinancial || capexR === null ? null : lin(capexR, 0.9, 0.3), rule: 'Buffett aime les activités peu gourmandes en capital (< 50 %)' },
    { id: 'q-pio', label: 'Piotroski F-Score', weight: 2, value: pio === null ? 'n.d.' : `${pio} / 9`, score: pio === null ? null : lin(pio, 2, 8),
      rule: '8-9 = santé financière solide ; 0-2 = fragile (9 tests comptables)', comment: pio !== null && pioN < 9 ? `Calculé sur ${pioN} tests disponibles, ramené sur 9.` : undefined },
    { id: 'q-altman', label: 'Altman Z-Score', weight: 2, value: altman === null ? (!altmanOk ? 'Non applicable' : 'n.d.') : nf(2).format(altman),
      score: altman === null ? null : lin(altman, 1.8, 3), rule: '> 3 zone sûre ; 1,8 – 3 zone grise ; < 1,8 risque de faillite' },
  ];
  if (netIncome !== null && netIncome < 0) redFlags.push('Perte nette lors du dernier exercice.');
  if (altman !== null && altman < 1.8) redFlags.push(`Altman Z-Score en zone de détresse (${nf(2).format(altman)}).`);
  if (pio !== null && pio <= 2) redFlags.push(`Piotroski F-Score faible (${pio}/9).`);
  categories.push({ id: 'quality', label: 'Qualité & solidité', weight: 15, score: catScore(qC), criteria: qC });

  // ===== 8. Concurrents
  let peers: PeerRow[] = []; let peerSource = '';
  try {
    const { list, source } = await findPeers(symbol, industry, sector, usd(mcap ?? 0, priceCcy));
    peerSource = source;
    const res = await Promise.allSettled(list.map(p => cached(`qs:${p.s}`, 6 * 3600_000, () => fetchSummary(p.s))));
    peers = res.flatMap((r, i) => (r.status === 'fulfilled' ? [peerRow(list[i].s, r.value)] : []));
  } catch { warnings.push('Comparaison avec les concurrents indisponible.'); }
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
  if (score >= 68 && !redFlags.length && valScore >= 45) {
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
    riskFree, updatedAt: new Date().toISOString(), warnings,
  };
}
