/* Exécute le moteur de notation de l'application (lib/scoring.ts) sur des snapshots historiques.
 *
 * Usage : node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/backtest/run_scoring.ts \
 *           --in snapshots.jsonl --out scores.jsonl [--engine lib/scoring.ts]
 *
 * Chaque snapshot (produit par build_snapshots.py) est converti au format des réponses Yahoo
 * attendu par computeAnalysis ; les concurrents sont choisis comme dans l'app : même industrie,
 * capitalisation la plus proche (6 au plus), repli sur le secteur s'il y en a moins de 3.
 */
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type Row = Record<string, unknown> & { date: string };
interface Snap {
  cik: number; symbol: string | null; asOf: string; name: string; rows: Row[]; gone?: boolean; relinked?: boolean;
  price: number | null; marketCap: number | null; sector: string; industry: string; country: string;
  dividends: { date: string; amount: number }[]; dividendYield: number | null; ttmDividendAdj?: number; splitFactorAfter?: number;
  sharesOutstanding: number | null; riskFreePct: number | null;
  exit?: string; exitDate?: string | null; delistedBeforeF?: boolean; publicFloat?: number | null;
}

const arg = (k: string, d?: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const engine = await import(pathToFileURL(resolve(arg('engine', 'lib/scoring.ts')!)).href);
const { computeAnalysis, peerRow } = engine;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nn = (v: unknown) => (isNum(v) ? v : undefined);

function toQS(s: Snap) {
  const L = s.rows[s.rows.length - 1] ?? ({} as Row);
  const ni = nn(L.netIncomeCommonStockholders) ?? nn(L.netIncome);
  const rev = nn(L.totalRevenue);
  const eq = nn(L.commonStockEquity) ?? nn(L.stockholdersEquity);
  const debt = nn(L.totalDebt);
  const cash = nn(L.cashCashEquivalentsAndShortTermInvestments) ?? nn(L.cashAndCashEquivalents);
  const ebitda = nn(L.EBITDA);
  const mc = nn(s.marketCap);
  const ca = nn(L.currentAssets), cl = nn(L.currentLiabilities);
  // Taux de distribution façon Yahoo : dividendes / bénéfice ; 0 si pertes ou aucun dividende.
  const ttmPaid = isNum(s.ttmDividendAdj) && s.ttmDividendAdj > 0 && isNum(s.sharesOutstanding)
    ? s.ttmDividendAdj * (s.splitFactorAfter ?? 1) * s.sharesOutstanding : 0;
  const paid = isNum(L.dividendsPaid) ? Math.abs(L.dividendsPaid) : ttmPaid;
  const payout = ni !== undefined ? (ni > 0 ? paid / ni : 0) : undefined;
  const ev = mc !== undefined ? mc + (debt ?? 0) - (cash ?? 0) : undefined;
  return {
    price: { quoteType: 'EQUITY', currency: 'USD', regularMarketPrice: nn(s.price), marketCap: mc, longName: s.name, exchangeName: '' },
    summaryDetail: {
      dividendYield: s.price === null ? undefined : (s.dividendYield ?? 0), trailingAnnualDividendYield: s.price === null ? undefined : (s.dividendYield ?? 0),
      payoutRatio: payout, trailingPE: mc !== undefined && ni !== undefined && ni > 0 ? mc / ni : undefined,
    },
    financialData: {
      financialCurrency: 'USD', currentPrice: nn(s.price), totalDebt: debt, totalCash: cash, ebitda, totalRevenue: rev,
      currentRatio: ca !== undefined && cl ? ca / cl : undefined,
      profitMargins: ni !== undefined && rev ? ni / rev : undefined,
      returnOnEquity: ni !== undefined && eq && eq > 0 ? ni / eq : undefined,
      debtToEquity: eq && eq > 0 ? ((debt ?? 0) / eq) * 100 : undefined,
    },
    defaultKeyStatistics: {
      sharesOutstanding: nn(s.sharesOutstanding),
      enterpriseToEbitda: ev !== undefined && ebitda && ebitda > 0 ? ev / ebitda : undefined,
      priceToBook: mc !== undefined && eq && eq > 0 ? mc / eq : undefined,
    },
    assetProfile: { sector: s.sector, industry: s.industry, country: s.country },
  };
}

const snaps: Snap[] = [];
for await (const line of createInterface({ input: createReadStream(arg('in')!) })) if (line.trim()) snaps.push(JSON.parse(line));

const byDate = new Map<string, Snap[]>();
for (const s of snaps) { if (!byDate.has(s.asOf)) byDate.set(s.asOf, []); byDate.get(s.asOf)!.push(s); }

const out: string[] = [];
for (const [asOf, list] of byDate) {
  const listed = list.filter(s => !s.gone && isNum(s.marketCap) && s.marketCap > 0);
  const qs = new Map(listed.map(s => [s.cik, toQS(s)]));
  const pick = (self: Snap, cands: Snap[]) => {
    const lm = Math.log10(Math.max(self.marketCap ?? 1, 1));
    return cands
      .filter(c => c.cik !== self.cik && c.name !== self.name)
      .map(c => ({ c, d: Math.abs(Math.log10(c.marketCap as number) - lm) }))
      .sort((a, b) => a.d - b.d)
      .filter((v, i, arr) => arr.findIndex(w => w.c.name === v.c.name) === i)
      .slice(0, 6).map(v => v.c);
  };
  const byInd = new Map<string, Snap[]>(), bySec = new Map<string, Snap[]>();
  for (const s of listed) {
    if (s.industry) { if (!byInd.has(s.industry)) byInd.set(s.industry, []); byInd.get(s.industry)!.push(s); }
    if (!bySec.has(s.sector)) bySec.set(s.sector, []); bySec.get(s.sector)!.push(s);
  }
  for (const s of list) {
    const q = s.gone ? toQS(s) : qs.get(s.cik) ?? toQS(s);
    let peers: unknown[] | null = [], peerSource = '';
    if (!s.gone && isNum(s.marketCap)) {
      let chosen = s.industry ? pick(s, byInd.get(s.industry) ?? []) : [];
      peerSource = `même industrie (${s.industry})`;
      if (chosen.length < 3) { chosen = pick(s, bySec.get(s.sector) ?? []); peerSource = `même secteur (${s.sector})`; }
      peers = chosen.map(c => peerRow(c.symbol, qs.get(c.cik)));
    }
    let a;
    try {
      a = computeAnalysis({
        symbol: s.symbol ?? `CIK${s.cik}`, q, rows: s.rows, dividends: s.dividends, firstTradeDate: null,
        riskFreePct: s.riskFreePct, conv: 1, peers, peerSource, asOf: new Date(asOf + 'T12:00:00Z'),
      });
    } catch (e) { console.error('échec', s.symbol, s.cik, (e as Error).message); continue; }
    const crit: Record<string, number | null> = {}, cat: Record<string, number | null> = {};
    const critW: Record<string, number> = {}, catW: Record<string, number> = {}, critCat: Record<string, string> = {};
    for (const c of a.categories) { cat[c.id] = c.score; catW[c.id] = c.weight; for (const k of c.criteria) { crit[k.id] = k.score; critW[k.id] = k.weight; critCat[k.id] = c.id; } }
    out.push(JSON.stringify({
      cik: s.cik, symbol: s.symbol, asOf, gone: !!s.gone, relinked: !!s.relinked, name: s.name, sector: s.sector, industry: s.industry,
      marketCap: s.marketCap, isFinancial: a.isFinancial, score: a.score, verdictLevel: a.verdictLevel, verdict: a.verdict,
      redFlags: a.redFlags, nPeers: (peers ?? []).length, categories: cat, criteria: crit, weights: { categories: catW, criteria: critW, criterionCategory: critCat },
      exit: s.exit ?? null, exitDate: s.exitDate ?? null, delistedBeforeF: !!s.delistedBeforeF, publicFloat: s.publicFloat ?? null,
      bs: { ta: nn(s.rows.at(-1)?.totalAssets) ?? null, rev: nn(s.rows.at(-1)?.totalRevenue) ?? null },
      metrics: { pe: a.peers[0]?.pe ?? null, pb: a.peers[0]?.pb ?? null, evEbitda: a.peers[0]?.evEbitda ?? null, dy: a.peers[0]?.dy ?? null,
        roe: a.peers[0]?.roe ?? null, netMargin: a.peers[0]?.netMargin ?? null, de: a.peers[0]?.de ?? null, mos: a.graham.marginOfSafety,
        divYears: a.dividends.consecutiveYears },
    }));
  }
}
writeFileSync(arg('out')!, out.join('\n') + '\n');
console.error(`${out.length} analyses écrites dans ${arg('out')}`);
