// Qualitäts-Report: eine HTML-Seite mit Ampel pro Reel, damit man (und Claude) nur noch EINE Datei lesen muss.
// Nutzung: node kit/report.mjs reels/<slug> [datei.mp4] [--run] [--no-asr]
//   --run     vorher kit/check.mjs und kit/audio-review.mjs laufen lassen (sonst werden deren Ergebnisse nur eingelesen)
// Ergebnis: reels/<slug>/check/report.html (im Browser öffnen, Klick auf Zeitstempel/Kontaktbogen springt im Video)
//           reels/<slug>/check/quality.json (für Claude: Ampel + alle Befunde mit Zeitstempel)
// Misst selbst: Länge, Bildwechsel-Takt (Ziel: alle ~3 s passiert sichtbar was), Lautheit + True Peak.
// Liest ein: check/report.txt (check.mjs), check/audio-report.txt (audio-review.mjs), script.md (lint-script.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lintScript, pronunciationList } from './lint-script.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Ziele (Ampel). Bildwechsel: "Beat" = ≥ BEAT % der Pixel über den Untertiteln haben sich seit dem letzten Beat um > PIX Graustufen geändert.
// "harter Wechsel" = ≥ CUT % von einem Frame zum nächsten (Szenenwechsel, Übergang). Kalibriert am Capybara-Reel (findet dieselbe 3,5-s-Stelle wie check.mjs).
export const T = { len: [45, 75, 40, 80], lufs: -14, beatGap: [3, 4.5], PIX: 20, BEAT: 3, CUT: 30 };

/* ---------- Einlesen der anderen Reports (reine Funktionen, getestet) ---------- */
export function parseCheckReport(txt) {
  return txt.split(/\n/).map(l => l.match(/^\s+(ok|!!)\s+(.*)$/)).filter(Boolean).map(m => ({ ok: m[1] === 'ok', msg: m[2].trim() }));
}
export function parseAudioReport(txt) {
  const head = txt.match(/## Stimme \(([^)]*)\)/);
  const understood = txt.match(/Transkription versteht (\d+)\/(\d+)/);
  const sec = txt.split(/^## Befunde.*$/m)[1] || '';
  const findings = sec.split(/\n/).map(l => l.match(/^(!!|!)\s+(.*)$/)).filter(Boolean).map(m => {
    const t = m[2].match(/(?:\(|bei |@)(?:s\d+[a-z]?,\s*)?(\d+(?:\.\d+)?)\s*s\b/);
    const sc = m[2].match(/\((s\d+[a-z]?)[,)]/);
    return { sev: m[1], msg: m[2], t: t ? +t[1] : null, scene: sc ? sc[1] : null };
  });
  const sounds = (txt.match(/^## Sounds im Mix \(([^)]*)\)/m) || [])[1] || null;
  return { voice: head ? head[1] : null, understood: understood ? [+understood[1], +understood[2]] : null, sounds, findings };
}
// "Beats": Zeitpunkte, an denen sich das Bild sichtbar ändert (Schnitt, neues Element, Bewegung, Zoom, Länder färben sich).
// Vergleich mit dem Bild beim letzten Beat, damit auch langsame Änderungen zählen. raw = Graustufen-Frames hintereinander.
export function analyzeMotion(raw, FS, fps, total) {
  const n = Math.floor(raw.length / FS), pct = (i, j) => { let c = 0; for (let k = 0; k < FS; k++) if (Math.abs(raw[i * FS + k] - raw[j * FS + k]) > T.PIX) c++; return 100 * c / FS; };
  const beats = []; let ref = 0, lastCut = -1e9;
  for (let i = 1; i < n; i++) {
    const t = i / fps, d = pct(i, ref);
    if (d < T.BEAT) continue;
    const big = pct(i, i - 1) >= T.CUT || d >= T.CUT * 2;
    beats.push({ t, big: big && t - lastCut > 1 }); if (big) lastCut = t; ref = i;
  }
  const gaps = []; let prev = 0;
  for (const b of beats) { gaps.push({ from: prev, to: b.t, d: b.t - prev }); prev = b.t; }
  gaps.push({ from: prev, to: total, d: total - prev });
  const longest = gaps.reduce((a, g) => g.d > a.d ? g : a, { d: 0, from: 0, to: 0 });
  const bigT = beats.filter(b => b.big).map(b => b.t), iv = bigT.slice(1).map((t, i) => t - bigT[i]).sort((a, b) => a - b);
  return { beats, cuts: bigT.length, cutMedian: iv.length ? iv[Math.floor(iv.length / 2)] : null, gaps, longest, perMin: beats.length / (total / 60), over: gaps.filter(g => g.d > T.beatGap[0] + 1e-9) };
}
export const lamp = (v, green, yellow) => v <= green ? 'green' : v <= yellow ? 'yellow' : 'red';
const worst = arr => arr.includes('red') ? 'red' : arr.includes('yellow') ? 'yellow' : arr.includes('green') ? 'green' : 'grey';

/* ---------- Messen ---------- */
function measureVideo(file) {
  const probe = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height,r_frame_rate,codec_type', '-of', 'json', file], { encoding: 'utf8' }).stdout);
  const v = probe.streams.find(s => s.codec_type === 'video') || {}, hasAudio = probe.streams.some(s => s.codec_type === 'audio');
  const total = +probe.format.duration;
  const W = 108, H = 125, FS = W * H, FPS = 4;
  const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `fps=${FPS},crop=1080:1250:0:0,scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 }).stdout;
  let lufs = NaN, tp = NaN, lra = NaN;
  if (hasAudio) {
    const e = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-vn', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 }).stderr;
    const sum = e.slice(e.lastIndexOf('Summary:'));
    lufs = +(sum.match(/I:\s*(-?[\d.]+) LUFS/) || [])[1]; lra = +(sum.match(/LRA:\s*(-?[\d.]+) LU/) || [])[1]; tp = +(sum.match(/Peak:\s*(-?[\d.]+) dBFS/) || [])[1];
  }
  return { total, width: v.width, height: v.height, fps: v.r_frame_rate, hasAudio, motion: analyzeMotion(raw, FS, FPS, total), lufs, tp, lra };
}

/* ---------- Report bauen ---------- */
export function buildReport(dir, file, m) {
  const slug = path.basename(dir), check = path.join(dir, 'check');
  const read = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  const tl = read(path.join(dir, 'timeline.json')) ? JSON.parse(read(path.join(dir, 'timeline.json'))) : null;
  const B = m.motion;
  const motion = read(path.join(check, 'report.txt')), audio = read(path.join(check, 'audio-report.txt')), script = read(path.join(dir, 'script.md'));
  const C = [], F = [];
  const add = (key, name, status, value, detail = '') => C.push({ key, name, status, value, detail });

  // Länge
  const [g0, g1, y0, y1] = T.len;
  add('len', 'Länge', m.total >= g0 && m.total <= g1 ? 'green' : m.total >= y0 && m.total <= y1 ? 'yellow' : 'red', `${m.total.toFixed(1)} s`, 'Ziel 45–75 s');
  if (m.width !== 1080 || m.height !== 1920) { add('fmt', 'Format', 'red', `${m.width}×${m.height}`, 'muss 1080×1920 sein'); }
  // Bildwechsel
  add('beat', 'Bildwechsel-Takt', lamp(B.longest.d, T.beatGap[0], T.beatGap[1]),
    `längste Lücke ${B.longest.d.toFixed(1)} s`, `${B.beats.length} sichtbare Änderungen (${B.perMin.toFixed(0)}/min), ${B.cuts} harte Wechsel (Median alle ${B.cutMedian ? B.cutMedian.toFixed(1) : '–'} s). Ziel: alle ~3 s passiert was, keine Lücke > ${T.beatGap[0]} s`);
  B.over.forEach(g => F.push({ t: g.from, sev: g.d > T.beatGap[1] ? '!!' : '!', source: 'Bild', msg: `${g.d.toFixed(1)} s ohne sichtbare Änderung (${g.from.toFixed(1)}–${g.to.toFixed(1)} s) → neues Element, Zoom oder R.trans` }));
  // Lautheit
  if (m.hasAudio) {
    const dl = Math.abs(m.lufs - T.lufs);
    add('lufs', 'Lautheit', worst([lamp(dl, 1, 2), m.tp > -0.5 ? 'yellow' : 'green']), `${m.lufs} LUFS`, `True Peak ${m.tp} dBFS, LRA ${m.lra} LU. Ziel −14 LUFS, Peak ≤ −1`);
    if (m.tp > -0.5) F.push({ t: null, sev: '!', source: 'Ton', msg: `True Peak ${m.tp} dBFS → kann auf Handys clippen` });
  } else add('lufs', 'Lautheit', 'red', 'kein Ton', 'MP4 hat keine Tonspur');
  // Motion-Check (check.mjs)
  if (motion) {
    const rows = parseCheckReport(motion), bad = rows.filter(r => !r.ok);
    const hard = bad.filter(r => !/^Szene s\d+ dauert/.test(r.msg));   // Szenen > 6 s sind ok, wenn scenes.html sie teilt → Bildwechsel-Takt zählt
    add('motion', 'Motion-Check', hard.length ? 'yellow' : 'green', `${rows.length - bad.length}/${rows.length} ok`, [...hard.map(r => r.msg), bad.length > hard.length && `${bad.length - hard.length} Szenen > 6 s (ok, wenn scenes.html sie teilt, siehe Bildwechsel-Takt)`].filter(Boolean).join(' · ') || 'alles ok');
    hard.forEach(r => { const t = r.msg.match(/ab ([\d.]+) s/); F.push({ t: t ? +t[1] : null, sev: '!', source: 'Motion', msg: r.msg }); });
  } else add('motion', 'Motion-Check', 'grey', 'nicht gelaufen', 'node kit/check.mjs reels/' + slug);
  // Audio-Review
  let pronHints = [];
  if (audio) {
    const A = parseAudioReport(audio), crit = A.findings.filter(f => f.sev === '!!').length;
    add('audio', 'Audio-Review', crit ? 'red' : A.findings.length ? 'yellow' : 'green', `${crit} kritisch, ${A.findings.length - crit} Hinweise`,
      [A.understood && `ASR versteht ${A.understood[0]}/${A.understood[1]} Wörter`, A.sounds && `Sounds: ${A.sounds}`].filter(Boolean).join(' · '));
    A.findings.forEach(f => F.push({ t: f.t, sev: f.sev, source: 'Audio', msg: f.msg }));
    const known = new Set(pronunciationList(read(path.join(ROOT, 'guides/pronunciation.md')) || '').map(p => p.word.toLowerCase()));
    for (const f of A.findings) { const mm = f.msg.match(/"([^"]+)" \([^)]*\) klingt wie "([^"]+)"/); if (mm) { const w = mm[1].replace(/[.,!?]+$/, ''); if (!known.has(w.toLowerCase())) { known.add(w.toLowerCase()); pronHints.push(`- ${w} → klingt wie "${mm[2]}" | Tipp ergänzen`); } } }
  } else add('audio', 'Audio-Review', 'grey', 'nicht gelaufen', 'node kit/audio-review.mjs reels/' + slug);
  // Script-Lint
  let lint = null;
  if (script) {
    lint = lintScript(script); const crit = lint.findings.filter(f => f.sev === '!!').length, warn = lint.findings.filter(f => f.sev === '!').length;
    add('lint', 'Script-Lint', crit ? 'yellow' : 'green', `${crit} kritisch, ${warn} Hinweise`, lint.stats ? `${lint.stats.words} Wörter, geschätzt ${lint.stats.estSeconds} s` : '');
  }
  const order = { '!!': 0, '!': 1 };
  F.sort((a, b) => order[a.sev] - order[b.sev] || (a.t ?? 1e9) - (b.t ?? 1e9));
  const sheets = fs.existsSync(check) ? fs.readdirSync(check).filter(f => /^sheet_\d+\.png$/.test(f)).sort() : [];
  const imgs = { hook: fs.existsSync(path.join(check, 'hook.png')), edges: fs.existsSync(path.join(check, 'edges.png')), sheets };
  return { slug, file: path.basename(file), created: new Date().toISOString(), overall: worst(C.map(c => c.status).filter(s => s !== 'grey')), checks: C, findings: F, beats: B, scenes: tl ? tl.scenes.map(s => ({ id: s.id, start: s.start, end: s.end, title: s.title })) : [], total: m.total, lint, pronHints, imgs };
}

/* ---------- HTML ---------- */
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LBL = { green: 'grün', yellow: 'gelb', red: 'rot', grey: 'fehlt' };
export function renderHtml(R) {
  const W = 1000, x = t => (t / R.total * W).toFixed(1);
  const scenes = R.scenes.map((s, i) => `<g class="scn" data-t="${s.start}"><rect x="${x(s.start)}" y="0" width="${(x(s.end) - x(s.start)).toFixed(1)}" height="26" class="${i % 2 ? 'a' : 'b'}"/><text x="${(+x(s.start) + 4).toFixed(1)}" y="18">${esc(s.id)}</text><title>${esc(s.id + ' ' + s.title)} · ${s.start.toFixed(1)}–${s.end.toFixed(1)} s</title></g>`).join('');
  const gaps = R.beats.over.map(g => `<rect x="${x(g.from)}" y="32" width="${(x(g.to) - x(g.from))}" height="22" class="${g.d > T.beatGap[1] ? 'gr' : 'gy'}" data-t="${g.from}"><title>${g.d.toFixed(1)} s ohne Änderung</title></rect>`).join('');
  const beats = R.beats.beats.map(b => `<line x1="${x(b.t)}" x2="${x(b.t)}" y1="${b.big ? 32 : 42}" y2="54" class="bt"/>`).join('');
  const marks = R.findings.filter(f => f.t != null).map(f => `<circle cx="${x(f.t)}" cy="70" r="6" class="${f.sev === '!!' ? 'mr' : 'my'}" data-t="${f.t}"><title>${esc(f.source + ': ' + f.msg)}</title></circle>`).join('');
  const ticks = Array.from({ length: Math.floor(R.total / 10) + 1 }, (_, i) => `<text x="${x(i * 10)}" y="92" class="tk">${i * 10}s</text>`).join('');
  const card = c => `<div class="card ${c.status}"><div class="dot"></div><div><div class="cn">${esc(c.name)} <span class="lbl">${LBL[c.status]}</span></div><div class="cv">${esc(c.value)}</div><div class="cd">${esc(c.detail)}</div></div></div>`;
  const fRow = f => `<tr class="${f.sev === '!!' ? 'r' : 'y'}"><td>${f.sev}</td><td>${f.t != null ? `<a href="#" data-t="${f.t}">${f.t.toFixed(2)} s</a>` : '–'}</td><td>${esc(f.source)}</td><td>${esc(f.msg)}</td></tr>`;
  const lintRows = R.lint ? R.lint.findings.filter(f => f.sev !== 'i').map(f => `<tr class="${f.sev === '!!' ? 'r' : 'y'}"><td>${f.sev}</td><td>${esc(f.scene || '')}</td><td>${esc(f.msg)}</td></tr>`).join('') : '';
  const sheet = (f, i) => `<img src="${f}" class="sheet" data-t0="${i * 9}" data-cols="6" data-rows="3" data-step="0.5" alt="Kontaktbogen ${i + 1}" loading="lazy">`;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Report ${esc(R.slug)}</title>
<style>
:root{--bg:#f6f4ef;--fg:#1d1b2f;--mut:#6b6880;--card:#fff;--line:#e4e0d8;--g:#1f9d55;--y:#d99a00;--r:#d8402a;--gr:#9a98a8;--a:#ece8f6;--b:#ddd6f0}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#17141f;--fg:#ece9f5;--mut:#a29fb3;--card:#221e2e;--line:#38324a;--a:#2c2640;--b:#3a3255}}
:root[data-theme=dark]{--bg:#17141f;--fg:#ece9f5;--mut:#a29fb3;--card:#221e2e;--line:#38324a;--a:#2c2640;--b:#3a3255}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1180px;margin:0 auto;padding:20px 16px 60px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 10px}.sub{color:var(--mut);font-size:13px}
.top{display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:20px;align-items:start}@media(max-width:760px){.top{grid-template-columns:1fr}}
video{width:100%;max-width:270px;border-radius:10px;background:#000;position:sticky;top:12px}
.big{display:inline-block;padding:4px 12px;border-radius:99px;color:#fff;font-weight:700;margin:8px 0 14px}.big.green{background:var(--g)}.big.yellow{background:var(--y)}.big.red{background:var(--r)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.card{display:flex;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}.dot{flex:none;width:14px;height:14px;border-radius:50%;margin-top:4px;background:var(--gr)}
.card.green .dot{background:var(--g)}.card.yellow .dot{background:var(--y)}.card.red .dot{background:var(--r)}
.cn{font-weight:650}.lbl{font-weight:400;color:var(--mut);font-size:12px}.cv{font-size:18px;font-weight:700}.cd{color:var(--mut);font-size:12.5px;overflow-wrap:anywhere}
svg{width:100%;height:auto;display:block;background:var(--card);border:1px solid var(--line);border-radius:10px}svg text{font-size:12px;fill:var(--fg)}svg .tk{fill:var(--mut);font-size:11px}
.a{fill:var(--a)}.b{fill:var(--b)}.gy{fill:var(--y);opacity:.35}.gr{fill:var(--r);opacity:.4}.bt{stroke:var(--fg);stroke-width:1.2;opacity:.55}.mr{fill:var(--r)}.my{fill:var(--y)}
svg [data-t],a[data-t]{cursor:pointer}.legend{color:var(--mut);font-size:12.5px;margin-top:6px}
.tbl{overflow-x:auto}table{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--line);border-radius:10px;font-size:13.5px}td{padding:6px 10px;border-top:1px solid var(--line);vertical-align:top}tr:first-child td{border-top:0}
tr.r td:first-child{color:var(--r);font-weight:700}tr.y td:first-child{color:var(--y);font-weight:700}td:nth-child(2){white-space:nowrap}a{color:inherit}
.sheets img,.imgs img{width:100%;border-radius:8px;border:1px solid var(--line);margin-bottom:8px;cursor:crosshair}.imgs{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px;overflow-x:auto;font-size:13px}
</style></head><body><main>
<div class="top"><div>
<h1>${esc(R.slug)}</h1><div class="sub">${esc(R.file)} · ${new Date(R.created).toLocaleString('de-DE')}</div>
<div class="big ${R.overall}">Gesamt: ${LBL[R.overall]}</div>
<div class="cards">${R.checks.map(card).join('')}</div>
<h2>Zeitleiste</h2>
<svg viewBox="-4 0 ${W + 8} 98" role="img" aria-label="Zeitleiste">${scenes}${gaps}${beats}${marks}${ticks}</svg>
<div class="legend">Oben Szenen aus timeline.json · Striche = sichtbare Bildänderung (lang = harter Wechsel) · gelb/rot hinterlegt = Lücke über ${T.beatGap[0]} / ${T.beatGap[1]} s · Punkte = Befunde. Klick springt im Video.</div>
</div><video id="v" src="../${esc(R.file)}" controls playsinline preload="metadata"></video></div>
<h2>Befunde (${R.findings.length})</h2>
${R.findings.length ? `<div class="tbl"><table>${R.findings.map(fRow).join('')}</table></div>` : '<p class="sub">Keine Befunde.</p>'}
${R.pronHints.length ? `<h2>Für guides/pronunciation.md</h2><pre>${esc(R.pronHints.join('\n'))}</pre>` : ''}
${lintRows ? `<h2>Script-Lint</h2><div class="tbl"><table>${lintRows}</table></div>` : ''}
${R.imgs.hook || R.imgs.edges ? `<h2>Hook &amp; Szenenwechsel (Ton)</h2><div class="imgs">${R.imgs.hook ? '<img src="hook.png" class="sheet" data-t0="0" data-cols="6" data-rows="2" data-step="0.25" alt="Hook, erste 3 s">' : ''}${R.imgs.edges ? '<img src="edges.png" alt="Wellenform an den Szenenwechseln" style="cursor:default">' : ''}</div>` : ''}
${R.imgs.sheets.length ? `<h2>Kontaktbögen (alle 0,5 s, Klick springt hin)</h2><div class="sheets">${R.imgs.sheets.map(sheet).join('')}</div>` : ''}
</main><script>
const v=document.getElementById('v');const go=t=>{v.currentTime=+t;v.scrollIntoView({block:'nearest'});v.play().catch(()=>{})};
document.addEventListener('click',e=>{const el=e.target.closest('[data-t]');if(el){e.preventDefault();go(el.dataset.t);return}
const s=e.target.closest('img.sheet');if(s){const r=s.getBoundingClientRect(),c=Math.floor((e.clientX-r.left)/r.width*s.dataset.cols),w=Math.floor((e.clientY-r.top)/r.height*s.dataset.rows);go(+s.dataset.t0+(w*s.dataset.cols+c)*s.dataset.step)}});
</script></body></html>`;
}

export function summary(R) {
  const L = [`Qualitäts-Report ${R.slug}: ${LBL[R.overall].toUpperCase()}`];
  R.checks.forEach(c => L.push(`  ${LBL[c.status].padEnd(5)} ${c.name}: ${c.value}${c.detail ? ' · ' + c.detail : ''}`));
  const top = R.findings.filter(f => f.sev === '!!');
  if (top.length) { L.push('  Kritisch:'); top.slice(0, 12).forEach(f => L.push(`   !! ${f.t != null ? f.t.toFixed(1) + ' s ' : ''}[${f.source}] ${f.msg}`)); if (top.length > 12) L.push(`   … ${top.length - 12} weitere`); }
  if (R.pronHints.length) L.push('  Neu für guides/pronunciation.md:', ...R.pronHints.map(h => '   ' + h));
  return L.join('\n');
}

/* ---------- CLI ---------- */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), pos = args.filter(a => !a.startsWith('--'));
  const dir = path.resolve(pos[0] || ''); const slug = path.basename(dir);
  if (!pos[0] || !fs.existsSync(dir)) { console.error('Nutzung: node kit/report.mjs reels/<slug> [datei.mp4] [--run] [--no-asr]'); process.exit(2); }
  const file = pos[1] ? path.resolve(pos[1]) : [slug + '.mp4', slug + '_draft.mp4'].map(f => path.join(dir, f)).filter(fs.existsSync).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!file) { console.error('Kein MP4 gefunden. Erst rendern: node kit/render.mjs reels/' + slug); process.exit(1); }
  if (args.includes('--run')) {
    const node = (s, ...a) => spawnSync(process.execPath, [path.join(ROOT, 'kit', s), dir, ...a], { stdio: 'inherit' });
    node('check.mjs', file);
    if (fs.existsSync(path.join(dir, 'vo.wav'))) node('audio-review.mjs', ...(args.includes('--no-asr') ? ['--no-asr'] : []));
  }
  const R = buildReport(dir, file, measureVideo(file));
  const out = path.join(dir, 'check'); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'report.html'), renderHtml(R));
  const { imgs, ...json } = R; json.beats = { count: R.beats.beats.length, perMin: +R.beats.perMin.toFixed(1), longest: R.beats.longest, over: R.beats.over, cuts: R.beats.cuts, cutMedian: R.beats.cutMedian };
  fs.writeFileSync(path.join(out, 'quality.json'), JSON.stringify(json, null, 1));
  console.log(summary(R));
  console.log(`\n→ ${path.relative(process.cwd(), path.join(out, 'report.html'))} (Browser) · quality.json (für Claude)`);
  process.exitCode = R.overall === 'red' ? 1 : 0;
}
