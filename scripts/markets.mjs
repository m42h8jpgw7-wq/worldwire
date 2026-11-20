// Market snapshot: indices/FX/commodities (Stooq daily CSV), crypto (CoinGecko), sentiment (alternative.me).
// Every source is optional: failures are skipped, never fatal.
const UA = { 'user-agent': 'worldwire-bot/1.0 (+github)' };
const get = async (url) => { try { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) }); return r.ok ? r : null; } catch { return null; } };

const INDICES = [
  ['^spx', 'S&P 500', 'US'], ['^ndq', 'Nasdaq 100', 'US'], ['^dji', 'Dow Jones', 'US'], ['^dax', 'DAX', 'DE'], ['^ukx', 'FTSE 100', 'GB'],
  ['^cac', 'CAC 40', 'FR'], ['^nkx', 'Nikkei 225', 'JP'], ['^hsi', 'Hang Seng', 'HK'], ['^shc', 'Shanghai Comp.', 'CN'], ['^kospi', 'KOSPI', 'KR'],
  ['^snx', 'BSE Sensex', 'IN'], ['^smi', 'SMI', 'CH'], ['^aex', 'AEX', 'NL'], ['^ibex', 'IBEX 35', 'ES'], ['^mib', 'FTSE MIB', 'IT'],
  ['^bvp', 'Bovespa', 'BR'], ['^tsx', 'S&P/TSX', 'CA'], ['^aor', 'All Ordinaries', 'AU'],
];
const COMMODITIES = [['xauusd', 'Gold', 'USD/oz'], ['xagusd', 'Silver', 'USD/oz'], ['cl.f', 'WTI Crude', 'USD/bbl']];
const FX = [['eurusd', 'EUR/USD'], ['usdjpy', 'USD/JPY'], ['gbpusd', 'GBP/USD'], ['usdchf', 'USD/CHF'], ['usdcny', 'USD/CNY']];

async function stooq(sym) {
  const r = await get(`https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`);
  if (!r) return null;
  const rows = (await r.text()).trim().split('\n').slice(1).map((l) => l.split(','));
  if (rows.length < 2) return null;
  const [a, b] = rows.slice(-2); const last = parseFloat(b[4]), prev = parseFloat(a[4]);
  if (!isFinite(last) || !isFinite(prev) || !prev) return null;
  return { price: last, chg: ((last - prev) / prev) * 100, date: b[0] };
}

export async function fetchMarkets() {
  const out = { updated: new Date().toISOString(), indices: [], commodities: [], fx: [], crypto: [], fng: null };
  const jobs = [];
  for (const [sym, name, country] of INDICES) jobs.push(stooq(sym).then((q) => q && out.indices.push({ name, country, ...q })));
  for (const [sym, name, unit] of COMMODITIES) jobs.push(stooq(sym).then((q) => q && out.commodities.push({ name, unit, ...q })));
  for (const [sym, name] of FX) jobs.push(stooq(sym).then((q) => q && out.fx.push({ name, ...q })));
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
