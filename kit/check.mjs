// Motion-Check: Kontaktabzüge + Messwerte, damit Claude das fertige Reel "anschauen" kann
// Nutzung: node kit/check.mjs reels/<slug> [datei.mp4]
// Ergebnis: reels/<slug>/check/hook.png (erste 3 s, alle 0,25 s), sheet_XX.png (alle 0,5 s), report.txt
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = path.resolve(process.argv[2] || '');
const slug = path.basename(dir);
const file = process.argv[3] ? path.resolve(process.argv[3]) : [slug + '.mp4', slug + '_draft.mp4'].map(f => path.join(dir, f)).filter(fs.existsSync).sort((x, y) => fs.statSync(y).mtimeMs - fs.statSync(x).mtimeMs)[0];  // neueste Datei
if (!file) { console.error('Kein MP4 gefunden. Erst rendern.'); process.exit(1); }
const out = path.join(dir, 'check'); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out);
const run = a => spawnSync('ffmpeg', ['-hide_banner', ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const label = "drawtext=text='%{pts\\:hms}':x=6:y=h-34:fontsize=26:fontcolor=yellow:box=1:boxcolor=black@0.7"
// brew-ffmpeg ohne freetype kennt kein drawtext -> Kacheln dann ohne Zeitstempel
const hasDrawtext = /drawtext/.test(run(['-filters']).stdout);
const lab = hasDrawtext ? label + ',' : '';

run(['-v', 'error', '-y', '-t', '3', '-i', file, '-vf', `fps=4,scale=270:480,${lab}tile=6x2`, '-frames:v', '1', path.join(out, 'hook.png')]);
run(['-v', 'error', '-y', '-i', file, '-vf', `fps=2,scale=270:480,${lab}tile=6x3`, path.join(out, 'sheet_%02d.png')]);

const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height,r_frame_rate', '-of', 'json', file], { encoding: 'utf8' });
const info = JSON.parse(probe.stdout); const v = info.streams.find(s => s.width);
const loud = run(['-i', file, '-af', 'ebur128', '-vn', '-f', 'null', '-']).stderr.match(/I:\s*(-?[\d.]+) LUFS/g);
const lufs = loud ? +loud.pop().match(/-?[\d.]+/)[0] : NaN;
// Standbild-Erkennung: Bildbereich über den Untertiteln, 4 Bilder/s, mittlere Pixeländerung
const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'fps=4,crop=1080:1250:0:0,scale=54:62,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 }).stdout;
const FS = 54 * 62, nf = Math.floor(raw.length / FS); let run0 = 0, longest = 0, longestAt = 0;
for (let i = 1; i < nf; i++) {
  let d = 0; for (let k = 0; k < FS; k++) d += Math.abs(raw[i * FS + k] - raw[(i - 1) * FS + k]);
  if (d / FS < 0.35) { run0++; if (run0 > longest) { longest = run0; longestAt = i; } } else run0 = 0;
}
const still = longest / 4, stillFrom = (longestAt - longest) / 4;
const silences = (run(['-i', file, '-af', 'silencedetect=noise=-40dB:d=0.7', '-vn', '-f', 'null', '-']).stderr.match(/silence_start: [\d.]+/g) || []).length;
const D = +info.format.duration;

const lines = [];
const ok = (cond, txt) => lines.push((cond ? '  ok   ' : '  !!   ') + txt);
lines.push(`Motion-Check ${path.basename(file)}`);
ok(v.width === 1080 && v.height === 1920, `Format ${v.width}x${v.height}`);
ok(D >= 45 && D <= 80, `Länge ${D.toFixed(1)} s (Ziel 45–75 s)`);
ok(Math.abs(lufs + 14) <= 1.5, `Lautheit ${lufs} LUFS (Ziel -14)`);
ok(silences === 0, `Stille-Stellen ≥0,7 s: ${silences}`);
ok(still <= 3, `Längstes Standbild (ohne Untertitel): ${still.toFixed(1)} s ab ${stillFrom.toFixed(1)} s (Ziel ≤3 s)`);

const tlFile = path.join(dir, 'timeline.json');
if (fs.existsSync(tlFile)) {
  const tl = JSON.parse(fs.readFileSync(tlFile, 'utf8'));
  const first = tl.words[0]; ok(first && first.start <= .6, `Erstes Wort bei ${first?.start.toFixed(2)} s (Hook sofort)`);
  const wps = tl.words.length / tl.total; ok(wps >= 2.2 && wps <= 3.4, `Sprechtempo ${wps.toFixed(2)} Wörter/s (Ziel 2,4–3,2)`);
  tl.scenes.forEach(s => { const d = s.end - s.start; if (d > 6) lines.push(`  !!   Szene ${s.id} dauert ${d.toFixed(1)} s, braucht mehrere Bildwechsel`); });
}
lines.push('', 'Jetzt anschauen: check/hook.png und check/sheet_*.png');
lines.push('Prüfen: Text in Safe Zone (x 60–960, y 180–1600)? Nichts überlappt die Untertitel? Jede Szene hat Bewegung? Gags lesbar?');
fs.writeFileSync(path.join(out, 'report.txt'), lines.join('\n'));
console.log(lines.join('\n'));
