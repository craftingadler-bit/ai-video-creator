import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseCheckReport, parseAudioReport, analyzeMotion, lamp, T } from '../kit/report.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

test('check.mjs-Report wird eingelesen', () => {
  const rows = parseCheckReport('Motion-Check x.mp4\n  ok   Format 1080x1920\n  !!   Längstes Standbild (ohne Untertitel): 3.3 s ab 75.5 s (Ziel ≤3 s)\n\nJetzt anschauen: …');
  assert.equal(rows.length, 2);
  assert.equal(rows[1].ok, false);
});

test('audio-review-Report: Befunde mit Zeit und Szene', () => {
  const txt = `# Audio-Report x\n\n## Stimme (vo.wav, 82.6 s, 190 Wörter, 2.30 Wörter/s)\nTranskription versteht 188/190 Wörter.\n\n## Sounds im Mix (15 von 15 gesetzten; 11 Effekte pro Minute)\n\n## Befunde (1 kritisch, 2 Hinweise)\n!! Stimme: Wort "College" (s7, 46.41 s) nicht verstanden → verschluckt/verlesen?\n! Stimme: "Germania." (s3, 16.41 s) klingt wie "germany" → Aussprache prüfen\n! Sound: 2 Atmos → höchstens eine\n`;
  const A = parseAudioReport(txt);
  assert.deepEqual(A.understood, [188, 190]);
  assert.equal(A.findings.length, 3);
  assert.deepEqual([A.findings[0].sev, A.findings[0].t, A.findings[0].scene], ['!!', 46.41, 's7']);
  assert.equal(A.findings[2].t, null);
});

test('Bildwechsel: Standbild-Strecke wird gefunden, auch langsame Änderung zählt', () => {
  const FS = 100, fps = 4, n = 40;   // 10 s
  const raw = new Uint8Array(FS * n);
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    // 0–2 s: harter Wechsel jede Sekunde · 2–8 s: Standbild · 8–10 s: Element wächst langsam (1 Pixel pro Frame)
    const base = t < 2 ? (Math.floor(t) % 2 ? 200 : 20) : 20;
    for (let k = 0; k < FS; k++) raw[i * FS + k] = base;
    if (t >= 8) for (let k = 0; k < (i - 32) + 1; k++) raw[i * FS + k] = 255;
  }
  const M = analyzeMotion(raw, FS, fps, 10);
  assert.ok(M.longest.d >= 5.5 && M.longest.d <= 7, 'längste Lücke ' + M.longest.d);
  assert.ok(M.longest.from >= 1 && M.longest.from <= 2.1);
  assert.ok(M.beats.some(b => b.t > 8), 'langsame Änderung ab 8 s zählt');
  assert.equal(M.over.length, 1);
});

test('Ampel', () => {
  assert.equal(lamp(2.5, ...T.beatGap), 'green');
  assert.equal(lamp(4, ...T.beatGap), 'yellow');
  assert.equal(lamp(9, ...T.beatGap), 'red');
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
test('Ende-zu-Ende: report.mjs auf einem Mini-Video', { skip: !hasFfmpeg && 'ffmpeg fehlt' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-')), slug = path.basename(dir);
  const mp4 = path.join(dir, slug + '.mp4');
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=15:d=6', '-f', 'lavfi', '-i', 'sine=f=220:d=6',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', mp4]);
  assert.equal(r.status, 0, String(r.stderr));
  fs.writeFileSync(path.join(dir, 'script.md'), '# T\n## s1 Hook\nVO: What if Rome never fell?\nBILD: x\n');
  fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify({ total: 6, scenes: [{ id: 's1', title: 'Hook', start: 0, end: 6 }], words: [] }));
  const out = spawnSync(process.execPath, [path.join(ROOT, 'kit/report.mjs'), dir], { encoding: 'utf8' });
  assert.match(out.stdout, /Qualitäts-Report/);
  const q = JSON.parse(fs.readFileSync(path.join(dir, 'check/quality.json'), 'utf8'));
  assert.equal(q.checks.find(c => c.key === 'len').status, 'red');           // 6 s ist zu kurz
  assert.equal(q.checks.find(c => c.key === 'motion').status, 'grey');       // check.mjs lief nicht
  assert.ok(fs.readFileSync(path.join(dir, 'check/report.html'), 'utf8').includes('<video'));
  fs.rmSync(dir, { recursive: true, force: true });
});
