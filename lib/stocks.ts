import raw from '@/data/stocks.json';

export interface StockEntry { s: string; n: string; x: string; c: string; sec: string; r: string; mc: number }
export const STOCKS = raw as StockEntry[];
export const BY_SYMBOL = new Map(STOCKS.map(s => [s.s, s]));

export const REGION_LABEL: Record<string, string> = {
  us: 'États-Unis', ca: 'Canada', fr: 'France', de: 'Allemagne', gb: 'Royaume-Uni', nl: 'Pays-Bas', es: 'Espagne', it: 'Italie',
  ch: 'Suisse', se: 'Suède', dk: 'Danemark', no: 'Norvège', fi: 'Finlande', be: 'Belgique', at: 'Autriche', ie: 'Irlande',
  pt: 'Portugal', pl: 'Pologne', gr: 'Grèce', lu: 'Luxembourg', jp: 'Japon', hk: 'Hong Kong', au: 'Australie', kr: 'Corée du Sud',
  tw: 'Taïwan', sg: 'Singapour', il: 'Israël',
};
export const EUROPE = ['fr', 'de', 'gb', 'nl', 'es', 'it', 'ch', 'se', 'dk', 'no', 'fi', 'be', 'at', 'ie', 'pt', 'pl', 'gr', 'lu'];

export { SECTOR_FR } from './scoring';

export const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const NAMES = STOCKS.map(s => norm(s.n));

export function searchLocal(q: string, limit = 30): StockEntry[] {
  const nq = norm(q);
  if (!nq) return [];
  const uq = q.trim().toUpperCase();
  const scored: { e: StockEntry; sc: number }[] = [];
  const words = nq.split(' ');
  for (let i = 0; i < STOCKS.length; i++) {
    const e = STOCKS[i];
    const name = NAMES[i];
    const base = e.s.split('.')[0];
    let sc = 0;
    if (e.s === uq || base === uq) sc = 1000;
    else if (e.s.startsWith(uq)) sc = 500;
    else if (name.startsWith(nq)) sc = 400;
    else if (name.includes(' ' + nq) ) sc = 300;
    else if (words.every(w => name.includes(w))) sc = 200;
    if (!sc) continue;
    // bonus de taille : les grandes capitalisations remontent
    sc += Math.log10(Math.max(e.mc, 1)) * 5;
    scored.push({ e, sc });
  }
  scored.sort((a, b) => b.sc - a.sc);
  return scored.slice(0, limit).map(x => x.e);
}
