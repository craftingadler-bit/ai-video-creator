// Ein Befehl für die ganze Pipeline: Stimme → Polish → Audio-Review → Render → Motion-Check. Stoppt beim ersten Fehler.
// Jeder Schritt merkt sich per Hash, womit er zuletzt gelaufen ist (reels/<slug>/.cache/state.json) und läuft nur,
// wenn sich davon etwas geändert hat. Ändert sich nur der Text von 1–2 Absätzen, werden nur die neu gesprochen (--redo).
// Beim Rendern werden unveränderte Frames aus dem Frame-Cache genommen (siehe render.mjs).
//
// Nutzung: node kit/run.mjs reels/<slug> [Optionen]
//   (ohne)            Entwurf: Stimme, Polish, Audio-Review, Render --draft, Check
//   --final           finales Render (30 fps). Audio-Review muss dann sauber sein, sonst Stopp vor dem Render
//   --dry             nur anzeigen, was laufen würde (und warum), nichts ausführen
//   --only render     nur diesen Schritt (voice, polish, audio, render, check)
//   --from render     ab diesem Schritt
//   --force           alles neu, ohne Cache.  --force voice,render = nur diese Schritte neu
//   --full-voice      ganzes Script neu sprechen statt einzelne Absätze
//   --fake            Stimme ohne VoiceStudio (stumm, Zeiten geschätzt). Audio-Review fällt dann weg
//   --takes N         an voice.mjs durchreichen
//   --no-asr          an audio-review.mjs durchreichen
//   --no-frame-cache  an render.mjs durchreichen
//   --keep-going      nach einem Qualitäts-Fehler (Audio-Review) trotzdem weiter
//   --clean           Cache des Reels löschen (.cache/), dann Schluss
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KIT = path.join(ROOT, 'kit');
const args = process.argv.slice(2);
const has = k => args.includes(k);
const opt = k => (has(k) ? args[args.indexOf(k) + 1] : null);
const VALUE_OPTS = ['--only', '--from', '--takes'];
const dirArg = args.find((a, i) => !a.startsWith('--') && !VALUE_OPTS.includes(args[i - 1]) && !(args[i - 1] === '--force' && /^[a-z,]+$/.test(a) && !a.includes('/')));
if (!dirArg) { console.error('Nutzung: node kit/run.mjs reels/<slug> [--final] [--dry] [--only|--from schritt] [--force [schritte]]'); process.exit(1); }
const dir = path.resolve(dirArg), rel = path.relative(process.cwd(), dir) || '.', slug = path.basename(dir);
if (!fs.existsSync(path.join(dir, 'script.md'))) { console.error('script.md fehlt in ' + rel); process.exit(1); }

const STEPS = ['voice', 'polish', 'audio', 'render', 'check'];
const FINAL = has('--final'), DRY = has('--dry'), FAKE = has('--fake'), KEEP = has('--keep-going');
const forceArg = opt('--force');
const FORCE = !has('--force') ? new Set() : forceArg && /^[a-z,]+$/.test(forceArg) && forceArg.split(',').every(s => STEPS.includes(s)) ? new Set(forceArg.split(',')) : new Set(STEPS);
const only = opt('--only'), from = opt('--from');
for (const s of [only, from]) if (s && !STEPS.includes(s)) { console.error(`Schritt "${s}" gibt es nicht. Möglich: ${STEPS.join(', ')}`); process.exit(1); }
const wanted = s => (only ? s === only : from ? STEPS.indexOf(s) >= STEPS.indexOf(from) : true);

const cacheDir = path.join(dir, '.cache'), stateFile = path.join(cacheDir, 'state.json');
if (has('--clean')) { fs.rmSync(cacheDir, { recursive: true, force: true }); console.log('Cache gelöscht: ' + path.relative(process.cwd(), cacheDir)); process.exit(0); }
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
const saveState = () => { if (DRY) return; fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(state, null, 1)); };
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

/* ---------- Hashes ---------- */
const H = (...parts) => { const h = crypto.createHash('sha1'); for (const p of parts) h.update(typeof p === 'string' || Buffer.isBuffer(p) ? p : JSON.stringify(p ?? null)).update('\0'); return h.digest('hex').slice(0, 16); };
const fileHash = f => (fs.existsSync(f) ? H(fs.readFileSync(f)) : 'fehlt');
function walk(d, skip = () => false, base = d) {
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(e => {
    const p = path.join(d, e.name), r = path.relative(base, p);
    if (skip(r, e) || e.name === '.DS_Store') return [];
    return e.isDirectory() ? walk(p, skip, base) : [r];
  });
}
const dirHash = (d, skip) => H(...walk(d, skip).map(r => r + ':' + fileHash(path.join(d, r))));
// Dateien im Reel-Ordner, die Ausgaben sind (dürfen den Render-Hash nicht beeinflussen)
const OUTPUTS = r => /^(\.cache|check|audio)(\/|$)/.test(r) || r.endsWith('.mp4') || r === '.mix.raw' || r === 'script.md' || r === 'vo.wav' || r.startsWith('timeline.');

/* ---------- script.md lesen (wie voice.mjs) ---------- */
function parseScript(md) {
  const scenes = []; let cur = null, key = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const h = line.match(/^##\s+(s\d+[a-z]?)\b(.*)$/i);
    if (h) { cur = { id: h[1].toLowerCase(), vo: '' }; scenes.push(cur); key = null; continue; }
    if (!cur) continue;
    const m = line.match(/^(VO|BILD)\s*:\s*(.*)$/i);
    if (m) { key = m[1].toLowerCase(); if (key === 'vo') cur.vo += (cur.vo ? ' ' : '') + m[2]; continue; }
    if (!line) { key = null; continue; }
    if (key === 'vo') cur.vo += ' ' + line;
  }
  return scenes.filter(s => s.vo.trim()).map(s => ({ id: s.id, vo: s.vo.trim().replace(/\s+/g, ' ') }));
}

/* ---------- Ausführen ---------- */
const log = (...a) => console.log(...a);
function exec(script, a, label) {
  log(`\n▶ ${label}: node kit/${script} ${a.join(' ')}`);
  if (DRY) return 0;
  const r = spawnSync(process.execPath, [path.join(KIT, script), ...a], { stdio: 'inherit', cwd: ROOT });
  return r.status ?? 1;
}
const fail = (step, msg) => { log(`\n✘ ${step}: ${msg}`); summary(); process.exit(1); };
const results = [];
function summary() {
  log('\n──────── Zusammenfassung ' + slug + (FINAL ? ' (final)' : ' (Entwurf)'));
  for (const r of results) log(`  ${DRY && r.icon === '✔' ? '→' : r.icon} ${r.step.padEnd(7)} ${DRY && r.icon === '✔' ? 'würde laufen: ' : ''}${r.msg}`);
}
const done = (step, icon, msg) => results.push({ step, icon, msg });
const isForced = s => FORCE.has(s);
const takes = opt('--takes') ? ['--takes', opt('--takes')] : [];
let qualityFail = false;

/* 1. Stimme */
const scenes = parseScript(fs.readFileSync(path.join(dir, 'script.md'), 'utf8'));
if (!scenes.length) fail('voice', 'keine Szenen mit "## s1 …" und "VO: …" in script.md');
const vs = cfg.voicestudio || {};
const voiceKey = H({ voice: vs.voice, model: vs.model, language: vs.language, speed: vs.speed, steps: vs.steps, seed: vs.seed, timing: cfg.timing, ids: scenes.map(s => s.id), fake: FAKE });
const sceneHash = Object.fromEntries(scenes.map(s => [s.id, H(s.vo)]));
const voOut = ['vo.wav', 'timeline.json', 'timeline.js'].every(f => fs.existsSync(path.join(dir, f)));
let voiceRan = false;
if (wanted('voice')) {
  const prev = state.voice;
  let plan, why;
  if (isForced('voice') || has('--full-voice')) { plan = 'full'; why = isForced('voice') ? '--force' : '--full-voice'; }
  else if (!voOut) { plan = 'full'; why = 'noch keine Stimme'; }
  else if (!prev) { plan = 'adopt'; why = 'vorhandene Stimme übernommen (erster Lauf mit run.mjs)'; }
  else if (prev.key !== voiceKey) { plan = 'full'; why = prev.fake !== FAKE ? (FAKE ? 'Wechsel auf --fake' : 'bisher nur --fake, jetzt echte Stimme') : 'Stimm-Einstellungen oder Szenenliste geändert'; }
  else {
    const changed = scenes.filter(s => prev.scenes[s.id] !== sceneHash[s.id]).map(s => s.id);
    if (!changed.length) { plan = 'skip'; }
    else if (changed.length <= 2 && changed.length < scenes.length && !FAKE) { plan = 'redo'; why = 'Text geändert in ' + changed.join(', '); plan = { redo: changed }; }
    else { plan = 'full'; why = `Text in ${changed.length} Szenen geändert (${changed.join(', ')})`; }
  }
  if (plan === 'skip') done('voice', '·', 'unverändert, aus dem Cache');
  else if (plan === 'adopt') { done('voice', '·', why); }
  else if (plan === 'full') {
    log(`\nStimme: ${why}`);
    if (exec('voice.mjs', [rel, ...(FAKE ? ['--fake'] : []), ...takes], 'Stimme (ganzes Script)')) fail('voice', 'voice.mjs ist abgebrochen (Meldung oben)');
    voiceRan = true; done('voice', '✔', 'neu gesprochen: ' + why);
  } else {
    log(`\nStimme: ${why} → nur diese Absätze neu`);
    for (const id of plan.redo) if (exec('voice.mjs', [rel, '--redo', id, ...takes], `Stimme ${id} neu`)) fail('voice', `voice.mjs --redo ${id} ist abgebrochen`);
    voiceRan = true; done('voice', '✔', 'neu gesprochen: ' + plan.redo.join(', ') + ' (Rest aus dem Cache)');
  }
  if (plan !== 'skip') { state.voice = { key: voiceKey, scenes: sceneHash, fake: FAKE }; saveState(); }
} else if (!voOut) fail('voice', 'noch keine Stimme, erst ohne --only/--from laufen lassen');

/* 2. Polish (läuft in voice.mjs schon mit; hier nur, wenn sich voice-polish.mjs oder config.polish geändert haben) */
const rawWav = path.join(dir, 'audio', 'vo_raw.wav');
const fakeVoice = state.voice?.fake ?? FAKE;
const polishKey = () => H(fileHash(rawWav), fileHash(path.join(dir, 'audio', 'timeline_raw.json')), cfg.polish, fileHash(path.join(KIT, 'voice-polish.mjs')));
if (wanted('polish')) {
  if (fakeVoice || !fs.existsSync(rawWav)) done('polish', '·', fakeVoice ? 'Fake-Stimme, nichts zu glätten' : 'keine Rohfassung (audio/vo_raw.wav), übersprungen');
  else {
    const k = polishKey();
    if (voiceRan && !DRY) done('polish', '✔', 'lief mit der Stimme');
    else if (state.polish === k && !isForced('polish')) done('polish', '·', 'unverändert, aus dem Cache');
    else if (!state.polish && !isForced('polish')) done('polish', '·', 'vorhandene Fassung übernommen');
    else {
      if (exec('voice-polish.mjs', [rel], 'Polish neu (voice-polish.mjs oder config.polish geändert)')) fail('polish', 'voice-polish.mjs ist abgebrochen');
      done('polish', '✔', 'neu geglättet');
    }
    if (!DRY) { state.polish = polishKey(); saveState(); }
  }
}

/* Ohne scenes.html geht es hier nicht weiter */
const scenesFile = path.join(dir, 'scenes.html');
if (!fs.existsSync(scenesFile) && ['audio', 'render', 'check'].some(wanted)) {
  done('scenes', '…', 'scenes.html fehlt: jetzt die Szenen bauen (Zeiten stehen in timeline.json), dann nochmal starten');
  summary(); process.exit(0);
}

/* 3. Audio-Review (vor dem Render, damit ein Final-Render mit kaputter Stimme gar nicht erst startet) */
const auditKey = H(fileHash(path.join(dir, 'vo.wav')), fileHash(path.join(dir, 'timeline.json')), fileHash(scenesFile), dirHash(path.join(dir, 'sfx')),
  cfg.audio, ...['audio-review.mjs', 'audio-qa.mjs', 'sfx-mix.mjs', 'runtime.js'].map(f => fileHash(path.join(KIT, f))), dirHash(path.join(KIT, 'sfx')), has('--no-asr'));
if (wanted('audio')) {
  if (fakeVoice) done('audio', '·', 'Fake-Stimme, kein Audio-Review');
  else {
    const prev = state.audio;
    let code;
    if (prev?.key === auditKey && !isForced('audio')) { code = prev.code; done('audio', code ? '✘' : '·', (code ? 'hatte !! (unverändert): ' : 'unverändert, aus dem Cache. ') + 'check/audio-report.txt'); }
    else {
      code = exec('audio-review.mjs', [rel, ...(has('--no-asr') ? ['--no-asr'] : [])], 'Audio-Review');
      if (!DRY) { state.audio = { key: auditKey, code }; saveState(); }
      done('audio', code ? '✘' : '✔', code ? 'hat !! gefunden → check/audio-report.txt' : 'sauber → check/audio-report.txt');
    }
    if (code && !DRY) {
      qualityFail = true;
      if (FINAL && !KEEP) fail('audio', 'erst die !! in check/audio-report.txt beheben, sonst lohnt das finale Render nicht (--keep-going rendert trotzdem)');
    }
  }
}

/* 4. Render */
const mp4 = path.join(dir, slug + (FINAL ? '' : '_draft') + '.mp4');
const renderKey = H(FINAL, fileHash(scenesFile), fileHash(path.join(dir, 'timeline.js')), fileHash(path.join(dir, 'vo.wav')), dirHash(dir, OUTPUTS),
  dirHash(KIT, r => r.endsWith('.mjs') && !['render.mjs', 'sfx-mix.mjs'].includes(r)), cfg.audio, cfg.audio?.music ? fileHash(path.join(ROOT, cfg.audio.music)) : '');
if (wanted('render')) {
  const prev = state.render?.[FINAL ? 'final' : 'draft'];
  if (prev === renderKey && fs.existsSync(mp4) && !isForced('render')) done('render', '·', 'unverändert, aus dem Cache: ' + path.relative(process.cwd(), mp4));
  else {
    const a = [rel, ...(FINAL ? [] : ['--draft']), ...(has('--no-frame-cache') ? ['--no-frame-cache'] : [])];
    if (exec('render.mjs', a, FINAL ? 'Render final' : 'Render Entwurf')) fail('render', 'render.mjs ist abgebrochen (Fehler in scenes.html? Meldung oben)');
    if (!DRY && !fs.existsSync(mp4)) fail('render', 'keine MP4 entstanden');
    if (!DRY) { state.render = { ...state.render, [FINAL ? 'final' : 'draft']: renderKey }; saveState(); }
    done('render', '✔', path.relative(process.cwd(), mp4));
  }
}

/* 5. Motion-Check */
if (wanted('check')) {
  if (!fs.existsSync(mp4) && !DRY) fail('check', 'keine MP4 zum Prüfen: ' + path.relative(process.cwd(), mp4));
  const k = DRY && !fs.existsSync(mp4) ? 'neu' : H(fileHash(mp4), fileHash(path.join(dir, 'timeline.json')), fileHash(path.join(KIT, 'check.mjs')));
  const report = path.join(dir, 'check', 'report.txt');
  // check.mjs nimmt sonst die neueste MP4 → Datei explizit mitgeben
  const cached = state.check === k && fs.existsSync(report) && !isForced('check');
  if (!cached) {
    if (exec('check.mjs', [rel, path.relative(ROOT, mp4)], 'Motion-Check')) fail('check', 'check.mjs ist abgebrochen');
    if (!DRY) { state.check = k; saveState(); }
  }
  if (fs.existsSync(report) && !DRY) {
    const bad = fs.readFileSync(report, 'utf8').split('\n').filter(l => l.includes('!!')).map(l => l.replace(/^\s*!!\s*/, ''));
    done('check', bad.length ? '!' : cached ? '·' : '✔', (cached ? 'unverändert, aus dem Cache. ' : '') + (bad.length ? `${bad.length}× !! in check/report.txt:` : 'alles ok'));
    bad.forEach(b => results.push({ step: '', icon: ' ', msg: '  !! ' + b }));
  }
}

summary();
if (DRY) log('\n(--dry: nichts ausgeführt)');
else if (!only || only === 'render' || only === 'check') log('\nAnschauen: check/hook.png, check/sheet_*.png' + (fakeVoice ? '' : ', check/audio-report.txt'));
process.exit(qualityFail ? 1 : 0);
