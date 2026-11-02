import { NextResponse } from 'next/server';
import { analyze } from '@/lib/analysis';
import { cached } from '@/lib/yahoo';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  if (!/^[A-Z0-9.\-^=]{1,20}$/.test(sym)) return NextResponse.json({ error: 'Symbole invalide' }, { status: 400 });
  try {
    const data = await cached(`an:${sym}`, 3 * 3600_000, () => analyze(sym));
    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=86400' } });
  } catch (e) {
    const msg = (e as Error).message || 'Erreur';
    const notFound = /not found|No fundamentals|Quote not found/i.test(msg);
    return NextResponse.json({ error: notFound ? 'Action introuvable ou données indisponibles.' : msg }, { status: notFound ? 404 : 502 });
  }
}
