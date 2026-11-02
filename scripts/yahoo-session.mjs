import YahooFinance from 'yahoo-finance2';
export async function session(){
  const yf = new YahooFinance({suppressNotices:['yahooSurvey']});
  await yf.quote('AAPL');
  const url='https://query1.finance.yahoo.com/v1/finance/screener';
  const cookie = await yf._opts.cookieJar.getCookieString(url);
  const crumb = (await (await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb',{headers:{cookie,'user-agent':'Mozilla/5.0'}})).text()).trim();
  return {yf, crumb, cookie};
}
export async function screen(s, query, offset=0, size=250){
  const r = await fetch(`https://query1.finance.yahoo.com/v1/finance/screener?crumb=${encodeURIComponent(s.crumb)}&lang=en-US&region=US&formatted=false`,{method:'POST',headers:{'content-type':'application/json',cookie:s.cookie,'user-agent':'Mozilla/5.0'},body:JSON.stringify({size,offset,sortField:'intradaymarketcap',sortType:'DESC',quoteType:'EQUITY',query,userId:'',userIdType:'guid'})});
  const t = await r.text();
  try { return JSON.parse(t).finance.result[0]; } catch { throw new Error(r.status+' '+t.slice(0,200)); }
}
