import { NextResponse } from 'next/server';
import { searchLocal, BY_SYMBOL, REGION_LABEL, SECTOR_FR, norm } from '@/lib/stocks';
import { yf } from '@/lib/yahoo';

export const runtime = 'nodejs';

export interface SearchHit { s: string; n: string; x: string; sec: string; region: string; mc: number; inDb: boolean }

// Places secondaires allemandes/autrichiennes : doublons des cotations principales
const SECONDARY = /\.(F|DU|BE|MU|SG|HM|HA|VI|IL|XC|XD)$/;
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 60);
  if (q.length < 1) return NextResponse.json({ hits: [] });
  const local = ISIN.test(q.toUpperCase()) ? [] : searchLocal(q, 30);
  const hits: SearchHit[] = local.map(e => ({ s: e.s, n: e.n, x: e.x, sec: SECTOR_FR[e.sec] ?? e.sec, region: REGION_LABEL[e.r] ?? e.r, mc: e.mc, inDb: true }));
  // Complément en ligne (ISIN, petites valeurs absentes de la base)
  if (hits.length < 8 && q.length >= 2) {
    try {
      const r = await yf.search(q, { quotesCount: 12, newsCount: 0 });
      for (const it of r.quotes as Array<Record<string, unknown>>) {
        if (it.quoteType !== 'EQUITY' || typeof it.symbol !== 'string' || hits.some(h => h.s === it.symbol)) continue;
        const e = BY_SYMBOL.get(it.symbol);
        const nm = norm(String(it.longname || it.shortname || ''));
        if (!e && (SECONDARY.test(it.symbol) && (hits.length > 0 || nm === '')) ) continue;
        if (!e && hits.some(h => norm(h.n) === nm)) continue;
        hits.push({ s: it.symbol, n: String(it.longname || it.shortname || it.symbol), x: String(it.exchDisp || it.exchange || ''),
          sec: e ? SECTOR_FR[e.sec] ?? e.sec : String(it.sectorDisp || ''), region: e ? REGION_LABEL[e.r] ?? e.r : '', mc: e?.mc ?? 0, inDb: !!e });
      }
    } catch { /* recherche locale uniquement */ }
  }
  return NextResponse.json({ hits }, { headers: { 'Cache-Control': 'public, s-maxage=3600' } });
}
