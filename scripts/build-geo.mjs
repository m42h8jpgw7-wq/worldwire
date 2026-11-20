import fs from 'fs';
import { feature } from 'topojson-client';
import iso from 'i18n-iso-countries';
const topo = JSON.parse(fs.readFileSync('node_modules/world-atlas/countries-110m.json','utf8'));
const fc = feature(topo, topo.objects.countries);
const out = [];
for (const f of fc.features) {
  const a2 = iso.numericToAlpha2(String(f.id).padStart(3,'0'));
  f.properties = { iso: a2 || (f.properties.name === 'Kosovo' ? 'XK' : null), name: f.properties.name };
  out.push(f);
}
fs.writeFileSync('data/countries.geo.json', JSON.stringify({type:'FeatureCollection',features:out}));
console.log(out.length, 'features;', out.filter(f=>!f.properties.iso).map(f=>f.properties.name).join(', '));
