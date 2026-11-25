// Stimme nachbearbeiten (läuft automatisch am Ende von voice.mjs, oder einzeln: node kit/voice-polish.mjs reels/<slug>)
// 1. Wort-Pegel angleichen: Wörter, die deutlich leiser sind als der Median (leiser Absatz-Einstieg, wegsackendes Satzende),
//    werden gezielt angehoben (max. +9 dB, weiche Rampen). Stille wird nicht angehoben → kein Ein-/Ausblend-Effekt mehr.
// 2. Pausen an Szenenwechseln: echte Stille zwischen zwei Absätzen messen. Zu kurz (< pauseMin) → an der leisesten Stelle
//    Stille einsetzen, zu lang (> pauseMax) → Stille in der Mitte kürzen. Nur zwischen Absätzen (Satzende, Stimme ist
//    schon unten), nie mitten im Satz. Wortzeiten werden passend verschoben.
// Ausgang: vo.wav + timeline.json/.js. Original bleibt in audio/vo_raw.wav + audio/timeline_raw.json (Polish startet immer davon).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const SR = 48000, FR = 480;                                 // 10-ms-Frames
const T = Object.assign({ pauseMin: .38, pauseTarget: .45, pauseMax: .62, innerMax: .75, innerTarget: .55, liftMax: 9, liftBelow: 3 }, cfg.polish || {});

function readPcm(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 30 });
  const b = r.stdout, f = new Float32Array(b.length / 2); for (let i = 0; i < f.length; i++) f[i] = b.readInt16LE(i * 2) / 32768; return f;
}
function writeWav(file, f) {
  const pcm = Buffer.alloc(f.length * 2); for (let i = 0; i < f.length; i++) pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(f[i] * 32767))), i * 2);
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40); fs.writeFileSync(file, Buffer.concat([h, pcm]));
}
const frameDb = x => { const n = Math.floor(x.length / FR), d = new Float32Array(n); for (let i = 0; i < n; i++) { let q = 0; for (let j = 0; j < FR; j++) q += x[i * FR + j] ** 2; d[i] = 10 * Math.log10(q / FR + 1e-12); } return d; };
const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

export function polish(x, words, log = console.log) {
  words = words.map(w => ({ ...w }));
  /* 1. Wort-Pegel */
  let db = frameDb(x);
  const pk = w => { let m = -120; for (let i = Math.floor(w.start * 100); i < Math.min(db.length, Math.ceil(w.end * 100)); i++) m = Math.max(m, db[i]); return m; };
  const peaks = words.map(pk), ref = med(peaks);
  const gainF = new Float32Array(db.length);                 // dB pro Frame
  let lifted = 0;
  words.forEach((w, i) => {
    const lift = Math.min(T.liftMax, Math.max(0, ref - T.liftBelow - peaks[i]));
    if (lift <= 0) return; lifted++;
    for (let f = Math.max(0, Math.floor(w.start * 100) - 3); f < Math.min(db.length, Math.ceil(w.end * 100) + 3); f++) gainF[f] = Math.max(gainF[f], lift);
  });
  // glätten (80 ms), Stille unter −50 dBFS nicht anheben
  const sm = new Float32Array(db.length);
  for (let i = 0; i < db.length; i++) { let s = 0, n = 0; for (let k = -4; k <= 4; k++) if (i + k >= 0 && i + k < db.length) { s += gainF[i + k]; n++; } sm[i] = db[i] < -50 ? 0 : s / n; }
  for (let i = 0; i < x.length; i++) {
    const p = i / FR - .5, a = Math.max(0, Math.min(sm.length - 1, Math.floor(p))), b = Math.min(sm.length - 1, a + 1), t = Math.max(0, Math.min(1, p - a));
    const g = sm[a] + (sm[b] - sm[a]) * t; if (g) x[i] *= 10 ** (g / 20);
  }
  log(`  Pegel: ${lifted} leise Wörter angehoben (Referenz ${ref.toFixed(1)} dB, max +${T.liftMax} dB)`);

  const scenes = [...new Set(words.map(w => w.scene))];
  /* 2. Atem/Rauschen direkt vor einem Absatz-Einstieg leiser machen (klingt sonst wie Einblenden):
     ersten lauten Frame des Absatzes suchen, alles in den 450 ms davor, was nicht laut ist, um 20 dB absenken */
  db = frameDb(x);
  const loud = ref - 12; let breaths = 0;
  for (const sc of scenes.slice(1)) {
    const w0 = words.find(w => w.scene === sc), prevEnd = words.filter(w => w.scene === scenes[scenes.indexOf(sc) - 1]).at(-1).end;
    let on = Math.max(0, Math.floor((w0.start - .1) * 100)); while (on < db.length && db[on] < loud) on++;
    const from = Math.max(Math.ceil((prevEnd + .12) * 100), on - 45), to = on - 3;
    if (to - from < 5) continue;
    let pre = 0; for (let f = from; f < to; f++) if (db[f] > ref - 45) pre++;
    if (pre < 6) continue;                                   // kein hörbares Vorgeräusch
    const s0 = from * FR, s1 = to * FR, ramp = 3 * FR;
    for (let i = s0; i < s1 + ramp && i < x.length; i++) { const g = i < s0 + ramp ? 1 - .9 * (i - s0) / ramp : i < s1 ? .1 : .1 + .9 * (i - s1) / ramp; x[i] *= g; }
    breaths++;
  }
  if (breaths) log(`  Atem vor ${breaths} Absätzen um 20 dB abgesenkt`);
  /* 3. Pausen an Szenenwechseln (nach der Atem-Absenkung messen) */
  db = frameDb(x);
  const speech = ref - 30;                                   // darunter = Pause
  const edits = [];                                          // { at (s), delta (s) }
  for (let k = 0; k < scenes.length - 1; k++) {
    const A = words.filter(w => w.scene === scenes[k]), B = words.filter(w => w.scene === scenes[k + 1]);
    // tatsächliche Stille rund um die Grenze suchen (Wortzeiten sind an Absätzen oft ungenau → Fenster vom vorletzten bis zum zweiten Wort)
    const f0 = Math.max(0, Math.floor((A.at(-2) ?? A.at(-1)).end * 100)), f1 = Math.min(db.length - 1, Math.ceil((B[1] ?? B[0]).start * 100));
    // Stille-Strecken suchen; kurze leise Unterbrechungen (Atem, < 150 ms, unter ref−20) gehören mit zur Pause
    const runs = []; let run = null;
    for (let f = f0; f <= f1; f++) { if (db[f] < speech) { run ||= { s: f, e: f }; run.e = f; } else if (run) { runs.push(run); run = null; } }
    if (run) runs.push(run);
    for (let r = runs.length - 1; r > 0; r--) {
      const a = runs[r - 1], b = runs[r]; let quietGap = b.s - a.e <= 15;
      for (let f = a.e + 1; f < b.s && quietGap; f++) if (db[f] > ref - 20) quietGap = false;
      if (quietGap) { a.e = b.e; runs.splice(r, 1); }
    }
    let best = null; for (const r of runs) if (!best || r.e - r.s > best.e - best.s) best = r;
    let gap, at;
    if (best) { gap = (best.e - best.s + 1) / 100; at = (best.s + best.e + 1) / 2 / 100; }
    else { gap = 0; let m = 1e9, mf = f0; for (let f = f0; f <= f1; f++) if (db[f] < m) { m = db[f]; mf = f; } at = mf / 100; }
    let delta = 0;
    if (gap < T.pauseMin) delta = T.pauseTarget - gap;
    else if (gap > T.pauseMax) delta = -(gap - T.pauseTarget);
    // Wortzeiten an der Grenze auf die echte Stille ziehen (erstes Wort fängt erst nach der Pause an)
    if (best) { const cut = best.s / 100, resume = (best.e + 1) / 100;
      if (A.at(-1).end > cut && A.at(-1).start < cut) A.at(-1).end = +cut.toFixed(3);
      if (B[0].start < resume && B[0].end > resume) B[0].start = +resume.toFixed(3); }
    if (Math.abs(delta) > .02) edits.push({ at, delta, id: scenes[k] + '→' + scenes[k + 1], gap });
  }
  // Pausen innerhalb einer Szene: länger als innerMax → auf innerTarget kürzen (Mitte der Stille rausschneiden)
  for (const sc of scenes) {
    const ws = words.filter(w => w.scene === sc);
    let run = null;
    for (let f = Math.floor(ws[0].start * 100); f <= Math.min(db.length - 1, Math.ceil(ws.at(-1).end * 100)); f++) {
      if (db[f] < speech) { run ||= { s: f, e: f }; run.e = f; continue; }
      if (run && (run.e - run.s + 1) / 100 > T.innerMax) {
        const len = (run.e - run.s + 1) / 100, at = (run.s + run.e + 1) / 200;
        if (!edits.some(e => Math.abs(e.at - at) < .5)) edits.push({ at, delta: -(len - T.innerTarget), id: sc + ' innen', gap: len });
      }
      run = null;
    }
  }
  edits.sort((a, b) => a.at - b.at);
  if (edits.length) {
    const parts = []; let pos = 0; const fade = Math.round(.008 * SR);
    for (const e of edits) {
      const c = Math.round(e.at * SR);
      if (e.delta > 0) {
        const head = x.slice(pos, c); for (let i = 0; i < fade && i < head.length; i++) head[head.length - 1 - i] *= i / fade;
        parts.push(head, new Float32Array(Math.round(e.delta * SR))); pos = c;
        const nx = x.subarray(c, c + fade); for (let i = 0; i < nx.length; i++) nx[i] *= i / fade;
      } else {
        const cut = Math.round(-e.delta * SR), s0 = c - Math.floor(cut / 2);
        parts.push(x.slice(pos, s0)); pos = s0 + cut;
      }
    }
    parts.push(x.slice(pos));
    const len = parts.reduce((a, p) => a + p.length, 0), y = new Float32Array(len); let o = 0; for (const p of parts) { y.set(p, o); o += p.length; }
    x = y;
    for (const w of words) { const sh = edits.filter(e => e.at <= w.start).reduce((a, e) => a + e.delta, 0); w.start = +(w.start + sh).toFixed(3); w.end = +(w.end + sh).toFixed(3); }
    log('  Pausen: ' + edits.map(e => `${e.id} ${e.gap.toFixed(2)}→${(e.gap + e.delta).toFixed(2)} s`).join(' · '));
  } else log('  Pausen: alle Szenenwechsel ok');
  return { x, words };
}

/* Timeline neu bauen (gleiche Logik wie voice.mjs save) */
export function rebuild(old, words, total) {
  const out = { total: +total.toFixed(3), scenes: [], words };
  for (const s of old.scenes) {
    const ws = words.filter(w => w.scene === s.id);
    out.scenes.push({ ...s, voStart: ws[0].start, voEnd: ws.at(-1).end });
  }
  out.scenes.forEach((s, i) => { s.start = i ? +((out.scenes[i - 1].voEnd + s.voStart) / 2).toFixed(3) : 0; });
  out.scenes.forEach((s, i) => { s.end = out.scenes[i + 1] ? out.scenes[i + 1].start : out.total; });
  return out;
}

export function polishDir(dir, log = console.log) {
  const raw = path.join(dir, 'audio', 'vo_raw.wav'), rawTl = path.join(dir, 'audio', 'timeline_raw.json');
  fs.mkdirSync(path.join(dir, 'audio'), { recursive: true });
  if (!fs.existsSync(raw)) { fs.copyFileSync(path.join(dir, 'vo.wav'), raw); fs.copyFileSync(path.join(dir, 'timeline.json'), rawTl); }
  const tl = JSON.parse(fs.readFileSync(rawTl, 'utf8'));
  const { x, words } = polish(readPcm(raw), tl.words, log);
  const out = rebuild(tl, words, x.length / SR);
  writeWav(path.join(dir, 'vo.wav'), x);
  fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(dir, 'timeline.js'), 'window.TIMELINE = ' + JSON.stringify(out) + ';\n');
  log(`  → vo.wav ${out.total.toFixed(1)} s (vorher ${tl.total.toFixed(1)} s)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const d = process.argv[2]; if (!d) { console.error('Nutzung: node kit/voice-polish.mjs reels/<slug>'); process.exit(1); }
  polishDir(path.resolve(d));
}
