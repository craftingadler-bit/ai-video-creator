/* Reel-Runtime: Timeline, Animationen, Untertitel, Lippen-Sync, Preview + Render-Hook.
   Wird von jedem reels/<slug>/scenes.html geladen. Bühne: 1080x1920 px. */
(function () {
  const TL = window.TIMELINE || { total: 10, scenes: [], words: [] };
  const RENDER = !!window.__RENDER;
  const E = {
    lin: p => p, out: p => 1 - (1 - p) ** 3, in: p => p * p * p, grav: p => p * p,
    inout: p => (p < .5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2),
    back: p => { const c = 1.9; return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2; }
  };
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const $ = id => (typeof id === 'string' ? document.getElementById(id) : id);

  const BASE = {}, TW = {}, DUR = [], SHAKES = [], SFX = [];
  const R = { TL, TOTAL: TL.total, E, clamp, $ };

  /* ---------- Zeit relativ zu Szenen ---------- */
  R.scene = id => TL.scenes.find(s => s.id === id) || (console.warn('Szene fehlt:', id), { start: 0, end: TL.total });
  R.at = (id, dt = 0) => R.scene(id).start + dt;           // Sekunden ab Szenenstart
  R.end = (id, dt = 0) => R.scene(id).end + dt;            // dt negativ = vor Szenenende
  R.word = (id, text, nth = 0) => {                         // Zeitpunkt, an dem ein Wort gesprochen wird
    const s = R.scene(id), low = text.toLowerCase();
    const hits = TL.words.filter(w => w.scene === id && w.w.toLowerCase().replace(/[^\p{L}\p{N}%€]/gu, '').startsWith(low));
    return hits[nth] ? hits[nth].start : s.start;
  };

  /* ---------- Tween-Engine ---------- */
  R.init = (id, st) => { BASE[id] = Object.assign(BASE[id] || { x: 0, y: 0, s: 1, r: 0, o: 1 }, st); TW[id] ||= []; };
  R.tw = (id, t, d, from, to, ease = 'out') => { if (!BASE[id]) R.init(id, {}); TW[id].push({ t, d, from, to, ease }); };
  // R.sfx(t, name, vol, {len, kind}): bewusst gesetzter Sound. len = max. Länge in s, kind 'bed' = Atmo.
  // AUTO = Sounds, die Helfer (pop, slam, Übergänge …) von selbst setzen: werden im Mix ausgedünnt und leiser gehalten.
  R.sfx = (t, name, vol = 1, o = {}) => SFX.push({ t, name, vol, ...o });
  let autoOn = true; R.autoSfx = on => { autoOn = on; };   // R.autoSfx(false) am Anfang: nur die Sounds aus der Sound-Liste
  const AUTO = (t, name, vol = 1) => { if (autoOn) SFX.push({ t, name, vol, auto: true }); };
  const hidden = id => { if (!TW[id] || !TW[id].length) R.init(id, { o: 0 }); };
  R.pop = (id, t, sfx = 'pop') => { hidden(id); R.tw(id, t, .45, { o: 0, s: .35 }, { o: 1, s: 1 }, 'back'); if (sfx) AUTO(t, sfx, .6); };
  R.slam = (id, t) => { hidden(id); R.tw(id, t, .26, { o: 0, s: 2.1 }, { o: 1, s: 1 }, 'out'); AUTO(t, 'slam'); R.shake(t + .18); };
  R.fadeIn = (id, t, d = .4) => { hidden(id); R.tw(id, t, d, { o: 0 }, { o: 1 }); };
  R.up = (id, t) => { hidden(id); R.tw(id, t, .4, { o: 0, y: 70 }, { o: 1, y: 0 }); };
  R.fadeOut = (id, t, d = .3) => R.tw(id, t, d, {}, { o: 0, s: .94 }, 'in');
  R.slideIn = (id, t, dir = 1) => { hidden(id); R.tw(id, t, .6, { o: 1, x: 1080 * dir }, { x: 0 }, 'out'); AUTO(t, 'whoosh', .5); };
  R.slideOut = (id, t, dir = 1) => R.tw(id, t, .45, {}, { x: -1080 * dir }, 'in');
  R.move = (id, t, d, to, ease = 'inout') => R.tw(id, t, d, {}, to, ease);
  R.show = (id, t0, t1, how = 'pop') => { R[how](id, t0); if (t1 != null) R.fadeOut(id, t1); };
  R.during = (t, d, fn) => DUR.push({ t, d, fn });
  R.shake = (t, d = .3, a = 18) => SHAKES.push({ t, d, a });

  /* Szene als Ganzes: Gruppe ein-/ausblenden passend zum Voiceover */
  R.sceneGroup = (gid, sid, how = 'slide') => {
    const s = R.scene(sid);
    if (how === 'slide') { R.slideIn(gid, s.start); if (s.end < TL.total - .01) R.slideOut(gid, s.end - .25); }
    else { R.fadeIn(gid, s.start, .25); if (s.end < TL.total - .01) R.fadeOut(gid, s.end - .2, .2); }
  };

  /* Helfer: Tippen, Zähler, Pfad zeichnen */
  R.type = (id, t, d, text) => R.during(t, d, (p, now) => {
    const n = Math.floor(p * text.length); const caret = p > 0 && p < 1 && Math.floor(now * 4) % 2 === 0;
    $(id).textContent = text.slice(0, n) + (caret ? '|' : '');
  });
  R.count = (id, t, d, from, to, fmt = v => Math.round(v).toLocaleString('de-DE'), ease = 'out') =>
    R.during(t, d, p => { $(id).textContent = fmt(from + (to - from) * E[ease](p)); });
  R.draw = (id, t, d, ease = 'inout') => {          // SVG-Pfad zeichnet sich selbst
    const el = $(id), L = el.getTotalLength(); el.style.strokeDasharray = L;
    R.during(t, d, p => { el.style.strokeDashoffset = L * (1 - E[ease](p)); });
  };

  /* ---------- GSAP (kit/vendor/gsap-all.js vor runtime.js laden) ----------
     Eine pausierte Master-Timeline, Zeit = Videosekunden. Wird pro Frame exakt gesucht → deterministisch.
     NIE gsap.to() direkt (läuft in Echtzeit), immer R.g / R.tl. Ein Element entweder per R.tw/R.pop ODER per GSAP bewegen, nie beides. */
  const G = window.gsap;
  if (G) {
    R.tl = G.timeline({ paused: true });
    const T = x => Array.isArray(x) ? x.map(T) : (typeof x === 'string' && /^[\w-]+$/.test(x) ? '#' + x : x);
    R.g = (target, vars, t) => R.tl.to(T(target), vars, t);
    R.gfrom = (target, vars, t) => R.tl.from(T(target), vars, t);
    R.gfromTo = (target, from, to, t) => R.tl.fromTo(T(target), from, to, t);
    R.gset = (target, vars, t) => R.tl.set(T(target), vars, t);
    R.hide = (target, t = 0) => R.tl.set(T(target), { autoAlpha: 0 }, t);
    const once = {}, ease = (name, make) => (once[name] ||= (make(), name));
    /* Cartoon-Helfer */
    R.popIn = (id, t, o = {}) => { R.tl.fromTo(T(id), { autoAlpha: 0, scale: 0, rotation: o.r ?? -12 },
      { autoAlpha: 1, scale: 1, rotation: 0, duration: o.d ?? .55, ease: o.ease ?? 'back.out(2.6)', transformOrigin: o.origin ?? '50% 50%' }, t); if (o.sfx !== false) AUTO(t, o.sfx || 'pop', .6); };
    R.dropIn = (id, t, o = {}) => {                     // fällt von oben, landet mit Squash & Stretch
      const b = ease('bnc', () => window.CustomBounce.create('bnc', { strength: o.strength ?? .45, squash: 2.2, squashID: 'bnc-sq' }));
      R.tl.set(T(id), { autoAlpha: 1, transformOrigin: '50% 100%' }, t);
      R.tl.fromTo(T(id), { y: o.from ?? -1400 }, { y: 0, duration: o.d ?? .9, ease: b }, t);
      R.tl.fromTo(T(id), { scaleX: 1, scaleY: 1 }, { scaleX: 1.35, scaleY: .7, duration: o.d ?? .9, ease: 'bnc-sq' }, t);
      if (o.sfx !== false) AUTO(t + (o.d ?? .9) * .42, o.sfx || 'drop', .7);
    };
    R.wiggle = (id, t, o = {}) => {                     // Wackeln (Schock, Lachen, Aufregung)
      const w = ease('wig' + (o.n ?? 6), () => window.CustomWiggle.create('wig' + (o.n ?? 6), { wiggles: o.n ?? 6, type: 'easeOut' }));
      R.tl.to(T(id), { [o.prop || 'rotation']: o.a ?? 9, duration: o.d ?? .7, ease: w, transformOrigin: o.origin ?? '50% 100%' }, t);
    };
    R.squash = (id, t, o = {}) => {                     // kurz zusammendrücken (Landen, Lachen, Schreck)
      R.tl.to(T(id), { scaleX: o.x ?? 1.18, scaleY: o.y ?? .82, duration: .09, ease: 'power2.out', transformOrigin: '50% 100%' }, t)
        .to(T(id), { scaleX: 1, scaleY: 1, duration: .5, ease: 'elastic.out(1.1,.35)' }, t + .09);
    };
    R.bob = (id, t0, t1, o = {}) => {                   // Atmen / Wippen in einer Szene
      const d = o.d ?? .7, n = Math.max(1, Math.floor((t1 - t0) / d) - 1);
      R.tl.to(T(id), { [o.prop || 'y']: o.a ?? -10, duration: d, repeat: n, yoyo: true, ease: 'sine.inOut' }, t0);
    };
    R.morph = (id, t, d, shape, e = 'power2.inOut') => R.tl.to(T(id), { morphSVG: shape, duration: d, ease: e }, t);
    R.path = (id, t, d, path, o = {}) => R.tl.to(T(id), { duration: d, ease: o.ease ?? 'power1.inOut',
      motionPath: { path: T(path), align: T(path), alignOrigin: [.5, .5], autoRotate: o.rotate ?? false } }, t);
    R.chars = (id, t, o = {}) => {                      // Text Buchstabe für Buchstabe reinploppen
      const s = new window.SplitText(T(id), { type: 'chars' });
      R.tl.from(s.chars, { autoAlpha: 0, y: o.y ?? 60, scale: o.s ?? .3, rotation: o.r ?? 0, duration: .4, ease: 'back.out(2.2)', stagger: o.stagger ?? .035 }, t);
      R.tl.set(T(id), { autoAlpha: 1 }, t);
    };
  }

  /* ---------- Kamera (bewegt #world; Untertitel bleiben stehen) ----------
     R.cam(t, d, {x, y, s, r}): Punkt (x,y) der Bühne kommt in die Bildmitte, Zoom s. Start: x 540, y 960, s 1. */
  R.init('__cam', { x: 540, y: 960, s: 1, r: 0, o: 1 });
  R.cam = (t, d, to, e = 'inout') => R.tw('__cam', t, d, {}, to, e);
  R.camCut = (t, to) => R.tw('__cam', t, .001, to, to, 'lin');

  /* ---------- Szenen mit Übergängen ----------
     R.scenes([['s1','g1'], ['s2','g2','zoom'], …], {drift: true})
     Gruppe gN ist sichtbar während Szene sN, Wechsel per Übergang (3. Eintrag, sonst Wechsel aus der Liste).
     Übergänge: whip, zoom, push, drop, spin, iris, flash, cut. drift = leichte Kamerafahrt pro Szene. */
  const TRANS = ['whip', 'zoom', 'push', 'iris', 'whip', 'spin', 'push', 'flash'];
  R.trans = (type, a, b, t, d = .5) => {
    if (!G) return console.warn('R.trans braucht kit/vendor/gsap-all.js');
    const tl = R.tl, A = a && T0(a), B = T0(b), org = el => el instanceof SVGElement ? { svgOrigin: '540 960' } : { transformOrigin: '540px 960px' };
    const ob = { ...org($(b)) }, oa = a ? { ...org($(a)) } : {};
    const hideA = () => A && tl.set(A, { autoAlpha: 0, x: 0, y: 0, scale: 1, rotation: 0, filter: 'none', clipPath: 'none' }, t + d);
    tl.set(B, { autoAlpha: 1, ...ob }, t);
    if (type === 'whip') {
      if (A) tl.to(A, { x: -1300, filter: 'blur(28px)', duration: d * .6, ease: 'power3.in', ...oa }, t);
      tl.fromTo(B, { x: 1300, filter: 'blur(28px)' }, { x: 0, filter: 'blur(0px)', duration: d, ease: 'power3.out' }, t + d * .3);
      AUTO(t, 'whoosh', .6);
    } else if (type === 'zoom') {
      if (A) tl.to(A, { scale: 3.2, autoAlpha: 0, filter: 'blur(14px)', duration: d * .7, ease: 'power2.in', ...oa }, t);
      tl.fromTo(B, { scale: .45, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: d, ease: 'back.out(1.6)' }, t + d * .35);
      AUTO(t, 'whoosh', .5);
    } else if (type === 'push') {
      if (A) tl.to(A, { y: -2000, duration: d * .8, ease: 'power3.in', ...oa }, t);
      tl.fromTo(B, { y: 2000 }, { y: 0, duration: d * 1.1, ease: 'back.out(1.15)' }, t + d * .15);
      AUTO(t, 'whoosh', .5);
    } else if (type === 'drop') {
      if (A) tl.to(A, { y: 400, autoAlpha: 0, duration: d * .6, ease: 'power2.in', ...oa }, t);
      tl.fromTo(B, { y: -2000 }, { y: 0, duration: d * 1.6, ease: 'bounce.out' }, t);
      AUTO(t + d * .7, 'drop', .6);
    } else if (type === 'spin') {
      if (A) tl.to(A, { rotation: -100, scale: .2, autoAlpha: 0, duration: d * .7, ease: 'power3.in', ...oa }, t);
      tl.fromTo(B, { rotation: 100, scale: 1.8, autoAlpha: 0 }, { rotation: 0, scale: 1, autoAlpha: 1, duration: d, ease: 'power3.out' }, t + d * .3);
      AUTO(t, 'whoosh', .6);
    } else if (type === 'iris') {
      tl.fromTo(B, { clipPath: 'circle(0% at 50% 42%)' }, { clipPath: 'circle(120% at 50% 42%)', duration: d * 1.2, ease: 'power2.inOut' }, t);
      AUTO(t, 'whoosh', .4); if (A) tl.set(A, { autoAlpha: 0 }, t + d * 1.2); tl.set(B, { clipPath: 'none' }, t + d * 1.2);
      return;
    } else if (type === 'flash') {
      const f = flashEl(); tl.fromTo(f, { opacity: 0 }, { opacity: 1, duration: d * .35, ease: 'power2.in' }, t)
        .to(f, { opacity: 0, duration: d * .8, ease: 'power2.out' }, t + d * .35);
      tl.set(B, { autoAlpha: 0 }, t); tl.set(B, { autoAlpha: 1 }, t + d * .35); if (A) tl.set(A, { autoAlpha: 0 }, t + d * .35);
      tl.fromTo(B, { scale: 1.12 }, { scale: 1, duration: d * 1.2, ease: 'power3.out' }, t + d * .35);
      AUTO(t, 'whoosh', .4); return;
    } else { // cut: harter Schnitt mit Punch-in
      if (A) tl.set(A, { autoAlpha: 0 }, t);
      tl.fromTo(B, { scale: 1.1 }, { scale: 1, duration: .35, ease: 'power3.out' }, t);
      return;
    }
    hideA();
  };
  function T0(x) { return typeof x === 'string' ? '#' + x : x; }
  function flashEl() {
    let f = document.getElementById('__flash');
    if (!f) { f = document.createElement('div'); f.id = '__flash'; f.style.cssText = 'position:absolute;inset:0;background:#fff;opacity:0;z-index:40;pointer-events:none';
      (document.getElementById('stage') || document.body).appendChild(f); }
    return f;
  }
  R.scenes = (list, o = {}) => {
    const d = o.d ?? .5;
    list.forEach(([sid, gid, type], i) => {
      const s = R.scene(sid);
      if (i === 0) { R.tl.set('#' + gid, { autoAlpha: 1 }, 0); }
      else {
        R.tl.set('#' + gid, { autoAlpha: 0 }, 0);
        R.trans(type || o.order?.[i % o.order.length] || TRANS[(i - 1) % TRANS.length], list[i - 1][1], gid, Math.max(0, s.start - d * .45), d);
      }
      if (o.drift !== false) {                          // leichte Kamerafahrt, abwechselnd rein/raus und seitlich
        const k = i % 4, fx = [540, 600, 480, 540][k], fy = [960, 900, 1000, 940][k], s0 = k % 2 ? 1.07 : 1, s1 = k % 2 ? 1 : 1.07;
        R.camCut(s.start, { x: 540, y: 960, s: s0, r: 0 });
        R.cam(s.start + .01, Math.max(.5, s.end - s.start - .02), { x: fx, y: fy, s: s1 }, 'lin');
      }
    });
  };

  /* ---------- Lottie (kit/vendor/lottie.js + kit/lottie/<name>.js laden) ----------
     const a = R.lottie('containerId', 'mascot-walk', {t: R.at('s3'), speed: 1, loop: false})
     a.play(t, fromFrame, toFrame, {loop, speed})   weitere Clips (z. B. nur "point"-Teil) zu Zeitpunkt t
     Frames statt Zeit, damit Marker aus der Datei passen. Vor t: erster Frame des ersten Clips. */
  const LOT = [], LOADS = [];
  R.lottie = (cid, name, o = {}) => {
    const data = (window.LOTTIE || {})[name];
    if (!window.lottie || !data) { console.warn('Lottie fehlt:', name, '→ kit/vendor/lottie.js und kit/lottie/' + name + '.js einbinden'); return { play() { return this; } }; }
    const anim = window.lottie.loadAnimation({ container: $(cid), renderer: 'svg', loop: false, autoplay: false,
      animationData: JSON.parse(JSON.stringify(data)), rendererSettings: { preserveAspectRatio: o.fit || 'xMidYMid meet' } });
    LOADS.push(new Promise(r => { if (anim.isLoaded) r(); else { anim.addEventListener('DOMLoaded', r); setTimeout(r, 3000); } }));
    const fr = data.fr, h = { anim, clips: [], fr, markers: Object.fromEntries((data.markers || []).map(m => [m.cm, m.tm])),
      play(t, from = data.ip, to = data.op - 1, c = {}) { this.clips.push({ t, from, to, loop: !!c.loop, speed: c.speed ?? 1 }); this.clips.sort((a, b) => a.t - b.t); return this; } };
    if (o.t != null) h.play(o.t, o.from ?? data.ip, o.to ?? data.op - 1, o);
    LOT.push(h); return h;
  };
  function lottieFrame(now) {
    for (const h of LOT) {
      if (!h.clips.length) continue;
      let c = h.clips[0]; for (const k of h.clips) if (now >= k.t) c = k;
      const len = c.to - c.from; let f = Math.max(0, (now - c.t) * h.fr * c.speed);
      f = c.loop ? f % Math.max(1, len) : Math.min(f, len);
      const fr = c.from + f;
      if (h.last !== fr) { h.anim.goToAndStop(Math.min(fr, c.to - .01), true); h.last = fr; }
    }
  }

  /* ---------- Lippen-Sync ---------- */
  R.talk = now => {                                  // 0..1, wie weit der Mund offen ist
    const w = TL.words.find(w => now >= w.start && now < w.end);
    if (!w) return 0;
    const k = (now - w.start) / Math.max(.08, w.end - w.start);
    return clamp(Math.sin(k * Math.PI) * (.6 + .4 * Math.abs(Math.sin(now * 23))));
  };
  R.mouth = (id, onlyScenes) => R.during(0, TL.total, (p, now) => {
    const cur = TL.scenes.find(s => now >= s.start && now < s.end);
    const on = !onlyScenes || (cur && onlyScenes.includes(cur.id));
    const el = $(id); el.style.transformBox = 'fill-box'; el.style.transformOrigin = 'center';
    el.style.transform = `scaleY(${on ? .15 + .85 * R.talk(now) : .15})`;
  });

  /* ---------- Untertitel ---------- */
  const CAP = Object.assign({ y: 1390, size: 66, maxWords: 3, color: '#fff', active: '#FFD23F', box: '#FF4D2E', on: true }, window.CAPTIONS || {});
  R.captions = opts => Object.assign(CAP, opts);
  let chunks = null, capEl = null;
  function buildChunks() {
    chunks = []; let cur = [];
    TL.words.forEach((w, i) => {
      cur.push(w);
      const next = TL.words[i + 1];
      const brk = /[.,!?:;…]$/.test(w.w) || cur.length >= CAP.maxWords || !next || next.scene !== w.scene || next.start - w.end > .35;
      if (brk) { chunks.push(cur); cur = []; }
    });
    chunks.forEach((c, i) => { c.start = c[0].start; c.end = chunks[i + 1] ? Math.min(chunks[i + 1][0].start, c[c.length - 1].end + .5) : c[c.length - 1].end + .4; });
    capEl = document.createElement('div'); capEl.id = 'captions';
    capEl.style.cssText = `position:absolute;left:60px;right:60px;top:${CAP.y}px;transform:translateY(-50%);text-align:center;font:900 ${CAP.size}px/1.15 var(--cap-font, 'Poppins', system-ui, sans-serif);letter-spacing:-.01em;z-index:50;pointer-events:none`;
    (document.getElementById('stage') || document.body).appendChild(capEl);
  }
  let lastCap = '';
  function renderCaptions(now) {
    if (!CAP.on || !TL.words.length) return;
    if (!chunks) buildChunks();
    const c = chunks.find(c => now >= c.start && now < c.end);
    let html = '', sc = 1;
    if (c) {
      sc = .82 + .18 * E.back(clamp((now - c.start) / .14));
      html = c.map(w => {
        const txt = w.w.replace(/[<>&]/g, '');
        const active = now >= w.start && now < w.end + .05;
        if (w.kw) return `<span style="background:${CAP.box};color:#fff;padding:0 .18em;border-radius:.16em;-webkit-box-decoration-break:clone">${txt}</span>`;
        return `<span style="color:${active ? CAP.active : CAP.color}">${txt}</span>`;
      }).join(' ');
    }
    const key = html + sc.toFixed(2);
    if (key !== lastCap) {
      capEl.innerHTML = html;
      capEl.style.transform = `translateY(-50%) scale(${sc})`;
      capEl.style.textShadow = '0 0 2px #000, 0 6px 0 rgba(0,0,0,.55), 0 0 24px rgba(0,0,0,.35)';
      capEl.style.webkitTextStroke = '3px rgba(0,0,0,.85)'; capEl.style.paintOrder = 'stroke fill';
      lastCap = key;
    }
  }

  /* ---------- Frame rendern ---------- */
  const EL = {}, LAST = {}; let CAMST = { x: 540, y: 960, s: 1, r: 0 };
  function frame(now) {
    for (const id in BASE) {
      const st = { ...BASE[id] };
      for (const w of TW[id]) {
        if (now < w.t) break;
        const e = E[w.ease](clamp((now - w.t) / w.d));
        for (const k in w.to) { const a = (k in w.from) ? w.from[k] : st[k]; st[k] = a + (w.to[k] - a) * e; }
        for (const k in w.from) if (!(k in w.to)) st[k] = w.from[k];
      }
      if (id === '__cam') { CAMST = st; continue; }
      const el = EL[id] ||= $(id);
      if (!el) continue;
      if (el instanceof SVGElement && !el.__box) { el.style.transformBox = 'fill-box'; el.style.transformOrigin = 'center'; el.__box = 1; }
      const tr = `translate(${st.x.toFixed(1)}px,${st.y.toFixed(1)}px) rotate(${st.r.toFixed(2)}deg) scale(${st.s.toFixed(3)})`;
      const op = clamp(st.o).toFixed(3), key = tr + op;
      if (LAST[id] !== key) { el.style.transform = tr; el.style.opacity = op; el.style.visibility = +op < .005 ? 'hidden' : 'visible'; LAST[id] = key; }
    }
    if (R.tl) R.tl.seek(Math.max(0, now), true);
    lottieFrame(now);
    DUR.filter(d => now < d.t).forEach(d => d.fn(0, now));
    DUR.filter(d => now >= d.t).forEach(d => d.fn(clamp((now - d.t) / d.d), now));
    let sx = 0, sy = 0;
    for (const s of SHAKES) { const k = now - s.t; if (k >= 0 && k < s.d) { const a = s.a * (1 - k / s.d); sx = Math.sin(now * 90) * a; sy = Math.cos(now * 77) * a; } }
    const world = document.getElementById('world');
    if (world) {
      const c = CAMST, camOn = c.s !== 1 || c.x !== 540 || c.y !== 960 || c.r;
      world.style.transformOrigin = '0 0';
      const tx = c.s >= 1 ? clamp(540 - c.x * c.s, 1080 - 1080 * c.s, 0) : 540 - c.x * c.s, ty = c.s >= 1 ? clamp(960 - c.y * c.s, 1920 - 1920 * c.s, 0) : 960 - c.y * c.s;  // nie über den Rand fahren
      world.style.transform = (camOn ? `translate(${(tx + sx).toFixed(1)}px,${(ty + sy).toFixed(1)}px) rotate(${c.r}deg) scale(${c.s.toFixed(4)})`
        : sx ? `translate(${sx}px,${sy}px)` : '');
    }
    renderCaptions(now);
    const bar = document.getElementById('__bar'); if (bar) bar.style.width = (now / TL.total * 100) + '%';
  }

  /* ---------- Start: Render-Modus oder Preview ---------- */
  R.start = () => {
    for (const id in TW) TW[id].sort((a, b) => a.t - b.t);
    SFX.sort((a, b) => a.t - b.t);
    window.__SFX = SFX; window.__TOTAL = TL.total;
    window.__seek = t => frame(t);
    if (R.tl) for (const id in BASE) if (id !== '__cam' && R.tl.getTweensOf('#' + id).length) console.warn('Element', id, 'wird von R.tw UND GSAP bewegt → in eine eigene <g>/<div> packen');
    Promise.all(LOADS).then(() => {
      frame(0);
      if (RENDER) { window.__ready = true; return; }
      preview();
    });
  };

  function preview() {
    const stage = document.getElementById('stage');
    const fit = () => { const k = Math.min(innerWidth / 1080, innerHeight / 1920); stage.style.transform = `scale(${k})`; stage.style.left = (innerWidth - 1080 * k) / 2 + 'px'; };
    stage.style.position = 'absolute'; stage.style.transformOrigin = '0 0'; fit(); addEventListener('resize', fit);
    const bar = document.createElement('div');
    bar.style.cssText = 'position:absolute;left:0;bottom:0;height:14px;width:100%;background:rgba(0,0,0,.25);z-index:99;cursor:pointer';
    bar.innerHTML = '<i id="__bar" style="display:block;height:100%;width:0;background:#FF4D2E"></i>';
    stage.appendChild(bar);
    const audio = new Audio('vo.wav'); let playing = false, t = 0, last = performance.now(), prev = 0;
    const sfxCache = {}; const playSfx = n => { try { if (!sfxCache[n]) { sfxCache[n] = new Audio('sfx/' + n + '.wav'); sfxCache[n].onerror = () => { sfxCache[n] = new Audio('../../kit/sfx/' + n + '.wav'); }; }
      const a = sfxCache[n].cloneNode(); a.volume = .5; a.play().catch(() => {}); } catch (e) {} };  // Reel-Sounds (sfx/) zuerst, sonst kit/sfx
    const hint = document.createElement('div');
    hint.textContent = '▶  Klicken zum Abspielen · Leertaste = Pause · Balken = Spulen';
    hint.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);color:#fff;font:800 44px Poppins,system-ui;z-index:100;text-align:center;padding:80px';
    stage.appendChild(hint);
    const toggle = () => { hint.remove(); playing = !playing; if (playing) { if (t >= TL.total) t = 0; audio.currentTime = t; audio.play().catch(() => {}); } else audio.pause(); };
    stage.addEventListener('click', e => { if (e.target.closest('#__bar') || e.target === bar) return; toggle(); });
    bar.addEventListener('click', e => { e.stopPropagation(); const r = bar.getBoundingClientRect(); t = clamp((e.clientX - r.left) / r.width) * TL.total; audio.currentTime = t; prev = t; });
    addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); toggle(); } });
    (function loop(ts) {
      const dt = (ts - last) / 1000; last = ts;
      if (playing) {
        t = !audio.paused && audio.readyState > 2 ? audio.currentTime : Math.min(TL.total, t + dt);
        for (const c of SFX) if (c.t > prev && c.t <= t) playSfx(c.name);
        if (t >= TL.total) { playing = false; audio.pause(); }
      }
      prev = t; frame(t); requestAnimationFrame(loop);
    })(last);
    const q = new URLSearchParams(location.search).get('t'); if (q) { hint.remove(); t = +q; }
  }

  window.R = R;
})();
