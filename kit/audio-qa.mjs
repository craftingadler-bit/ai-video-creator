// Schnitt- und Störgeräusch-Prüfung für die Stimme + ffmpeg-Video-QA. Läuft in kit/audio-review.mjs mit, einzeln:
//   node kit/audio-qa.mjs reels/<slug>                (vo.wav + timeline.json, dazu <slug>.mp4 falls vorhanden)
//   node kit/audio-qa.mjs datei.wav timeline.json     (nur Stimme)
// Stimme: Geräusche im Vor-/Nachlauf, Pegel unter Raumton vor Einsätzen, langsame Absatz-Einstiege (> 150 ms), Abbrüche,
//         Klicks, digitale Löcher (exakte Null mitten in der Aufnahme), Übersteuerung.
// Video:  eingefrorene Bilder, Schwarzbilder, Lautheit (−14 LUFS) und True Peak, Länge Bild vs. Ton.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SR = 48000, FR = 480;
export function pcm48(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 30 });
  const b = r.stdout, x = new Float32Array(b.length / 2); for (let i = 0; i < x.length; i++) x[i] = b.readInt16LE(i * 2) / 32768; return x;
}
const med = a => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)] ?? -120; };
const tt = f => (f / 100).toFixed(2) + ' s';

/* Stimme: gibt { flags: [{ sev: '!!' | '!', t (s), msg }], floor, wMed } zurück */
export function seams(x, TL) {
  const n = Math.floor(x.length / FR), db = new Float32Array(n);
  for (let i = 0; i < n; i++) { let q = 0; for (let j = 0; j < FR; j++) q += x[i * FR + j] ** 2; db[i] = 10 * Math.log10(q / FR + 1e-12); }
  const wPk = TL.words.map(w => { let m = -120; for (let i = Math.floor(w.start * 100); i < Math.min(n, Math.ceil(w.end * 100)); i++) m = Math.max(m, db[i]); return m; });
  const wMed = med(wPk), loud = wMed - 12, sil = Math.min(-50, wMed - 30);
  const fq = [...db].filter(d => d > -100 && d < sil - 5), floor = fq.length > 20 ? med(fq) : -100;   // Raumton (ohne digitale Stille)
  const flags = [], fl = (sev, f, msg) => flags.push({ sev, t: f / 100, msg });
  // Sprachblöcke, getrennt durch ≥ 40 ms Stille
  const blobs = []; let b = null, q = 0;
  for (let f = 0; f < n; f++) { if (db[f] >= sil) { if (!b) b = { s: f, e: f, pk: -120 }; b.e = f; b.pk = Math.max(b.pk, db[f]); q = 0; } else if (b && ++q >= 4) { blobs.push(b); b = null; } }
  if (b) blobs.push(b);
  if (!blobs.length) return { flags, floor, wMed };
  const w0 = TL.words[0];

  // 1. Vorlauf: Blöcke vor dem ersten echten Wort (Artefakt, Atem, Klick). Kurzer Block + Lücke vor einem Wort ohne
  //    Satzzeichen = Geräusch, nicht das Wort.
  let first = blobs.findIndex(k => k.pk >= loud);
  const B0 = blobs[first], B1 = blobs[first + 1];
  if (B0 && B1 && B0.e - B0.s < 30 && B1.s - B0.e > 7 && B0.pk < wMed - 5 && !/[,.;:!?—-]$/.test(w0.w)) first++;
  blobs.slice(0, first).filter(k => k.pk > floor + 10).forEach(k => fl('!!', k.s, `Geräusch im Vorlauf ${tt(k.s)}–${tt(k.e + 1)} (${(k.pk - wMed).toFixed(0)} dB, ${(k.e - k.s + 1) * 10} ms) vor dem ersten Wort`));
  // Nachlauf: Block > 0,4 s nach dem letzten lauten Block
  const last = blobs.findLastIndex(k => k.pk >= loud);
  blobs.slice(last + 1).filter(k => k.s - blobs[last].e > 40 && k.pk > floor + 10).forEach(k => fl('!!', k.s, `Geräusch im Nachlauf ${tt(k.s)} (${(k.pk - wMed).toFixed(0)} dB)`));

  // 2. Einsätze: Pegel unter Raumton / digitale Null direkt davor, langsamer Anstieg bei Absatz-Einstiegen
  const paraStart = new Set();
  for (const sc of TL.scenes.slice(1)) {
    const w = TL.words.find(w => w.scene === sc.id); if (!w) continue;
    let i = blobs.findLastIndex(k => k.s <= (w.start + .1) * 100); if (i < 0) continue;
    while (i > 0 && blobs[i - 1].pk >= loud && blobs[i].s - blobs[i - 1].e < 12 && blobs[i - 1].s > (sc.start ?? 0) * 100) i--;
    paraStart.add(blobs[i]);
  }
  for (const k of blobs.slice(first > 0 ? first : 1)) {
    if (floor > -100) {
      let c = 0, z = 0; for (let f = Math.max(0, k.s - 40); f < k.s; f++) { if (db[f] < -110) z++; else if (db[f] < floor - 12) c++; }
      if (c >= 3) fl('!!', k.s, `Einsatz bei ${tt(k.s)}: ${c * 10} ms davor mehr als 12 dB unter Raumton (${floor.toFixed(0)} dB) → abgesenkt/geschnitten, Wortanfang klingt abgehackt`);
      else if (z >= 3) fl('!', k.s, `Einsatz bei ${tt(k.s)}: ${z * 10} ms digitale Stille direkt davor (Raumton fehlt)`);
    }
    if (paraStart.has(k) && k.pk >= loud) {                 // vom ersten hörbaren Frame bis zur Sprechlautstärke (Median −15 dB)
      let f = k.s; while (f < k.e && db[f] < wMed - 15) f++;
      const ms = (f - k.s) * 10;
      if (ms > 250) fl('!!', k.s, `Absatz-Einstieg bei ${tt(k.s)} braucht ${ms} ms bis zur Sprechlautstärke → klingt wie Einblenden`);
      else if (ms > 150) fl('!', k.s, `Absatz-Einstieg bei ${tt(k.s)} braucht ${ms} ms bis zur Sprechlautstärke (Frikativ oder Einblenden?)`);
    }
  }

  // 3. Abbrüche (≥ 20 dB in 10 ms unter Raumton) und Klicks (Sample-Sprung in leiser Umgebung)
  for (let f = 1; f < n; f++) {
    if (db[f - 1] > -45 && db[f] < floor - 6 && db[f - 1] - db[f] > 20) fl('!!', f, `Abbruch bei ${tt(f)}: ${(db[f - 1] - db[f]).toFixed(0)} dB in 10 ms → Wortende/Atem abgeschnitten`);
    if (db[f] < -45 && (f + 1 >= n || db[f + 1] < -40) && db[f - 1] < -40) {
      let j = 0; for (let i = f * FR + 1; i < (f + 1) * FR; i++) j = Math.max(j, Math.abs(x[i] - x[i - 1]));
      // Rauschen/Frikative springen bis ~5× RMS, ein Klick deutlich mehr
      if (j > Math.max(.01, 12 * 10 ** (db[f] / 20))) fl('!!', f, `Klick bei ${tt(f)} (Sprung ${(20 * Math.log10(j)).toFixed(0)} dBFS in einem Sample, Umgebung leise)`);
    }
  }

  // 4. Digitale Löcher: exakte Null ≥ 5 ms zwischen erstem und letztem Wort (bei Raumton-Aufnahme auch am Rand ≥ 50 ms)
  const a0 = blobs[0].s * FR, a1 = (blobs.at(-1).e + 1) * FR;
  for (let i = 0, run = 0; i <= x.length; i++) {
    if (i < x.length && Math.abs(x[i]) < 1 / 32768) { run++; continue; }
    if (run) { const s = i - run, inside = s > a0 && i < a1;
      if (inside && run >= SR * .005) fl('!!', s / FR, `Digitales Loch bei ${(s / SR).toFixed(2)} s (${(run / SR * 1000).toFixed(0)} ms exakte Null mitten in der Aufnahme)`);
      else if (!inside && floor > -100 && run >= SR * .05) fl('!', s / FR, `${(run / SR * 1000).toFixed(0)} ms exakte Null bei ${(s / SR).toFixed(2)} s am Rand (Raumton fehlt)`);
      run = 0; }
  }

  // 5. Übersteuerung
  let clip = 0, run = 0, pk = 0, firstClip = -1;
  for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); pk = Math.max(pk, v); if (v >= .999) { if (++run === 3) { clip++; if (firstClip < 0) firstClip = i; } } else run = 0; }
  if (clip) fl('!!', firstClip / FR, `Übersteuert: ${clip} Stellen mit ≥ 3 Samples am Anschlag (erste bei ${(firstClip / SR).toFixed(2)} s)`);
  else if (pk > 10 ** (-1 / 20)) fl('!', 0, `Spitzenpegel ${(20 * Math.log10(pk)).toFixed(1)} dBFS (Ziel ≤ −1)`);

  // gleiche Stelle nur einmal melden
  const seen = new Set();
  return { flags: flags.sort((a, b) => a.t - b.t).filter(f => { const k = f.msg.split(' ')[0] + Math.round(f.t * 20); if (seen.has(k)) return false; seen.add(k); return true; }), floor, wMed };
}

/* Video (nur ffmpeg): eingefrorene Bilder, Schwarzbilder, Lautheit, True Peak, Länge */
export function videoQa(file) {
  const flags = [], fl = (sev, t, msg) => flags.push({ sev, t, msg }), info = {};
  const pr = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,duration', '-of', 'json', file], { encoding: 'utf8' });
  const st = JSON.parse(pr.stdout || '{}').streams || [], vD = +st.find(s => s.codec_type === 'video')?.duration, aD = +st.find(s => s.codec_type === 'audio')?.duration;
  info.duration = vD;
  if (!aD) fl('!!', 0, 'Video hat keine Tonspur');
  else if (Math.abs(vD - aD) > .1) fl('!', 0, `Bild ${vD.toFixed(2)} s, Ton ${aD.toFixed(2)} s → Längen weichen ab`);
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vf', 'scale=270:-2,freezedetect=n=-60dB:d=1.5,blackdetect=d=0.1:pix_th=0.10',
    ...(aD ? ['-af', 'ebur128=peak=true'] : ['-an']), '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const log = r.stderr || '';
  for (const m of log.matchAll(/freeze_start: ([\d.]+)[\s\S]*?freeze_duration: ([\d.]+)/g)) {
    const s = +m[1], d = +m[2];
    fl(d >= 3 ? '!!' : '!', s, `Bild steht still ab ${s.toFixed(2)} s für ${d.toFixed(1)} s → Animation hängt oder Szene zu statisch`);
  }
  const fs0 = [...log.matchAll(/freeze_start: ([\d.]+)/g)].length, fd0 = [...log.matchAll(/freeze_duration/g)].length;
  if (fs0 > fd0) { const s = +[...log.matchAll(/freeze_start: ([\d.]+)/g)].at(-1)[1]; fl(vD - s >= 3 ? '!!' : '!', s, `Bild steht still ab ${s.toFixed(2)} s bis zum Ende (${(vD - s).toFixed(1)} s)`); }
  for (const m of log.matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g)) {
    const s = +m[1], d = +m[3], edge = s < .05 || +m[2] > vD - .05;
    fl(edge && d < .3 ? '!' : '!!', s, `Schwarzbild ${s.toFixed(2)}–${(+m[2]).toFixed(2)} s (${(d * 1000).toFixed(0)} ms)${edge ? ' am Rand' : ''}`);
  }
  const I = log.match(/Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/), TP = log.match(/True peak:\s*\n\s*Peak:\s*(-?[\d.]+|-inf) dBFS/);
  if (I) { info.lufs = +I[1]; if (Math.abs(info.lufs + 14) > 1) fl('!', 0, `Lautheit ${info.lufs.toFixed(1)} LUFS (Ziel −14)`); }
  if (TP) { info.truePeak = +TP[1]; if (info.truePeak > 0) fl('!!', 0, `True Peak ${info.truePeak.toFixed(1)} dBTP → übersteuert`); else if (info.truePeak > -1) fl('!', 0, `True Peak ${info.truePeak.toFixed(1)} dBTP (Ziel ≤ −1)`); }
  return { flags: flags.sort((a, b) => a.t - b.t), info };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [a, b] = process.argv.slice(2);
  if (!a) { console.error('Nutzung: node kit/audio-qa.mjs reels/<slug>  |  node kit/audio-qa.mjs datei.wav timeline.json'); process.exit(1); }
  const isDir = fs.statSync(a).isDirectory(), wav = isDir ? path.join(a, 'vo.wav') : a, tl = isDir ? path.join(a, 'timeline.json') : b;
  const r = seams(pcm48(wav), JSON.parse(fs.readFileSync(tl, 'utf8')));
  console.log(`Stimme: Raumton ${r.floor.toFixed(1)} dB, Wort-Median ${r.wMed.toFixed(1)} dB`);
  r.flags.forEach(f => console.log(f.sev, f.msg));
  const mp4 = isDir && path.join(a, path.basename(path.resolve(a)) + '.mp4');
  if (mp4 && fs.existsSync(mp4)) { const v = videoQa(mp4); console.log(`Video: ${v.info.duration?.toFixed(1)} s, ${v.info.lufs ?? '?'} LUFS, True Peak ${v.info.truePeak ?? '?'} dBTP`); v.flags.forEach(f => console.log(f.sev, f.msg)); }
  const crit = r.flags.filter(f => f.sev === '!!').length; if (crit) process.exitCode = 1;
}
