/* WORLDWIRE — interactive news globe. Static front-end; data comes from /data/*.json
   (refreshed by .github/workflows/update-data.yml). */
(() => {
  const $ = (s) => document.querySelector(s);
  const CATS = [['top', 'Top'], ['business', 'Business'], ['technology', 'Tech'], ['science', 'Science'], ['sports', 'Sports']];
  const TABS = {
    country: [['news', 'News'], ['data', 'Data'], ['upcoming', 'Upcoming']],
    world: [['markets', 'Markets'], ['events', 'Events']],
  };
  const EU = new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' '));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = { src: 'all', outlets: {}, mode: null, sel: null, tab: 'news', cat: 'top', evCat: 'All', cache: {}, events: [], markets: null, withData: new Set(), idle: null, cent: {} };

  /* ---------- helpers ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : '#');
  const flag = (iso) => /^[A-Z]{2}$/.test(iso) && iso !== 'XK' ? String.fromCodePoint(...[...iso].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '🌐';
  const ago = (d) => { const m = Math.round((Date.now() - new Date(d)) / 60000); if (isNaN(m)) return ''; return m < 60 ? `${Math.max(m, 1)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
  const daysTo = (d) => Math.ceil((new Date(d + 'T00:00:00') - new Date().setHours(0, 0, 0, 0)) / 864e5);
  const inDays = (d) => { const n = daysTo(d); return n <= 0 ? 'today' : n === 1 ? 'tomorrow' : n < 60 ? `in ${n} days` : `in ${Math.round(n / 30)} months`; };
  const fmtUsd = (v) => v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v).toLocaleString('en-US')}`;
  const fmtNum = (v) => v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.round(v).toLocaleString('en-US');
  const fmtPct = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
  const px = (v) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v >= 10 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : v.toLocaleString('en-US', { maximumFractionDigits: 4 });
  const chg = (v) => (v == null ? '' : `<span class="${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(2)}%</span>`);
  const upcoming = () => state.events.filter((e) => daysTo(e.date) >= 0).sort((a, b) => a.date.localeCompare(b.date));

  /* ---------- starfield ---------- */
  (function stars() {
    const c = $('#stars'), x = c.getContext('2d');
    const draw = () => {
      c.width = innerWidth; c.height = innerHeight;
      for (let i = 0; i < Math.min(420, innerWidth * innerHeight / 3500); i++) {
        x.fillStyle = `rgba(190,210,255,${Math.random() * 0.55 + 0.08})`;
        x.beginPath(); x.arc(Math.random() * c.width, Math.random() * c.height, Math.random() * 1.2 + 0.2, 0, 7); x.fill();
      }
    };
    draw(); addEventListener('resize', draw);
  })();

  /* ---------- globe ---------- */
  let raf = 0; const refresh = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; globe.polygonsData(globe.polygonsData()); }); };
  const globe = Globe({ animateIn: !reduce })($('#globe'))
    .backgroundColor('rgba(0,0,0,0)')
    .showAtmosphere(true).atmosphereColor('#5eead4').atmosphereAltitude(0.14)
    .polygonsTransitionDuration(250)
    .polygonStrokeColor(() => 'rgba(120,150,190,0.22)')
    .polygonSideColor(() => 'rgba(0,0,0,0)')
    .polygonAltitude((d) => (d === state.sel || d === state.hover ? 0.035 : 0.006))
    .polygonCapColor((d) => d === state.sel ? 'rgba(94,234,212,0.85)' : d === state.hover ? 'rgba(94,234,212,0.42)'
      : state.withData.has(d.properties.iso) ? '#161d2a' : '#0f131b')
    .polygonLabel(({ properties: p }) => `<div class="label">${flag(p.iso)} ${esc(p.name)}<small>${esc(p.iso || '')}</small></div>`)
    .onPolygonHover((d) => { state.hover = d; $('#globe').style.cursor = d ? 'pointer' : 'grab'; refresh(); })
    .onPolygonClick((d) => d && d.properties.iso && select(d))
    .ringColor(() => (t) => `rgba(94,234,212,${(1 - t) * 0.8})`).ringMaxRadius(3.2).ringPropagationSpeed(1.6).ringRepeatPeriod(1800);
  globe.renderer().setPixelRatio(Math.min(devicePixelRatio || 1, 2));

  const mat = globe.globeMaterial();
  mat.color.set('#070a10'); mat.emissive.set('#05080f'); mat.emissiveIntensity = 0.6; mat.shininess = 8;
  const ctl = globe.controls();
  ctl.autoRotate = !reduce; ctl.autoRotateSpeed = 0.35; ctl.enableDamping = true; ctl.minDistance = 160; ctl.maxDistance = 520;
  const idle = () => { if (!reduce) { ctl.autoRotate = true; } };
  const pauseRotate = () => { ctl.autoRotate = false; clearTimeout(state.idle); state.idle = setTimeout(() => { if (!state.mode) idle(); }, 9000); };
  ['pointerdown', 'wheel', 'touchstart'].forEach((e) => $('#globe').addEventListener(e, () => { pauseRotate(); $('#hint').classList.add('hide'); }, { passive: true }));
  const resize = () => globe.width(innerWidth).height(innerHeight);
  addEventListener('resize', resize); resize();

  function centroid(d) {
    const polys = d.geometry.type === 'Polygon' ? [d.geometry.coordinates] : d.geometry.coordinates;
    let best = null, area = -1;
    for (const p of polys) {
      const ring = p[0], xs = ring.map((c) => c[0]), ys = ring.map((c) => c[1]);
      const a = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
      if (a > area) { area = a; best = ring; }
    }
    return { lat: best.reduce((s, c) => s + c[1], 0) / best.length, lng: best.reduce((s, c) => s + c[0], 0) / best.length, area };
  }
  function updateRings() { // pulse countries with an election in the next 60 days
    if (reduce) return;
    const seen = new Set();
    const rings = upcoming().filter((e) => e.category === 'Election' && daysTo(e.date) <= 60 && state.cent[e.country] && !seen.has(e.country) && seen.add(e.country))
      .map((e) => ({ lat: state.cent[e.country].lat, lng: state.cent[e.country].lng }));
    globe.ringsData(rings);
  }

  /* ---------- data ---------- */
  async function getJSON(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); return r.json(); }
  async function loadCountry(iso) {
    if (state.cache[iso] === undefined) { try { state.cache[iso] = await getJSON(`data/countries/${iso}.json`); } catch { state.cache[iso] = null; } }
    return state.cache[iso];
  }

  /* ---------- panel ---------- */
  function openPanel(mode, tab) {
    state.mode = mode; state.tab = tab;
    document.body.classList.add('open'); $('#panel').hidden = false;
    $('#tabs').innerHTML = TABS[mode].map(([k, l]) => `<button class="tab" data-tab="${k}" role="tab">${l}</button>`).join('');
    $('#btn-markets').classList.toggle('on', mode === 'world' && tab === 'markets');
    $('#btn-events').classList.toggle('on', mode === 'world' && tab === 'events');
    ctl.autoRotate = false;
  }
  async function select(d) {
    const iso = d.properties.iso;
    state.sel = d; pauseRotate(); ctl.autoRotate = false;
    openPanel('country', state.mode === 'country' ? state.tab : 'news');
    $('#flag').textContent = flag(iso); $('#cname').textContent = d.properties.name; $('#csub').textContent = iso;
    history.replaceState(null, '', `#${iso}`);
    const c = centroid(d);
    globe.pointOfView({ lat: c.lat, lng: c.lng, altitude: Math.min(2.2, Math.max(0.9, 0.9 + c.area / 900)) }, reduce ? 0 : 1100);
    refresh();
    $('#body').innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
    state.data = await loadCountry(iso);
    if (state.sel === d) render();
  }
  function openWorld(tab) {
    state.sel = null; refresh(); pauseRotate();
    openPanel('world', tab);
    $('#flag').textContent = '🌐'; $('#cname').textContent = tab === 'markets' ? 'Global markets' : 'Upcoming events'; $('#csub').textContent = 'WORLD OVERVIEW';
    history.replaceState(null, '', `#${tab}`);
    globe.pointOfView({ altitude: 2.4 }, reduce ? 0 : 900);
    render();
  }
  function close() {
    state.sel = null; state.mode = null; document.body.classList.remove('open'); $('#panel').hidden = true;
    $('#btn-markets').classList.remove('on'); $('#btn-events').classList.remove('on');
    history.replaceState(null, '', location.pathname); refresh(); pauseRotate(); idle();
    globe.pointOfView({ altitude: 2.4 }, reduce ? 0 : 900);
  }

  function render() {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === state.tab));
    const el = $('#body'), iso = state.sel?.properties.iso;
    el.innerHTML = state.mode === 'world'
      ? (state.tab === 'markets' ? renderMarkets() : renderEvents())
      : (state.tab === 'news' ? renderNews(state.data) : state.tab === 'data' ? renderData(state.data, iso) : renderUpcoming(state.data, iso));
    el.scrollTop = 0;
  }

  function renderNews(data) {
    if (!data) return '<div class="empty">No data for this country yet. The data pipeline will pick it up on its next run.</div>';
    if (!data.news || !Object.keys(data.news).length) return '<div class="empty">No local news feed is available for this country.<br>Data and dates are still shown in the other tabs.</div>';
    const chips = CATS.map(([k, l]) => `<button class="chip ${k === state.cat ? 'active' : ''}" data-cat="${k}">${l}</button>`).join('');
    const all = data.news[state.cat] || [];
    const outs = [...new Set(all.map((n) => n.src).filter(Boolean))];
    const src = outs.includes(state.src) ? state.src : 'all';
    const items = src === 'all' ? all : all.filter((n) => n.src === src);
    const srcChips = outs.length > 1 ? `<div class="chips src">${['all', ...outs].map((o) => `<button class="chip ${o === src ? 'active' : ''}" data-src="${o}">${o === 'all' ? 'All sources' : esc(state.outlets[o] || o)}</button>`).join('')}</div>` : '';
    const list = items.length ? items.map((n) => `
      <li><a href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener noreferrer"><div class="t">${esc(n.title)}</div>
      <div class="m"><b>${esc(n.source || '')}</b>${n.src === 'google' ? ' · via Google News' : ''} · ${ago(n.date)}</div></a></li>`).join('') : '<li class="empty">Nothing in this category right now.</li>';
    return `<div class="chips">${chips}</div>${srcChips}<ul class="news">${list}</ul>`;
  }

  function renderData(data, iso) {
    const i = data && data.indicators, idx = (state.markets?.indices || []).filter((x) => x.country === iso);
    if ((!i || !Object.keys(i).length) && !idx.length) return '<div class="empty">No indicator data available.</div>';
    const S = (label, k, f, tone) => {
      const o = i?.[k]; if (!o || o.v == null) return '';
      return `<div class="stat"><div class="l">${label}</div><div class="v ${tone ? (o.v >= 0 ? 'pos' : 'neg') : ''}">${f(o.v)}</div><div class="y">${o.y}</div></div>`;
    };
    const stocks = idx.length ? `<h3>Stock market</h3><ul class="rows">${idx.map((x) => `<li class="row"><span class="nm">${esc(x.name)}</span><span class="px">${px(x.price)}</span><span class="ch">${chg(x.chg)}</span></li>`).join('')}</ul>` : '';
    return `<div class="grid">${S('GDP', 'gdp', fmtUsd)}${S('Population', 'pop', fmtNum)}${S('GDP / capita', 'gdppc', fmtUsd)}${S('GDP growth', 'growth', fmtPct, 1)}${S('Inflation (CPI)', 'inflation', fmtPct)}${S('Unemployment', 'unemployment', (v) => `${v.toFixed(1)}%`)}</div>${stocks}
      <div class="src">Sources: World Bank Open Data (latest available year) · Stooq (index, last daily close).</div>`;
  }

  const evCard = (e, opts = {}) => {
    const dt = new Date(e.date + 'T00:00:00');
    const title = e.url ? `<a class="n" href="${esc(safeUrl(e.url))}" target="_blank" rel="noopener noreferrer">${esc(e.title)}</a>` : `<span class="n">${esc(e.title)}</span>`;
    return `<li class="ev ${e.big ? 'big' : ''} ${opts.go ? 'click' : ''}" ${opts.go ? `data-go="${esc(e.country)}"` : ''}>
      <div class="d"><b>${dt.getDate()}</b><span>${dt.toLocaleString('en', { month: 'short' })}${dt.getFullYear() !== new Date().getFullYear() ? ' ' + String(dt.getFullYear()).slice(2) : ''}</span></div>
      <div><div class="n">${opts.go ? flag(e.country) + ' ' : ''}${title}</div><div class="r">${inDays(e.date)}${e.category ? `<span class="tag">${esc(e.category)}</span>` : ''}</div></div></li>`;
  };

  function renderUpcoming(data, iso) {
    const ev = upcoming().filter((e) => e.country === iso || e.country === 'ALL' || (e.country === 'EU' && EU.has(iso))).map((e) => ({ ...e, big: true }));
    const hol = ((data && data.holidays) || []).filter((h) => daysTo(h.date) >= 0).slice(0, 6);
    let out = '';
    if (ev.length) out += `<h3>Key events</h3><ul class="events">${ev.map((e) => evCard(e)).join('')}</ul>`;
    if (hol.length) out += `<h3>Public holidays</h3><ul class="events">${hol.map((h) => evCard({ date: h.date, title: h.name })).join('')}</ul>`;
    return out || '<div class="empty">No upcoming dates on file for this country.</div>';
  }

  function renderEvents() {
    const cats = ['All', ...new Set(state.events.map((e) => e.category).filter(Boolean))];
    const chips = cats.map((c) => `<button class="chip ${c === state.evCat ? 'active' : ''}" data-ev="${esc(c)}">${esc(c)}</button>`).join('');
    const list = upcoming().filter((e) => state.evCat === 'All' || e.category === state.evCat);
    return `<div class="chips">${chips}</div>${list.length ? `<ul class="events">${list.map((e) => evCard(e, { go: /^[A-Z]{2}$/.test(e.country) })).join('')}</ul>` : '<div class="empty">No upcoming events.</div>'}
      <div class="src">Curated from public election calendars and central bank schedules. Dates can change — follow the source link.</div>`;
  }

  function renderMarkets() {
    const m = state.markets; if (!m) return '<div class="empty">No market data yet — it appears after the first data run.</div>';
    const row = (nm, sub, p, c) => `<li class="row"><span class="nm">${nm}${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="px">${p}</span><span class="ch">${chg(c)}</span></li>`;
    let out = '';
    if (m.fng) out += `<h3>Crypto sentiment</h3><div class="fng"><div class="top"><span>Fear &amp; Greed</span><b>${m.fng.value}</b></div><div class="bar"><i style="left:calc(${m.fng.value}% - 1px)"></i></div><div class="y" style="font:11px var(--mono);color:var(--muted)">${esc(m.fng.label)}</div></div>`;
    if (m.indices?.length) out += `<h3>Stock indices</h3><ul class="rows">${m.indices.map((x) => row(`${flag(x.country)} ${esc(x.name)}`, '', px(x.price), x.chg)).join('')}</ul>`;
    if (m.crypto?.length) out += `<h3>Crypto · top ${m.crypto.length}</h3><ul class="rows">${m.crypto.map((x) => row(esc(x.name), x.symbol, '$' + px(x.price), x.chg)).join('')}</ul>`;
    const cf = [...(m.commodities || []).map((x) => row(esc(x.name), x.unit, px(x.price), x.chg)), ...(m.fx || []).map((x) => row(esc(x.name), '', px(x.price), x.chg))];
    if (cf.length) out += `<h3>Commodities &amp; FX</h3><ul class="rows">${cf.join('')}</ul>`;
    return out + `<div class="src">Sources: Stooq (last daily close), CoinGecko, alternative.me. Updated ${ago(m.updated)}. Not financial advice.</div>`;
  }

  /* ---------- ticker ---------- */
  function renderTicker() {
    const m = state.markets; if (!m) return;
    const pick = [];
    const byName = (arr, n) => arr?.find((x) => x.name === n);
    const c = (sym) => m.crypto?.find((x) => x.symbol === sym);
    [['BTC', c('BTC'), '$'], ['ETH', c('ETH'), '$'], ['S&P 500', byName(m.indices, 'S&P 500'), ''], ['DAX', byName(m.indices, 'DAX'), ''],
      ['Gold', byName(m.commodities, 'Gold'), ''], ['EUR/USD', byName(m.fx, 'EUR/USD'), '']].forEach(([n, q, p]) => q && pick.push(`<div><span>${n}</span><b>${p}${px(q.price)}</b>${chg(q.chg)}</div>`));
    const t = $('#ticker'); t.hidden = !pick.length; t.innerHTML = pick.join('');
  }
  async function liveCrypto() { // browser-side refresh (CoinGecko allows CORS); silently falls back to the static snapshot
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true');
      if (!r.ok) return; const j = await r.json();
      for (const [id, sym] of [['bitcoin', 'BTC'], ['ethereum', 'ETH']]) {
        const q = state.markets?.crypto?.find((x) => x.symbol === sym);
        if (q && j[id]) { q.price = j[id].usd; q.chg = j[id].usd_24h_change; }
      }
      renderTicker();
    } catch { /* offline or rate-limited */ }
  }

  /* ---------- wiring ---------- */
  $('#body').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (c?.dataset.cat) { state.cat = c.dataset.cat; render(); }
    if (c?.dataset.ev) { state.evCat = c.dataset.ev; render(); }
    if (c?.dataset.src) { state.src = c.dataset.src; render(); }
    const go = e.target.closest('[data-go]');
    if (go && !e.target.closest('a')) pick(go.dataset.go);
  });
  $('#tabs').addEventListener('click', (e) => {
    const t = e.target.closest('.tab'); if (!t) return;
    state.tab = t.dataset.tab;
    if (state.mode === 'world') openWorld(state.tab); else render();
  });
  $('#close').addEventListener('click', close);
  $('#btn-markets').addEventListener('click', () => (state.mode === 'world' && state.tab === 'markets' ? close() : openWorld('markets')));
  $('#btn-events').addEventListener('click', () => (state.mode === 'world' && state.tab === 'events' ? close() : openWorld('events')));
  $('#ticker').addEventListener('click', () => openWorld('markets'));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.mode) close(); });

  let feats = [];
  const inp = $('#search'), res = $('#results');
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) { res.hidden = true; return; }
    const m = feats.filter((f) => f.properties.iso && f.properties.name.toLowerCase().includes(q)).slice(0, 8);
    res.innerHTML = m.map((f, i) => `<li data-iso="${f.properties.iso}" class="${i ? '' : 'sel'}">${flag(f.properties.iso)} ${esc(f.properties.name)}</li>`).join('');
    res.hidden = !m.length;
  });
  function pick(iso) { const f = feats.find((x) => x.properties.iso === iso); if (f) { select(f); inp.value = ''; res.hidden = true; inp.blur(); } }
  res.addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) pick(li.dataset.iso); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const li = res.querySelector('li'); if (li) pick(li.dataset.iso); } });

  /* boot */
  (async () => {
    const [geo, idx, evs, mk] = await Promise.all([
      getJSON('data/countries.geo.json'),
      getJSON('data/index.json').catch(() => null),
      getJSON('data/events.json').catch(() => []),
      getJSON('data/markets.json').catch(() => null),
    ]);
    feats = geo.features; state.events = evs; state.markets = mk;
    for (const f of feats) if (f.properties.iso && !state.cent[f.properties.iso]) state.cent[f.properties.iso] = centroid(f);
    if (idx) { state.outlets = idx.outlets || {}; state.withData = new Set(idx.countries); $('#updated').textContent = `UPDATED ${ago(idx.updated).toUpperCase()}`; }
    else { const b = $('#banner'); b.hidden = false; b.textContent = 'No data yet — run the “Update data” workflow once (Actions tab) or `npm run update` locally.'; }
    globe.polygonsData(feats);
    updateRings(); renderTicker(); liveCrypto(); setInterval(liveCrypto, 60000);
    globe.pointOfView({ lat: 25, lng: 10, altitude: 2.4 });
    const h = location.hash.slice(1);
    if (h === 'markets' || h === 'events') setTimeout(() => openWorld(h), 400); else if (h) setTimeout(() => pick(h.toUpperCase()), 600);
  })();
})();
