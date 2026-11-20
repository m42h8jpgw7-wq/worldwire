// Offline dev helper: writes clearly fake sample data so the UI can be previewed without network.
import fs from 'node:fs/promises';
const OUT = new URL('../data/', import.meta.url);
const geo = JSON.parse(await fs.readFile(new URL('countries.geo.json', OUT), 'utf8'));
await fs.mkdir(new URL('countries/', OUT), { recursive: true });
const isos = [...new Set(geo.features.map((f) => f.properties.iso).filter(Boolean))];
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const cats = ['top', 'business', 'technology', 'science', 'sports'];
for (const f of geo.features) {
  const iso = f.properties.iso; if (!iso) continue;
  const news = Object.fromEntries(cats.map((c) => [c, Array.from({ length: 6 }, (_, i) => ({
    title: `[SAMPLE] ${f.properties.name}: ${c} headline number ${i + 1} used for UI preview only`, source: 'Sample Wire',
    url: 'https://example.com', date: new Date(Date.now() - (i + 1) * 36e5 * 3).toISOString() }))]));
  const s = (v, y = 2024) => ({ v, y });
  await fs.writeFile(new URL(`countries/${iso}.json`, OUT), JSON.stringify({ iso, name: f.properties.name, updated: new Date().toISOString(), news,
    indicators: { gdp: s(1.234e12), pop: s(48.2e6), gdppc: s(25600), growth: s(2.1), inflation: s(3.4), unemployment: s(5.2) },
    holidays: [{ date: day(5), name: 'Sample Holiday A' }, { date: day(31), name: 'Sample Holiday B' }] }));
}
await fs.writeFile(new URL('index.json', OUT), JSON.stringify({ updated: new Date().toISOString(), countries: isos }));
console.log('mock data written for', isos.length, 'countries');
const q = (price, chg) => ({ price, chg, date: day(0) });
await fs.writeFile(new URL('markets.json', OUT), JSON.stringify({ updated: new Date().toISOString(),
  indices: [['S&P 500','US'],['DAX','DE'],['FTSE 100','GB'],['Nikkei 225','JP']].map(([name, country], i) => ({ name, country, ...q(5000 + i * 3000.55, i % 2 ? -0.6 : 0.8) })),
  commodities: [{ name: 'Gold', unit: 'USD/oz', ...q(2650.2, 0.3) }], fx: [{ name: 'EUR/USD', ...q(1.0812, -0.12) }],
  crypto: [{ symbol: 'BTC', name: 'Bitcoin', price: 98000, chg: 2.1 }, { symbol: 'ETH', name: 'Ethereum', price: 3400, chg: -1.4 }], fng: { value: 64, label: 'Greed' } }));
