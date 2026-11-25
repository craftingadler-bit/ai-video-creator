// Rendert reels/<slug>/scenes.html zu MP4 (1080x1920): Frames per Playwright, Ton = Voiceover + SFX + Musik, Lautheit -14 LUFS
// Nutzung: node kit/render.mjs reels/<slug> [--draft] [--fps 30] [--from 10 --to 20]
//   --draft  15 fps, schneller Entwurf (Datei: <slug>_draft.mp4)
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { plan, sfxInfo, frameDb } from './sfx-mix.mjs';

const args = process.argv.slice(2);
const dir = path.resolve(args.find(a => !a.startsWith('--') && isNaN(+a)) || '');
const opt = k => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const DRAFT = args.includes('--draft');
const FPS = +(opt('--fps') || (DRAFT ? 15 : 30));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const slug = path.basename(dir);
const outFile = path.join(dir, slug + (DRAFT ? '_draft' : '') + '.mp4');
const SR = 48000;
if (!fs.existsSync(path.join(dir, 'scenes.html'))) { console.error('scenes.html fehlt in ' + dir); process.exit(1); }
if (!fs.existsSync(path.join(dir, 'timeline.js'))) { console.error('timeline.js fehlt: erst node kit/voice.mjs ' + path.relative(process.cwd(), dir)); process.exit(1); }

/* ---------- Bild ---------- */
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('Fehler in scenes.html:', e.message));
await page.addInitScript(() => { window.__RENDER = true; });
await page.goto(pathToFileURL(path.join(dir, 'scenes.html')).href);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 }).catch(() => { console.error('scenes.html ruft R.start() nicht auf oder hat einen Fehler'); process.exit(1); });
await page.evaluate(() => document.fonts && document.fonts.ready);
const TOTAL = await page.evaluate(() => window.__TOTAL);
const SFX = await page.evaluate(() => window.__SFX || []);
const from = +(opt('--from') || 0), to = Math.min(TOTAL, +(opt('--to') || TOTAL));

/* ---------- Ton mischen ---------- */
function pcm(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(file + ': ' + r.stderr);
  const b = r.stdout, f = new Float32Array(b.length / 2);
  for (let i = 0; i < f.length; i++) f[i] = b.readInt16LE(i * 2) / 32768;
  return f;
}
const n = Math.ceil(TOTAL * SR), mix = new Float32Array(n);
const vo = pcm(path.join(dir, 'vo.wav')); for (let i = 0; i < Math.min(n, vo.length); i++) mix[i] += vo[i];
// Sounds nach den Mix-Regeln (kit/sfx-mix.mjs): gekürzt, unter der Stimme, automatische ausgedünnt
const WORDS = await page.evaluate(() => (window.TIMELINE || {}).words || []);
const vdb = frameDb(vo, SR), infoCache = {}, getInfo = nm => (nm in infoCache ? infoCache[nm] : (infoCache[nm] = sfxInfo(dir, ROOT, nm)));
const mixPlan = plan(SFX, WORDS, vdb, getInfo, cfg.audio?.sfx ?? .35), cache = {};
for (const c of mixPlan.list) {
  if (c.drop) continue;
  const s = (cache[c.name] ||= pcm(getInfo(c.name).file)), o = Math.round(c.t * SR), L = Math.min(s.length, Math.round(c.len * SR));
  const fi = Math.round((c.fadeIn || 0) * SR), fo = Math.max(1, Math.round((c.fadeOut || 0) * SR));
  for (let i = 0; i < L && o + i < n; i++) if (o + i >= 0) { const g = Math.min(1, fi ? i / fi : 1, (L - i) / fo); mix[o + i] += s[i] * c.gain * g; }
}
const nDrop = mixPlan.list.filter(c => c.drop).length;
console.log(`Sounds: ${mixPlan.list.length - nDrop} gemischt, ${nDrop} nach Mix-Regeln weggelassen (Details: node kit/audio-review.mjs)`);
const musicFile = ['music.mp3', 'music.wav', 'music.m4a'].map(f => path.join(dir, f)).find(fs.existsSync) || (cfg.audio?.music && path.join(ROOT, cfg.audio.music));
if (musicFile && fs.existsSync(musicFile)) {
  const m = pcm(musicFile), g = cfg.audio?.musicVol ?? .12, fade = SR * 1.5;
  for (let i = 0; i < n; i++) { const env = Math.min(1, (n - i) / fade); mix[i] += m[i % m.length] * g * env; }
}
const pcmOut = Buffer.alloc(n * 2);
for (let i = 0; i < n; i++) pcmOut.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(Math.tanh(mix[i] * 1.05) * 32767))), i * 2);
const mixFile = path.join(dir, '.mix.raw'); fs.writeFileSync(mixFile, pcmOut);

/* ---------- Lautheit: messen, Gain + Limiter, nachregeln bis -14 LUFS (single-pass loudnorm landet ~2 LU zu leise) ---------- */
const limiter = 'alimiter=limit=0.84:level=false:attack=2:release=60';
const lufsOf = af => +((spawnSync('ffmpeg', ['-hide_banner', '-ss', String(from), '-t', String(to - from), '-f', 's16le', '-ar', String(SR), '-ac', '1', '-i', mixFile,
  '-af', af + 'ebur128', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 }).stderr.match(/Integrated loudness:\s+I:\s+(-?[\d.]+)/) || [])[1] ?? NaN);
let gain = -14 - lufsOf('');
if (!isFinite(gain)) gain = 0;
for (let i = 0; i < 3; i++) {
  const out = lufsOf(`volume=${gain.toFixed(2)}dB,${limiter},`);
  if (!isFinite(out) || Math.abs(out + 14) < .3) break;
  gain += -14 - out;
}
gain = Math.max(-20, Math.min(24, gain));
const audioFilter = `volume=${gain.toFixed(2)}dB,${limiter}`;

/* ---------- ffmpeg ---------- */
const ff = spawn('ffmpeg', ['-y', '-v', 'error',
  '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-ss', String(from), '-f', 's16le', '-ar', String(SR), '-ac', '1', '-i', mixFile,
  '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', DRAFT ? 'veryfast' : 'medium', '-crf', DRAFT ? '26' : '18', '-pix_fmt', 'yuv420p',
  '-af', audioFilter, '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-t', String(to - from), '-movflags', '+faststart', outFile],
  { stdio: ['pipe', 'inherit', 'inherit'] });
const frames = Math.round((to - from) * FPS); const t0 = Date.now();
console.log(`Rendere ${slug}: ${(to - from).toFixed(1)} s, ${frames} Frames @ ${FPS} fps …`);
for (let i = 0; i < frames; i++) {
  await page.evaluate(t => window.__seek(t), from + i / FPS);
  const jpg = await page.screenshot({ type: 'jpeg', quality: DRAFT ? 80 : 93 });
  if (!ff.stdin.write(jpg)) await new Promise(r => ff.stdin.once('drain', r));
  if (i % Math.max(1, Math.round(frames / 10)) === 0) process.stdout.write(`  ${Math.round(i / frames * 100)} %\r`);
}
ff.stdin.end(); await new Promise(r => ff.on('close', r));
await browser.close(); fs.rmSync(mixFile, { force: true });
console.log(`fertig: ${path.relative(process.cwd(), outFile)} (${((Date.now() - t0) / 1000).toFixed(0)} s Renderzeit)`);
