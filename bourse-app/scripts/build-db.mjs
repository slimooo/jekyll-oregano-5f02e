// Construit data/stocks.json à partir du screener Yahoo Finance.
// Usage : node scripts/build-db.mjs
import fs from 'node:fs';
import { session, screen } from './yahoo-session.mjs';

const REGIONS = ['us','ca','fr','de','gb','nl','es','it','ch','se','dk','no','fi','be','at','ie','pt','pl','gr','lu','jp','hk','au','kr','tw','sg','il','br','mx','in','za','cn','nz'];
const SECTORS = ['Basic Materials','Communication Services','Consumer Cyclical','Consumer Defensive','Energy','Financial Services','Healthcare','Industrials','Real Estate','Technology','Utilities'];
// Seuil de capitalisation (devise locale) : on vise les titres réellement négociables chez un néo-courtier.
const MINCAP = { us: 150e6, ca: 200e6, jp: 30e9, hk: 2e9, kr: 500e9, tw: 10e9, in: 50e9, br: 1e9, mx: 5e9, za: 5e9, cn: 5e9, se: 2e9, dk: 2e9, no: 2e9, pl: 1e9 };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const s = await session();
const out = new Map();
for (const region of REGIONS) {
  const min = MINCAP[region] ?? 100e6;
  for (const sector of SECTORS) {
    let offset = 0, total = 1;
    while (offset < total && offset < 2500) {
      const q = { operator: 'AND', operands: [
        { operator: 'eq', operands: ['region', region] },
        { operator: 'eq', operands: ['sector', sector] },
        { operator: 'gt', operands: ['intradaymarketcap', min] },
      ]};
      let r;
      for (let a = 0; a < 4; a++) { try { r = await screen(s, q, offset, 250); break; } catch (e) { console.error('retry', region, sector, e.message); await sleep(3000 * (a + 1)); } }
      if (!r) break;
      total = r.total;
      for (const x of r.quotes) {
        if (!x.symbol || out.has(x.symbol)) continue;
        out.set(x.symbol, { s: x.symbol, n: x.longName || x.shortName || x.symbol, x: x.fullExchangeName || x.exchange, c: x.currency, sec: sector, r: region, mc: Math.round(x.marketCap || 0) });
      }
      offset += 250;
      await sleep(250);
    }
    process.stdout.write(`${region}/${sector}:${total} `);
  }
  console.log('\n', region, 'total', out.size);
}
const arr = [...out.values()].sort((a, b) => b.mc - a.mc);
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/stocks.json', JSON.stringify(arr));
console.log('écrit', arr.length);
