// Stimme nachbearbeiten (läuft automatisch am Ende von voice.mjs, oder einzeln: node kit/voice-polish.mjs reels/<slug>)
// 0. Wortzeiten: optional Forced Alignment (kit/align.py, stable-ts oder WhisperX, wenn installiert), dann Absatz-Einsätze
//    aus dem Pegelverlauf lesen. Whisper setzt das erste Wort eines Absatzes oft 50–400 ms zu spät, der weiche Wortanfang
//    liegt davor. Maßgeblich ist der erste hörbare Frame des Sprachblocks.
// 1. Wort-Pegel angleichen: Wörter, die deutlich leiser sind als der Median, gezielt anheben (max. +9 dB, weiche Rampen,
//    ab dem echten Einsatz). Stille wird nicht angehoben.
// 2. Vorgeräusche (Atem, Schmatzer, OmniVoice-Artefakt am Anfang, Rest am Ende) auf Raumton absenken. Nur Blöcke, die durch
//    echte Stille (≥ 40 ms) vom Wort getrennt sind. Das Wort wird nie angefasst, Ziel ist der Raumton, nie darunter.
// 3. Pausen an Szenenwechseln auf ~0,45 s bringen, Pausen in Szenen über 0,75 s auf 0,55 s kürzen. Geschnitten/eingesetzt
//    wird nur in echter Stille mit ≥ 40 ms Abstand zur Sprache, eingesetzt wird Raumton (keine digitale Null), jeder Schnitt
//    bekommt einen Crossfade (Standard 20 ms, 15–40 ms über polish.xfade in config.json).
// Ausgang: vo.wav + timeline.json/.js (Format unverändert). Original bleibt in audio/vo_raw.wav + audio/timeline_raw.json.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
export const SR = 48000;
const FR = 480;                                             // 10-ms-Frames
const T = Object.assign({ pauseMin: .38, pauseTarget: .45, pauseMax: .62, innerMax: .75, innerTarget: .55, liftMax: 9, liftBelow: 3,
  xfade: .02, guard: .04, align: 'auto', python: 'python3' }, cfg.polish || {});
const XF = Math.round(Math.max(.015, Math.min(.04, T.xfade)) * SR), GUARD = Math.round(T.guard * 100);

export function readPcm(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error('ffmpeg konnte ' + file + ' nicht lesen: ' + r.stderr);
  const b = r.stdout, f = new Float32Array(b.length / 2); for (let i = 0; i < f.length; i++) f[i] = b.readInt16LE(i * 2) / 32768; return f;
}
export function writeWav(file, f) {
  const pcm = Buffer.alloc(f.length * 2); for (let i = 0; i < f.length; i++) pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(f[i] * 32767))), i * 2);
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40); fs.writeFileSync(file, Buffer.concat([h, pcm]));
}
export const frameDb = x => { const n = Math.floor(x.length / FR), d = new Float32Array(n); for (let i = 0; i < n; i++) { let q = 0; for (let j = 0; j < FR; j++) q += x[i * FR + j] ** 2; d[i] = 10 * Math.log10(q / FR + 1e-12); } return d; };
const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

/* Pegel-Analyse: Referenz (Median der Wortspitzen), Stille-Schwelle, Raumton, Sprachblöcke (getrennt durch ≥ 40 ms Stille) */
export function analyze(x, words) {
  const db = frameDb(x);
  const pk = w => { let m = -120; for (let i = Math.floor(w.start * 100); i < Math.min(db.length, Math.ceil(w.end * 100)); i++) m = Math.max(m, db[i]); return m; };
  const peaks = words.map(pk), ref = peaks.length ? med(peaks) : [...db].sort((a, b) => a - b)[Math.floor(db.length * .95)] ?? -20;
  const sil = Math.min(-50, ref - 30), loud = ref - 12;
  const q = [...db].filter(d => d > -100 && d < sil - 5);
  const floor = q.length > 20 ? med(q) : -100;               // −100 = Datei hat nur digitale Stille (z. B. --fake)
  const blobs = []; let b = null, quiet = 0;
  for (let f = 0; f < db.length; f++) {
    if (db[f] >= sil) { if (!b) b = { s: f, e: f, pk: -120 }; b.e = f; b.pk = Math.max(b.pk, db[f]); quiet = 0; }
    else if (b && ++quiet >= 4) { blobs.push(b); b = null; }
  }
  if (b) blobs.push(b);
  return { db, peaks, ref, sil, loud, floor, blobs };
}

/* Crossfade (gleiche Leistung) – an jedem Schnitt, damit nie eine Kante entsteht */
export function xfade(A, B, n = XF) {
  n = Math.min(n, A.length, B.length);
  const y = new Float32Array(A.length + B.length - n); y.set(A.subarray(0, A.length - n));
  for (let i = 0; i < n; i++) { const t = (i + .5) / n; y[A.length - n + i] = A[A.length - n + i] * Math.cos(t * Math.PI / 2) + B[i] * Math.sin(t * Math.PI / 2); }
  y.set(B.subarray(n), A.length); return y;
}

/* Raumton: ruhigste 200 ms echte Stille der Aufnahme (keine digitale Null), als Schleife mit Crossfades beliebig lang */
export function roomTone(x, A = analyze(x, [])) {
  const { db, floor } = A, len = Math.round(.2 * SR);
  if (floor <= -100) return n => new Float32Array(n);
  let at = -1, best = 1e9;
  for (let f = 0; f + 20 < db.length; f += 2) {
    let m = -1e9, z = false; for (let j = f; j < f + 20; j++) { m = Math.max(m, Math.abs(db[j] - floor)); if (db[j] < -100) z = true; }
    if (!z && m < best) { best = m; at = f * FR; }
  }
  if (at < 0 || best > 6) return n => new Float32Array(n);
  const rt = x.slice(at, at + len);
  return n => { let y = rt.slice(0, Math.min(n, len)); while (y.length < n) y = xfade(y, rt.slice(0, Math.min(len, n - y.length + XF))); return y.slice(0, n); };
}

/* Absatz-Einsätze aus dem Pegelverlauf: Block des ersten Worts suchen, zusammenhängende laute Blöcke davor mitnehmen
   (Wortzeiten sind zu spät), Einsatz = erster hörbarer Frame. Szene 1: kurzer Block + Lücke vor einem Wort ohne Satzzeichen
   = Geräusch (OmniVoice-Artefakt), kein Wort. Gibt pro Szene den Block-Index des Einsatzes zurück. */
function onsets(A, words, scenes) {
  const { blobs, loud } = A, res = new Map();  // A.ref wird unten gebraucht
  const wordBlob = w => blobs.filter(k => k.s <= (w.start + .1) * 100).at(-1);
  scenes.forEach((sc, si) => {
    const w0 = words.find(w => w.scene === sc); let k = wordBlob(w0) ?? blobs[0]; if (!k) return;
    let ki = blobs.indexOf(k);
    if (si === 0) {
      ki = blobs.findIndex(b => b.pk >= loud); if (ki < 0) return;
      const b0 = blobs[ki], b1 = blobs[ki + 1];
      if (b1 && b0.e - b0.s < 30 && b1.s - b0.e > 7 && b0.pk < A.ref - 5 && !/[,.;:!?—-]$/.test(w0.w)) ki++;   // leiser als ein normales Wort
    } else {
      const prevEnd = words.filter(w => w.scene === scenes[si - 1]).at(-1).end * 100;
      while (ki > 0 && blobs[ki - 1].s > prevEnd + 12 && blobs[ki - 1].pk >= loud && blobs[ki].s - blobs[ki - 1].e < 12) ki--;
      if (blobs[ki].pk < loud && blobs[ki + 1] && blobs[ki + 1].s < w0.end * 100) ki++;   // Atem vor dem Wort ist kein Einsatz
    }
    res.set(sc, ki);
  });
  return res;
}

export function polish(x, words, log = console.log) {
  words = words.map(w => ({ ...w }));
  const scenes = [...new Set(words.map(w => w.scene))];
  /* 0. Einsätze aus dem Pegel: erstes Wort jedes Absatzes beginnt dort, wo die Stimme hörbar wird */
  let A = analyze(x, words), moved = [];
  for (const [sc, ki] of onsets(A, words, scenes)) {
    const w0 = words.find(w => w.scene === sc), on = A.blobs[ki].s / 100;
    const prev = words[words.indexOf(w0) - 1];
    if (Math.abs(on - w0.start) > .02 && on < w0.end && (!prev || on > prev.end)) { moved.push(`${sc} ${((on - w0.start) * 1000).toFixed(0)} ms`); w0.start = +on.toFixed(3); }
  }
  if (moved.length) log(`  Einsätze aus dem Pegel korrigiert: ${moved.join(' · ')}`);

  /* 0b. Digitale Null (alte --redo-Pads, Vor-/Nachlauf aus voice.mjs) durch Raumton ersetzen, Rampen 5 ms */
  if (A.floor > -100) {
    const tone = roomTone(x, A), r = Math.round(.005 * SR); let filled = 0;
    for (let i = 0, run = 0; i <= x.length; i++) {
      if (i < x.length && Math.abs(x[i]) < 1 / 32768) { run++; continue; }
      if (run >= SR * .005) { const s0 = i - run, t = tone(run); for (let k = 0; k < run; k++) x[s0 + k] = t[k] * Math.min(1, (k + 1) / r, (run - k) / r); filled++; }
      run = 0;
    }
    if (filled) log(`  Raumton: ${filled} Stellen mit digitaler Stille aufgefüllt`);
  }

  /* 1. Wort-Pegel */
  let db = A.db; const ref = A.ref, peaks = A.peaks;
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

  /* 2. Vorgeräusche auf Raumton absenken (Rampen 15 ms komplett in der Stille, nie unter Raumton) */
  A = analyze(x, words); db = A.db;
  const { blobs, loud, floor } = A, target = floor <= -100 ? -100 : floor + 2;
  const duck = k => {
    let q = 0; for (let f = k.s; f <= k.e; f++) q += 10 ** (db[f] / 10); const lvl = 10 * Math.log10(q / (k.e - k.s + 1));
    const g = 10 ** (Math.max(-40, Math.min(0, target - lvl)) / 20), s0 = k.s * FR, s1 = (k.e + 1) * FR, r = Math.round(.015 * SR);
    for (let i = Math.max(0, s0 - r); i < Math.min(x.length, s1 + r); i++) { const t = i < s0 ? (s0 - i) / r : i >= s1 ? (i - s1 + 1) / r : 0; x[i] *= g + (1 - g) * Math.min(1, t); }
  };
  const on = onsets(A, words, scenes), ducked = [];
  // Atem/Schmatzer, der ohne Stille ins Wort übergeht (> 300 ms leiser Vorlauf vor dem lauten Teil): nur den Teil bis
  // 120 ms vor dem lauten Einsatz absenken (Frikativ/Plosiv davor bleibt ganz), max. −20 dB, Rampe 30 ms im Vorlauf
  const glued = k => {
    let lo = k.s; while (lo < k.e && db[lo] < loud) lo++;
    const end = lo - 12; if (end - k.s < 18) return;
    let q = 0; for (let f = k.s; f < end; f++) q += 10 ** (db[f] / 10); const lvl = 10 * Math.log10(q / (end - k.s));
    const g = 10 ** (Math.max(-20, Math.min(0, target + 4 - lvl)) / 20); if (g > .7) return;
    const s0 = k.s * FR, s1 = (end - 3) * FR, r = 3 * FR;
    for (let i = Math.max(0, s0 - r); i < Math.min(x.length, s1 + r); i++) { const t = i < s0 ? (s0 - i) / r : i >= s1 ? (i - s1 + 1) / r : 0; x[i] *= g + (1 - g) * Math.min(1, t); }
    ducked.push({ s: k.s, glued: true });
  };
  scenes.forEach((sc, si) => {
    const ki = on.get(sc); if (ki == null) return;
    glued(blobs[ki]);
    if (si === 0) { for (let j = 0; j < ki; j++) { duck(blobs[j]); ducked.push(blobs[j]); } return; }
    const prevEnd = words.filter(w => w.scene === scenes[si - 1]).at(-1).end * 100;
    for (let j = ki - 1; j >= 0 && blobs[j].s > prevEnd + 12; j--)
      if (blobs[j].pk < loud && blobs[ki].s - blobs[j].e >= GUARD) { duck(blobs[j]); ducked.push(blobs[j]); }
  });
  const lastW = words.at(-1), lastB = blobs.findLastIndex(k => k.s <= lastW.end * 100 && k.pk >= loud);
  if (lastB >= 0) for (const k of blobs.slice(lastB + 1)) if (k.pk < loud && k.s - blobs[lastB].e >= GUARD) { duck(k); ducked.push(k); }
  if (ducked.length) log(`  Vorgeräusche: ${ducked.length} Blöcke abgesenkt (Raumton ${floor.toFixed(0)} dB): ${ducked.map(k => (k.s / 100).toFixed(2) + ' s' + (k.glued ? ' (vor dem Wort)' : '')).join(', ')}`);

  /* 3. Pausen: nur in echter Stille schneiden/einsetzen, Raumton statt Null, Crossfade an jedem Schnitt */
  db = frameDb(x);
  const speech = ref - 30;                                   // darunter = Pause
  const edits = [], warn = [];
  const runsIn = (f0, f1) => { const r = []; let run = null; for (let f = f0; f <= f1; f++) { if (db[f] < speech) { run ||= { s: f, e: f }; run.e = f; } else if (run) { r.push(run); run = null; } } if (run) r.push(run); return r; };
  const longest = rs => rs.reduce((b, r) => !b || r.e - r.s > b.e - b.s ? r : b, null);
  for (let k = 0; k < scenes.length - 1; k++) {
    const As = words.filter(w => w.scene === scenes[k]), Bs = words.filter(w => w.scene === scenes[k + 1]);
    const f0 = Math.max(0, Math.floor((As.at(-2) ?? As.at(-1)).end * 100)), f1 = Math.min(db.length - 1, Math.ceil((Bs[1] ?? Bs[0]).start * 100));
    const pure = runsIn(f0, f1), runs = pure.map(r => ({ ...r }));
    // kurze leise Unterbrechungen (abgesenkter Atem, < 150 ms, unter ref−20) gehören zur Pause
    for (let r = runs.length - 1; r > 0; r--) {
      const a = runs[r - 1], b = runs[r]; let quietGap = b.s - a.e <= 15;
      for (let f = a.e + 1; f < b.s && quietGap; f++) if (db[f] > ref - 20) quietGap = false;
      if (quietGap) { a.e = b.e; runs.splice(r, 1); }
    }
    const best = longest(runs), gap = best ? (best.e - best.s + 1) / 100 : 0;
    const id = scenes[k] + '→' + scenes[k + 1];
    if (best) {                                              // Wortzeiten an der Grenze auf die echte Stille ziehen
      const cut = best.s / 100, resume = (best.e + 1) / 100;
      if (As.at(-1).end > cut && As.at(-1).start < cut) As.at(-1).end = +cut.toFixed(3);
      if (Bs[0].start < resume && Bs[0].end > resume) Bs[0].start = +resume.toFixed(3);
    }
    let delta = gap < T.pauseMin ? T.pauseTarget - gap : gap > T.pauseMax ? -(gap - T.pauseTarget) : 0;
    if (Math.abs(delta) <= .02) continue;
    // Schnittstelle = Mitte der längsten reinen Stille in der Pause, mit ≥ 40 ms Abstand zur Sprache auf beiden Seiten
    const p = longest(pure.filter(r => !best || (r.s >= best.s && r.e <= best.e)));
    const room = p ? (p.e - p.s + 1 - 2 * GUARD) / 100 : -1;
    if (room < 0 && delta > 0 && p && p.e - p.s + 1 >= 4) warn.push(`${id}: nur ${((p.e - p.s + 1) / 100).toFixed(2)} s Stille, Pause trotzdem eingesetzt (enger Schnitt) → im Audio-Review anhören`);
    else if (room < 0) { warn.push(`${id}: nur ${gap.toFixed(2)} s Stille, kein sauberer Schnitt möglich → --redo ${scenes[k + 1]} oder Satzende im Script prüfen`); continue; }
    if (delta < 0 && -delta > room) { warn.push(`${id}: Pause nur um ${room.toFixed(2)} statt ${(-delta).toFixed(2)} s gekürzt (Atem in der Pause)`); delta = -room; }
    if (Math.abs(delta) > .02) edits.push({ at: (p.s + p.e + 1) / 200, delta, id, gap });
  }
  // Pausen innerhalb einer Szene: länger als innerMax → auf innerTarget kürzen (Mitte der Stille rausschneiden)
  for (const sc of scenes) {
    const ws = words.filter(w => w.scene === sc);
    for (const r of runsIn(Math.floor(ws[0].start * 100), Math.min(db.length - 1, Math.ceil(ws.at(-1).end * 100)))) {
      const len = (r.e - r.s + 1) / 100, at = (r.s + r.e + 1) / 200;
      if (len > T.innerMax && r.e < Math.ceil(ws.at(-1).end * 100) - 1 && !edits.some(e => Math.abs(e.at - at) < .5)) edits.push({ at, delta: -(len - T.innerTarget), id: sc + ' innen', gap: len });
    }
  }
  edits.sort((a, b) => a.at - b.at);
  if (edits.length) {
    const tone = roomTone(x, { db, floor });
    let y = new Float32Array(0), pos = 0;
    for (const e of edits) {
      const c = Math.round(e.at * SR);
      if (e.delta > 0) { y = xfade(y, x.subarray(pos, c)); y = xfade(y, tone(Math.round(e.delta * SR) + 2 * XF)); pos = c; }
      else { const cut = Math.round(-e.delta * SR), s0 = c - Math.floor(cut / 2); y = xfade(y, x.subarray(pos, s0 + XF)); pos = s0 + cut; }
    }
    x = xfade(y, x.subarray(pos));
    for (const w of words) { const sh = edits.filter(e => e.at <= w.start).reduce((a, e) => a + e.delta, 0); w.start = +(w.start + sh).toFixed(3); w.end = +(w.end + sh).toFixed(3); }
    log('  Pausen: ' + edits.map(e => `${e.id} ${e.gap.toFixed(2)}→${(e.gap + e.delta).toFixed(2)} s`).join(' · ') + ` (Raumton, Crossfade ${(XF / SR * 1000).toFixed(0)} ms)`);
  } else log('  Pausen: alle Szenenwechsel ok');
  warn.forEach(m => log('  ! ' + m));
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

/* Optional: Forced Alignment über kit/align.py (stable-ts oder WhisperX). Ohne Paket → null, dann bleiben die Whisper-Zeiten.
   Ergebnis wird in audio/timeline_aligned.json gecacht (gilt, solange vo_raw.wav gleich bleibt). */
export function forceAlign(dir, wav, words, log = console.log) {
  if (T.align === false || T.align === 'off') return null;
  const st = fs.statSync(wav), key = `${st.size}-${Math.round(st.mtimeMs)}-${words.length}`, cache = path.join(dir, 'audio', 'timeline_aligned.json');
  try { const c = JSON.parse(fs.readFileSync(cache, 'utf8')); if (c.key === key) { log(`  Wortzeiten: Forced Alignment (${c.engine}, Cache)`); return c.words; } } catch {}
  const inp = path.join(dir, 'audio', '.align_in.json');
  fs.writeFileSync(inp, JSON.stringify({ language: cfg.voicestudio?.language || 'en', words: words.map(w => ({ w: w.w, scene: w.scene, start: w.start, end: w.end })) }));
  const r = spawnSync(T.python, [path.join(ROOT, 'kit', 'align.py'), wav, inp], { encoding: 'utf8', maxBuffer: 1 << 26, timeout: 20 * 60e3 });
  fs.rmSync(inp, { force: true });
  if (r.status !== 0) { log(`  Wortzeiten: Whisper (Forced Alignment nicht verfügbar: ${(r.stderr || r.error?.message || '').trim().split('\n').at(-1)})`); return null; }
  let res; try { res = JSON.parse(r.stdout); } catch { log('  Wortzeiten: Whisper (Alignment-Ausgabe unlesbar)'); return null; }
  const dur = st.size / 2 / SR, out = words.map((w, i) => ({ ...w, start: +(+res.words?.[i]?.start).toFixed(3), end: +(+res.words?.[i]?.end).toFixed(3) }));
  // Plausibilität: gleiche Wortzahl, aufsteigend, in der Datei, im Mittel nah an Whisper
  const ok = res.words?.length === words.length && out.every((w, i) => isFinite(w.start) && w.end >= w.start && w.end <= dur + .1 && (!i || w.start >= out[i - 1].start - .01))
    && med(out.map((w, i) => Math.abs(w.start - words[i].start))) < .5;
  if (!ok) { log(`  Wortzeiten: Whisper (Alignment mit ${res.engine} unplausibel, verworfen)`); return null; }
  fs.writeFileSync(cache, JSON.stringify({ key, engine: res.engine, words: out }));
  log(`  Wortzeiten: Forced Alignment (${res.engine})`);
  return out;
}

export function polishDir(dir, log = console.log) {
  const raw = path.join(dir, 'audio', 'vo_raw.wav'), rawTl = path.join(dir, 'audio', 'timeline_raw.json');
  fs.mkdirSync(path.join(dir, 'audio'), { recursive: true });
  if (!fs.existsSync(raw)) { fs.copyFileSync(path.join(dir, 'vo.wav'), raw); fs.copyFileSync(path.join(dir, 'timeline.json'), rawTl); }
  const tl = JSON.parse(fs.readFileSync(rawTl, 'utf8'));
  const aligned = forceAlign(dir, raw, tl.words, log);
  const { x, words } = polish(readPcm(raw), aligned || tl.words, log);
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
