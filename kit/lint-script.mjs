// Script-Linter ohne KI: prüft script.md vor der Aufnahme (gratis, in Millisekunden).
// Nutzung: node kit/lint-script.mjs reels/<slug>      ein Reel
//          node kit/lint-script.mjs --all             alle Reels
//          --json   Ergebnis als JSON   --ci   nur Formatfehler lassen den Lauf scheitern (für GitHub Actions)
// Prüft: Format, Wörter, geschätzte Länge (Ziel 45–75 s), Hook, Satzlänge, Schlagwörter, Pausen-Marken,
//        CTA, verbotene Wörter (guides/humor.md), Aussprache-Liste (guides/pronunciation.md), Abkürzungen.
// Stufen: !! = vor der Aufnahme fixen · ! = Hinweis · i = Info
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Schätzung der Sprechdauer bei Tempo 1 (kalibriert an rom-ueberlebt-en und planet-der-capybaras-en, ±4 s)
export const EST = { wps: 2.8, short: 0.35, long: 0.55, frame: 1.15 };
export const LIMITS = { minS: 45, maxS: 75, maxWords: 185, hookWords: 12, scenesMin: 8, scenesMax: 14, sentenceWords: 14, sceneS: 6 };

/* ---------- script.md lesen (wie kit/voice.mjs, plus Zeilennummern) ---------- */
export function parseScript(md) {
  const scenes = []; let cur = null, key = null, title = '';
  md.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!title && /^#\s+/.test(line)) title = line.replace(/^#\s+/, '');
    const h = line.match(/^##\s+(s\d+[a-z]?)\b(.*)$/i);
    if (h) { cur = { id: h[1].toLowerCase(), title: h[2].replace(/^[\s|:–-]+/, ''), vo: '', bild: '', line: i + 1 }; scenes.push(cur); key = null; return; }
    if (!cur) return;
    const m = line.match(/^(VO|BILD)\s*:\s*(.*)$/i);
    if (m) { key = m[1].toLowerCase(); cur[key] += (cur[key] ? ' ' : '') + m[2]; if (key === 'vo') cur.voLine ??= i + 1; return; }
    if (!line) { key = null; return; }
    if (key) cur[key] += ' ' + line;
  });
  return { title, scenes };
}

/* ---------- Listen aus den Guides ---------- */
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = phrase => new RegExp('(?<![\\p{L}\\p{N}])' + phrase.split(/\s*…\s*/).map(p => escRe(p.trim()).replace(/\s+/g, '\\s+')).join('[^.?!]{1,40}?') + '(?![\\p{L}\\p{N}\'’])', 'iu');

export function bannedLists(humorMd) {
  const sec = name => { const m = humorMd.match(new RegExp('^## ' + name + '\\s*\\n([\\s\\S]*?)(?=\\n## |\\n\\n[A-Z]|$)', 'm')); return m ? m[1] : ''; };
  const split = txt => txt.split(/\n/)[0].split(',').map(s => s.trim()).filter(Boolean)
    .flatMap(s => s.includes('/') ? [s.replace(/\s*\S+\/(\S+)$/, ' $1'), s.replace(/\/\S+$/, '')] : [s]);   // "Welt/Ära" → beide
  return { de: split(sec('Verboten \\(klingt nach KI\\)')), en: split(sec('Verboten englisch[^\\n]*')) };
}
export function pronunciationList(md) {
  return md.split(/\n/).map(l => l.match(/^-\s+(.+?)\s+→\s+([^|]+?)\s*(?:\|\s*(.*))?$/)).filter(Boolean).map(m => ({ word: m[1], says: m[2], tip: m[3] || '' }));
}
function loadGuides(root = ROOT) {
  const read = f => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } };
  let lang = 'en'; try { lang = JSON.parse(read('config.json')).voicestudio.language || 'en'; } catch {}
  return { banned: bannedLists(read('guides/humor.md')), pron: pronunciationList(read('guides/pronunciation.md')), lang };
}

/* ---------- Text-Helfer ---------- */
const isMark = t => t === '/' || t === '//';
const cleanWord = t => t.replace(/\*/g, '');
const realWords = vo => vo.trim().split(/\s+/).filter(t => t && !isMark(t) && /[\p{L}\p{N}]/u.test(t));
// Sätze: Tokens bis . ? ! (Marken und Schlagwort-Sternchen werden mitgezählt)
function sentences(vo) {
  const out = []; let cur = { words: [], kw: 0, text: [] }, inKw = false;
  for (const t of vo.trim().split(/\s+/).filter(Boolean)) {
    if (isMark(t)) continue;
    const stars = (t.match(/\*/g) || []).length;
    if (t.startsWith('*') && !inKw) cur.kw++;
    if (stars % 2 === 1) inKw = !inKw;
    if (/[\p{L}\p{N}]/u.test(t)) cur.words.push(cleanWord(t));
    cur.text.push(cleanWord(t));
    if (/[.?!]["”)]?\*?$/.test(t) && !inKw) { out.push({ ...cur, text: cur.text.join(' ') }); cur = { words: [], kw: 0, text: [] }; }
  }
  if (cur.words.length) out.push({ ...cur, text: cur.text.join(' ') });
  return out;
}
export function detectLang(text, fallback = 'en') {
  const en = (text.match(/\b(the|and|you|is|of|your|what|if)\b/gi) || []).length;
  const de = (text.match(/\b(der|die|das|und|du|ist|nicht|wenn|dein)\b/gi) || []).length;
  return en === de ? fallback : en > de ? 'en' : 'de';
}

// Verbotene Wörter mit harmloser Zweitbedeutung ("schick" = stylish ist verboten, "Schick das an …" ist der CTA)
const EXCEPT = { schick: /(?<![\p{L}])schick(e|'s|’s)?\s+(das|es|ihn|sie|den|die|dem|an|mal)\b/iu };

/* ---------- Linter ---------- */
export function lintScript(md, guides = loadGuides()) {
  const F = []; const add = (sev, scene, msg, kind = 'regel') => F.push({ sev, scene, msg, kind });
  const { title, scenes } = parseScript(md);
  if (!title) add('!', null, 'Kein Titel ("# …") in der ersten Zeile', 'format');
  if (!scenes.length) { add('!!', null, 'Keine Szenen gefunden. Format: "## s1 Hook" + "VO: …"', 'format'); return { stats: null, findings: F }; }

  const ids = new Set();
  for (const s of scenes) {
    if (ids.has(s.id)) add('!!', s.id, `Szenen-ID ${s.id} doppelt`, 'format'); ids.add(s.id);
    if (!s.vo.trim()) add('!!', s.id, 'Szene ohne VO-Zeile (wird nicht gesprochen)', 'format');
    if (!s.bild.trim()) add('!', s.id, 'Szene ohne BILD-Zeile', 'format');
    if ((s.vo.match(/\*/g) || []).length % 2) add('!!', s.id, 'Sternchen nicht geschlossen (*Schlagwort*)', 'format');
    if (/(^|\s)\/{3,}(\s|$)/.test(s.vo)) add('!!', s.id, 'Pausen-Marke mit 3+ Strichen, nur " / " oder " // " erlaubt', 'format');
    if (/[^\s/]\/\/?(\s|$)/.test(s.vo.replace(/https?:\/\/\S+/g, ''))) add('!', s.id, 'Pausen-Marke klebt am Wort, braucht Leerzeichen davor: "Satz. / Nächster"', 'format');
  }
  const spoken = scenes.filter(s => s.vo.trim());
  const allVo = spoken.map(s => s.vo).join(' ');
  const lang = detectLang(allVo.replace(/\*/g, ''), guides.lang);

  // Länge
  let words = 0, short = 0, long = 0;
  const per = spoken.map(s => {
    const w = realWords(s.vo).length, toks = s.vo.trim().split(/\s+/);
    const p1 = toks.filter(t => t === '/').length, p2 = toks.filter(t => t === '//').length;
    words += w; short += p1; long += p2;
    return { id: s.id, words: w, est: w / EST.wps + p1 * EST.short + p2 * EST.long, sent: sentences(s.vo) };
  });
  const est = words / EST.wps + short * EST.short + long * EST.long + EST.frame;
  const stats = { title, lang, scenes: spoken.length, words, pausesShort: short, pausesLong: long, estSeconds: +est.toFixed(1), perScene: per.map(p => ({ id: p.id, words: p.words, estSeconds: +p.est.toFixed(1) })) };

  if (est > LIMITS.maxS) add('!!', null, `Geschätzt ${est.toFixed(0)} s, Ziel 45–75 s → ca. ${Math.ceil((est - 70) * EST.wps)} Wörter raus`, 'länge');
  else if (est < LIMITS.minS) add('!!', null, `Geschätzt ${est.toFixed(0)} s, Ziel 45–75 s → zu kurz`, 'länge');
  if (lang === 'en' && words > LIMITS.maxWords) add('!', null, `${words} Wörter, bei Tempo 1 max. ~${LIMITS.maxWords} (learnings 18.11.)`, 'länge');
  if (spoken.length < LIMITS.scenesMin || spoken.length > LIMITS.scenesMax) add('!', null, `${spoken.length} Szenen, Ziel 8–14`, 'länge');
  for (const p of per) if (p.est > LIMITS.sceneS) add('i', p.id, `~${p.est.toFixed(1)} s gesprochen → in scenes.html 2–3 Bildwechsel (R.trans) einplanen`, 'bild');

  // Hook
  const s1 = spoken[0], hookW = realWords(s1.vo).length;
  if (hookW > LIMITS.hookWords) add('!!', s1.id, `Hook hat ${hookW} Wörter, max. ${LIMITS.hookWords}`, 'hook');
  const start = s1.vo.replace(/^[\s/*]+/, '').toLowerCase();
  const bad = ['hey', 'hi', 'hallo', 'in this video', 'in diesem video', 'did you know', 'wusstest du', 'today', 'heute', 'so,', 'okay', 'welcome'].find(b => start.startsWith(b));
  if (bad) add('!!', s1.id, `Hook startet mit "${bad}" → Thema ab dem ersten Wort`, 'hook');
  if (/^\s*\/\//.test(s1.vo)) add('!', s1.id, 'Pause vor dem Hook → Stimme muss sofort starten', 'hook');

  // Sätze, Schlagwörter, Pausen
  let sentTotal = 0, inScenePauses = 0;
  for (const [i, s] of spoken.entries()) {
    const p = per[i]; sentTotal += p.sent.length;
    if (p.sent.length > 4) add('!', s.id, `${p.sent.length} Sätze, Regel: 1–3 kurze pro Szene`, 'satz');
    for (const st of p.sent) {
      if (st.words.length > LIMITS.sentenceWords) add('!', s.id, `Satz mit ${st.words.length} Wörtern: "${st.text.slice(0, 60)}…" → teilen`, 'satz');
      if (st.kw > 1) add('!', s.id, `${st.kw} Schlagwörter in einem Satz (max. 1): "${st.text.slice(0, 60)}"`, 'schlagwort');
    }
    let run = 0;
    for (const st of p.sent) { run = st.words.length <= 2 ? run + 1 : 0; if (run === 3) add('!', s.id, '3+ Mini-Sätze hintereinander → Stimme verschluckt gern, lieber verbinden', 'satz'); }
    const toks = s.vo.trim().split(/\s+/);
    toks.forEach((t, k) => {
      if (!isMark(t) || k === 0) return;
      inScenePauses++;
      const prev = toks[k - 1];
      if (!/[.?!:]["”)]?\*?$/.test(prev)) add('!!', s.id, `Pause mitten im Satz nach "${cleanWord(prev)}" → nur nach . ? : setzen`, 'pause');
      if (k === toks.length - 1) add('!', s.id, 'Pause am Szenenende ist doppelt (Szenenwechsel macht schon ~0,45 s)', 'pause');
    });
  }
  if (inScenePauses > Math.ceil(sentTotal / 2) + 1) add('!', null, `${inScenePauses} Pausen auf ${sentTotal} Sätze → max. etwa eine pro zwei Sätze`, 'pause');
  if (!s1.vo.match(/[?]/) || !/(^|\s)\/\/?(\s|$)/.test(s1.vo)) add('i', s1.id, 'Tipp: kurze Pause nach der Hook-Frage (" / ")', 'pause');

  // CTA
  const last = spoken[spoken.length - 1];
  const ctaRe = /\?|comment|tell me|send (this|it)|share|follow|schick|kommentar|schreib/i;
  if (!ctaRe.test(last.vo)) add('!', last.id, 'Letzte Szene ohne CTA (Frage an die Comments / "Send this to …")', 'cta');
  if (spoken.length > 1 && !/^\s*\/\//.test(last.vo)) add('i', last.id, 'Tipp: "//" vor die CTA-Szene', 'pause');

  // Wörter: verboten, Aussprache, Abkürzungen, Ziffern
  const lists = lang === 'en' ? guides.banned.en : guides.banned.de;
  for (const s of spoken) {
    const txt = s.vo.replace(/\*/g, '').replace(/(^|\s)\/\/?(?=\s|$)/g, ' ');
    for (const b of lists) if (b.length > 1 && wordRe(b).test(txt) && !(EXCEPT[b.toLowerCase()]?.test(txt))) add('!!', s.id, `Verbotenes Wort "${b}" (guides/humor.md)`, 'wort');
    for (const p of guides.pron) if (wordRe(p.word).test(txt)) add('!', s.id, `"${p.word}" ${p.says}${p.tip ? ' · ' + p.tip : ''} (guides/pronunciation.md)`, 'aussprache');
    const caps = [...new Set(txt.match(/(?<![\p{L}])[A-Z]{2,}(?![\p{L}])/gu) || [])].filter(c => !['I', 'OK', 'TV', 'AI', 'KI'].includes(c));
    if (caps.length) add('!', s.id, `Abkürzung ${caps.join(', ')} → buchstabiert die Stimme oder liest sie als Wort? Lieber ausschreiben`, 'aussprache');
    const nums = txt.match(/\d[\d,.]*\d|\d/g);
    if (nums) add('i', s.id, `Ziffern ${nums.join(', ')} → nach der Aufnahme prüfen, ob richtig gelesen`, 'aussprache');
  }
  return { stats, findings: F };
}

export function formatLint(slug, r) {
  const L = [`Script-Lint ${slug}`];
  if (r.stats) {
    const s = r.stats;
    L.push(`  ${s.scenes} Szenen · ${s.words} Wörter · ${s.pausesShort}× " / " · ${s.pausesLong}× " // " · geschätzt ~${s.estSeconds} s (±4 s, Ziel 45–75)`);
  }
  const order = { '!!': 0, '!': 1, i: 2 };
  [...r.findings].sort((a, b) => order[a.sev] - order[b.sev]).forEach(f => L.push(`  ${f.sev.padEnd(3)} ${f.scene ? f.scene.padEnd(4) + ' ' : ''}${f.msg}`));
  const crit = r.findings.filter(f => f.sev === '!!').length, warn = r.findings.filter(f => f.sev === '!').length;
  L.push(crit ? `  → ${crit} kritisch, ${warn} Hinweise. Erst die !! fixen, dann aufnehmen.` : `  → bereit für die Aufnahme (${warn} Hinweise)`);
  return L.join('\n');
}

/* ---------- CLI ---------- */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const JSONOUT = args.includes('--json'), CI = args.includes('--ci');
  const dirs = args.includes('--all')
    ? fs.readdirSync(path.join(ROOT, 'reels')).filter(d => !d.startsWith('_') && fs.existsSync(path.join(ROOT, 'reels', d, 'script.md'))).sort().map(d => path.join(ROOT, 'reels', d))
    : args.filter(a => !a.startsWith('--')).map(a => path.resolve(a));
  if (!dirs.length) { console.error('Nutzung: node kit/lint-script.mjs reels/<slug> | --all [--json] [--ci]'); process.exit(2); }
  const guides = loadGuides(); const all = {}; let fail = false;
  for (const d of dirs) {
    const f = fs.statSync(d).isDirectory() ? path.join(d, 'script.md') : d;
    if (!fs.existsSync(f)) { console.error('Fehlt: ' + f); fail = true; continue; }
    const slug = path.basename(path.dirname(path.resolve(f)));
    const r = lintScript(fs.readFileSync(f, 'utf8'), guides); all[slug] = r;
    if (r.findings.some(x => x.sev === '!!' && (!CI || x.kind === 'format'))) fail = true;
    if (!JSONOUT) console.log(formatLint(slug, r) + (dirs.length > 1 ? '\n' : ''));
  }
  if (JSONOUT) console.log(JSON.stringify(dirs.length === 1 ? Object.values(all)[0] : all, null, 1));
  process.exitCode = fail ? 1 : 0;
}
