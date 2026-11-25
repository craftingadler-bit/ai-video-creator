// Baut kit/geo-data-50m.js und kit/geo-data-10m.js aus den npm-Paketen (d3-geo, topojson-client, world-atlas).
// Einmalig nach `npm install`: node kit/build-geo.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = p => fs.readFileSync(path.join(ROOT, 'node_modules', p), 'utf8');
const libs = ['d3-array/dist/d3-array.min.js', 'd3-geo/dist/d3-geo.min.js', 'topojson-client/dist/topojson-client.min.js'].map(nm).join('\n');
fs.writeFileSync(path.join(ROOT, 'kit', 'geo-lib.js'), '/* d3-array, d3-geo, topojson-client (ISC) */\n' + libs + '\n');
for (const res of ['50m', '10m']) {
  const data = nm(`world-atlas/countries-${res}.json`);
  fs.writeFileSync(path.join(ROOT, 'kit', `geo-data-${res}.js`), `/* Natural Earth via world-atlas (public domain) */\nwindow.WORLD_${res.toUpperCase()} = ${data};\n`);
}
console.log('geo-lib.js, geo-data-50m.js, geo-data-10m.js geschrieben');
