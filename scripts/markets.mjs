// Market snapshot: indices/FX/commodities (Yahoo Finance chart API, Stooq as fallback), crypto (CoinGecko), sentiment (alternative.me).
// Every source is optional: failures are skipped, never fatal.
const UA = { 'user-agent': 'worldwire-bot/1.0 (+github)' };
const get = async (url) => { try { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) }); return r.ok ? r : null; } catch { return null; } };

// [stooq symbol, name, country, yahoo symbol]
const INDICES = [
  ['^spx', 'S&P 500', 'US', '^GSPC'], ['^ndq', 'Nasdaq 100', 'US', '^NDX'], ['^dji', 'Dow Jones', 'US', '^DJI'], ['^dax', 'DAX', 'DE', '^GDAXI'], ['^ukx', 'FTSE 100', 'GB', '^FTSE'],
  ['^cac', 'CAC 40', 'FR', '^FCHI'], ['^nkx', 'Nikkei 225', 'JP', '^N225'], ['^hsi', 'Hang Seng', 'HK', '^HSI'], ['^shc', 'Shanghai Comp.', 'CN', '000001.SS'], ['^kospi', 'KOSPI', 'KR', '^KS11'],
  ['^snx', 'BSE Sensex', 'IN', '^BSESN'], ['^smi', 'SMI', 'CH', '^SSMI'], ['^aex', 'AEX', 'NL', '^AEX'], ['^ibex', 'IBEX 35', 'ES', '^IBEX'], ['^mib', 'FTSE MIB', 'IT', 'FTSEMIB.MI'],
  ['^bvp', 'Bovespa', 'BR', '^BVSP'], ['^tsx', 'S&P/TSX', 'CA', '^GSPTSE'], ['^aor', 'ASX 200', 'AU', '^AXJO'],
];
const COMMODITIES = [['xauusd', 'Gold', 'USD/oz', 'GC=F'], ['xagusd', 'Silver', 'USD/oz', 'SI=F'], ['cl.f', 'WTI Crude', 'USD/bbl', 'CL=F']];
const FX = [['eurusd', 'EUR/USD', 'EURUSD=X'], ['usdjpy', 'USD/JPY', 'JPY=X'], ['gbpusd', 'GBP/USD', 'GBPUSD=X'], ['usdchf', 'USD/CHF', 'CHF=X'], ['usdcny', 'USD/CNY', 'CNY=X']];

async function stooq(sym) {
  const r = await get(`https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`);
  if (!r) return null;
  const rows = (await r.text()).trim().split('\n').slice(1).map((l) => l.split(','));
  if (rows.length < 2) return null;
  const [a, b] = rows.slice(-2); const last = parseFloat(b[4]), prev = parseFloat(a[4]);
  if (!isFinite(last) || !isFinite(prev) || !prev) return null;
  return { price: last, chg: ((last - prev) / prev) * 100, date: b[0] };
}

async function yahoo(sym) {
  const r = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`);
  if (!r) return null;
  try {
    const res = (await r.json()).chart?.result?.[0];
    const ts = res.timestamp, cl = res.indicators.quote[0].close;
    const pts = ts.map((t, i) => [t, cl[i]]).filter(([, c]) => c != null);
    if (pts.length < 2) return null;
    const [a, b] = pts.slice(-2);
    return { price: b[1], chg: ((b[1] - a[1]) / a[1]) * 100, date: new Date(b[0] * 1000).toISOString().slice(0, 10) };
  } catch { return null; }
}
const quote = async (stooqSym, yahooSym) => (await yahoo(yahooSym)) || (await stooq(stooqSym));

export async function fetchMarkets() {
  const out = { updated: new Date().toISOString(), indices: [], commodities: [], fx: [], crypto: [], fng: null };
  const jobs = [];
  for (const [sym, name, country, y] of INDICES) jobs.push(quote(sym, y).then((q) => q && out.indices.push({ name, country, ...q })));
  for (const [sym, name, unit, y] of COMMODITIES) jobs.push(quote(sym, y).then((q) => q && out.commodities.push({ name, unit, ...q })));
  for (const [sym, name, y] of FX) jobs.push(quote(sym, y).then((q) => q && out.fx.push({ name, ...q })));
  jobs.push((async () => {
    const r = await get('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&price_change_percentage=24h');
    if (!r) return;
    out.crypto = (await r.json()).map((c) => ({ id: c.id, symbol: c.symbol.toUpperCase(), name: c.name, price: c.current_price, chg: c.price_change_percentage_24h, mcap: c.market_cap }));
  })());
  jobs.push((async () => {
    const r = await get('https://api.alternative.me/fng/?limit=1');
    if (!r) return; const d = (await r.json()).data?.[0];
    if (d) out.fng = { value: +d.value, label: d.value_classification };
  })());
  await Promise.all(jobs.map((p) => p.catch(() => null)));
  const order = (list, names) => list.sort((x, y) => names.indexOf(x.name) - names.indexOf(y.name));
  order(out.indices, INDICES.map((i) => i[1])); order(out.commodities, COMMODITIES.map((i) => i[1])); order(out.fx, FX.map((i) => i[1]));
  return out;
}
