/* Chargement des données (Yahoo Finance) puis appel du moteur de notation pur (lib/scoring.ts).
 * Uniquement des données publiées (comptes annuels, dividendes versés, cours actuel).
 * Aucune prise en compte de l'évolution du cours, des objectifs d'analystes ou des prévisions.
 */
import { yf, retry, cached, screenIndustry } from './yahoo';
import { BY_SYMBOL, STOCKS, EUROPE, SECTOR_FR, type StockEntry } from './stocks';
import { computeAnalysis, describe, assertEquity, peerRow, SUBUNIT, type Analysis, type AnnualRow, type PeerRow, type QS } from './scoring';

export type { Status, Criterion, Category, PeerRow, Analysis } from './scoring';
export { pct, x, money } from './scoring';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

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
async function fetchSummary(symbol: string): Promise<QS> {
  return retry(() => yf.quoteSummary(symbol, { modules: ['price', 'summaryDetail', 'financialData', 'defaultKeyStatistics', 'assetProfile'] })) as Promise<QS>;
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
  const asOf = new Date();
  const since = new Date(asOf); since.setFullYear(since.getFullYear() - 6);

  const [q, ts, chart, tnx] = await Promise.all([
    fetchSummary(symbol),
    retry(() => yf.fundamentalsTimeSeries(symbol, { period1: since, type: 'annual', module: 'all' })).catch(() => [] as Record<string, unknown>[]),
    retry(() => yf.chart(symbol, { period1: '1970-01-01', interval: '1mo', events: 'div' })).catch(() => null),
    cached('tnx', 6 * 3600_000, () => retry(() => yf.quote('^TNX'))).catch(() => null),
  ]);
  assertEquity(q);
  const fallbackSector = BY_SYMBOL.get(symbol)?.sec || '';
  const { priceCcy, finCcy, mcap, sector, industry } = describe(q, fallbackSector);

  let conv = 1;
  try { conv = await conversion(priceCcy, finCcy); } catch (e) { warnings.push(String((e as Error).message)); }

  let peers: PeerRow[] | null = null; let peerSource = '';
  try {
    const { list, source } = await findPeers(symbol, industry, sector, usd(mcap ?? 0, priceCcy));
    const res = await Promise.allSettled(list.map(p => cached(`qs:${p.s}`, 6 * 3600_000, () => fetchSummary(p.s))));
    peers = res.flatMap((r, i) => (r.status === 'fulfilled' ? [peerRow(list[i].s, r.value)] : []));
    peerSource = source;
  } catch { peers = null; }

  return computeAnalysis({
    symbol, q, conv, peers, peerSource, fallbackSector, warnings, asOf,
    rows: ts as AnnualRow[],
    dividends: (chart?.events?.dividends ?? []) as { amount: number; date: Date }[],
    firstTradeDate: chart?.meta?.firstTradeDate ?? null,
    riskFreePct: num((tnx as { regularMarketPrice?: number } | null)?.regularMarketPrice),
  });
}
