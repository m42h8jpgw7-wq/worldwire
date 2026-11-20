// Builds data/aliases.json (country name variants, demonyms, capitals) used to match global news feeds to countries.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const iso = require('i18n-iso-countries');
iso.registerLocale(require('i18n-iso-countries/langs/en.json'));
const geo = JSON.parse(fs.readFileSync('data/countries.geo.json', 'utf8'));
const ISOS = [...new Set(geo.features.map((f) => f.properties.iso).filter(Boolean))];
const names = iso.getNames('en', { select: 'all' });

// Extra signals: demonyms and capitals that headlines use instead of the country name.
const EXTRA = {
  US: ['US', 'U.S.', 'America', 'American', 'Americans', 'Washington', 'White House', 'Pentagon'], GB: ['UK', 'U.K.', 'Britain', 'British', 'London', 'Westminster', 'Downing Street'],
  FR: ['French', 'Paris', 'Macron'], DE: ['German', 'Germans', 'Berlin', 'Bundestag'], IT: ['Italian', 'Rome'], ES: ['Spanish', 'Madrid'], PT: ['Portuguese', 'Lisbon'],
  NL: ['Dutch', 'Netherlands', 'Amsterdam'], BE: ['Belgian', 'Brussels'], CH: ['Swiss', 'Bern'], AT: ['Austrian', 'Vienna'], SE: ['Swedish', 'Stockholm'], NO: ['Norwegian', 'Oslo'],
  DK: ['Danish', 'Copenhagen'], FI: ['Finnish', 'Helsinki'], PL: ['Polish', 'Warsaw'], CZ: ['Czech', 'Prague', 'Czech Republic'], HU: ['Hungarian', 'Budapest'], RO: ['Romanian', 'Bucharest'],
  GR: ['Greek', 'Athens'], TR: ['Turkish', 'Ankara', 'Istanbul', 'Turkiye', 'Türkiye'], RU: ['Russian', 'Russians', 'Moscow', 'Kremlin'], UA: ['Ukrainian', 'Ukrainians', 'Kyiv', 'Kiev'],
  BY: ['Belarusian', 'Minsk'], CN: ['Chinese', 'Beijing'], JP: ['Japanese', 'Tokyo'], KR: ['South Korean', 'Seoul', 'South Korea'], KP: ['North Korean', 'Pyongyang', 'North Korea'],
  IN: ['Indian', 'Indians', 'New Delhi', 'Delhi', 'Mumbai'], PK: ['Pakistani', 'Islamabad'], BD: ['Bangladeshi', 'Dhaka'], AF: ['Afghan', 'Kabul', 'Taliban'], IR: ['Iranian', 'Tehran'],
  IQ: ['Iraqi', 'Baghdad'], SY: ['Syrian', 'Damascus'], IL: ['Israeli', 'Israelis', 'Jerusalem', 'Tel Aviv'], PS: ['Palestinian', 'Palestinians', 'Gaza', 'West Bank', 'Ramallah'],
  LB: ['Lebanese', 'Beirut', 'Hezbollah'], JO: ['Jordanian', 'Amman'], SA: ['Saudi', 'Riyadh'], AE: ['UAE', 'Emirati', 'Dubai', 'Abu Dhabi'], QA: ['Qatari', 'Doha'], YE: ['Yemeni', 'Houthi', 'Houthis', 'Sanaa'],
  EG: ['Egyptian', 'Cairo'], LY: ['Libyan', 'Tripoli'], SD: ['Sudanese', 'Khartoum'], ET: ['Ethiopian', 'Addis Ababa'], KE: ['Kenyan', 'Nairobi'], NG: ['Nigerian', 'Abuja', 'Lagos'],
  ZA: ['South African', 'Pretoria', 'Johannesburg'], GH: ['Ghanaian', 'Accra'], CD: ['DR Congo', 'DRC', 'Congolese', 'Kinshasa'], SO: ['Somali', 'Mogadishu'], MA: ['Moroccan', 'Rabat'],
  DZ: ['Algerian', 'Algiers'], TN: ['Tunisian', 'Tunis'], BR: ['Brazilian', 'Brasilia', 'Brasília'], AR: ['Argentine', 'Argentinian', 'Buenos Aires'], MX: ['Mexican', 'Mexico City'],
  CO: ['Colombian', 'Bogota', 'Bogotá'], VE: ['Venezuelan', 'Caracas'], CL: ['Chilean', 'Santiago'], PE: ['Peruvian', 'Lima'], CU: ['Cuban', 'Havana'], CA: ['Canadian', 'Canadians', 'Ottawa'],
  AU: ['Australian', 'Australians', 'Canberra'], NZ: ['New Zealander', 'Wellington'], ID: ['Indonesian', 'Jakarta'], PH: ['Philippine', 'Filipino', 'Manila', 'Philippines'], VN: ['Vietnamese', 'Hanoi'],
  TH: ['Thai', 'Bangkok'], MY: ['Malaysian', 'Kuala Lumpur'], SG: ['Singaporean'], MM: ['Myanmar', 'Burmese', 'Naypyidaw'], TW: ['Taiwanese', 'Taipei'], HK: ['Hong Kong'], KZ: ['Kazakh', 'Astana'],
  RS: ['Serbian', 'Belgrade'], HR: ['Croatian', 'Zagreb'], BG: ['Bulgarian', 'Sofia'], IE: ['Irish', 'Dublin'], IS: ['Icelandic', 'Reykjavik'], GE: ['Tbilisi'], AM: ['Armenian', 'Yerevan'], AZ: ['Azerbaijani', 'Baku'],
};
const DROP = new Set(['Georgia', 'Jersey', 'Guinea']); // too ambiguous on their own
const out = {};
for (const c of ISOS) {
  let n = names[c]; n = Array.isArray(n) ? n : n ? [n] : [];
  const geoName = geo.features.find((f) => f.properties.iso === c)?.properties.name;
  const set = new Set([...n, geoName, ...(EXTRA[c] || [])].filter(Boolean).filter((s) => !DROP.has(s)));
  out[c] = [...set].filter((s) => s.length >= 3 || ['US', 'UK'].includes(s));
}
fs.writeFileSync('data/aliases.json', JSON.stringify(out));
console.log('aliases for', Object.keys(out).length, 'countries;', Object.values(out).flat().length, 'terms');
