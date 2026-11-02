import YahooFinance from 'yahoo-finance2';

// Client unique, réutilisé entre les invocations d'une même instance serverless.
const g = globalThis as unknown as { __yf?: InstanceType<typeof YahooFinance> };
export const yf: InstanceType<typeof YahooFinance> =
  g.__yf ?? (g.__yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'], validation: { logErrors: false } }));

export async function retry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let err: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw err;
}

// ---- Screener Yahoo (requête POST avec crumb) : utilisé pour trouver les concurrents d'une même industrie
let screenerSession: { crumb: string; cookie: string; at: number } | null = null;

async function getScreenerSession() {
  if (screenerSession && Date.now() - screenerSession.at < 30 * 60_000) return screenerSession;
  await yf.quote('AAPL'); // initialise cookies + crumb dans la cookie jar
  const jar = (yf as unknown as { _opts: { cookieJar: { getCookieString(u: string): Promise<string> } } })._opts.cookieJar;
  const cookie = await jar.getCookieString('https://query1.finance.yahoo.com/v1/finance/screener');
  const crumb = (await (await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { cookie, 'user-agent': 'Mozilla/5.0' } })).text()).trim();
  if (!crumb || crumb.length > 20) throw new Error('crumb indisponible');
  screenerSession = { crumb, cookie, at: Date.now() };
  return screenerSession;
}

export interface ScreenerQuote { symbol: string; marketCap?: number }

export async function screenIndustry(industry: string, regions: string[]): Promise<ScreenerQuote[]> {
  const s = await getScreenerSession();
  const body = {
    size: 250, offset: 0, sortField: 'intradaymarketcap', sortType: 'DESC', quoteType: 'EQUITY', userId: '', userIdType: 'guid',
    query: { operator: 'AND', operands: [
      { operator: 'eq', operands: ['industry', industry] },
      { operator: 'or', operands: regions.map(r => ({ operator: 'eq', operands: ['region', r] })) },
    ] },
  };
  const res = await fetch(`https://query1.finance.yahoo.com/v1/finance/screener?crumb=${encodeURIComponent(s.crumb)}&lang=en-US&region=US&formatted=false`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: s.cookie, 'user-agent': 'Mozilla/5.0' }, body: JSON.stringify(body),
  });
  if (!res.ok) { screenerSession = null; throw new Error('screener ' + res.status); }
  const j = await res.json();
  return j?.finance?.result?.[0]?.quotes ?? [];
}

// ---- Cache mémoire simple (par instance)
const cache = new Map<string, { at: number; v: unknown }>();
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v as T;
  const v = await fn();
  cache.set(key, { at: Date.now(), v });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return v;
}
