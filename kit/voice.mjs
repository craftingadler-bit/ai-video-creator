// Voiceover über VoiceStudio: script.md -> vo.wav + timeline.json/.js (Szenen- und Wort-Zeiten)
// Nutzung: node kit/voice.mjs reels/<slug> [--fake] [--only s3] [--per-scene]
//   Standard: ganzes Script am Stück sprechen, Pausen-Marken (/ und //) werden zu Gedankenstrichen, die Pause macht die
//   Stimme selbst. Nichts wird geschnitten oder eingefügt. Dann per Wortzeiten in Szenen teilen.
//   --groups     Sinngruppen-Modus: jede Gruppe zwischen zwei Marken einzeln sprechen und mit Stille zusammensetzen
//   --fake       ohne VoiceStudio: stille Tonspur mit geschätzten Zeiten (für Layout-Tests)
//   --only s3    (--groups) die Sinngruppen dieser Szene neu sprechen (anderer Seed), Rest aus dem Cache
//   --takes 3    bis zu so viele Takes (am Stück: ganze Takes, --groups: pro Gruppe), der verständlichste gewinnt (Standard: voicestudio.takes in config.json)
//   --per-scene  alter Modus: jede Szene einzeln (klingt abgehackter)
//   --redo s11   nur diesen Absatz neu sprechen (verschluckte/verlesene Wörter) und an den Pausen davor/danach einsetzen
//   Danach läuft immer kit/voice-polish.mjs: leise Wörter anheben, Pausen an Szenenwechseln auf ~0,5 s bringen
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith('--') && !/^s\d/.test(a));
if (!dir) { console.error('Nutzung: node kit/voice.mjs reels/<slug> [--fake] [--only s3]'); process.exit(1); }
const FAKE = args.includes('--fake');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const PER_SCENE = args.includes('--per-scene');
const GROUPS = args.includes('--groups');
const TAKES = +(args.includes('--takes') ? args[args.indexOf('--takes') + 1] : 0) || 0;
const REDO = args.includes('--redo') ? args[args.indexOf('--redo') + 1] : null;
import { polishDir, rebuild } from './voice-polish.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const VS = cfg.voicestudio;
const SR = 48000;

/* ---------- script.md lesen ---------- */
function parseScript(md) {
  const scenes = []; let cur = null, key = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const h = line.match(/^##\s+(s\d+[a-z]?)\b(.*)$/i);
    if (h) { cur = { id: h[1].toLowerCase(), title: h[2].replace(/^[\s|:–-]+/, ''), vo: '', bild: '' }; scenes.push(cur); key = null; continue; }
    if (!cur) continue;
    const m = line.match(/^(VO|BILD)\s*:\s*(.*)$/i);
    if (m) { key = m[1].toLowerCase(); cur[key] += (cur[key] ? ' ' : '') + m[2]; continue; }
    if (!line) { key = null; continue; }
    if (key) cur[key] += ' ' + line;
  }
  return scenes.filter(s => s.vo.trim());
}
// Schlagwörter über mehrere Wörter (*so wie hier*) korrekt markieren
// Pausen-Marken im VO-Text: " / " = kurze Pause, " // " = lange Pause (werden nach dem Sprechen als Stille eingesetzt)
function tokensKw(vo) {
  const out = []; let inKw = false;
  for (const t of vo.trim().split(/\s+/)) {
    if (t === '/' || t === '//') { const lvl = t.length; if (out.length) out[out.length - 1].pause = Math.max(out[out.length - 1].pause || 0, lvl); else out.pauseBefore = lvl; continue; }
    const starts = t.startsWith('*'), stars = (t.match(/\*/g) || []).length;
    const kw = inKw || starts || stars > 0;
    out.push({ w: t.replace(/\*/g, ''), kw });
    if (stars % 2 === 1) inKw = !inKw;
  }
  return out;
}
const plain = vo => vo.replace(/\*/g, '').replace(/(^|\s)\/\/?(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();

/* ---------- Audio-Helfer ---------- */
function toPcm(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error('ffmpeg konnte ' + file + ' nicht lesen: ' + r.stderr);
  return r.stdout;
}
function writeWav(file, pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, pcm]));
}
const silence = sec => Buffer.alloc(Math.round(sec * SR) * 2);
const dur = pcm => pcm.length / 2 / SR;
function trimSilence(pcm, thr = 500) {           // Stille am Anfang/Ende kürzen (lässt 60 ms stehen)
  const n = pcm.length / 2; let a = 0, b = n - 1;
  while (a < n && Math.abs(pcm.readInt16LE(a * 2)) < thr) a++;
  while (b > a && Math.abs(pcm.readInt16LE(b * 2)) < thr) b--;
  const pad = Math.round(.06 * SR);
  return pcm.subarray(Math.max(0, a - pad) * 2, Math.min(n, b + pad) * 2);
}

/* ---------- VoiceStudio ---------- */
const headers = VS.apiKey ? { Authorization: 'Bearer ' + VS.apiKey } : {};
async function speak(text, out, seed = VS.seed) {
  const body = { model: VS.model || 'omnivoice', voice: VS.voice, input: text, response_format: 'wav', speed: VS.speed || 1 };
  if (VS.language) body.language = VS.language;
  if (VS.steps) body.num_step = VS.steps;            // 32 = Qualitäts-Preset von OmniVoice (Standard 16 klingt flacher)
  if (seed != null) body.seed = seed;
  if (VS.instructions) body.instructions = VS.instructions;   // OmniVoice ignoriert Freitext, nur Voice-Design-Tags
  const res = await fetch(VS.url + '/v1/audio/speech', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok || buf.subarray(0, 4).toString() !== 'RIFF') throw new Error(`VoiceStudio /v1/audio/speech ${res.status}: ${buf.toString().slice(0, 400)}`);
  fs.writeFileSync(out, buf);
}
async function wordTimes(file) {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(file)], { type: 'audio/wav' }), path.basename(file));
  fd.append('model', 'whisper-1'); fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'word');
  if (VS.language) fd.append('language', VS.language);
  try {
    const res = await fetch(VS.url + '/v1/audio/transcriptions', { method: 'POST', headers, body: fd });
    if (!res.ok) { console.warn('  ! Transkription nicht verfügbar (' + res.status + '), Wortzeiten werden geschätzt'); return null; }
    const j = await res.json();
    if (j.words?.length) return j.words.map(w => ({ start: w.start, end: w.end, w: w.word }));
    if (j.segments?.length) return j.segments.map(s => ({ start: s.start, end: s.end, seg: true, text: s.text }));
  } catch (e) { console.warn('  ! Transkription fehlgeschlagen:', e.message); }
  return null;
}

/* Wortzeiten: echte ASR-Zeiten auf die Script-Wörter legen, sonst nach Silbenlänge schätzen */
function estimate(toks, t0, t1) {
  const weight = t => Math.max(1, t.w.replace(/[^\p{L}\p{N}]/gu, '').length) + (/[.,!?:;]$/.test(t.w) ? 4 : 0);
  const total = toks.reduce((a, t) => a + weight(t), 0); let t = t0;
  return toks.map(tk => { const d = (t1 - t0) * weight(tk) / total; const w = { ...tk, start: t, end: t + d * .92 }; t += d; return w; });
}
function align(toks, asr, d) {
  if (!asr) return estimate(toks, 0, d);
  if (asr[0].seg) {                       // nur Segmente: Wörter proportional auf Segmente verteilen
    const segText = asr.map(s => s.text.trim().split(/\s+/).length), sum = segText.reduce((a, b) => a + b, 0);
    let i = 0; const out = [];
    asr.forEach((s, k) => { const n = k === asr.length - 1 ? toks.length - i : Math.round(toks.length * segText[k] / sum); out.push(...estimate(toks.slice(i, i + n), s.start, s.end)); i += n; });
    return out;
  }
  const ratio = asr.length / toks.length;
  if (Math.abs(1 - ratio) > .2) console.warn(`  ! ASR hat ${asr.length} statt ${toks.length} Wörter erkannt, Zeiten werden gemittelt`);
  return toks.map((tk, i) => { const a = asr[Math.min(asr.length - 1, Math.floor(i * ratio))]; const b = asr[Math.min(asr.length - 1, Math.floor((i + 1) * ratio - 1e-9))]; return { ...tk, start: a.start, end: Math.max(a.start + .08, b.end) }; });
}

/* ---------- Ablauf ---------- */
const scenes = parseScript(fs.readFileSync(path.join(dir, 'script.md'), 'utf8'));
if (!scenes.length) { console.error('Keine Szenen mit "## s1 …" und "VO: …" in script.md gefunden'); process.exit(1); }
fs.mkdirSync(path.join(dir, 'audio'), { recursive: true });
if (!FAKE) {
  const h = await fetch(VS.url + '/health', { headers }).catch(() => null);
  if (!h?.ok) { console.error(`VoiceStudio unter ${VS.url} nicht erreichbar. App starten oder "url" in config.json prüfen. (Test ohne Stimme: --fake)`); process.exit(1); }
  if (!VS.voice) { console.error('In config.json fehlt voicestudio.voice (Profil-ID). Liste: node kit/setup-check.mjs'); process.exit(1); }
}
const lead = cfg.timing?.leadIn ?? .25, gap = cfg.timing?.gap ?? .22, tail = cfg.timing?.tail ?? .9;

/* Ergebnis schreiben: pcm inkl. Vorlauf, Wörter mit Szene und absoluten Zeiten */
function save(pcm, words) {
  const total = +dur(pcm).toFixed(3), out = { total, scenes: [], words };
  for (const s of scenes) {
    const ws = words.filter(w => w.scene === s.id);
    out.scenes.push({ id: s.id, title: s.title, bild: s.bild, voStart: ws[0].start, voEnd: ws[ws.length - 1].end, vo: plain(s.vo) });
  }
  out.scenes.forEach((s, i) => { s.start = i ? +((out.scenes[i - 1].voEnd + s.voStart) / 2).toFixed(3) : 0; });
  out.scenes.forEach((s, i) => { s.end = out.scenes[i + 1] ? out.scenes[i + 1].start : total; });
  writeWav(path.join(dir, 'vo.wav'), pcm);
  fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(dir, 'timeline.js'), 'window.TIMELINE = ' + JSON.stringify(out) + ';\n');
  console.log(`\nfertig: vo.wav ${total.toFixed(1)} s · ${out.scenes.length} Szenen · ${words.length} Wörter${FAKE ? '  (FAKE: stumm, Zeiten geschätzt)' : ''}`);
  if (!FAKE) {                                   // Rohfassung sichern, dann nachbearbeiten (Pegel + Pausen)
    writeWav(path.join(dir, 'audio', 'vo_raw.wav'), pcm); fs.writeFileSync(path.join(dir, 'audio', 'timeline_raw.json'), JSON.stringify(out));
    console.log('Nachbearbeitung:'); polishDir(dir);
  }
}

/* Script-Wörter per Sequenz-Alignment auf die ASR-Wörter legen (robust gegen Zahlen, zusammengezogene Wörter usw.) */
const norm = w => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
function alignSeq(toks, asr) {
  const n = toks.length, m = asr.length, A = toks.map(t => norm(t.w)), B = asr.map(a => norm(a.w));
  const sim = (a, b) => a === b ? 2 : (a.length > 2 && b.length > 2 && (a.startsWith(b) || b.startsWith(a))) ? 1 : -1;
  const D = Array.from({ length: n + 1 }, () => new Float64Array(m + 1)), P = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  for (let i = 1; i <= n; i++) { D[i][0] = -i; P[i][0] = 1; }
  for (let j = 1; j <= m; j++) { D[0][j] = -j; P[0][j] = 2; }
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const d = D[i - 1][j - 1] + sim(A[i - 1], B[j - 1]), u = D[i - 1][j] - 1, l = D[i][j - 1] - 1;
    if (d >= u && d >= l) { D[i][j] = d; P[i][j] = 0; } else if (u >= l) { D[i][j] = u; P[i][j] = 1; } else { D[i][j] = l; P[i][j] = 2; }
  }
  const hit = new Array(n).fill(null);
  for (let i = n, j = m; i > 0 || j > 0;) {
    const p = i && j ? P[i][j] : i ? 1 : 2;
    if (p === 0) { if (sim(A[i - 1], B[j - 1]) > 0) hit[i - 1] = asr[j - 1]; i--; j--; } else if (p === 1) i--; else j--;
  }
  // nicht erkannte Wörter zwischen die Nachbarn interpolieren
  const res = toks.map((t, i) => hit[i] ? { ...t, start: hit[i].start, end: hit[i].end, ok: true } : { ...t });
  for (let i = 0; i < n; i++) {
    if (res[i].ok) continue;
    let k = i; while (k < n && !res[k].ok) k++;
    const t0 = i ? res[i - 1].end : (res[k]?.start ?? 0) - .3 * (k - i), t1 = k < n ? res[k].start : t0 + .3 * (k - i), step = (t1 - t0) / (k - i);
    for (let q = i; q < k; q++) { res[q].start = t0 + step * (q - i); res[q].end = t0 + step * (q - i + 1) - .02; }
    i = k - 1;
  }
  return res;
}

const allToks = [];
for (const s of scenes) {                        // "//" am Zeilenanfang = Pause vor dieser Szene
  const tk = tokensKw(s.vo);
  if (tk.pauseBefore && allToks.length) allToks[allToks.length - 1].pause = Math.max(allToks[allToks.length - 1].pause || 0, tk.pauseBefore);
  allToks.push(...tk.map(t => ({ ...t, scene: s.id })));
}

const speechText = toks => toks.map((t, i) => t.w + (t.pause && i < toks.length - 1 ? ' —' : '')).join(' ');
if (REDO) {
  const rawF = path.join(dir, 'audio', 'vo_raw.wav'), rawT = path.join(dir, 'audio', 'timeline_raw.json');
  if (!fs.existsSync(rawF)) { fs.copyFileSync(path.join(dir, 'vo.wav'), rawF); fs.copyFileSync(path.join(dir, 'timeline.json'), rawT); }
  const tl = JSON.parse(fs.readFileSync(rawT, 'utf8')), toks = allToks.filter(t => t.scene === REDO);
  if (!toks.length) { console.error('Szene ' + REDO + ' gibt es nicht'); process.exit(1); }
  const text = speechText(toks), n = Math.max(1, TAKES || 4);
  let best = null;
  for (let k = 0; k < n; k++) {
    process.stdout.write(`  ${REDO} Take ${k + 1}/${n} … `);
    const f = path.join(dir, 'audio', `redo_${REDO}_${k}.wav`); await speak(text, f, (VS.seed ?? 7) + 50 + k);
    const pcm = trimSilence(toPcm(f), 300), tmp = path.join(dir, 'audio', `redo_${REDO}.wav`); writeWav(tmp, pcm);
    const asr = await wordTimes(tmp); const words = asr && !asr[0].seg ? alignSeq(toks, asr) : estimate(toks, 0, dur(pcm));
    const hit = words.filter(w => w.ok).length; console.log(`${hit}/${toks.length} verstanden`);
    if (!best || hit > best.hit) best = { hit, pcm, words };
    if (hit === toks.length) break;
  }
  // Schnittpunkte: Mitte der Stille vor und nach dem Absatz
  const raw = toPcm(rawF), nf = Math.floor(raw.length / 2 / 480), db = new Float32Array(nf);
  for (let i = 0; i < nf; i++) { let q = 0; for (let j = 0; j < 480; j++) { const v = raw.readInt16LE((i * 480 + j) * 2) / 32768; q += v * v; } db[i] = 10 * Math.log10(q / 480 + 1e-12); }
  const peaks = tl.words.map(w => { let m = -120; for (let i = Math.floor(w.start * 100); i < Math.min(nf, Math.ceil(w.end * 100)); i++) m = Math.max(m, db[i]); return m; }).sort((a, b) => a - b);
  const thr = peaks[Math.floor(peaks.length / 2)] - 30;
  const quietMid = (t0, t1) => { let bestR = null, run = null; for (let f = Math.max(0, Math.floor(t0 * 100)); f <= Math.min(nf - 1, Math.ceil(t1 * 100)); f++) { if (db[f] < thr) { run ||= { s: f, e: f }; run.e = f; if (!bestR || run.e - run.s > bestR.e - bestR.s) bestR = { ...run }; } else run = null; } return bestR ? (bestR.s + bestR.e) / 200 : (t0 + t1) / 2; };
  const before = tl.words.filter(w => tl.scenes.findIndex(s => s.id === w.scene) < tl.scenes.findIndex(s => s.id === REDO));
  const after = tl.words.filter(w => tl.scenes.findIndex(s => s.id === w.scene) > tl.scenes.findIndex(s => s.id === REDO));
  const own = tl.words.filter(w => w.scene === REDO);
  const cutA = before.length ? quietMid((before.at(-2) ?? before.at(-1)).end, (own[1] ?? own[0]).start) : 0;
  const cutB = after.length ? quietMid((own.at(-2) ?? own.at(-1)).end, (after[1] ?? after[0]).start) : dur(raw);
  const padA = before.length ? .25 : lead, padB = after.length ? .25 : tail;
  const seg = Buffer.concat([silence(padA), best.pcm, silence(padB)]);
  const at = s => Math.round(s * SR) * 2;
  const out = Buffer.concat([raw.subarray(0, at(cutA)), seg, raw.subarray(at(cutB))]), delta = cutA + dur(seg) - cutB;
  const words = [...before, ...best.words.map(w => ({ w: w.w, kw: w.kw, scene: REDO, start: +(cutA + padA + w.start).toFixed(3), end: +(cutA + padA + w.end).toFixed(3) })),
    ...after.map(w => ({ ...w, start: +(w.start + delta).toFixed(3), end: +(w.end + delta).toFixed(3) }))];
  writeWav(rawF, out); fs.writeFileSync(rawT, JSON.stringify(rebuild(tl, words, dur(out))));
  console.log(`  ${REDO} ersetzt (${best.hit}/${toks.length} verstanden). Nachbearbeitung:`);
  polishDir(dir);
  process.exit(0);
}
if (FAKE) {
  const words = []; let t = lead;
  for (const s of scenes) {
    const toks = allToks.filter(w => w.scene === s.id);
    const d = .25 + toks.length * .36 + (s.vo.match(/[.,!?:;]/g) || []).length * .18;
    words.push(...estimate(toks, t + .05, t + d - .05).map(w => ({ w: w.w, kw: w.kw, scene: s.id, start: +w.start.toFixed(3), end: +w.end.toFixed(3) })));
    t += d + gap;
  }
  save(Buffer.concat([silence(t - gap + tail)]), words);
} else if (PER_SCENE) {
  const parts = [], words = []; let t = lead;
  for (const s of scenes) {
    const toks = tokensKw(s.vo), file = path.join(dir, 'audio', s.id + '.wav');
    if (!ONLY || ONLY === s.id || !fs.existsSync(file)) { process.stdout.write(`  ${s.id}: spreche … `); await speak(plain(s.vo), file); }
    else process.stdout.write(`  ${s.id}: vorhanden … `);
    const pcm = trimSilence(toPcm(file)), tmp = path.join(dir, 'audio', s.id + '.trim.wav'); writeWav(tmp, pcm);
    const ws = align(toks, await wordTimes(tmp), dur(pcm));
    console.log(`${s.id}: ${dur(pcm).toFixed(2)} s, ${toks.length} Wörter`);
    words.push(...ws.map(w => ({ w: w.w, kw: w.kw, scene: s.id, start: +(t + w.start).toFixed(3), end: +(t + w.end).toFixed(3) })));
    parts.push(pcm); t += dur(pcm) + gap;
  }
  save(Buffer.concat([silence(lead), ...parts.flatMap((p, i) => i < parts.length - 1 ? [p, silence(gap)] : [p]), silence(tail)]), words);
} else if (!GROUPS) {
  // am Stück: Marken als Gedankenstrich ("Europe. — They"), Szenenwechsel als Absatz. Bei Tempo 1 macht OmniVoice daraus
  // echte Pausen mit natürlicher Satzmelodie. Bei höherem Tempo verschluckt es die Pausen (Länge hängt an der Textlänge).
  const speech = toks => toks.map((t, i) => t.w + (t.pause && i < toks.length - 1 ? ' —' : '')).join(' ');
  const text = scenes.map(s => speech(allToks.filter(t => t.scene === s.id))).join('\n\n');
  if (text.length > 4000) { console.error('Script zu lang für einen Rutsch (' + text.length + ' Zeichen). Kürzen oder --groups nutzen.'); process.exit(1); }
  const n = Math.max(1, TAKES || VS.takes || 1), fullFile = path.join(dir, 'audio', 'full.wav');
  let best = null;
  for (let k = 0; k < n; k++) {
    process.stdout.write(`  Take ${k + 1}/${n}: spreche am Stück (${text.length} Zeichen) … `);
    const f = path.join(dir, 'audio', `take${k + 1}.wav`), t0 = Date.now(); await speak(text, f, (VS.seed ?? 7) + k);
    const pcm = trimSilence(toPcm(f), 300); writeWav(fullFile, pcm);
    const asr = await wordTimes(fullFile);
    if (!asr || asr[0].seg) { console.error('\nTranskription mit Wortzeiten nötig. Alternativ --per-scene.'); process.exit(1); }
    const words = alignSeq(allToks, asr), hit = words.filter(w => w.ok).length;
    console.log(`${((Date.now() - t0) / 1000).toFixed(0)} s, ${hit}/${allToks.length} verstanden`);
    if (!best || hit > best.hit) best = { k, hit, pcm, words };
    if (hit === allToks.length) break;
  }
  if (n > 1) console.log(`  → Take ${best.k + 1} genommen`);
  writeWav(fullFile, best.pcm);
  for (const s of scenes) {
    const ws = best.words.filter(w => w.scene === s.id), miss = ws.filter(w => !w.ok).length;
    console.log(`  ${s.id}: ${(ws[ws.length - 1].end - ws[0].start).toFixed(2)} s, ${ws.length} Wörter${miss / ws.length > .3 ? `  ! ${miss} Wörter nicht erkannt, evtl. verlesen → neuer Take` : ''}`);
  }
  save(Buffer.concat([silence(lead), best.pcm, silence(tail)]), best.words.map(w => ({ w: w.w, kw: w.kw, scene: w.scene, start: +(lead + w.start).toFixed(3), end: +(lead + w.end).toFixed(3) })));
} else {
  // Sinngruppen: an jeder Pausen-Marke wird getrennt und jede Gruppe einzeln gesprochen. So endet jede Gruppe mit
  // natürlichem Satzende (Stimme geht runter, Atem), statt mitten im Redefluss Stille reinzuschneiden.
  // OmniVoice legt die Länge nach Textlänge fest und macht von sich aus kaum Pausen, Satzzeichen helfen da nicht.
  const P = { 1: cfg.timing?.pauseShort ?? .4, 2: cfg.timing?.pauseLong ?? .65 };
  const groups = []; let cur = [];
  allToks.forEach((t, i) => { cur.push(i); if (t.pause || i === allToks.length - 1) { groups.push({ idx: cur, pause: t.pause || 0 }); cur = []; } });
  const cdir = path.join(dir, 'audio', 'groups'); fs.mkdirSync(cdir, { recursive: true });
  // Cache nach Inhalt: gleicher Text + gleiche Stimm-Einstellungen = gleiche Datei, egal an welcher Stelle die Gruppe steht
  const hash = txt => crypto.createHash('sha1').update([VS.voice, VS.speed, VS.steps, VS.language, txt].join('|')).digest('hex').slice(0, 10);
  const n = Math.max(1, TAKES || VS.takes || 1), seed0 = VS.seed ?? 7;
  const frameDb = (pcm, i, F) => { let q = 0; for (let j = 0; j < F; j++) { const v = pcm.readInt16LE((i * F + j) * 2) / 32768; q += v * v; } return 10 * Math.log10(q / F + 1e-12); };
  // Anfang/Ende nach Energie finden (nicht nach ASR), Ausklang + Atem stehen lassen, weich ein-/ausblenden
  function shape(pcm) {
    const F = 480, nf = Math.floor(pcm.length / 2 / F); let a = 0, b = nf - 1;
    while (a < nf && frameDb(pcm, a, F) < -45) a++;
    while (b > a && frameDb(pcm, b, F) < -45) b--;
    const s0 = Math.max(0, a * F - Math.round(.03 * SR)), s1 = Math.min(pcm.length / 2, (b + 1) * F + Math.round(.14 * SR));
    const out = Buffer.from(pcm.subarray(s0 * 2, s1 * 2)), len = out.length / 2, fi = Math.round(.012 * SR), fo = Math.round(.06 * SR);
    for (let i = 0; i < len; i++) { const g = Math.min(1, i / fi, (len - 1 - i) / fo); if (g < 1) out.writeInt16LE(Math.round(out.readInt16LE(i * 2) * g), i * 2); }
    return out;
  }
  const pieces = [];
  for (const g of groups) {
    const toks = g.idx.map(i => allToks[i]), text = plain(toks.map(t => t.w).join(' ')), f = path.join(cdir, hash(text) + '.wav');
    const force = ONLY && toks.some(t => t.scene === ONLY);
    if (!force && fs.existsSync(f)) { pieces.push(shape(toPcm(f))); continue; }
    let best = null;
    for (let k = 0; k < n; k++) {
      const tf = path.join(cdir, `take_${k}.wav`);
      await speak(text, tf, seed0 + k + (force ? 100 : 0));
      const asr = await wordTimes(tf), hit = asr && !asr[0].seg ? alignSeq(toks, asr).filter(w => w.ok).length : 0;
      if (!best || hit > best.hit) best = { hit, tf };
      if (hit === toks.length) break;
    }
    fs.copyFileSync(best.tf, f);
    console.log(`  ${toks[0].scene} · ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}  ${best.hit}/${toks.length}`);
    pieces.push(shape(toPcm(f)));
  }
  // zusammensetzen: nach jeder Gruppe Pause in der Länge der Marke (Ausklang der Gruppe zählt mit)
  const raw = Buffer.concat(pieces.flatMap((p, i) => i < pieces.length - 1 ? [p, silence(Math.max(.05, P[groups[i].pause] - .14))] : [p]));
  const fullFile = path.join(dir, 'audio', 'full.wav'); writeWav(fullFile, raw);
  process.stdout.write('  Wortzeiten … ');
  const asr = await wordTimes(fullFile);
  if (!asr || asr[0].seg) { console.error('\nTranskription mit Wortzeiten nötig. Alternativ --per-scene.'); process.exit(1); }
  const words = alignSeq(allToks, asr), missed = words.filter(w => !w.ok).length;
  console.log(`${allToks.length - missed}/${allToks.length} zugeordnet · ${groups.length} Sinngruppen`);
  for (const s of scenes) {
    const ws = words.filter(w => w.scene === s.id), miss = ws.filter(w => !w.ok).length;
    console.log(`  ${s.id}: ${(ws[ws.length - 1].end - ws[0].start).toFixed(2)} s, ${ws.length} Wörter${miss / ws.length > .3 ? `  ! ${miss} Wörter nicht erkannt, evtl. verlesen → --only ${s.id}` : ''}`);
  }
  save(Buffer.concat([silence(lead), raw, silence(tail)]), words.map(w => ({ w: w.w, kw: w.kw, scene: w.scene, start: +(lead + w.start).toFixed(3), end: +(lead + w.end).toFixed(3) })));
}
