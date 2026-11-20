// Fetches news (Google News search + BBC + Guardian + Al Jazeera + DW), indicators (World Bank), holidays (Nager.Date)
// and markets, then writes static JSON into /data. No API keys, no dependencies (Node 18+).
import fs from 'node:fs/promises';
import { fetchMarkets } from './markets.mjs';
import { get, parseRss, fetchGlobalFeeds, indexByCountry, fetchGuardianCountry, mergeBalanced, loadAliases, OUTLETS,
  fetchGoodFeeds, fetchGoogleGood, fetchGoogleSearch, queryName, isPositive, buildBriefing } from './sources.mjs';

const OUT = new URL('../data/', import.meta.url);
const geo = JSON.parse(await fs.readFile(new URL('countries.geo.json', OUT), 'utf8'));
const ISOS = [...new Set(geo.features.map((f) => f.properties.iso).filter(Boolean))];
const NAMES = Object.fromEntries(geo.features.filter((f) => f.properties.iso).map((f) => [f.properties.iso, f.properties.name]));

const CATS = ['top', 'business', 'technology', 'science', 'sports'];
const PER_CAT = 12;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pool(items, n, fn) { const q = [...items]; await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); })); }

/* ---- World Bank ---- */
const IND = { gdp: 'NY.GDP.MKTP.CD', pop: 'SP.POP.TOTL', gdppc: 'NY.GDP.PCAP.CD', growth: 'NY.GDP.MKTP.KD.ZG', inflation: 'FP.CPI.TOTL.ZG', unemployment: 'SL.UEM.TOTL.ZS' };
async function fetchIndicators() {
  const res = {};
  for (const [k, code] of Object.entries(IND)) {
    const r = await get(`https://api.worldbank.org/v2/country/all/indicator/${code}?format=json&mrnev=1&per_page=400`);
    if (!r) continue;
    for (const row of (await r.json())[1] || []) {
      const iso = row.country?.id;
      if (row.value != null && ISOS.includes(iso)) (res[iso] ??= {})[k] = { v: row.value, y: row.date };
    }
  }
  return res;
}

/* ---- holidays ---- */
async function fetchHolidays(cc) {
  const r = await get(`https://date.nager.at/api/v3/NextPublicHolidays/${cc}`, 2);
  if (!r) return [];
  try { return (await r.json()).slice(0, 8).map((h) => ({ date: h.date, name: h.name || h.localName })); } catch { return []; }
}

async function main() {
  const t0 = Date.now();
  await fs.mkdir(new URL('countries/', OUT), { recursive: true });
  const aliases = await loadAliases(OUT);

  const [ind, markets, globalItems, goodItems] = await Promise.all([fetchIndicators(), fetchMarkets(), fetchGlobalFeeds(), fetchGoodFeeds()]);
  const mk = markets.indices.length + markets.crypto.length + markets.fx.length + markets.commodities.length;
  if (mk) await fs.writeFile(new URL('markets.json', OUT), JSON.stringify(markets));
  const byIso = indexByCountry(globalItems, aliases, true), goodByIso = indexByCountry(goodItems, aliases);
  const goodGlobal = mergeBalanced(goodItems, 24, true);
  await fs.writeFile(new URL('good.json', OUT), JSON.stringify({ updated: new Date().toISOString(), items: goodGlobal.map((g) => ({ ...g, iso: Object.keys(goodByIso).find((k) => goodByIso[k].some((x) => x.url === g.url)) || null })) }));
  console.log('indicators:', Object.keys(ind).length, '| market quotes:', mk, '| global feed items:', globalItems.length, '| countries matched:', Object.keys(byIso).length);

  const google = {}, guardian = {}, hol = {}, gGood = {};
  await pool(ISOS, 5, async (cc) => { google[cc] = await fetchGoogleSearch(queryName(aliases[cc])); });
  await pool(ISOS, 8, async (cc) => { guardian[cc] = await fetchGuardianCountry(cc, NAMES[cc]); hol[cc] = await fetchHolidays(cc); gGood[cc] = await fetchGoogleGood(cc, queryName(aliases[cc])); });

  const withData = [];
  for (const iso of ISOS) {
    const news = {}, ed = google[iso] || {};
    for (const cat of CATS) {
      const pool_ = [...(ed[cat] || []), ...(byIso[iso] || []).filter((i) => i.cat === cat), ...(cat === 'top' ? guardian[iso] || [] : [])];
      const merged = mergeBalanced(pool_, PER_CAT);
      if (merged.length) news[cat] = merged;
    }
    const raw = [...Object.values(ed).flat(), ...(byIso[iso] || []), ...(guardian[iso] || [])];
    const briefing = buildBriefing(raw, 5);
    const good = mergeBalanced([...(gGood[iso] || []), ...(goodByIso[iso] || []), ...raw.filter(isPositive)], 12, true);
    const doc = { iso, name: NAMES[iso], updated: new Date().toISOString(), briefing, good, news, indicators: ind[iso] || {}, holidays: hol[iso] || [] };
    if (!Object.keys(news).length && !Object.keys(doc.indicators).length && !doc.holidays.length) continue;
    await fs.writeFile(new URL(`countries/${iso}.json`, OUT), JSON.stringify(doc));
    withData.push(iso);
  }
  if (!withData.length) throw new Error('No data fetched — leaving previous data untouched.');
  await fs.writeFile(new URL('index.json', OUT), JSON.stringify({ updated: new Date().toISOString(), countries: withData, outlets: OUTLETS }));
  console.log(`done: ${withData.length} countries in ${Math.round((Date.now() - t0) / 1000)}s`);
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
