/* Echte Karten für Reels: Natural-Earth-Ländergrenzen, Projektionen von d3-geo, alles synchron zur Timeline.
   Einbinden NACH runtime.js:
     <script src="../../kit/geo-lib.js"></script>
     <script src="../../kit/geo-data-50m.js"></script>   (für starke Zooms: geo-data-10m.js)
     <script src="../../kit/map.js"></script>
   Nutzung:
     const m = MAP.create('map1', { box: [60, 300, 960, 900], projection: 'mercator', view: { center: [-60, -15], zoom: 2.2 } });
     m.view(R.at('s4'), 1.6, { center: [-80, 28], zoom: 7 });        // Kamerafahrt
     m.fill(['Brazil', 'Argentina'], R.word('s4', 'Südamerika'), '#9B6A43');  // Länder einfärben (Name, ISO-Zahl oder Liste)
     m.pin('pin1', [-81.7, 28.1]);                                  // HTML/SVG-Element klebt an einem Ort
     m.route('r1', [[-58, -20], [10, 51]], R.at('s6'), 1.2);       // Bogen-Linie zeichnet sich
   Länder-Namen: englisch wie in Natural Earth ("United States of America", "Germany", "Brazil" …). m.names() listet alle. */
(function () {
  const W = window, R = W.R;
  const hex = c => { c = c.replace('#', ''); if (c.length === 3) c = [...c].map(x => x + x).join(''); return [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16)); };
  const mix = (a, b, p) => { const A = hex(a), B = hex(b); return 'rgb(' + A.map((v, i) => Math.round(v + (B[i] - v) * p)).join(',') + ')'; };
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent && parent.appendChild(e); return e; };

  function create(id, o = {}) {
    const topo = o.res === '10m' ? W.WORLD_10M : W.WORLD_50M || W.WORLD_10M;
    if (!topo || !W.d3 || !W.topojson) throw new Error('MAP: geo-lib.js / geo-data-*.js fehlen (node kit/build-geo.mjs)');
    const [bx, by, bw, bh] = o.box || [60, 300, 960, 900];
    const st = Object.assign({ ocean: '#1E3554', land: '#5E5878', border: '#2A2440', borderW: 1.4, radius: 36, grid: true, shadow: true }, o.style || {});
    const root = typeof id === 'string' ? document.getElementById(id) : id;
    const svg = root.tagName.toLowerCase() === 'svg' ? root : mk('svg', { width: 1080, height: 1920, style: 'position:absolute;inset:0;overflow:visible' }, root);
    const g = mk('g', {}, svg);
    const clipId = 'clip_' + (root.id || 'map') + '_' + (create.n = (create.n || 0) + 1);   // fest statt zufällig, sonst greift der Frame-Cache bei Karten nie
    const defs = mk('defs', {}, g);
    mk('rect', { x: bx, y: by, width: bw, height: bh, rx: st.radius }, mk('clipPath', { id: clipId }, defs));
    if (st.shadow) mk('rect', { x: bx, y: by + 18, width: bw, height: bh, rx: st.radius, fill: 'rgba(0,0,0,.28)' }, g);
    mk('rect', { x: bx, y: by, width: bw, height: bh, rx: st.radius, fill: st.ocean }, g);
    const inner = mk('g', { 'clip-path': `url(#${clipId})` }, g);
    const gridEl = st.grid ? mk('path', { fill: 'none', stroke: 'rgba(255,255,255,.07)', 'stroke-width': 1.5 }, inner) : null;
    const landG = mk('g', {}, inner);
    const overG = mk('g', {}, inner);          // Routen, Flächen über den Ländern
    const pinG = mk('g', {}, inner);

    const features = W.topojson.feature(topo, topo.objects.countries).features;
    const borders = W.topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b);
    const coast = W.topojson.mesh(topo, topo.objects.countries, (a, b) => a === b);
    const C = features.map(f => ({ f, name: f.properties.name, id: f.id, el: mk('path', { fill: st.land }, landG), cur: st.land, keys: [] }));
    const borderEl = mk('path', { fill: 'none', stroke: st.border, 'stroke-width': st.borderW, 'stroke-linejoin': 'round' }, landG);
    const coastEl = mk('path', { fill: 'none', stroke: st.coast || 'rgba(255,255,255,.18)', 'stroke-width': st.coastW || 1.6, 'stroke-linejoin': 'round' }, landG);
    const find = q => { const qs = [].concat(q); return C.filter(c => qs.some(x => x === c.name || String(x) === String(c.id))); };
    const missing = q => [].concat(q).filter(x => !C.some(c => c.name === x || String(c.id) === String(x)));

    const kind = o.projection || 'mercator';
    const P = { mercator: W.d3.geoMercator, naturalEarth: W.d3.geoNaturalEarth1, orthographic: W.d3.geoOrthographic, equalEarth: W.d3.geoEqualEarth }[kind]();
    const base = kind === 'orthographic' ? Math.min(bw, bh) / 2.1 : bw / (2 * Math.PI);
    if (kind !== 'orthographic') P.clipExtent([[bx - 20, by - 20], [bx + bw + 20, by + bh + 20]]);
    P.precision(.3);
    const path = W.d3.geoPath(P);
    const cams = [{ t: -1, d: 0, v: Object.assign({ center: [0, 20], zoom: 1, rotate: 0 }, o.view || {}) }];
    let last = '';

    function camAt(now) {
      let v = { ...cams[0].v };
      for (const k of cams.slice(1)) {
        if (now < k.t) break;
        const p = R.E[k.ease || 'inout'](R.clamp((now - k.t) / k.d)), a = v, b = { ...a, ...k.v };
        v = {
          center: [a.center[0] + (b.center[0] - a.center[0]) * p, a.center[1] + (b.center[1] - a.center[1]) * p],
          zoom: Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * p), rotate: a.rotate + (b.rotate - a.rotate) * p
        };
      }
      return v;
    }
    function apply(v) {
      if (kind === 'orthographic') P.rotate([-v.center[0], -v.center[1], 0]).scale(base * v.zoom).translate([bx + bw / 2, by + bh / 2]);
      else P.rotate([v.rotate || 0, 0]).center(v.center).scale(base * v.zoom).translate([bx + bw / 2, by + bh / 2]);
    }
    const routes = [], pins = [], areas = [];
    R.during(-1, 1e9, (p, now) => {
      const v = camAt(now), key = v.center.map(x => x.toFixed(4)) + v.zoom.toFixed(4) + v.rotate;
      apply(v);
      if (key !== last) {
        last = key;
        for (const c of C) c.el.setAttribute('d', path(c.f) || '');
        borderEl.setAttribute('d', path(borders) || ''); coastEl.setAttribute('d', path(coast) || '');
        if (gridEl) gridEl.setAttribute('d', path(W.d3.geoGraticule10()) || '');
        borderEl.setAttribute('stroke-width', st.borderW * Math.min(2.2, Math.sqrt(v.zoom) * .8));
      }
      for (const c of C) {                    // Füllfarben
        let col = st.land;
        for (const k of c.keys) { if (now < k.t) break; const pp = R.clamp((now - k.t) / k.d); col = pp >= 1 ? k.to : mix(col, k.to, pp); }
        if (col !== c.cur) { c.el.setAttribute('fill', col); c.cur = col; }
      }
      for (const a of areas) { a.el.setAttribute('d', path(a.geo) || ''); }
      for (const r of routes) {
        const pp = R.E.inout(R.clamp((now - r.t) / r.d));
        const line = { type: 'LineString', coordinates: r.pts };
        const dd = path(line) || '';
        r.el.setAttribute('d', dd);
        if (!dd) { const h = r.head && document.getElementById(r.head); if (h) h.style.visibility = 'hidden'; continue; }
        const L = r.el.getTotalLength();
        r.el.style.strokeDasharray = r.dash ? r.dash : L; r.el.style.strokeDashoffset = r.dash ? 0 : L * (1 - pp);
        if (r.dash) r.el.style.opacity = pp > 0 ? 1 : 0;
        if (r.mask) { r.mask.setAttribute('d', r.el.getAttribute('d')); r.mask.style.strokeDasharray = L; r.mask.style.strokeDashoffset = L * (1 - pp); }
        if (r.head) {
          const q = r.el.getPointAtLength ? r.el.getPointAtLength(L * pp) : { x: 0, y: 0 }, q2 = r.el.getPointAtLength(Math.max(0, L * pp - 2));
          const h = document.getElementById(r.head); if (h) { h.style.translate = `${q.x}px ${q.y}px`; if (r.rotate !== false) h.style.rotate = Math.atan2(q.y - q2.y, q.x - q2.x) * 180 / Math.PI + 'deg'; h.style.visibility = pp > 0 && pp < 1 || r.keepHead && pp >= 1 ? 'visible' : 'hidden'; }
        }
      }
      for (const pn of pins) {
        const xy = P(pn.ll); const el = document.getElementById(pn.id); if (!el || !xy) continue;
        el.style.translate = `${(xy[0] + (pn.dx || 0)).toFixed(1)}px ${(xy[1] + (pn.dy || 0)).toFixed(1)}px`;
      }
    });

    const m = {
      el: g, projection: P, box: [bx, by, bw, bh],
      names: () => C.map(c => c.name).sort(),
      country: q => find(q)[0]?.el,
      /* Kamerafahrt: center [lon, lat], zoom (1 = ganze Erde auf Kartenbreite) */
      view(t, d, v, ease) { cams.push({ t, d, v, ease }); cams.sort((a, b) => a.t - b.t); return m; },
      /* Länder einfärben; stagger = Versatz zwischen den Ländern (Ausbreitung) */
      fill(q, t, color, d = .5, stagger = 0) {
        const miss = missing(q); if (miss.length) console.warn('MAP: Land nicht gefunden:', miss.join(', '));
        [].concat(q).forEach((name, i) => find(name).forEach(c => { c.keys.push({ t: t + i * stagger, d, to: color }); c.keys.sort((a, b) => a.t - b.t); }));
        return m;
      },
      /* Element (id) folgt einem Ort; dx/dy = Versatz in px. Element selbst bei 0,0 zeichnen */
      pin(id, ll, dx = 0, dy = 0) { pins.push({ id, ll, dx, dy }); return m; },
      /* Bogen von A nach B (Großkreis), zeichnet sich ab t in d Sekunden; head = id eines Elements, das vorne mitfährt (rotate:false = nicht mitdrehen, keepHead = am Ziel stehen lassen) */
      route(id, pts, t, d, o2 = {}) {
        const el = mk('path', { id, fill: 'none', stroke: o2.color || '#FFD23F', 'stroke-width': o2.width || 8, 'stroke-linecap': 'round' }, overG);
        if (o2.glow) el.setAttribute('filter', 'drop-shadow(0 0 8px ' + (o2.color || '#FFD23F') + ')');
        const ipts = []; for (let i = 0; i < pts.length - 1; i++) { const f = W.d3.geoInterpolate(pts[i], pts[i + 1]); for (let k = 0; k < 40; k++) ipts.push(f(k / 40)); } ipts.push(pts[pts.length - 1]);
        routes.push({ el, pts: ipts, t, d, head: o2.head, keepHead: o2.keepHead, rotate: o2.rotate });
        return m;
      },
      /* Kreis/Fläche in km-Radius um einen Ort (z. B. Ausbreitung) */
      circle(id, ll, km, o2 = {}) {
        const el = mk('path', { id, fill: o2.fill || 'rgba(255,210,63,.25)', stroke: o2.stroke || '#FFD23F', 'stroke-width': o2.width || 4 }, overG);
        const a = { el, geo: W.d3.geoCircle().center(ll).radius(km / 111.2)() }; areas.push(a); return el;
      },
      /* Element in die Pin-Ebene der Karte hängen (wird mitgeclippt) */
      layer: () => pinG, over: () => overG,
      xy: ll => P(ll)
    };
    return m;
  }
  W.MAP = { create };
})();
