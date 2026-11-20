# WORLDWIRE

Dark 3D globe. Click a country → current headlines (5 categories), key indicators and upcoming dates.

**Stack:** static HTML/CSS/JS · [globe.gl](https://globe.gl) (three.js) · GitHub Actions for data · GitHub Pages for hosting. No backend, no API keys.

## Data sources
| What | Source |
|---|---|
| Headlines (Top, Business, Tech, Science, Sports) | **5 outlets**: Google News (local media, per-country edition), BBC, The Guardian, Al Jazeera, DW — merged, de-duplicated and balanced per country |
| GDP, population, growth, inflation, unemployment | World Bank Open Data |
| Public holidays | Nager.Date |
| Stock indices, gold/oil, FX (last daily close) | Stooq |
| Crypto top 10 (+ live BTC/ETH in browser), Fear & Greed | CoinGecko, alternative.me |
| Elections & central bank dates | `data/events.json` (curated, each with source link) |

## How news is assembled
Global feeds (BBC, Guardian, Al Jazeera, DW) are fetched once and matched to countries by name/demonym/capital (`data/aliases.json`, built by `scripts/build-aliases.mjs`). The Guardian also has per-country feeds; Google News adds local media for ~70 countries. Items are de-duplicated and interleaved so no single outlet dominates; each can be filtered in the UI.

## Setup
1. Push this repo to GitHub.
2. **Settings → Pages**: deploy from branch `main`, folder `/ (root)`.
3. **Actions → Update data → Run workflow** (first run fills `data/`; afterwards it runs every 3 h).

## Local dev
```bash
npm run mock      # offline sample data (fake, for UI preview)
npm run serve     # http://localhost:3000
npm run update    # real data (needs internet)
```

## Add events
Edit `data/events.json`: `{ "date": "YYYY-MM-DD", "country": "US" | "EU" | "ALL", "title": "...", "category": "..." }`

## Notes
- Countries without a Google News edition still show indicators and holidays.
- Countries with an election in the next 60 days pulse on the globe.
- `events.json` was compiled from public calendars (IDEA, Wikipedia, Fed, service-public.fr); dates can shift — keep it updated.
- Some Stooq index symbols may be missing; they are skipped silently.
- News links belong to their publishers; the site only shows headline, source and link.
