// Multi-outlet news: Google News (local editions), BBC, The Guardian, Al Jazeera, DW.
// Global feeds are matched to countries via data/aliases.json; Guardian also has per-country feeds.
import fs from 'node:fs/promises';

export const OUTLETS = { google: 'Google News', bbc: 'BBC', guardian: 'The Guardian', aljazeera: 'Al Jazeera', dw: 'DW', gnn: 'Good News Network', positive: 'Positive News', optimist: 'Optimist Daily', rtbc: 'Reasons to be Cheerful' };
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; worldwire-bot/1.0; +https://github.com)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
      if (r.ok) return r;
      if (r.status === 404) return null;
      if (r.status === 429) await sleep(3000 * (i + 1));
    } catch { /* retry */ }
    await sleep(600 * (i + 1));
  }
  return null;
}

/* ---------- RSS / RDF parsing ---------- */
const decode = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : ''; };
const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

export function parseRss(xml, limit = 50) {
  return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)].map(([it]) => {
    let title = tag(it, 'title'); const source = tag(it, 'source');
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const d = new Date(tag(it, 'pubDate') || tag(it, 'dc:date'));
    return { title: strip(title), source, url: tag(it, 'link'), date: isNaN(d) ? null : d.toISOString(), text: strip(tag(it, 'description')).slice(0, 400) };
  }).filter((n) => n.title && /^https?:\/\//.test(n.url)).slice(0, limit);
}

/* ---------- global feeds (fetched once) ---------- */
const BBC = 'https://feeds.bbci.co.uk/news';
const FEEDS = [
  ['bbc', 'top', `${BBC}/world/rss.xml`], ['bbc', 'top', `${BBC}/world/africa/rss.xml`], ['bbc', 'top', `${BBC}/world/asia/rss.xml`], ['bbc', 'top', `${BBC}/world/europe/rss.xml`],
  ['bbc', 'top', `${BBC}/world/latin_america/rss.xml`], ['bbc', 'top', `${BBC}/world/middle_east/rss.xml`], ['bbc', 'top', `${BBC}/world/us_and_canada/rss.xml`],
  ['bbc', 'business', `${BBC}/business/rss.xml`], ['bbc', 'technology', `${BBC}/technology/rss.xml`], ['bbc', 'science', `${BBC}/science_and_environment/rss.xml`], ['bbc', 'sports', 'https://feeds.bbci.co.uk/sport/rss.xml'],
  ['guardian', 'top', 'https://www.theguardian.com/world/rss'], ['guardian', 'business', 'https://www.theguardian.com/business/rss'], ['guardian', 'technology', 'https://www.theguardian.com/technology/rss'],
  ['guardian', 'science', 'https://www.theguardian.com/science/rss'], ['guardian', 'sports', 'https://www.theguardian.com/sport/rss'],
  ['aljazeera', 'top', 'https://www.aljazeera.com/xml/rss/all.xml'],
  ['dw', 'top', 'https://rss.dw.com/rdf/rss-en-all'], ['dw', 'top', 'https://rss.dw.com/rdf/rss-en-world'], ['dw', 'business', 'https://rss.dw.com/rdf/rss-en-bus'], ['dw', 'science', 'https://rss.dw.com/rdf/rss-en-sci'],
];
export async function fetchGlobalFeeds() {
  const items = [];
  await Promise.all(FEEDS.map(async ([src, cat, url]) => {
    const r = await get(url, 2); if (!r) { console.log('feed failed:', src, url); return; }
    for (const it of parseRss(await r.text())) items.push({ ...it, src, cat, source: OUTLETS[src] });
  }));
  return items;
}

/* ---------- country matching ---------- */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function buildMatcher(aliases) {
  const map = new Map();
  for (const [iso, list] of Object.entries(aliases)) for (const a of list) if (!map.has(a)) map.set(a, iso);
  const terms = [...map.keys()].sort((a, b) => b.length - a.length); // longest first: "Papua New Guinea" before "Guinea"
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.map(esc).join('|')})(?![\\p{L}\\p{N}])`, 'gu');
  return (text) => { const hit = new Set(); for (const m of text.matchAll(re)) hit.add(map.get(m[0])); return hit; };
}
export function indexByCountry(items, aliases, titleOnly = false) {
  const match = buildMatcher(aliases), idx = {};
  for (const it of items) for (const iso of match(titleOnly ? it.title : `${it.title}. ${it.text}`)) (idx[iso] ??= []).push(it);
  return idx;
}

/* ---------- Guardian per-country feed ---------- */
const GSLUG = { US: 'us-news', GB: 'uk-news', CZ: 'czech-republic', KR: 'south-korea', KP: 'north-korea', MM: 'myanmar', CD: 'democratic-republic-of-the-congo', CG: 'republic-of-the-congo', CI: 'ivory-coast', PS: 'palestinian-territories', MK: 'north-macedonia', TL: 'timor-leste' };
export async function fetchGuardianCountry(iso, name) {
  const slug = GSLUG[iso] || name.toLowerCase().replace(/[^a-z\s-]/g, '').trim().replace(/\s+/g, '-');
  const path = ['US', 'GB'].includes(iso) ? slug : `world/${slug}`;
  const r = await get(`https://www.theguardian.com/${path}/rss`, 1);
  return r ? parseRss(await r.text(), 12).map((it) => ({ ...it, src: 'guardian', cat: 'top', source: OUTLETS.guardian })) : [];
}

/* ---------- merge: dedupe + balanced across outlets ---------- */
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 70);
export function mergeBalanced(items, n = 12, keepSum = false) {
  const seen = new Set(), groups = {};
  for (const it of items.sort((a, b) => (b.date || '').localeCompare(a.date || ''))) {
    const k = norm(it.title); if (seen.has(k)) continue; seen.add(k);
    (groups[it.src] ??= []).push(it);
  }
  const lists = Object.values(groups), out = [];
  for (let i = 0; out.length < n && lists.some((l) => l[i]); i++) for (const l of lists) if (l[i] && out.length < n) out.push(l[i]);
  return out.sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((it) => ({ title: it.title, source: it.source, src: it.src, url: it.url, date: it.date, ...(keepSum ? { sum: summarize(it) } : {}) }));
}

export const loadAliases = async (dir) => JSON.parse(await fs.readFile(new URL('aliases.json', dir), 'utf8'));

/* ---------- one-sentence summary from the feed description ---------- */
export function summarize(it) {
  let t = (it.text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.toLowerCase().includes(it.title.toLowerCase().slice(0, 40))) return ''; // Google News descriptions just repeat the headline
  t = t.split(/(?<=[.!?])\s+(?=[A-Z"'])/)[0];
  if (t.length > 200) t = t.slice(0, 200).replace(/\s+\S*$/, '') + '…';
  return t.length < 25 ? '' : t;
}

/* ---------- tone filter for the good-news mode (keyword based, transparent) ---------- */
const POS = /\b(breakthrough|cure[sd]?|rescued|celebrat\w*|milestone|record[- ]high|record[- ]breaking|wins?|victory|triumph\w*|discover\w*|heartwarming|reunit\w*|donat\w*|kindness|inspir\w*|thriv\w*|returns? home|reforest\w*|rewild\w*|clean energy|good news|innovat\w*|saves?|saved|generous|joy\w*)\b/i;
const NEGATE = /\b(oil|crude|stocks?|shares|bitcoin|crypto|solana|etf|fed|hinges|sponsored|no|not|fails?|failed|without|unlikely|denies|rejects?|trump|putin|netanyahu|vance|congress|senate|ceasefire|talks|summit|deal|election|votes?|voted)\b/i;
const NEG = /\b(kill\w*|dead|death\w*|die[sd]?|dying|attack\w*|war\b|bomb\w*|airstrike\w*|crash\w*|crisis|collaps\w*|flood\w*|earthquake|murder\w*|shoot\w*|shot|arrest\w*|scandal|threat\w*|fears?|injur\w*|wound\w*|victims?|sanction\w*|tension\w*|violen\w*|terror\w*|abus\w*|fraud|corrupt\w*|jail\w*|hostages?|famine|outbreak|disaster|plunge[sd]?|slump\w*|layoffs?|crackdown|conflict\w*|casualt\w*|massacre|genocide|rape\w*|stabb\w*|explosion|missile\w*|invasion|tragic|tragedy|devastat\w*|warns?|collapse|lawsuit|trial|strike[sd]?|protest\w*|toxic|cancer|pollut\w*|poverty|shortage)\b/i;
export const isPositive = (it) => POS.test(it.title) && !NEGATE.test(it.title) && !it.title.trim().endsWith('?') && !NEG.test(`${it.title} ${it.text || ''}`);
export const isNotNegative = (it) => !NEG.test(`${it.title} ${it.text || ''}`) && !/good news in history|horoscope|recipe/i.test(it.title);

/* ---------- good-news sources ---------- */
const GOOD_FEEDS = [['gnn', 'https://www.goodnewsnetwork.org/feed/'], ['positive', 'https://www.positive.news/feed/'], ['optimist', 'https://www.optimistdaily.com/feed/'], ['rtbc', 'https://reasonstobecheerful.world/feed/']];
export async function fetchGoodFeeds() {
  const items = [];
  await Promise.all(GOOD_FEEDS.map(async ([src, url]) => {
    const r = await get(url, 2); if (!r) { console.log('good feed failed:', src); return; }
    for (const it of parseRss(await r.text(), 30)) if (isNotNegative(it)) items.push({ ...it, src, cat: 'good', source: OUTLETS[src] });
  }));
  return items;
}
const BAD_NAME = /^(Islamic|Republic|Kingdom|People|Democratic|Federal|State of|Plurinational|Bolivarian|United Republic|Commonwealth)/;
export const queryName = (aliasList = []) => aliasList.find((a) => a.length >= 4 && !BAD_NAME.test(a) && /^[A-Z]/.test(a)) || aliasList[0];
export async function fetchGoogleGood(iso, name) {
  if (!name) return [];
  const q = `"${name}" (breakthrough OR rescued OR celebrates OR milestone OR discovery OR "record high" OR "returns home" OR cure OR heartwarming) when:14d`;
  const r = await get(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en&gl=US&ceid=US:en`, 2);
  if (!r) return [];
  return parseRss(await r.text(), 15).filter(isPositive).map((n) => ({ ...n, src: 'google', cat: 'good' }));
}

/* ---------- briefing: cluster the same story across outlets, rank, summarize ---------- */
const STOP = new Set('the and for with from after over into amid says said will could would more than about this that have has been what when where which their there they them were your you our out new year week day'.split(' '));
const toks = (t) => new Set(t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)).map((w) => w.slice(0, 5)));
const same = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1) >= 0.3 || (i >= 3 && i / Math.min(a.size, b.size) >= 0.4); };
const CATW = { top: 1, business: 0.9, technology: 0.7, science: 0.6, sports: 0.4 };
const PRIO = ['bbc', 'guardian', 'dw', 'aljazeera', 'google'];
const TRUSTED = /^(BBC|Reuters|AP|Associated Press|The Guardian|DW|Al Jazeera|The New York Times|The Washington Post|Financial Times|Bloomberg|CNN|NPR|WSJ|The Wall Street Journal|The Economist|Politico|Axios|CNBC|France 24|Euronews|Sky News|ABC News|NBC News|CBS News|Deutsche Welle|South China Morning Post|The Times|Le Monde|Forbes|TIME|The Independent|Nikkei Asia|CNA|Straits Times)/i;
const JUNK = /sponsored|presented by|opinion\b|horoscope|\bnfl\b|\bnba\b|coupon|giveaway/i;
const label = (it) => (it.src === 'google' ? it.source : OUTLETS[it.src]) || it.source;

export function buildBriefing(items, n = 5) {
  const uniq = [], seen = new Set();
  for (const it of items) { const k = norm(it.title); if (!seen.has(k) && !JUNK.test(it.title)) { seen.add(k); uniq.push({ ...it, t: toks(it.title) }); } }
  const parent = uniq.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) if (same(uniq[i].t, uniq[j].t)) parent[find(j)] = find(i);
  const groups = {};
  uniq.forEach((it, i) => (groups[find(i)] ??= []).push(it));
  const now = Date.now();
  return Object.values(groups).map((g) => {
    const outlets = [...new Set(g.map(label))];
    const newest = Math.max(...g.map((x) => (x.date ? +new Date(x.date) : 0)));
    const catW = Math.max(...g.map((x) => CATW[x.cat] ?? 0.5));
    const trusted = g.some((x) => x.src !== 'google' || TRUSTED.test(x.source || ''));
    const score = new Set(g.map(label)).size * 8 + (trusted ? 6 : -3) + catW * 3 + Math.max(0, 3 - (now - newest) / 36e5 / 12);
    const rep = [...g].sort((a, b) => PRIO.indexOf(a.src) - PRIO.indexOf(b.src) || (b.date || '').localeCompare(a.date || ''))[0];
    const sum = summarize(rep) || g.map(summarize).sort((a, b) => b.length - a.length)[0] || '';
    return { score, title: rep.title, url: rep.url, source: label(rep), src: rep.src, date: rep.date || new Date(newest).toISOString(), sum, outlets: outlets.slice(0, 4), n: outlets.length };
  }).sort((a, b) => b.score - a.score).slice(0, n).map(({ score, ...x }) => x);
}

/* ---------- Google News search per country (the edition feeds are US-flavoured in English) ---------- */
const GQ = {
  top: (n) => `"${n}" when:2d`,
  business: (n) => `"${n}" (economy OR business OR markets OR company OR inflation) when:7d`,
  technology: (n) => `"${n}" (technology OR AI OR startup OR tech) when:7d`,
  science: (n) => `"${n}" (science OR research OR climate OR space OR health) when:7d`,
  sports: (n) => `"${n}" (football OR sport OR olympic OR league OR tennis OR cricket) when:7d`,
};
export async function fetchGoogleSearch(name) {
  const out = {};
  if (!name) return out;
  for (const [cat, q] of Object.entries(GQ)) {
    const r = await get(`https://news.google.com/rss/search?q=${encodeURIComponent(q(name))}&hl=en-US&gl=US&ceid=US:en`, 2);
    out[cat] = r ? parseRss(await r.text(), 10).map((n) => ({ ...n, src: 'google', cat })) : [];
    await sleep(200);
  }
  return out;
}

/* ---------- per-country relevance test (title/description mentions the country) ---------- */
export function buildMentions(aliases) {
  const cache = {};
  return (iso, it) => {
    cache[iso] ??= new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...(aliases[iso] || [])].sort((a, b) => b.length - a.length).map(esc).join('|')})(?![\\p{L}\\p{N}])`, 'u');
    return cache[iso].test(`${it.title} ${it.text || ''}`);
  };
}
