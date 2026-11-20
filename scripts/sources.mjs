// Multi-outlet news: Google News (local editions), BBC, The Guardian, Al Jazeera, DW.
// Global feeds are matched to countries via data/aliases.json; Guardian also has per-country feeds.
import fs from 'node:fs/promises';

export const OUTLETS = { google: 'Google News', bbc: 'BBC', guardian: 'The Guardian', aljazeera: 'Al Jazeera', dw: 'DW' };
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
export function indexByCountry(items, aliases) {
  const match = buildMatcher(aliases), idx = {};
  for (const it of items) for (const iso of match(`${it.title}. ${it.text}`)) (idx[iso] ??= []).push(it);
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
export function mergeBalanced(items, n = 12) {
  const seen = new Set(), groups = {};
  for (const it of items.sort((a, b) => (b.date || '').localeCompare(a.date || ''))) {
    const k = norm(it.title); if (seen.has(k)) continue; seen.add(k);
    (groups[it.src] ??= []).push(it);
  }
  const lists = Object.values(groups), out = [];
  for (let i = 0; out.length < n && lists.some((l) => l[i]); i++) for (const l of lists) if (l[i] && out.length < n) out.push(l[i]);
  return out.sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(({ title, source, src, url, date }) => ({ title, source, src, url, date }));
}

export const loadAliases = async (dir) => JSON.parse(await fs.readFile(new URL('aliases.json', dir), 'utf8'));
