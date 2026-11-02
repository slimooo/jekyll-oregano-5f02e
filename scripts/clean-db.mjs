// Nettoie data/stocks-raw.json -> data/stocks.json : supprime cotations secondaires et doublons,
// puis complète avec les grandes valeurs indicielles absentes du screener.
import fs from 'node:fs';
import YahooFinance from 'yahoo-finance2';

const raw = JSON.parse(fs.readFileSync('data/stocks-raw.json', 'utf8'));
const DROP_EX = /^(Frankfurt|Stuttgart|Munich|Berlin|Dusseldorf|Hamburg|Hanover|IOB|Cboe .*|Aquis.*|OTC.*|Other OTC|BSE|Tradegate|gettex|Vienna.*)$/i;
const DROP_REGION = new Set(['cn', 'in', 'br', 'mx', 'za', 'nz']);
const SECONDARY = new Set(['de', 'pl', 'us', 'il', 'sg']); // marchés qui listent beaucoup de valeurs étrangères
const norm = n => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(inc|corp|corporation|company|co|ltd|limited|plc|se|sa|ag|nv|ab|asa|as|oyj|spa|holdings?|group|the|class [a-c]|adr|aktiengesellschaft|kgaa|societe europeenne)\b/g, '')
  .replace(/[^a-z0-9]/g, '');

let kept = raw.filter(x => !DROP_EX.test(x.x) && !DROP_REGION.has(x.r) && x.c && !(x.r === 'gb' && /^0[A-Z0-9]{3}\.L$/.test(x.s)));
const primary = new Set(kept.filter(x => !SECONDARY.has(x.r)).map(x => norm(x.n)));
const inUS = new Set(kept.filter(x => x.r === 'us').map(x => norm(x.n)));
const inDE = new Set(kept.filter(x => x.r === 'de').map(x => norm(x.n)));
const usSyms = new Set(kept.filter(x => x.r === 'us').map(x => x.s));
const otherEU = new Set(kept.filter(x => !SECONDARY.has(x.r) && x.r !== 'ch').map(x => norm(x.n)));
const GERMAN = /\b(AG|KGaA|GmbH|Aktiengesellschaft|SE)\b/;
kept = kept.filter(x => {
  const k = norm(x.n);
  if (x.r === 'de') return !primary.has(k) && (GERMAN.test(x.n) || !inUS.has(k));
  if (x.r === 'pl') return !primary.has(k) && !inDE.has(k) && !inUS.has(k);
  if (x.r === 'il' || x.r === 'sg') return !inUS.has(k);
  if (x.r === 'ch') {
    const base = x.s.replace(/\.SW$/, '');
    if (usSyms.has(base) || otherEU.has(k)) return false; // valeurs étrangères cotées à Zurich
  }
  if (/-(SEK|EUR|USD|NOK|DKK|CHF|GBP)\./.test(x.s)) return false; // lignes en devise étrangère
  if (x.r !== 'us' && inUS.has(k) && /\b(Inc\.?|Corporation|Corp\.?|Company|Co\.)$/.test(x.n.trim())) return false; // copies de valeurs US
  return true;
});
const seen = new Set();
let out = [];
kept.sort((a, b) => b.mc - a.mc);
const shortest = new Map();
for (const x of kept) { const kk = norm(x.n) + '|' + x.r; if (!shortest.has(kk) || x.s.length < shortest.get(kk).s.length) shortest.set(kk, x); }
for (const x of kept) {
  const kk = norm(x.n) + '|' + x.r;
  const best = shortest.get(kk);
  if (x.r !== 'us' && best !== x && best.s.slice(0, 3) === x.s.slice(0, 3)) continue; // ligne secondaire (ex. NOVNEE.SW vs NOVN.SW)
  const key = norm(x.n) + '|' + x.r + '|' + (x.r === 'us' ? x.s : x.s.replace(/[-.].*$/, '').slice(0, 3));
  if (seen.has(key)) continue;
  seen.add(key); out.push(x);
}

// Grandes valeurs européennes parfois absentes du screener Yahoo
const SEED = `ADS.DE AIR.DE ALV.DE BAS.DE BAYN.DE BEI.DE BMW.DE BNR.DE CBK.DE CON.DE 1COV.DE DTG.DE DBK.DE DB1.DE DHL.DE DTE.DE EOAN.DE FRE.DE HNR1.DE HEI.DE HEN3.DE IFX.DE MBG.DE MRK.DE MTX.DE MUV2.DE PAH3.DE P911.DE QIA.DE RHM.DE RWE.DE SAP.DE SRT3.DE SIE.DE ENR.DE SHL.DE SY1.DE VOW3.DE VNA.DE ZAL.DE PUM.DE LHA.DE
AI.PA AIR.PA ALO.PA MT.AS CS.PA BNP.PA EN.PA CAP.PA CA.PA ACA.PA BN.PA DSY.PA EDEN.PA ENGI.PA EL.PA ERF.PA RMS.PA KER.PA OR.PA LR.PA MC.PA ML.PA ORA.PA RI.PA PUB.PA RNO.PA SAF.PA SGO.PA SAN.PA SU.PA GLE.PA STLAP.PA STMPA.PA TEP.PA HO.PA TTE.PA URW.PA VIE.PA DG.PA VIV.PA
ASML.AS ADYEN.AS AD.AS HEIA.AS INGA.AS PHIA.AS PRX.AS WKL.AS UNA.AS SHELL.AS
ITX.MC IBE.MC SAN.MC BBVA.MC TEF.MC REP.MC AENA.MC
ENEL.MI ENI.MI ISP.MI UCG.MI RACE.MI STLAM.MI G.MI
NESN.SW NOVN.SW ROG.SW UBSG.SW ZURN.SW ABBN.SW CFR.SW LONN.SW SIKA.SW GIVN.SW
NOVO-B.CO DSV.CO ABI.BR KBC.BR NOKIA.HE NDA-FI.HE ATCO-A.ST VOLV-B.ST INVE-B.ST ERIC-B.ST EQNR.OL DNB.OL
AZN.L SHEL.L HSBA.L ULVR.L BP.L GSK.L RIO.L DGE.L BATS.L REL.L LSEG.L BARC.L LLOY.L VOD.L RR.L NG.L`.split(/\s+/).filter(Boolean);
const have = new Set(out.map(x => x.s));
const missing = SEED.filter(s => !have.has(s));
if (missing.length) {
  const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  const sectorOf = new Map();
  for (const s of missing) {
    try {
      const q = await yf.quoteSummary(s, { modules: ['price', 'assetProfile'] });
      const p = q.price;
      out.push({ s, n: p.longName || p.shortName || s, x: p.exchangeName, c: p.currency, sec: q.assetProfile?.sector || '', r: s.split('.').pop().toLowerCase(), mc: Math.round(p.marketCap || 0) });
      sectorOf.set(s, 1);
    } catch (e) { console.error('seed KO', s, e.message); }
  }
  console.log('ajoutés', sectorOf.size, 'sur', missing.length, missing.join(' '));
}
const REG = { pa: 'fr', as: 'nl', mc: 'es', mi: 'it', sw: 'ch', co: 'dk', br: 'be', he: 'fi', st: 'se', ol: 'no', l: 'gb' };
out.forEach(x => { if (REG[x.r]) x.r = REG[x.r]; });
// Passe finale : cotations étrangères à Londres / Varsovie
const byName = new Map();
out.forEach(x => { const k = norm(x.n); if (!byName.has(k)) byName.set(k, new Set()); byName.get(k).add(x.r); });
out = out.filter(x => {
  const regs = byName.get(norm(x.n));
  if (x.r === 'ch') return [...regs].every(r => r === 'ch' || r === 'us');
  if (x.r === 'pl') return [...regs].every(r => r === 'pl' || r === 'us');
  if (x.r === 'gb') return /^GB/i.test(x.c) || (regs.size === 1 && out.filter(y => norm(y.n) === norm(x.n)).length === 1);
  return true;
});
out.sort((a, b) => b.mc - a.mc);
fs.writeFileSync('data/stocks.json', JSON.stringify(out));
const c = {}; out.forEach(x => c[x.r] = (c[x.r] || 0) + 1);
console.log(out.length, JSON.stringify(c));
