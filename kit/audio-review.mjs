// Audio-Review: misst Stimme und Sounds eines Reels, damit Claude (und Review-Agenten) beurteilen können, was man nicht hören kann.
// Nutzung: node kit/audio-review.mjs reels/<slug> [--no-asr]
// Ergebnis: reels/<slug>/check/audio-report.txt + check/edges.png (Wellenform an jedem Szenenwechsel)
//   Stimme: verschluckte/nicht erkannte Wörter (ASR), leise Wörter, Ein-/Ausblend-Effekt an Absätzen, Pausen an Szenenwechseln
//   Sounds: Länge (hörbar), Pegel im Mix gegenüber der Stimme in dem Moment, Überlappung mit Sprache, Dichte
//   Schnitte (kit/audio-qa.mjs): Geräusche im Vor-/Nachlauf, Pegel unter Raumton vor Einsätzen, langsame Absatz-Einstiege,
//     Abbrüche, Klicks, digitale Löcher, Übersteuerung
//   Video (kit/audio-qa.mjs, nur wenn <slug>.mp4 existiert): eingefrorene Bilder, Schwarzbilder, Lautheit, True Peak
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { plan, sfxInfo } from './sfx-mix.mjs';
import { seams, videoQa, pcm48 } from './audio-qa.mjs';

const args = process.argv.slice(2);
const dir = path.resolve(args.find(a => !a.startsWith('--')) || '');
const NO_ASR = args.includes('--no-asr');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const SR = 16000, F = 160;   // Stimme in 10-ms-Frames                                  // 10-ms-Frames
const out = path.join(dir, 'check'); fs.mkdirSync(out, { recursive: true });
const TL = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8'));

function pcm(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 30 });
  const b = r.stdout, f = new Float32Array(b.length / 2); for (let i = 0; i < f.length; i++) f[i] = b.readInt16LE(i * 2) / 32768; return f;
}
const frames = x => { const n = Math.floor(x.length / F), d = new Float32Array(n); for (let i = 0; i < n; i++) { let q = 0; for (let j = 0; j < F; j++) q += x[i * F + j] ** 2; d[i] = 10 * Math.log10(q / F + 1e-12); } return d; };
const rmsDb = (db, t0, t1) => { const a = Math.max(0, Math.floor(t0 * 100)), b = Math.min(db.length, Math.ceil(t1 * 100)); if (b <= a) return -120; let q = 0; for (let i = a; i < b; i++) q += 10 ** (db[i] / 10); return 10 * Math.log10(q / (b - a)); };
const peakDb = (db, t0, t1) => { let m = -120; for (let i = Math.max(0, Math.floor(t0 * 100)); i < Math.min(db.length, Math.ceil(t1 * 100)); i++) m = Math.max(m, db[i]); return m; };
const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const f1 = x => (x >= 0 ? '+' : '') + x.toFixed(1);
const L = [], flags = [];
const flag = (sev, msg) => { flags.push(`${sev} ${msg}`); };

/* ================= Stimme ================= */
const vo = pcm(path.join(dir, 'vo.wav')), vdb = frames(vo);
const W = TL.words.map(w => ({ ...w, db: rmsDb(vdb, w.start, w.end), pk: peakDb(vdb, w.start, w.end) }));
const wMed = med(W.map(w => w.pk));
L.push(`# Audio-Report ${path.basename(dir)}`, '', `## Stimme (vo.wav, ${TL.total.toFixed(1)} s, ${W.length} Wörter, ${(W.length / TL.total).toFixed(2)} Wörter/s)`);
L.push(`Median-Spitzenpegel pro Wort: ${wMed.toFixed(1)} dB (Referenz 0)`);

// ASR: welche Wörter versteht die Transkription wirklich?
let heard = null;
if (!NO_ASR) {
  try {
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(path.join(dir, 'vo.wav'))], { type: 'audio/wav' }), 'vo.wav');
    fd.append('model', 'whisper-1'); fd.append('response_format', 'verbose_json'); fd.append('timestamp_granularities[]', 'word');
    if (cfg.voicestudio.language) fd.append('language', cfg.voicestudio.language);
    const res = await fetch(cfg.voicestudio.url + '/v1/audio/transcriptions', { method: 'POST', body: fd, headers: cfg.voicestudio.apiKey ? { Authorization: 'Bearer ' + cfg.voicestudio.apiKey } : {} });
    if (res.ok) heard = (await res.json()).words || null;
  } catch (e) { L.push('(Transkription nicht erreichbar: ' + e.message + ')'); }
}
const norm = w => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
// Zahlen aus der Transkription in Wörter ("12" → twelve, "2,000" → two thousand), damit sie zum Script passen
const ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' '), TENS = ' ten twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');
const say = n => n < 20 ? ONES[n] : n < 100 ? TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '') : n < 1000 ? ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + say(n % 100) : '') : say(Math.floor(n / 1000)) + ' thousand' + (n % 1000 ? ' ' + say(n % 1000) : '');
const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
if (heard) heard = heard.flatMap(h => { const d = h.word.replace(/[,.\s]/g, ''); return /^\d{1,6}$/.test(d) ? say(+d).split(' ').map(x => ({ ...h, word: x })) : [h]; });
if (heard) {
  const A = W.map(w => norm(w.w)), B = heard.map(h => norm(h.word));
  const n = A.length, m = B.length, D = Array.from({ length: n + 1 }, () => new Float64Array(m + 1)), P = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  const sim = (a, b) => a === b ? 2 : (a.length > 2 && b.length > 2 && (a.startsWith(b) || b.startsWith(a))) ? 1 : (a.length > 5 && lev(a, b) <= 2) ? .5 : -1;
  for (let i = 1; i <= n; i++) { D[i][0] = -i; P[i][0] = 1; } for (let j = 1; j <= m; j++) { D[0][j] = -j; P[0][j] = 2; }
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) { const d = D[i - 1][j - 1] + sim(A[i - 1], B[j - 1]), u = D[i - 1][j] - 1, l = D[i][j - 1] - 1; if (d >= u && d >= l) { D[i][j] = d; P[i][j] = 0; } else if (u >= l) { D[i][j] = u; P[i][j] = 1; } else { D[i][j] = l; P[i][j] = 2; } }
  for (let i = n, j = m; i > 0 || j > 0;) { const p = i && j ? P[i][j] : i ? 1 : 2; if (p === 0) { const q = sim(A[i - 1], B[j - 1]); if (q > 0) { W[i - 1].heard = true; if (q < 1) W[i - 1].as = B[j - 1]; } i--; j--; } else if (p === 1) i--; else j--; }
  W.forEach(w => { w.heard ??= false; }); const miss = W.filter(w => !w.heard);
  L.push(`Transkription versteht ${W.length - miss.length}/${W.length} Wörter.`);
  miss.forEach(w => flag('!!', `Stimme: Wort "${w.w}" (${w.scene}, ${w.start.toFixed(2)} s) nicht verstanden → verschluckt/verlesen?`));
  W.filter(w => w.as).forEach(w => flag('!', `Stimme: "${w.w}" (${w.scene}, ${w.start.toFixed(2)} s) klingt wie "${w.as}" → Aussprache prüfen`));
}
// zu kurz / zu leise
for (const w of W) {
  const letters = norm(w.w).length, d = w.end - w.start, rel = w.pk - wMed;
  if (letters >= 5 && d < .13 && w.heard === false) flag('!!', `Stimme: "${w.w}" (${w.scene}, ${w.start.toFixed(2)} s) nur ${(d * 1000).toFixed(0)} ms lang → evtl. verschluckt`);
  if (rel < -9) flag('!!', `Stimme: "${w.w}" (${w.scene}, ${w.start.toFixed(2)} s) ${f1(rel)} dB unter Median → zu leise`);
  else if (rel < -6) flag('!', `Stimme: "${w.w}" (${w.scene}, ${w.start.toFixed(2)} s) ${f1(rel)} dB unter Median`);
}
// Szenenwechsel: Pause, Ausklang, Einstieg
L.push('', '### Szenenwechsel (Pause = Stille zwischen letztem und erstem Wort; Pegel relativ zum Median)');
const edges = [];
for (let i = 0; i < TL.scenes.length - 1; i++) {
  const a = W.filter(w => w.scene === TL.scenes[i].id), b = W.filter(w => w.scene === TL.scenes[i + 1].id);
  const la = a.slice(-2), fb = b.slice(0, 2);
  const endRel = Math.max(...la.map(w => w.pk)) - wMed, startRel = Math.max(...fb.map(w => w.pk)) - wMed;
  // Pause nach Energie messen (Wortzeiten der Transkription sind an Absätzen oft ungenau): längste Stille-Strecke an der Grenze
  const f0 = Math.max(0, Math.floor((a.at(-2) ?? a.at(-1)).end * 100)), fe = Math.min(vdb.length - 1, Math.ceil((b[1] ?? b[0]).start * 100)), thr = wMed - 30;
  let best = null, run = null;
  const runs = []; for (let f = f0; f <= fe; f++) { if (vdb[f] < thr) { run ||= { s: f, e: f }; run.e = f; } else if (run) { runs.push(run); run = null; } }
  if (run) runs.push(run);
  for (let r = runs.length - 1; r > 0; r--) { const A = runs[r - 1], B = runs[r]; let q = B.s - A.e <= 15; for (let f = A.e + 1; f < B.s && q; f++) if (vdb[f] > wMed - 20) q = false; if (q) { A.e = B.e; runs.splice(r, 1); } }
  for (const r of runs) if (!best || r.e - r.s > best.e - best.s) best = r;
  const gap = best ? (best.e - best.s + 1) / 100 : 0, cut = best ? best.s / 100 : a.at(-1).end, resume = best ? (best.e + 1) / 100 : b[0].start;
  // Ausklang: lauteste Stelle der letzten 300 ms vor der Pause, Einstieg: der ersten 300 ms danach
  // Spitze statt Mittel (S/F-Laute sind von Natur aus leise); gemessen ab dem ersten / bis zum letzten deutlich hörbaren Frame
  let on = Math.round(resume * 100); while (on < vdb.length - 1 && vdb[on] < wMed - 20) on++;
  let offF = Math.round(cut * 100); while (offF > 0 && vdb[offF] < wMed - 20) offF--;
  const tail = peakDb(vdb, offF / 100 - .3, offF / 100 + .01) - wMed, head = peakDb(vdb, on / 100, on / 100 + .3) - wMed;
  const pre = on / 100 - resume, prePk = peakDb(vdb, resume, on / 100) - wMed;
  if (pre > .12 && prePk > -28) flag('!', `Stimme: ${(pre * 1000).toFixed(0)} ms Atem/Vorgeräusch vor ${TL.scenes[i + 1].id} (${f1(prePk)} dB)`);
  edges.push({ t: cut, gap, id: TL.scenes[i].id + '→' + TL.scenes[i + 1].id });
  L.push(`${TL.scenes[i].id}→${TL.scenes[i + 1].id} @${cut.toFixed(2)} s: Pause ${gap.toFixed(2)} s · Ende "${la.map(w => w.w).join(' ')}" ${f1(endRel)} dB (Ausklang ${f1(tail)}) · Start "${fb.map(w => w.w).join(' ')}" ${f1(startRel)} dB (Einstieg ${f1(head)})`);
  if (gap < .3) flag('!!', `Stimme: Szenenwechsel ${TL.scenes[i].id}→${TL.scenes[i + 1].id} nur ${gap.toFixed(2)} s Pause → nächster Absatz kommt zu früh`);
  if (gap > .7) flag('!!', `Stimme: Szenenwechsel ${TL.scenes[i].id}→${TL.scenes[i + 1].id} @${cut.toFixed(2)} s: ${gap.toFixed(2)} s Pause → zu lang (max. 0,7)`);
  if (endRel < -6 || tail < -9) flag('!!', `Stimme: Ende von ${TL.scenes[i].id} wird leise ("${la.map(w => w.w).join(' ')}", ${f1(endRel)} dB) → klingt wie Ausblenden`);
  else if (tail < -4) flag('!', `Stimme: Ende von ${TL.scenes[i].id} etwas leise (${f1(tail)} dB)`);
  if (startRel < -6 || head < -9) flag('!!', `Stimme: Anfang von ${TL.scenes[i + 1].id} zu leise ("${fb.map(w => w.w).join(' ')}", ${f1(startRel)} dB) → klingt wie Einblenden`);
}
// Pausen innerhalb der Szenen: nach Energie (Stille unter Median −30 dB), nicht nach Wortzeiten
const innerP = [];
for (const sc of TL.scenes) {
  const ws = W.filter(w => w.scene === sc.id); let run = null;
  for (let f = Math.floor(ws[0].start * 100); f <= Math.min(vdb.length - 1, Math.ceil(ws.at(-1).end * 100)); f++) {
    if (vdb[f] < wMed - 30) { run ||= { s: f, e: f }; run.e = f; continue; }
    if (run) { const len = (run.e - run.s + 1) / 100; if (len > .25) innerP.push({ len, t: run.s / 100, sc: sc.id }); }
    run = null;
  }
}
L.push(`Pausen innerhalb von Szenen: ${innerP.length}, längste ${Math.max(0, ...innerP.map(p => p.len)).toFixed(2)} s, ${innerP.filter(p => p.len > .75).length}× über 0,75 s`);
innerP.filter(p => p.len > .9).forEach(p => flag('!', `Stimme: ${p.len.toFixed(2)} s Pause in ${p.sc} bei ${p.t.toFixed(2)} s → zu lang`));

// Schnitte & Störgeräusche (48 kHz, damit Klicks und digitale Null sichtbar bleiben)
const SQ = seams(pcm48(path.join(dir, 'vo.wav')), TL);
L.push('', `### Schnitte & Störgeräusche (Raumton ${SQ.floor.toFixed(1)} dB): ${SQ.flags.length ? SQ.flags.length + ' Befunde' : 'sauber'}`);
SQ.flags.forEach(f => { L.push(`${f.t.toFixed(2).padStart(6)} s · ${f.msg}`); flag(f.sev, 'Schnitt: ' + f.msg); });

/* ================= Sounds ================= */
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
await p.addInitScript(() => { window.__RENDER = true; });
await p.goto(pathToFileURL(path.join(dir, 'scenes.html')).href);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
const SFX = await p.evaluate(() => window.__SFX || []); await b.close();
const getInfo = nm => sfxInfo(dir, ROOT, nm), base = cfg.audio?.sfx ?? .35;
const { list: PLAN } = plan(SFX, TL.words, vdb, getInfo, base);
const kept = PLAN.filter(s => !s.drop), dropped = PLAN.filter(s => s.drop), shots = kept.filter(s => !s.bed);
L.push('', `## Sounds im Mix (${kept.length} von ${PLAN.length} gesetzten; ${(shots.length / TL.total * 60).toFixed(0)} Effekte pro Minute; Regeln: kit/sfx-mix.mjs)`);
L.push('Spalten: Zeit · Name · Länge im Mix · Pegel relativ zur Stimme · Art · Szene · Wort an der Stelle');
const sceneAt = t => (TL.scenes.find(sc => t >= sc.start && t < sc.end) || {}).id;
const wordAt = t => { const w = W.find(w => t >= w.start - .15 && t < w.end + .15); return w ? '"' + w.w + '"' : '–'; };
for (const s of kept) L.push(`${s.t.toFixed(2).padStart(6)} s · ${s.name.padEnd(10)} · ${s.len.toFixed(2)} s · ${f1(s.rel)} dB · ${s.bed ? 'Atmo' : s.auto ? 'auto' : 'gesetzt'}${s.speech ? ', über Sprache' : ''}${s.capped ? ', gedeckelt' : ''} · ${sceneAt(s.t)} · ${wordAt(s.t)}${s.why ? ' · ' + s.why : ''}`);
if (dropped.length) { L.push('', `Weggelassen (${dropped.length}):`); dropped.forEach(s => L.push(`${s.t.toFixed(2).padStart(6)} s · ${s.name} · ${s.drop}`)); }
const perMin = shots.length / TL.total * 60;
if (perMin > 30) flag('!!', `Sound: ${perMin.toFixed(0)} Effekte pro Minute → zu viele (Ziel ≤ 25)`); else if (perMin > 25) flag('!', `Sound: ${perMin.toFixed(0)} Effekte pro Minute`);
for (let t = 0; t < TL.total; t += 1) { const n = shots.filter(s => s.t >= t && s.t < t + 2).length; if (n >= 3) flag('!', `Sound: ${n} Effekte zwischen ${t.toFixed(0)} und ${(t + 2).toFixed(0)} s → dicht`); }
for (const s of kept) if (!s.bed && s.len > .6) flag('!', `Sound: "${s.name}" bei ${s.t.toFixed(2)} s ${s.len.toFixed(1)} s lang (bewusst verlängert?)`);
const beds = kept.filter(s => s.bed); if (beds.length > 1) flag('!', `Sound: ${beds.length} Atmos → höchstens eine, wenn sie einen Ort trägt`);
dropped.filter(s => !s.auto).forEach(s => flag('!', `Sound: gesetzter Sound "${s.name}" bei ${s.t.toFixed(2)} s fällt weg (${s.drop}) → im Reel entfernen oder verschieben`));

/* Wellenform an jedem Szenenwechsel (±1,2 s) als Bild für die Prüfer */
const strips = [];
edges.forEach((e, i) => {
  const f = path.join(out, `.edge${i}.png`);
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.max(0, e.t - 1.2)), '-t', '2.4', '-i', path.join(dir, 'vo.wav'),
    '-filter_complex', `volume=6,showwavespic=s=600x120:colors=0x7FD3FF:scale=sqrt,drawbox=x=300:y=0:w=2:h=120:color=red@0.8:t=fill,drawtext=text='${e.id}  Pause ${e.gap.toFixed(2)}s':x=6:y=4:fontsize=18:fontcolor=yellow`, '-frames:v', '1', f]);
  if (!fs.existsSync(f)) spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.max(0, e.t - 1.2)), '-t', '2.4', '-i', path.join(dir, 'vo.wav'),
    '-filter_complex', 'volume=6,showwavespic=s=600x120:colors=0x7FD3FF:scale=sqrt,drawbox=x=300:y=0:w=2:h=120:color=red@0.8:t=fill', '-frames:v', '1', f]);
  if (fs.existsSync(f)) strips.push(f);
});
if (strips.length) {
  spawnSync('ffmpeg', ['-v', 'error', '-y', ...strips.flatMap(f => ['-i', f]), '-filter_complex', strips.map((_, i) => `[${i}]`).join('') + `vstack=${strips.length}`, path.join(out, 'edges.png')]);
  strips.forEach(f => fs.rmSync(f, { force: true }));
  L.push('', 'Wellenform an jedem Szenenwechsel: check/edges.png (rote Linie = Ende der Szene, je 1,2 s davor und danach)');
}

/* ================= Video (ffmpeg) ================= */
const mp4 = path.join(dir, path.basename(dir) + '.mp4');
if (fs.existsSync(mp4)) {
  const V = videoQa(mp4);
  L.push('', `## Video (${path.basename(mp4)}, ${V.info.duration?.toFixed(1)} s, ${V.info.lufs ?? '?'} LUFS, True Peak ${V.info.truePeak ?? '?'} dBTP)`);
  V.flags.forEach(f => { L.push(`${f.t.toFixed(2).padStart(6)} s · ${f.msg}`); flag(f.sev, 'Video: ' + f.msg); });
  if (!V.flags.length) L.push('keine eingefrorenen Bilder, keine Schwarzbilder, Pegel ok');
} else L.push('', `## Video: ${path.basename(mp4)} noch nicht gerendert (Video-QA übersprungen)`);

const crit = flags.filter(f => f.startsWith('!!')).length;
L.push('', `## Befunde (${crit} kritisch, ${flags.length - crit} Hinweise)`, ...flags);
fs.writeFileSync(path.join(out, 'audio-report.txt'), L.join('\n') + '\n');
console.log(L.slice(0, 3).join('\n'));
console.log(`… ${crit} kritisch, ${flags.length - crit} Hinweise → ${path.relative(process.cwd(), path.join(out, 'audio-report.txt'))}`);
if (crit) { console.log('Nicht fertig: erst alle !! beheben.'); process.exitCode = 1; }
