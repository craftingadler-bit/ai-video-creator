// Baut kit/vendor/gsap-all.js (GSAP + Plugins) und kit/vendor/lottie.js aus node_modules.
// Und wandelt Lottie-JSONs aus kit/lottie/*.json in ladbare .js-Dateien um (file:// darf kein JSON per fetch laden).
// Nutzung: node kit/build-vendor.mjs   (läuft auch in npm run setup)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = p => path.join(ROOT, 'node_modules', p);
const out = path.join(ROOT, 'kit', 'vendor'); fs.mkdirSync(out, { recursive: true });

const plugins = ['CustomEase', 'CustomBounce', 'CustomWiggle', 'MorphSVGPlugin', 'DrawSVGPlugin', 'MotionPathPlugin',
  'Physics2DPlugin', 'PhysicsPropsPlugin', 'SplitText', 'TextPlugin', 'Flip', 'EasePack'];
let js = '/* GSAP ' + JSON.parse(fs.readFileSync(nm('gsap/package.json'))).version + ' + Plugins (Standard "No Charge" License, gsap.com/standard-license) */\n';
js += fs.readFileSync(nm('gsap/dist/gsap.min.js'), 'utf8') + '\n';
for (const p of plugins) js += fs.readFileSync(nm(`gsap/dist/${p}.min.js`), 'utf8') + '\n';
js += `gsap.registerPlugin(${plugins.filter(p => p !== 'EasePack').join(',')});\n`;
fs.writeFileSync(path.join(out, 'gsap-all.js'), js);

fs.copyFileSync(nm('lottie-web/build/player/lottie_svg.min.js'), path.join(out, 'lottie.js'));

const ldir = path.join(ROOT, 'kit', 'lottie');
let n = 0;
for (const f of fs.existsSync(ldir) ? fs.readdirSync(ldir) : []) {
  if (!f.endsWith('.json')) continue;
  const name = f.replace(/\.json$/, '');
  const data = fs.readFileSync(path.join(ldir, f), 'utf8');
  JSON.parse(data);
  fs.writeFileSync(path.join(ldir, name + '.js'), `(window.LOTTIE = window.LOTTIE || {})[${JSON.stringify(name)}] = ${data.trim()};\n`);
  n++;
}
console.log(`vendor: gsap-all.js, lottie.js · ${n} Lottie-Datei(en) umgewandelt`);
