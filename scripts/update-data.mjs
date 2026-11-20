// Fetches news (Google News RSS), indicators (World Bank) and public holidays (Nager.Date)
// and writes static JSON into /data. No API keys, no dependencies (Node 18+).
import fs from 'node:fs/promises';
import { fetchMarkets } from './markets.mjs';

const OUT = new URL('../data/', import.meta.url);
const geo = JSON.parse(await fs.readFile(new URL('countries.geo.json', OUT), 'utf8'));
const ISOS = [...new Set(geo.features.map((f) => f.properties.iso).filter(Boolean))];
const NAMES = Object.fromEntries(geo.features.filter((f) => f.properties.iso).map((f) => [f.properties.iso, f.properties.name]));

// Countries with a Google News edition. Others still get indicators + holidays.
const NEWS_CC = 'AE AR AT AU BE BG BR CA CH CL CN CO CU CZ DE EG ES FR GB GR HK HU ID IE IL IN IT JP KE KR LB LT LV MA MX MY NG NL NO NZ PE PH PK PL PT RO RS RU SA SE SG SI SK TH TR TW TZ UA UG US VE VN ZA ZW'
  .split(' ').filter((c) => ISOS.includes(c));
const CATS = { top: '', business: 'BUSINESS', technology: 'TECHNOLOGY', science: 'SCIENCE', sports: 'SPORTS' };
const PER_CAT = 7;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'worldwire-bot/1.0 (+github)' }, signal: AbortSignal.timeout(20000) });
      if (r.ok) return r;
      if (r.status === 429) await sleep(3000 * (i + 1));
    } catch { /* retry */ }
    await sleep(600 * (i + 1));
  }
  return null;
}
async function pool(items, n, fn) {
  const q = [...items]; const run = async () => { while (q.length) await fn(q.shift()); };
  await Promise.all(Array.from({ length: n }, run));
}

/* ---- news ---- */
const decode = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : ''; };
export function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    let title = tag(it, 'title'); const source = tag(it, 'source');
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const d = new Date(tag(it, 'pubDate'));
    return { title, source, url: tag(it, 'link'), date: isNaN(d) ? null : d.toISOString() };
  }).filter((n) => n.title && n.url).slice(0, PER_CAT);
}
async function fetchNews(cc) {
  const out = {};
  for (const [k, topic] of Object.entries(CATS)) {
    const base = topic ? `https://news.google.com/rss/headlines/section/topic/${topic}` : 'https://news.google.com/rss';
    const r = await get(`${base}?hl=en&gl=${cc}&ceid=${cc}:en`);
    if (r) out[k] = parseRss(await r.text());
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
    const j = await r.json();
    for (const row of j[1] || []) {
      const iso = row.country?.id;
      if (row.value == null || !ISOS.includes(iso)) continue;
      (res[iso] ??= {})[k] = { v: row.value, y: row.date };
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

/* ---- main ---- */
async function main() {
  const t0 = Date.now();
  await fs.mkdir(new URL('countries/', OUT), { recursive: true });
  const [ind, markets] = await Promise.all([fetchIndicators(), fetchMarkets()]);
  const mk = markets.indices.length + markets.crypto.length + markets.fx.length + markets.commodities.length;
  if (mk) await fs.writeFile(new URL('markets.json', OUT), JSON.stringify(markets));
  console.log('market quotes:', mk);
  console.log('indicators for', Object.keys(ind).length, 'countries');

  const news = {}, hol = {};
  await pool(NEWS_CC, 6, async (cc) => { news[cc] = await fetchNews(cc); console.log('news', cc); });
  await pool(ISOS, 8, async (cc) => { hol[cc] = await fetchHolidays(cc); });

  const withData = [];
  for (const iso of ISOS) {
    const n = news[iso] || {};
    const hasNews = Object.values(n).some((a) => a.length);
    const doc = { iso, name: NAMES[iso], updated: new Date().toISOString(), news: hasNews ? n : {}, indicators: ind[iso] || {}, holidays: hol[iso] || [] };
    if (!hasNews && !Object.keys(doc.indicators).length && !doc.holidays.length) continue;
    await fs.writeFile(new URL(`countries/${iso}.json`, OUT), JSON.stringify(doc));
    withData.push(iso);
  }
  if (!withData.length) throw new Error('No data fetched — leaving previous data untouched.');
  await fs.writeFile(new URL('index.json', OUT), JSON.stringify({ updated: new Date().toISOString(), countries: withData }));
  console.log(`done: ${withData.length} countries in ${Math.round((Date.now() - t0) / 1000)}s`);
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
