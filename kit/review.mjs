// Review-Seite: Reel abspielen, per Klick/Taste Feedback mit Zeitstempel setzen, als Liste exportieren.
// Nutzung: node kit/review.mjs [reels/<slug>] [--port 3910]   → http://localhost:3910 öffnet sich im Browser
// Rein lokal (nur 127.0.0.1), keine Pakete nötig. Speichert:
//   reels/<slug>/review.json            alle Notizen (Autosave)
//   reels/<slug>/review.md              Export: Aufgabenliste für Claude (Zeit, Szene, gesprochene Wörter, Notiz, Standbild)
//   reels/<slug>/check/review/*.jpg     Standbild pro Notiz
//   guides/learnings.md                 Notizen mit Haken „Regel für alle Reels“ landen oben als neue Regel
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REELS = path.join(ROOT, 'reels');
const args = process.argv.slice(2);
const PORT = +(args[args.indexOf('--port') + 1] || 0) || 3910;
const first = args.find(a => !a.startsWith('--') && !/^\d+$/.test(a));
const startSlug = first ? path.basename(path.resolve(first)) : '';

const slugOk = s => /^[\w.-]+$/.test(s) && fs.existsSync(path.join(REELS, s));
const videoOf = s => {
  const d = path.join(REELS, s);
  for (const f of [`${s}.mp4`, `${s}_draft.mp4`]) if (fs.existsSync(path.join(d, f))) return path.join(d, f);
  const any = fs.readdirSync(d).find(f => f.endsWith('.mp4'));
  return any ? path.join(d, any) : null;
};
const listReels = () => fs.readdirSync(REELS).filter(s => !s.startsWith('.') && fs.statSync(path.join(REELS, s)).isDirectory())
  .map(s => {
    const v = videoOf(s), n = fs.existsSync(path.join(REELS, s, 'review.json')) ? JSON.parse(fs.readFileSync(path.join(REELS, s, 'review.json'), 'utf8')).notes.length : 0;
    return { slug: s, video: v ? path.basename(v) : null, mtime: v ? fs.statSync(v).mtimeMs : 0, notes: n };
  }).sort((a, b) => b.mtime - a.mtime);

const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = req => new Promise((ok, bad) => { const c = []; let n = 0; req.on('data', d => { n += d.length; if (n > 30e6) { bad(new Error('zu groß')); req.destroy(); } else c.push(d); }); req.on('end', () => ok(Buffer.concat(c).toString('utf8'))); });
const fmtT = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const today = () => new Date().toISOString().slice(0, 10);

function streamVideo(req, res, file) {
  const size = fs.statSync(file).size, m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (!m) { res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': size, 'accept-ranges': 'bytes' }); return fs.createReadStream(file).pipe(res); }
  const a = m[1] ? +m[1] : 0, b = m[2] ? Math.min(+m[2], size - 1) : size - 1;
  res.writeHead(206, { 'content-type': 'video/mp4', 'content-length': b - a + 1, 'content-range': `bytes ${a}-${b}/${size}`, 'accept-ranges': 'bytes' });
  fs.createReadStream(file, { start: a, end: b }).pipe(res);
}

function exportReview(slug, data) {
  const dir = path.join(REELS, slug), shots = path.join(dir, 'check', 'review');
  fs.mkdirSync(shots, { recursive: true });
  const notes = data.notes.slice().sort((a, b) => a.t - b.t);
  const lines = [`# Review: ${slug}`, '', `Datum: ${today()} · Video: ${data.video || '?'} · ${notes.length} Notizen`, '',
    'Abarbeiten wie in SKILL.md Schritt 6: nur das Genannte ändern, betroffene Szene neu sprechen/rendern.', ''];
  notes.forEach((n, i) => {
    let img = '';
    if (n.frame && n.frame.startsWith('data:image/jpeg;base64,')) {
      const f = `note_${String(i + 1).padStart(2, '0')}_${n.t.toFixed(1)}s.jpg`;
      fs.writeFileSync(path.join(shots, f), Buffer.from(n.frame.split(',')[1], 'base64'));
      img = ` · Bild: check/review/${f}`;
    }
    lines.push(`- [ ] **${fmtT(n.t)}** (${n.scene || '–'}${n.cat ? ', ' + n.cat : ''}) ${n.text.trim() || '(ohne Text)'}${n.rule ? ' · *Regel*' : ''}`);
    if (n.words) lines.push(`  - gesprochen: „${n.words}“${img}`); else if (img) lines.push(`  - ${img.slice(3)}`);
  });
  fs.writeFileSync(path.join(dir, 'review.md'), lines.join('\n') + '\n');

  // Regeln in learnings.md (oben einfügen, unter dem Kopf), jede nur einmal
  const rules = notes.filter(n => n.rule && n.text.trim() && !n.exported);
  if (rules.length) {
    const lf = path.join(ROOT, 'guides', 'learnings.md');
    const src = fs.readFileSync(lf, 'utf8'), at = src.search(/^- /m);
    const add = rules.map(n => `- ${today()} (Review ${slug}, ${fmtT(n.t)}${n.cat ? ', ' + n.cat : ''}): ${n.text.trim().replace(/\n+/g, ' ')}`).join('\n') + '\n';
    fs.writeFileSync(lf, at < 0 ? src.trimEnd() + '\n\n' + add : src.slice(0, at) + add + src.slice(at));
    rules.forEach(n => (n.exported = true));
  }
  fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify(data, null, 1));
  return { md: path.relative(ROOT, path.join(dir, 'review.md')), rules: rules.length, data };
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x'), p = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html'))
      return send(res, 200, fs.readFileSync(path.join(ROOT, 'kit', 'review.html')), 'text/html; charset=utf-8');
    if (p[0] === 'api' && p[1] === 'reels') return send(res, 200, { start: startSlug, reels: listReels() });
    const slug = p[1];
    if (p[0] === 'api' && !slugOk(slug || '')) return send(res, 404, { error: 'Reel nicht gefunden' });
    const dir = path.join(REELS, slug || '');
    if (p[0] === 'api' && p[2] === 'video') { const v = videoOf(slug); return v ? streamVideo(req, res, v) : send(res, 404, { error: 'keine mp4' }); }
    if (p[0] === 'api' && p[2] === 'timeline') {
      const f = path.join(dir, 'timeline.json');
      return send(res, 200, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '{"scenes":[],"words":[]}');
    }
    if (p[0] === 'api' && p[2] === 'notes' && req.method === 'GET') {
      const f = path.join(dir, 'review.json');
      return send(res, 200, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : { notes: [] });
    }
    if (p[0] === 'api' && p[2] === 'notes' && req.method === 'POST') {
      const data = JSON.parse(await readBody(req)); if (!Array.isArray(data.notes)) return send(res, 400, { error: 'notes fehlt' });
      fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify(data, null, 1)); return send(res, 200, { ok: true });
    }
    if (p[0] === 'api' && p[2] === 'export' && req.method === 'POST') return send(res, 200, exportReview(slug, JSON.parse(await readBody(req))));
    send(res, 404, { error: 'gibt es nicht' });
  } catch (e) { console.error(e); send(res, 500, { error: e.message }); }
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}/${startSlug ? '#' + startSlug : ''}`;
  console.log(`Review-Seite: ${url}   (Strg+C beendet)`);
  if (!args.includes('--no-open')) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    try { spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).on('error', () => {}).unref(); } catch {}
  }
});
