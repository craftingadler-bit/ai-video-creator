// Mix-Regeln für Soundeffekte. Von render.mjs (wirklich mischen) und audio-review.mjs (prüfen) gleich benutzt.
// Ziel (Feedback 24.11.): Sounds kurz und knackig, immer klar unter der Stimme, keine Dauerberieselung.
//   - Effekt (one-shot): 0,5 s hörbar, mit R.sfx(..., {len}) höchstens 0,8 s, Ausklang 0,1 s
//   - Atmo ({kind:'bed'} oder Datei > 4 s): max. 6 s, weich ein/aus, 24 dB unter der Stimme
//   - Pegel: während gesprochen wird mind. 15 dB unter der Stimme, in Sprechpausen mind. 12 dB darunter (Review 24.11.)
//   - automatische Sounds der Helfer (pop, whoosh, slam, drop): gleicher Sound innerhalb 1,5 s nur einmal,
//     fallen weg, wenn ein bewusst gesetzter Sound in der Nähe ist, und sind 3 dB leiser
//   - nie zwei Sounds innerhalb 0,3 s (der automatische fliegt raus)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const RULES = { oneShotLen: .5, oneShotMax: .8, fade: .1, bedLen: 6, bedFade: .5, overSpeech: -15, inPause: -12, bedUnder: -24, autoExtra: -3, autoGap: 1.5, minGap: .3 };

export function readMono(file, sr) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', String(sr), '-'], { maxBuffer: 1 << 30 });
  const b = r.stdout, f = new Float32Array(b.length / 2); for (let i = 0; i < f.length; i++) f[i] = b.readInt16LE(i * 2) / 32768; return f;
}
export function frameDb(x, sr) { const F = sr / 100, n = Math.floor(x.length / F), d = new Float32Array(n); for (let i = 0; i < n; i++) { let q = 0; for (let j = 0; j < F; j++) q += x[i * F + j] ** 2; d[i] = 10 * Math.log10(q / F + 1e-12); } return d; }
const peakIn = (db, t0, t1) => { let m = -120; for (let i = Math.max(0, Math.floor(t0 * 100)); i < Math.min(db.length, Math.ceil(t1 * 100)); i++) m = Math.max(m, db[i]); return m; };

/* Datei-Infos: Spitze, hörbare Länge (bis 30 dB unter Spitze), Einsatz */
export function sfxInfo(dir, root, name, sr = 16000) {
  const f = [path.join(dir, 'sfx', name + '.wav'), path.join(root, 'kit', 'sfx', name + '.wav')].find(fs.existsSync);
  if (!f) return null;
  const db = frameDb(readMono(f, sr), sr), pk = Math.max(...db);
  let last = 0; for (let i = 0; i < db.length; i++) if (db[i] > pk - 30) last = i;
  let first = 0; while (first < db.length && db[first] < pk - 30) first++;
  return { file: f, pk, len: (last + 1) / 100, onset: first / 100 };
}

/* Plan: für jeden Sound Verstärkung, Länge, Ausblenden – oder warum er wegfällt */
export function plan(SFX, words, voiceDb, info, base = .35, R = RULES) {
  const wPk = words.map(w => peakIn(voiceDb, w.start, w.end)).sort((a, b) => a - b), vMed = wPk[Math.floor(wPk.length / 2)];
  const list = SFX.map(s => ({ ...s })).sort((a, b) => a.t - b.t);
  const lastAuto = {};
  for (const s of list) {
    const I = info(s.name); if (!I) { s.drop = 'Datei fehlt'; continue; }
    s.bed = s.kind === 'bed' || I.len > 4;
    if (s.auto) {
      if (lastAuto[s.name] != null && s.t - lastAuto[s.name] < R.autoGap) { s.drop = `gleicher Auto-Sound vor ${(s.t - lastAuto[s.name]).toFixed(1)} s`; continue; }
      if (list.some(o => !o.auto && !o.bed && o !== s && Math.abs(o.t - s.t) < .45 && !o.drop)) { s.drop = 'bewusst gesetzter Sound in der Nähe'; continue; }
      lastAuto[s.name] = s.t;
    }
  }
  // Mindestabstand: zwei Effekte innerhalb minGap → den automatischen (oder späteren) streichen
  const kept = list.filter(s => !s.drop && !s.bed);
  for (let i = 1; i < kept.length; i++) {
    const a = kept[i - 1], b = kept[i];
    if (b.t - a.t < R.minGap && !a.drop) { const loser = b.auto || !a.auto ? b : a; loser.drop = 'zu dicht am vorherigen Sound'; }
  }
  for (const s of list) {
    if (s.drop) continue;
    const I = info(s.name);
    s.len = s.bed ? Math.min(I.len, s.len ?? R.bedLen) : Math.min(I.len, s.len ?? R.oneShotLen, R.oneShotMax);   // auch mit len nie über 0,8 s
    s.fadeIn = s.bed ? R.bedFade : 0; s.fadeOut = s.bed ? R.bedFade : Math.min(R.fade, s.len / 3);
    const t0 = s.t + I.onset, t1 = s.t + s.len, over = words.filter(w => w.end > t0 && w.start < t1);
    const voice = over.length ? Math.max(...over.map(w => peakIn(voiceDb, w.start, w.end))) : vMed;
    const want = I.pk + 20 * Math.log10(base * (s.vol ?? 1));
    let cap = s.bed ? vMed + R.bedUnder : over.length ? voice + R.overSpeech : vMed + R.inPause;
    if (s.auto) cap += R.autoExtra;
    const lvl = Math.min(want, cap);
    s.gain = 10 ** ((lvl - I.pk) / 20); s.rel = lvl - (s.bed ? vMed : voice); s.speech = over.length > 0; s.capped = want > cap + .1;
  }
  return { list, vMed };
}
