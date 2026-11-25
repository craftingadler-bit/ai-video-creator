// Einzelbilder aus scenes.html, ohne zu rendern: node kit/shot.mjs reels/<slug> 3.2 7 12.5
// Speichert reels/<slug>/check/shot_<t>.png und ein Übersichtsbild shots.png (nebeneinander)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const [d, ...ts] = process.argv.slice(2);
if (!d || !ts.length) { console.error('Nutzung: node kit/shot.mjs reels/<slug> <sekunde> [<sekunde> …]'); process.exit(1); }
const dir = path.resolve(d), out = path.join(dir, 'check'); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
p.on('pageerror', e => console.error('Fehler in scenes.html:', e.message));
p.on('console', m => m.type() === 'warning' && console.log('  Warnung:', m.text()));
await p.addInitScript(() => { window.__RENDER = true; });
await p.goto(pathToFileURL(path.join(dir, 'scenes.html')).href);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
await p.evaluate(() => document.fonts && document.fonts.ready);
const files = [];
for (const t of ts) { await p.evaluate(t => window.__seek(t), +t); const f = path.join(out, `shot_${t}.png`); await p.screenshot({ path: f }); files.push(f); }
await b.close();
const inputs = files.flatMap(f => ['-i', f]);
spawnSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', files.map((_, i) => `[${i}]scale=360:640[v${i}]`).join(';') + ';' + files.map((_, i) => `[v${i}]`).join('') + `hstack=${files.length}`, path.join(out, 'shots.png')].map(String).filter(x => !(files.length === 1 && x.includes('hstack'))));
console.log('→', path.relative(process.cwd(), path.join(out, files.length > 1 ? 'shots.png' : `shot_${ts[0]}.png`)));
