/* Szenen-Bausteine: fertige Szenentypen aus den bisherigen Reels (Rom, Capybaras), damit ein neues Reel mit wenig Code entsteht.
   Einbinden NACH runtime.js, figures.js, props.js (und map.js, falls B.map genutzt wird):
     <script src="../../kit/blocks.js"></script>
   Dazu optional <link rel="stylesheet" href="../../kit/base.css"> (Bühne, .t, .kick, .stamp …) statt eigenem <style>.

   Zeitangaben ("at", "flip" …) gehen überall gleich:
     1.2              → Sekunden nach Szenenstart
     'Rome'           → wenn das Wort gesprochen wird
     ['Rome', -.1, 1] → Wort, Versatz in s, n-tes Vorkommen (0 = erstes)
     {end: 'done'}    → Wortende (für Sounds NACH der Pointe), auch {end:'done', dt:.05, nth:1}
     {abs: 12.3}      → absolute Videosekunde
   Die Szene ("s") ergibt sich aus der Gruppe, wenn die Szenen per B.scenes(...) angelegt wurden (g5b → s5). Sonst s: 's5' angeben.

   Schnellübersicht (alle geben die id des Bausteins zurück, B.map gibt die Karte zurück):
     B.scenes([['s1','g1'], ['s2','g2','zoom'], …])         wie R.scenes, merkt sich Gruppe → Szene
     B.group('g3', 'linear-gradient(#7CC4F0,#CDEBF7)')        Szenengruppe + Hintergrund anlegen (kein HTML nötig)
     B.title('g1', {lines: [{text:'What if the', size:72}, {text:'ROME', size:140, box:'var(--re)', at:'Rome', fx:'chars'}]})
     B.counter('g5', {at:'three', from:0, to:3, suffix:' years', y:1000})
     B.stamp('g3', {text:'PROVINCE', at:'province', x:540, y:360, r:-8})
     B.quote('g7', {text:'Veni, vidi, vici.', who:'Julius Caesar', at:0.2})
     B.sign('g3', {from:['Federal Republic of','GERMANY'], to:['Province of','GERMANIA'], strike:'doesn', flip:'Germania'})
     B.closeup('g2', {at:'Shocking', moods:[[0,'annoyed'], ['nobody','neutral']], cam:true})
     B.map('g2', {view:{center:[38,44], zoom:2.5}, fills:[[['Italy','Spain'], 'Europe', '#C8302A']], labels:[['EUROPE',[8,52],'Europe']]})
     B.board('g6', {text:'VIA APPIA EXPRESS', at:'Via'})       Fallblatt-Anzeige
     B.bubble('g4', {text:'SALVE!', at:'waiter', x:300, y:700})
     B.confetti('g4', {at:'paid'})   B.rise('g11', {at:'Germania', item: PROPS.heart()})
     B.enter('hero4', 'waiter', 'left')                        hide + reinfliegen (left/right/top/bottom/drop/pop)
   Helfer: B.$, B.put, B.add, B.at, B.hero, B.rnd, B.time, B.WE, B.pill
   Regel aus SKILL.md gilt weiter: Bausteine bewegen ihre Elemente per GSAP (R.g*), nur stamp nutzt R.slam. Eigene Animationen
   auf Bausteinen also auch per R.g*, nicht per R.tw. */
(function () {
  const W = window, R = W.R;
  if (!R) throw new Error('blocks.js braucht runtime.js davor');
  const $ = id => (typeof id === 'string' ? document.getElementById(id) : id);
  const B = { $ };
  let uid = 0; const nid = p => `${p}${++uid}`;

  /* ---------- CSS der Bausteine (eigene Klassen mit b-, kollidiert nicht mit alten Reels) ---------- */
  const css = `
  .b-svg { position:absolute; inset:0; width:1080px; height:1920px; overflow:visible; pointer-events:none; }
  .b-abs { position:absolute; translate:-50% -50%; }
  .b-t { position:absolute; left:60px; right:60px; text-align:center; color:#fff; font-weight:900; line-height:1.05; letter-spacing:-.02em; text-shadow:0 8px 0 rgba(0,0,0,.25); }
  .b-box { display:inline-block; padding:.04em .3em; border-radius:.18em; }
  .b-stamp { color:#FF4D2E; border:12px solid currentColor; border-radius:22px; font-weight:900; padding:0 30px; letter-spacing:.02em; white-space:nowrap; background:rgba(255,255,255,.08); line-height:1.15; }
  .b-card { background:#FBF8F1; border-radius:28px; box-shadow:0 18px 0 rgba(0,0,0,.25); color:#141022; }
  .b-sign { position:absolute; inset:0; background:#FFD23F; border:12px solid #141022; border-radius:20px; color:#141022; text-align:center; font-weight:900; backface-visibility:hidden; display:flex; flex-direction:column; justify-content:center; }
  .b-bubble { background:#fff; color:#141022; border-radius:40px; font-weight:900; padding:18px 34px; box-shadow:0 12px 0 rgba(0,0,0,.2); white-space:nowrap; }
  .b-bubble::after { content:''; position:absolute; bottom:-30px; left:var(--tail, 60px); border:18px solid transparent; border-top:26px solid #fff; }
  .b-board { background:#0A1230; border:10px solid #2A355A; border-radius:24px; padding:26px 20px; text-align:center; box-shadow:0 18px 0 rgba(0,0,0,.3); }
  .b-flap { display:inline-block; width:.8em; margin:0 2px; background:#1A2448; border-radius:8px; text-align:center; color:#FFD23F; box-shadow:inset 0 -3px 0 rgba(0,0,0,.5); }`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  /* ---------- Helfer ---------- */
  let seed = 7;
  B.rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);   // reproduzierbarer Zufall (gleiches Bild bei jedem Render)
  B.seed = n => { seed = n; };
  B.put = (id, html) => { $(id).innerHTML = html; return id; };
  B.add = (id, html) => { $(id).insertAdjacentHTML('beforeend', html); return $(id).lastElementChild; };
  B.at = (x, y, s, inner) => `<g transform="translate(${x} ${y}) scale(${Array.isArray(s) ? s.join(' ') : s})">${inner}</g>`;
  B.hero = (id, x, y, s, o = {}) => B.at(x, y, s, W.FIG.human({ id, mood: o.mood || 'neutral', hoodie: o.hoodie, hoodieD: o.hoodieD, arm: o.arm, pose: o.pose })
    + (o.hat ? `<g transform="translate(0 -452)">${o.hat}</g>` : '') + (o.beard ? `<g transform="translate(0 -452)"><g id="${o.beard}">${W.PROPS.beard()}</g></g>` : ''));
  const clean = w => w.toLowerCase().replace(/[^\p{L}\p{N}%€]/gu, '');
  const hits = (sid, text) => R.TL.words.filter(w => w.scene === sid && clean(w.w).startsWith(clean(text)));
  B.WE = (sid, text, nth = 0) => { const h = hits(sid, text); return h[nth] ? h[nth].end : R.at(sid); };   // Wortende

  /* Gruppe → Szene */
  const G2S = {};
  B.scenes = (list, o) => { list.forEach(([s, g]) => (G2S[g] = s)); return R.scenes(list, o); };
  const sceneOf = (g, o) => o.s || G2S[g] || G2S[String(g).replace(/[a-z]+$/, '')] || ('s' + String(g).replace(/^\D+|[a-z]+$/g, ''));

  /* Zeit auflösen (siehe Kopfkommentar) */
  B.time = (s, w, fallback = 0) => {
    if (w == null) return R.at(s, fallback);
    if (typeof w === 'number') return R.at(s, w);
    if (typeof w === 'string') { if (!hits(s, w).length) console.warn(`Baustein: Wort "${w}" in ${s} nicht gefunden → Szenenstart`); return R.word(s, w); }
    if (Array.isArray(w)) { const [word, dt = 0, nth = 0] = w; if (!hits(s, word)[nth]) console.warn(`Baustein: Wort "${word}" (#${nth}) in ${s} nicht gefunden`); return R.word(s, word, nth) + dt; }
    if ('abs' in w) return w.abs + (w.dt || 0);
    if ('end' in w) return B.WE(s, w.end, w.nth || 0) + (w.dt || 0);
    if ('word' in w) return R.word(s, w.word, w.nth || 0) + (w.dt || 0);
    return R.at(s);
  };

  /* Szenengruppe anlegen, falls es sie im HTML noch nicht gibt */
  B.group = (gid, bg, o = {}) => {
    let el = $(gid);
    if (!el) {
      const world = $('world') || $('stage');
      el = document.createElement('div'); el.className = 'sc'; el.id = gid;
      el.style.cssText = 'position:absolute;inset:0;overflow:hidden';
      world.appendChild(el);
    }
    if (bg) el.insertAdjacentHTML('afterbegin', `<div class="bg" style="position:absolute;inset:0;background:${bg}"></div>`);
    if (o.svg) el.insertAdjacentHTML('beforeend', o.svg.startsWith('<') ? `<svg class="b-svg">${o.svg}</svg>` : '');
    return gid;
  };
  const svgIn = (g, inner) => B.add(g, `<svg class="b-svg">${inner}</svg>`);

  /* Reinkommen: hide + an Zeit t sichtbar + Bewegung. from: bottom | top | left | right | drop | pop | fade */
  B.enter = (id, t, from = 'bottom', o = {}) => {
    if (typeof t !== 'number') t = B.time(o.s || sceneOf(id, o), t);
    if (from === 'drop') { R.hide(id); R.dropIn(id, t, o); return id; }
    if (from === 'pop') { R.hide(id); R.popIn(id, t, o); return id; }
    R.hide(id); R.gset(id, { autoAlpha: 1 }, t);
    const d = o.dist ?? 900, v = { bottom: { y: d }, top: { y: -d }, left: { x: -d }, right: { x: d }, fade: { autoAlpha: 0 } }[from];
    R.gfrom(id, { ...v, duration: o.d ?? .45, ease: o.ease ?? (from === 'fade' ? 'power1.out' : 'back.out(1.5)') }, t);
    return id;
  };
  B.leave = (id, t, o = {}) => { R.g(id, { autoAlpha: 0, y: o.y ?? -60, duration: o.d ?? .25, ease: 'power2.in' }, t); return id; };

  /* Schild für Karten (SVG, um 0,0 zentriert) */
  B.pill = (text, o = {}) => {
    const fs = o.size || 36, w = Math.round(text.length * fs * .62 + fs * 1.6), h = Math.round(fs * 1.7);
    return `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${h / 2}" fill="${o.bg || '#fff'}"/><text y="${fs * .34}" text-anchor="middle" font-size="${fs}" font-weight="900" fill="${o.color || '#141022'}" font-family="Poppins, system-ui, sans-serif">${text}</text>`;
  };

  /* ---------- Titel / Hook: Zeilen untereinander, jede kommt mit eigenem Effekt ----------
     lines: [{text, size=96, color, box (Hintergrundfarbe), at, fx: up|chars|pop|slam|fade}], y = Oberkante der ersten Zeile */
  B.title = (g, o = {}) => {
    const s = sceneOf(g, o), id = o.id || nid('ti');
    let y = o.y ?? 250;
    (o.lines || []).forEach((l, i) => {
      const lid = `${id}_${i}`, size = l.size || 96, rows = (l.text.match(/<br>/g) || []).length + 1;
      const inner = l.box ? `<span class="b-box" style="background:${l.box}">${l.text}</span>` : l.text;
      B.add(g, `<div class="b-t" id="${lid}" style="top:${y}px;font-size:${size}px;color:${l.color || '#fff'};line-height:${l.box ? .98 : 1.05}">${inner}</div>`);
      const t = B.time(s, l.at, .05 + i * .25), fx = l.fx || (i === 0 ? 'up' : 'pop');
      if (fx === 'chars') { R.hide(lid); R.chars(lid, t - .1, { stagger: .025, y: 90 }); }
      else if (fx === 'up') B.enter(lid, t, 'bottom', { dist: 70, d: .4, ease: 'power3.out' });
      else if (fx === 'slam') { R.hide(lid); R.gset(lid, { autoAlpha: 1 }, t); R.gfrom(lid, { scale: 2.2, duration: .26, ease: 'power3.out' }, t); R.shake(t + .18); }
      else if (fx === 'fade') B.enter(lid, t, 'fade');
      else R.popIn(lid, t, { r: 0, sfx: l.sfx ?? 'pop' });
      y += size * (l.box ? 1.08 : 1.12) * rows + (l.gap ?? 14);
    });
    return id;
  };

  /* ---------- Zähler: große Zahl zählt hoch, kleiner Punch am Ende ----------
     {at, d=1, from=0, to, fmt, prefix, suffix, x=540, y=900, size=160, color, label, locale} */
  B.counter = (g, o = {}) => {
    const s = sceneOf(g, o), id = o.id || nid('cnt'), t = B.time(s, o.at, .2), d = o.d ?? 1;
    const loc = o.locale || (document.documentElement.lang === 'en' ? 'en-US' : 'de-DE');
    const fmt = o.fmt || (v => (o.prefix || '') + Math.round(v).toLocaleString(loc) + (o.suffix || ''));
    B.add(g, `<div class="b-abs" id="${id}" style="left:${o.x ?? 540}px;top:${o.y ?? 900}px;text-align:center;white-space:nowrap">
      ${o.label ? `<div style="font:800 ${Math.round((o.size || 160) * .3)}px Poppins,sans-serif;color:${o.labelColor || '#fff'};letter-spacing:.06em">${o.label}</div>` : ''}
      <div id="${id}n" style="font:900 ${o.size || 160}px/1 Poppins,sans-serif;color:${o.color || '#FFD23F'};text-shadow:0 10px 0 rgba(0,0,0,.25)">${fmt(o.from ?? 0)}</div></div>`);
    R.popIn(id, t, { r: 0, sfx: o.sfx ?? false });
    R.count(id + 'n', t + .1, d, o.from ?? 0, o.to, fmt, o.ease || 'out');
    R.g(id, { scale: 1.18, duration: .12, yoyo: true, repeat: 1, ease: 'power2.out' }, t + .1 + d);
    return id;
  };

  /* ---------- Stempel: knallt mit Wackler + Sound rein ----------  {text, at, x=540, y=600, r=-8, color, size=110} */
  B.stamp = (g, o = {}) => {
    const s = sceneOf(g, o), id = o.id || nid('st');
    B.add(g, `<div class="b-abs b-stamp" id="${id}" style="left:${o.x ?? 540}px;top:${o.y ?? 600}px;rotate:${o.r ?? -8}deg;font-size:${o.size || 110}px;color:${o.color || '#FF4D2E'}">${o.text}</div>`);
    R.slam(id, B.time(s, o.at));
    return id;
  };

  /* ---------- Zitat-Karte: Karte ploppt, Text tippt sich, Name blendet ein ----------
     {text, who, at, y=330, w=860, size=60, type=true, d, bg, color} */
  B.quote = (g, o = {}) => {
    const s = sceneOf(g, o), id = o.id || nid('qu'), t = B.time(s, o.at, .15), w = o.w || 860;
    B.add(g, `<div class="b-card" id="${id}" style="position:absolute;left:${540 - w / 2}px;top:${o.y ?? 330}px;width:${w}px;padding:60px 56px 44px;background:${o.bg || '#FBF8F1'};color:${o.color || '#141022'};rotate:${o.r ?? -2}deg">
      <div style="position:absolute;left:34px;top:-70px;font:900 220px/1 Georgia,serif;color:${o.accent || '#FF4D2E'}">“</div>
      <div id="${id}t" style="font:800 ${o.size || 60}px/1.18 Poppins,sans-serif;min-height:${(o.size || 60) * 1.18}px">${o.type === false ? o.text : ''}</div>
      ${o.who ? `<div id="${id}w" style="margin-top:26px;font:700 ${Math.round((o.size || 60) * .6)}px Poppins,sans-serif;opacity:.7;text-align:right">– ${o.who}</div>` : ''}</div>`);
    R.popIn(id, t, { r: o.r ? 0 : -4, sfx: o.sfx ?? 'pop' });
    const d = o.d ?? Math.min(2.4, o.text.length * .035);
    if (o.type !== false) R.type(id + 't', t + .3, d, o.text);
    if (o.who) { R.hide(id + 'w'); R.g(id + 'w', { autoAlpha: 1, duration: .3 }, t + .35 + (o.type === false ? 0 : d)); }
    return id;
  };

  /* ---------- Ortsschild: fällt rein, wird durchgestrichen, dreht sich um ----------
     {from:[klein, GROSS], to:[klein, GROSS], at (Reinfallen), strike (Wort/Zeit, optional), flip (Wort/Zeit), x=540, y=630, w=780, h=300, color} */
  B.sign = (g, o = {}) => {
    const s = sceneOf(g, o), id = o.id || nid('sg'), w = o.w || 780, h = o.h || 300, x = (o.x ?? 540) - w / 2, y = (o.y ?? 630) - h / 2;
    const face = (k, [small, big]) => `<div class="b-sign" id="${id}${k}" style="background:${o.color || '#FFD23F'}"><div style="font-size:40px">${small || ''}</div><div style="font-size:${big.length > 9 ? 96 : 112}px;line-height:1.1">${big}</div></div>`;
    B.add(g, `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;perspective:1600px" id="${id}">${face('a', o.from)}${o.to ? face('b', o.to) : ''}</div>`);
    if (o.strike != null) svgIn(g, `<path id="${id}x" d="M${x + 20} ${y + h} L${x + w - 20} ${y}" stroke="${o.strikeColor || '#FF4D2E'}" stroke-width="34" stroke-linecap="round" fill="none"/>`);
    R.gfromTo(id + 'a', { y: -900 }, { y: 0, duration: .8, ease: 'bounce.out' }, B.time(s, o.at, .05));
    if (o.strike != null) { $(id + 'x').style.strokeDashoffset = 1e4; R.draw(id + 'x', B.time(s, o.strike) - .05, .3); }
    if (o.to) {
      const tf = B.time(s, o.flip);
      R.g(id + 'a', { rotationY: 90, duration: .18, ease: 'power2.in' }, tf - .2);
      if (o.strike != null) R.gset(id + 'x', { autoAlpha: 0 }, tf - .2);
      R.hide(id + 'b'); R.gset(id + 'b', { autoAlpha: 1 }, tf - .02);
      R.gfromTo(id + 'b', { rotationY: -90 }, { rotationY: 0, duration: .35, ease: 'back.out(2)' }, tf - .02);
    }
    return id;
  };

  /* ---------- Close-up: Reaktionsgesicht schiebt sich ins Bild, Mimik wechselt auf Wörter ----------
     {at, mood='neutral', moods:[[zeit, mood], …], x=250, y=1010, scale=.62, from='bottom', capy=false, hoodie, cam: true | {x,y,s,d}}
     Moods: neutral, shock, happy, bliss, annoyed, sad */
  B.closeup = (g, o = {}) => {
    const s = sceneOf(g, o), id = o.id || nid('cu'), fid = id + 'f', t = B.time(s, o.at, .1);
    const x = o.x ?? 250, y = o.y ?? 1010, sc = o.scale ?? .62;
    const face = o.capy ? W.FIG.capyFace({ id: fid, eyes: o.eyes, acc: o.acc }) : W.FIG.humanFace({ id: fid, mood: o.mood || 'neutral', hoodie: o.hoodie, hoodieD: o.hoodieD });
    svgIn(g, `<g id="${id}"><g transform="translate(${x} ${y}) scale(${sc})">${face}</g></g>`);
    B.enter(id, t - .1, o.from || 'bottom', { dist: 700, ease: 'back.out(1.6)' });
    if (!o.capy && o.moods) W.FIG.mood(fid, [[0, o.mood || o.moods[0][1]], ...o.moods.map(([w, m]) => [typeof w === 'number' && w === 0 ? 0 : B.time(s, w), m])]);
    if (o.cam) { const c = o.cam === true ? {} : o.cam; R.cam(c.t != null ? B.time(s, c.t) : t + .3, c.d ?? 1.3, { x: c.x ?? x + 110, y: c.y ?? y - 110, s: c.s ?? 1.2 }, 'inout'); }
    return id;
  };

  /* ---------- Karte mit echten Grenzen (kit/map.js) ----------
     {box=[40,400,1000,790], projection='naturalEarth', view:{center,zoom}, style, res,
      fills: [[länder, zeit, farbe, stagger?], …], labels: [[text, [lon,lat], zeit, {bg, color, out}], …],
      star: [[lon,lat], zeit], views: [[zeit, dauer, {center, zoom}], …],
      route: {pts:[[lon,lat],…], from: zeit, to: zeit, color, head (id), …}}  → gibt die Karte (m) zurück */
  B.map = (g, o = {}) => {
    if (!W.MAP) throw new Error('B.map braucht geo-lib.js, geo-data-50m.js und map.js');
    const s = sceneOf(g, o), id = o.id || nid('map');
    B.add(g, `<svg class="b-svg" id="${id}"></svg>`);
    const m = W.MAP.create(id, { box: o.box || [40, 400, 1000, 790], projection: o.projection || 'naturalEarth', res: o.res,
      view: o.view || { center: [10, 48], zoom: 2.5 }, style: o.style || { ocean: '#1E3554', land: '#5E5878', border: '#2A2440' } });
    (o.fills || []).forEach(([q, w, color, stagger]) => {
      const list = [].concat(q); m.fill(list, B.time(s, w) - .15, color || '#C8302A', .3, stagger ?? Math.min(.06, .45 / list.length));
    });
    (o.views || []).forEach(([w, d, v]) => m.view(B.time(s, w), d, v));
    const L = m.layer();
    if (o.star) {
      const [ll, w] = o.star, sid = id + 'star';
      L.insertAdjacentHTML('beforeend', `<g id="${sid}"><path d="M0 -44 L13 -14 L44 -12 L20 8 L28 40 L0 22 L-28 40 L-20 8 L-44 -12 L-13 -14Z" fill="#FFD23F" stroke="#141022" stroke-width="5"/></g>`);
      m.pin(sid, ll); R.hide(sid); R.popIn(sid, B.time(s, w), { r: 0, sfx: 'ding' });
    }
    (o.labels || []).forEach(([text, ll, w, lo = {}], i) => {
      const lid = `${id}L${i}`;
      L.insertAdjacentHTML('beforeend', `<g id="${lid}"><g>${B.pill(text, lo)}</g></g>`);
      m.pin(lid, ll, lo.dx || 0, lo.dy || 0); R.hide(lid);
      R.popIn(lid, B.time(s, w), { r: 0, sfx: lo.sfx ?? false });
      if (lo.out != null) R.g(lid, { autoAlpha: 0, duration: .25 }, B.time(s, lo.out));
    });
    if (o.route) {
      const r = o.route, t0 = B.time(s, r.from), t1 = r.to != null ? B.time(s, r.to) : t0 + 1.5;
      m.route(id + 'r', r.pts, t0, t1 - t0, { color: r.color || '#fff', width: r.width || 8, head: r.head, rotate: r.rotate, keepHead: r.keepHead, glow: r.glow });
    }
    return m;
  };

  /* ---------- Fallblatt-Anzeige: Buchstaben rattern, bis sie stehen ----------  {text, at, d=1.1, x=540, y=520, title} */
  B.board = (g, o = {}) => {
    const s = sceneOf(g, o), id = o.id || nid('bd'), t = B.time(s, o.at, .1), txt = o.text.toUpperCase(), ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    B.add(g, `<div class="b-abs b-board" id="${id}" style="left:${o.x ?? 540}px;top:${o.y ?? 520}px;width:${o.w || 960}px">
      ${o.title ? `<div style="font:800 34px Poppins,sans-serif;color:#7FD3FF;letter-spacing:.14em;margin-bottom:14px">${o.title}</div>` : ''}
      <div id="${id}t" style="font:900 ${o.size || 54}px/1.3 'Courier New',monospace;white-space:nowrap"></div></div>`);
    R.gfromTo(id, { rotationX: -90, transformOrigin: '50% 0%', transformPerspective: 1200 }, { rotationX: 0, duration: .6, ease: 'back.out(1.6)' }, B.time(s, o.show ?? 0, .05));
    const d = o.d ?? 1.1;
    R.during(t - .2, d, (p, now) => {
      $(id + 't').innerHTML = [...txt].map((c, i) => {
        if (c === ' ') return '<span style="display:inline-block;width:.4em"></span>';
        const done = p >= .25 + i / txt.length * .7, k = (i * 7 + Math.floor(now * 24)) % ABC.length;
        return `<span class="b-flap">${p <= 0 ? '&nbsp;' : done ? c : ABC[k]}</span>`;
      }).join('');
    });
    return id;
  };

  /* ---------- Sprechblase ----------  {text, at, x, y, size=64, tail=60 (px von links), r} */
  B.bubble = (g, o = {}) => {
    const s = sceneOf(g, o), id = o.id || nid('bb');
    B.add(g, `<div class="b-abs b-bubble" id="${id}" style="left:${o.x ?? 540}px;top:${o.y ?? 600}px;font-size:${o.size || 64}px;--tail:${o.tail ?? 60}px">${o.text}</div>`);
    R.popIn(id, B.time(s, o.at), { r: o.r ?? -8, sfx: o.sfx ?? 'pop', origin: `${o.tail ?? 60}px 100%` });
    if (o.out != null) B.leave(id, B.time(s, o.out));
    return id;
  };

  /* ---------- Konfetti (physics2D) ----------  {at, n=40, x=540, y=800, colors, spread=110} */
  B.confetti = (g, o = {}) => {
    const s = sceneOf(g, o), id = o.id || nid('cf'), t = B.time(s, o.at), n = o.n || 40;
    const cols = o.colors || ['#FFD23F', '#FF4D2E', '#7FD3FF', '#2EAF5A', '#FF7A9A'];
    let h = ''; for (let i = 0; i < n; i++) h += `<rect id="${id}_${i}" x="${(o.x ?? 540) - 5}" y="${o.y ?? 800}" width="${14 + B.rnd() * 10}" height="${22 + B.rnd() * 12}" rx="4" fill="${cols[i % cols.length]}"/>`;
    svgIn(g, h);
    for (let i = 0; i < n; i++) {
      R.hide(`${id}_${i}`); R.gset(`${id}_${i}`, { autoAlpha: 1 }, t);
      R.g(`${id}_${i}`, { duration: o.d ?? 1.6, physics2D: { velocity: 900 + B.rnd() * 700, angle: -90 + (B.rnd() - .5) * (o.spread ?? 110), gravity: 1800 }, rotation: B.rnd() * 720 - 360, ease: 'none' }, t);
    }
    return id;
  };

  /* ---------- Aufsteigende Dinge (Herzen, Likes, Schweißtropfen nach oben …) ----------  {at, n=10, x=620, y=1100, item (SVG), every=.18, scale} */
  B.rise = (g, o = {}) => {
    const s = sceneOf(g, o), id = o.id || nid('rs'), t0 = B.time(s, o.at), n = o.n || 10, item = o.item || (W.PROPS && W.PROPS.heart());
    let h = ''; for (let i = 0; i < n; i++) h += `<g id="${id}_${i}">${B.at((o.x ?? 620) + (B.rnd() - .5) * 120, o.y ?? 1100, (o.scale ?? .7) + B.rnd() * .5, item)}</g>`;
    svgIn(g, h);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * (o.every ?? .18), k = `${id}_${i}`;
      R.hide(k); R.gset(k, { autoAlpha: 1 }, t);
      R.g(k, { y: -600 - B.rnd() * 300, x: (B.rnd() - .5) * 200, autoAlpha: 0, duration: 1.4, ease: 'power1.out' }, t);
    }
    return id;
  };

  W.B = B;
})();
