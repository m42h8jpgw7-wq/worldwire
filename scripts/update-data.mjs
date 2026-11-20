// Fetches news (Google News + BBC + Guardian + Al Jazeera + DW), indicators (World Bank), holidays (Nager.Date)
// and markets, then writes static JSON into /data. No API keys, no dependencies (Node 18+).
import fs from 'node:fs/promises';
import { fetchMarkets } from './markets.mjs';
import { get, parseRss, fetchGlobalFeeds, indexByCountry, fetchGuardianCountry, mergeBalanced, loadAliases, OUTLETS,
  fetchGoodFeeds, fetchGoogleGood, fetchGoogleGeo, buildMentions, queryName, isPositive, buildBriefing } from './sources.mjs';

const OUT = new URL('../data/', import.meta.url);
const geo = JSON.parse(await fs.readFile(new URL('countries.geo.json', OUT), 'utf8'));
const ISOS = [...new Set(geo.features.map((f) => f.properties.iso).filter(Boolean))];
const NAMES = Object.fromEntries(geo.features.filter((f) => f.properties.iso).map((f) => [f.properties.iso, f.properties.name]));

// Countries with a Google News edition (local-media layer). Every country also gets BBC/Guardian/Al Jazeera/DW matches.
const NEWS_CC = 'AE AR AT AU BE BG BR CA CH CL CN CO CU CZ DE EG ES FR GB GR HK HU ID IE IL IN IT JP KE KR LB LT LV MA MX MY NG NL NO NZ PE PH PK PL PT RO RS RU SA SE SG SI SK TH TR TW TZ UA UG US VE VN ZA ZW'
  .split(' ').filter((c) => ISOS.includes(c));
const CATS = { top: '', business: 'BUSINESS', technology: 'TECHNOLOGY', science: 'SCIENCE', sports: 'SPORTS' };
const PER_GOOGLE = 8, PER_CAT = 12;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pool(items, n, fn) { const q = [...items]; await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); })); }

/* ---- Google News (local editions) ---- */
async function fetchGoogle(cc) {
  const out = {};
  for (const [k, topic] of Object.entries(CATS)) {
    const base = topic ? `https://news.google.com/rss/headlines/section/topic/${topic}` : 'https://news.google.com/rss';
    const r = await get(`${base}?hl=en&gl=${cc}&ceid=${cc}:en`);
    out[k] = r ? parseRss(await r.text(), PER_GOOGLE).map((n) => ({ ...n, src: 'google', cat: k })) : [];
    await sleep(150);
  }
  return out;
}

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
  const byIso = indexByCountry(globalItems, aliases), goodByIso = indexByCountry(goodItems, aliases);
  const goodGlobal = mergeBalanced(goodItems, 24, true);
  await fs.writeFile(new URL('good.json', OUT), JSON.stringify({ updated: new Date().toISOString(), items: goodGlobal.map((g) => ({ ...g, iso: Object.keys(goodByIso).find((k) => goodByIso[k].some((x) => x.url === g.url)) || null })) }));
  console.log('indicators:', Object.keys(ind).length, '| market quotes:', mk, '| global feed items:', globalItems.length, '| countries matched:', Object.keys(byIso).length);

  const google = {}, guardian = {}, hol = {}, gGood = {}, gGeo = {};
  const mentions = buildMentions(aliases);
  await pool(NEWS_CC, 6, async (cc) => { google[cc] = await fetchGoogle(cc); });
  await pool(ISOS, 8, async (cc) => { guardian[cc] = await fetchGuardianCountry(cc, NAMES[cc]); hol[cc] = await fetchHolidays(cc); const place = queryName(aliases[cc]); gGood[cc] = await fetchGoogleGood(cc, place); gGeo[cc] = await fetchGoogleGeo(place); });

  const withData = [];
  for (const iso of ISOS) {
    const news = {}, ed = google[iso] || {}, geoTop = gGeo[iso] || [];
    const topPool = geoTop.length >= 4 ? geoTop : [...geoTop, ...(ed.top || [])]; // geo feed = stories about the country; edition feed only as fallback
    for (const cat of Object.keys(CATS)) {
      const pool_ = [...(cat === 'top' ? topPool : ed[cat] || []), ...(byIso[iso] || []).filter((i) => i.cat === cat), ...(cat === 'top' ? guardian[iso] || [] : [])];
      const merged = mergeBalanced(pool_, PER_CAT);
      if (merged.length) news[cat] = merged;
    }
    const local = Object.entries(ed).filter(([k]) => k !== 'top').flatMap(([, v]) => v).filter((it) => mentions(iso, it));
    const raw = [...topPool, ...local, ...(byIso[iso] || []), ...(guardian[iso] || [])];
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
