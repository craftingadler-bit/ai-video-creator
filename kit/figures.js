/* Wiederverwendbare Figuren als SVG-Strings. Nach runtime.js einbinden: <script src="../../kit/figures.js"></script>
   Alle Figuren stehen mit den Füßen auf (0,0); per transform/scale in eine <g> packen.
   FIG.human({ id, mood, hoodie, pose })   Hauptfigur „Du": schwarzer Kopf, große Augen, Hoodie. mood: neutral|shock|happy|bliss|annoyed|sad
   FIG.humanFace({ id, mood })            Close-up (Kopf ~ 620 px breit, Mitte auf 0,0)
   FIG.capy({ id, pose, eyes, acc })      Capybara seitlich, schaut nach rechts. pose: stand|lie|sit, eyes: open|sleepy|closed|glow, acc: orange|tie|''
   FIG.capyFace({ id, eyes, acc })        Capybara frontal (Close-up, ~ 560 px breit)
   FIG.mood(id, [[t, 'shock'], [t2, 'bliss']])   Mimik der Figur mit dieser id zu Zeitpunkten wechseln */
(function () {
  const C = { fur: '#A7743F', furD: '#87592F', furL: '#BE8A52', muz: '#6E4829', leg: '#7A5130', legF: '#5C3C22', ear: '#6E4A2C', earI: '#4A2F1C', eye: '#1A110A' };
  const MOODS = ['neutral', 'shock', 'happy', 'bliss', 'annoyed', 'sad'];

  /* Gesicht für den schwarzen Kopf (Mitte 0,0, Kopfradius 80) */
  function face(id, mood, k = 1) {
    const eyes = (ry = 24, py = 0, ps = 9) => `<g class="blink"><ellipse cx="-30" cy="-6" rx="19" ry="${ry}" fill="#fff"/><ellipse cx="30" cy="-6" rx="19" ry="${ry}" fill="#fff"/>
      <g id="${id}_pupils"><circle cx="-27" cy="${-4 + py}" r="${ps}" fill="#15121F"/><circle cx="33" cy="${-4 + py}" r="${ps}" fill="#15121F"/></g></g>`;
    const brow = (l, r) => `<path d="${l}" stroke="#fff" stroke-width="7" stroke-linecap="round" fill="none"/><path d="${r}" stroke="#fff" stroke-width="7" stroke-linecap="round" fill="none"/>`;
    const parts = {
      neutral: eyes() + brow('M-46 -40 L-16 -38', 'M16 -38 L46 -40') + '<path d="M-14 40 L14 40" stroke="#fff" stroke-width="7" stroke-linecap="round"/>',
      shock: eyes(27, 0, 6) + brow('M-48 -50 Q-32 -62 -14 -52', 'M14 -52 Q32 -62 48 -50') + '<ellipse cx="0" cy="44" rx="12" ry="16" fill="#fff"/>',
      happy: eyes(22, 2) + brow('M-46 -40 Q-31 -48 -16 -40', 'M16 -40 Q31 -48 46 -40') + '<path d="M-22 34 Q0 56 22 34" stroke="#fff" stroke-width="7" stroke-linecap="round" fill="none"/>',
      bliss: '<path d="M-46 -4 Q-30 -20 -14 -4 M14 -4 Q30 -20 46 -4" stroke="#fff" stroke-width="8" stroke-linecap="round" fill="none"/><ellipse cx="-50" cy="22" rx="14" ry="8" fill="#FF7A9A" opacity=".55"/><ellipse cx="50" cy="22" rx="14" ry="8" fill="#FF7A9A" opacity=".55"/><path d="M-20 34 Q0 52 20 34" stroke="#fff" stroke-width="7" stroke-linecap="round" fill="none"/>',
      annoyed: `<g><ellipse cx="-30" cy="-2" rx="19" ry="17" fill="#fff"/><ellipse cx="30" cy="-2" rx="19" ry="17" fill="#fff"/><circle cx="-28" cy="2" r="8" fill="#15121F"/><circle cx="32" cy="2" r="8" fill="#15121F"/><rect x="-52" y="-24" width="104" height="16" fill="#15121F"/></g>` + brow('M-48 -30 L-14 -22', 'M14 -22 L48 -30') + '<path d="M-16 42 Q0 36 16 42" stroke="#fff" stroke-width="7" stroke-linecap="round" fill="none"/>',
      sad: eyes(22, 4) + brow('M-46 -36 L-16 -46', 'M16 -46 L46 -36') + '<path d="M-18 46 Q0 32 18 46" stroke="#fff" stroke-width="7" stroke-linecap="round" fill="none"/>'
    };
    return `<g transform="scale(${k})">` + MOODS.map(m => `<g id="${id}_${m}" style="display:${m === mood ? 'inline' : 'none'}">${parts[m]}</g>`).join('') + '</g>';
  }
  const head = (id, mood) => `<circle r="80" fill="#15121F"/><path d="M-62 -50 A80 80 0 0 1 40 -70" stroke="rgba(255,255,255,.22)" stroke-width="7" fill="none" stroke-linecap="round"/>${face(id, mood)}`;

  function human(o = {}) {
    const id = o.id || 'du', hoodie = o.hoodie || '#FF7A3D', dark = o.hoodieD || '#D9582A';
    const sit = o.pose === 'sit';
    const legs = sit ? '' : `<path d="M-42 -160 L-48 -12 M42 -160 L48 -12" stroke="#46406A" stroke-width="44" stroke-linecap="round"/>
      <path d="M-74 -6 Q-74 -26 -48 -26 Q-22 -26 -20 -6 Z M20 -6 Q22 -26 48 -26 Q74 -26 74 -6 Z" fill="#F2EFE9"/>`;
    const armL = o.arm === 'wave' ? 'M-78 -300 Q-140 -360 -120 -440' : o.arm === 'point' ? 'M-78 -300 Q-150 -290 -190 -330' : 'M-78 -300 Q-104 -230 -96 -170';
    const handL = o.arm === 'wave' ? [-120, -446] : o.arm === 'point' ? [-196, -334] : [-96, -164];
    return `<g id="${id}">
      ${legs}
      <path d="M-82 -330 Q-90 -360 -40 -372 L40 -372 Q90 -360 82 -330 L90 -150 Q0 -130 -90 -150 Z" fill="${hoodie}"/>
      <path d="M-40 -372 Q0 -340 40 -372" stroke="${dark}" stroke-width="12" fill="none" stroke-linecap="round"/>
      <path d="M-14 -350 L-18 -300 M14 -350 L18 -300" stroke="#F2EFE9" stroke-width="5" stroke-linecap="round"/>
      <rect x="-46" y="-250" width="92" height="44" rx="16" fill="${dark}"/>
      <g id="${id}_armL"><path d="${armL}" stroke="${hoodie}" stroke-width="40" stroke-linecap="round" fill="none"/><circle cx="${handL[0]}" cy="${handL[1]}" r="22" fill="#15121F"/></g>
      <g id="${id}_armR"><path d="M78 -300 Q104 -230 96 -170" stroke="${hoodie}" stroke-width="40" stroke-linecap="round" fill="none"/><circle cx="96" cy="-164" r="22" fill="#15121F"/></g>
      <g id="${id}_head" transform="translate(0 -452)"><g>${head(id, o.mood || 'neutral')}</g></g>
    </g>`;
  }
  function humanFace(o = {}) {
    const id = o.id || 'duFace';
    return `<g id="${id}"><path d="M-230 330 Q-230 170 0 160 Q230 170 230 330 Z" fill="${o.hoodie || '#FF7A3D'}"/>
      <path d="M-120 176 Q0 250 120 176" stroke="${o.hoodieD || '#D9582A'}" stroke-width="26" fill="none" stroke-linecap="round"/>
      <g transform="scale(3.6)">${head(id, o.mood || 'neutral')}</g></g>`;
  }

  /* Capybara seitlich: Körper ~ 440 px lang, schaut nach rechts */
  function capyEye(eyes, cx, cy, s = 1) {
    if (eyes === 'closed') return `<path d="M${cx - 9 * s} ${cy} Q${cx} ${cy + 7 * s} ${cx + 9 * s} ${cy}" stroke="${C.eye}" stroke-width="${4 * s}" fill="none" stroke-linecap="round"/>`;
    const glow = eyes === 'glow';
    let e = `<ellipse cx="${cx}" cy="${cy}" rx="${7.5 * s}" ry="${8.5 * s}" fill="${glow ? '#FFE97A' : C.eye}" ${glow ? 'filter="drop-shadow(0 0 8px #FFD23F)"' : ''}/>`;
    if (!glow) e += `<circle cx="${cx + 2.4 * s}" cy="${cy - 3 * s}" r="${2.4 * s}" fill="#fff"/>`;
    if (eyes === 'sleepy') e += `<path d="M${cx - 10 * s} ${cy + 1 * s} A${10 * s} ${10 * s} 0 0 1 ${cx + 10 * s} ${cy + 1 * s} Z" fill="${C.fur}"/><path d="M${cx - 10 * s} ${cy + 1 * s} Q${cx} ${cy - 1 * s} ${cx + 10 * s} ${cy + 1 * s}" stroke="${C.eye}" stroke-width="${3 * s}" fill="none" stroke-linecap="round"/>`;
    return e;
  }
  function capy(o = {}) {
    const id = o.id || 'capy', lie = o.pose === 'lie', sit = o.pose === 'sit', eyes = o.eyes || 'open';
    const dy = lie ? 46 : 0;
    const legs = lie ? `<path d="M120 -6 Q150 -10 168 -4 Q170 4 120 4 Z" fill="${C.legF}"/>` : `
      <path d="M-120 -70 Q-126 -30 -122 -6 L-90 -6 Q-86 -40 -80 -70 Z" fill="${C.legF}"/>
      <path d="M92 -70 Q94 -30 98 -6 L128 -6 Q126 -40 130 -70 Z" fill="${C.legF}"/>
      <path d="M-150 -76 Q-160 -34 -154 -2 L-114 -2 Q-110 -40 -104 -76 Z" fill="${C.leg}"/>
      <path d="M58 -76 Q58 -34 62 -2 L100 -2 Q100 -40 104 -76 Z" fill="${C.leg}"/>
      <path d="M-156 -2 Q-156 -12 -134 -12 Q-110 -12 -112 -2 Z M60 -2 Q60 -12 82 -12 Q104 -12 102 -2 Z" fill="#3E2816"/>`;
    const tie = o.acc === 'tie' ? `<path d="M128 -84 L146 -84 L140 -70 L150 -26 L137 -12 L124 -26 L132 -70 Z" fill="#2F6FD8"/><path d="M118 -92 Q137 -78 156 -92" stroke="#fff" stroke-width="7" fill="none"/>` : '';
    const orange = o.acc === 'orange' ? `<g transform="translate(176 -262) scale(.8)"><circle r="34" fill="#FF9A1F"/><circle r="34" fill="none" stroke="#E07D0A" stroke-width="4"/><circle cx="-10" cy="-10" r="8" fill="#FFC36B" opacity=".8"/><path d="M0 -34 q6 -14 18 -16" stroke="#3E7A2A" stroke-width="5" fill="none"/><ellipse cx="16" cy="-46" rx="12" ry="6" fill="#57A23A" transform="rotate(-20 16 -46)"/></g>` : '';
    return `<g id="${id}">
      <ellipse cx="0" cy="2" rx="${lie ? 210 : 190}" ry="16" fill="rgba(0,0,0,.28)"/>
      ${legs}
      <g transform="translate(0 ${dy})">
        <path d="M-196 -96 C-206 -186 -120 -246 -14 -244 C70 -242 128 -218 146 -172 L156 -102 C150 -70 118 -58 78 -60 L-142 -60 C-182 -60 -194 -74 -196 -96 Z" fill="${C.fur}"/>
        <path d="M-192 -128 C-176 -214 -80 -246 -14 -244 C60 -242 112 -224 136 -194 C64 -214 -60 -222 -150 -172 Z" fill="${C.furD}"/>
        <path d="M-176 -78 C-120 -64 40 -62 120 -72 L118 -62 C40 -54 -120 -56 -170 -66 Z" fill="${C.furL}" opacity=".55"/>
        <path d="M-120 -150 l14 -8 M-70 -170 l16 -6 M-20 -150 l14 -8 M30 -176 l14 -6 M-150 -110 l12 -8 M-60 -120 l14 -6" stroke="${C.furD}" stroke-width="5" stroke-linecap="round"/>
        ${tie}
        <g id="${id}_head">
          <path d="M92 -214 C118 -250 208 -252 250 -222 C274 -204 288 -170 292 -134 C294 -108 282 -92 260 -90 L168 -88 C126 -88 98 -112 94 -146 Z" fill="${C.fur}"/>
          <path d="M244 -200 C272 -182 288 -158 292 -134 C294 -108 282 -92 260 -90 L234 -90 C244 -124 246 -170 244 -200 Z" fill="${C.muz}"/>
          <path d="M100 -200 C130 -238 200 -244 238 -224 C190 -230 140 -222 100 -200 Z" fill="${C.furD}"/>
          <ellipse cx="278" cy="-170" rx="5.5" ry="9" fill="#2A1A10" transform="rotate(-18 278 -170)"/>
          <path d="M288 -112 Q270 -106 254 -110" stroke="#2A1A10" stroke-width="4" fill="none" stroke-linecap="round"/>
          <path d="M160 -152 Q190 -118 232 -114" stroke="${C.furD}" stroke-width="5" fill="none" stroke-linecap="round"/>
          <ellipse cx="134" cy="-234" rx="17" ry="13" fill="${C.ear}"/><ellipse cx="137" cy="-233" rx="9" ry="7" fill="${C.earI}"/>
          <g class="blink">${capyEye(eyes, 194, -192)}</g>
          ${orange}
        </g>
      </g>
    </g>`;
  }
  /* Capybara frontal, Mitte 0,0 */
  function capyFace(o = {}) {
    const id = o.id || 'capyFace', eyes = o.eyes || 'open', glow = eyes === 'glow';
    const eye = x => eyes === 'closed' ? `<path d="M${x - 26} -110 Q${x} -92 ${x + 26} -110" stroke="${C.eye}" stroke-width="10" fill="none" stroke-linecap="round"/>`
      : `<ellipse cx="${x}" cy="-112" rx="24" ry="28" fill="${glow ? '#FFE97A' : C.eye}" ${glow ? 'filter="drop-shadow(0 0 22px #FFD23F)"' : ''}/>` + (glow ? `<ellipse cx="${x}" cy="-112" rx="9" ry="22" fill="#E8A400"/>` : `<circle cx="${x + 8}" cy="-122" r="8" fill="#fff"/>`)
        + (eyes === 'sleepy' ? `<path d="M${x - 29} -108 A29 32 0 0 1 ${x + 29} -108 Z" fill="${C.fur}"/><path d="M${x - 29} -108 Q${x} -114 ${x + 29} -108" stroke="${C.eye}" stroke-width="8" fill="none" stroke-linecap="round"/>` : '');
    return `<g id="${id}">
      <ellipse cx="-200" cy="-232" rx="46" ry="40" fill="${C.ear}" transform="rotate(-25 -200 -232)"/><ellipse cx="-196" cy="-226" rx="24" ry="20" fill="${C.earI}" transform="rotate(-25 -196 -226)"/>
      <ellipse cx="200" cy="-232" rx="46" ry="40" fill="${C.ear}" transform="rotate(25 200 -232)"/><ellipse cx="196" cy="-226" rx="24" ry="20" fill="${C.earI}" transform="rotate(25 196 -226)"/>
      <path d="M-236 -120 C-250 -230 -150 -270 0 -270 C150 -270 250 -230 236 -120 C232 -40 250 40 226 130 C200 230 -200 230 -226 130 C-250 40 -232 -40 -236 -120 Z" fill="${C.fur}"/>
      <path d="M-120 -262 C-60 -276 60 -276 120 -262 C80 -200 40 -170 0 -166 C-40 -170 -80 -200 -120 -262 Z" fill="${C.furD}" opacity=".7"/>
      <path d="M-150 -40 C-150 -90 150 -90 150 -40 L140 170 C130 236 -130 236 -140 170 Z" fill="${C.muz}"/>
      <path d="M-86 -44 C-86 -70 86 -70 86 -44 L70 6 C60 24 -60 24 -70 6 Z" fill="#3A2416"/>
      <ellipse cx="-40" cy="-30" rx="14" ry="20" fill="#1A0F08" transform="rotate(20 -40 -30)"/><ellipse cx="40" cy="-30" rx="14" ry="20" fill="#1A0F08" transform="rotate(-20 40 -30)"/>
      <path d="M0 18 L0 70 M0 70 Q-40 96 -70 80 M0 70 Q40 96 70 80" stroke="#2A1A10" stroke-width="9" fill="none" stroke-linecap="round"/>
      <path d="M-210 20 l30 6 M-214 60 l32 2 M210 20 l-30 6 M214 60 l-32 2" stroke="${C.furD}" stroke-width="8" stroke-linecap="round"/>
      <g class="blink">${eye(-146)}${eye(146)}</g>
      ${o.acc === 'orange' ? `<g transform="translate(0 -276)"><circle r="78" fill="#FF9A1F"/><circle cx="-24" cy="-24" r="18" fill="#FFC36B" opacity=".8"/><path d="M0 -78 q12 -30 40 -34" stroke="#3E7A2A" stroke-width="10" fill="none"/><ellipse cx="40" cy="-104" rx="28" ry="13" fill="#57A23A" transform="rotate(-20 40 -104)"/></g>` : ''}
    </g>`;
  }

  /* Mimik zu Zeitpunkten wechseln: FIG.mood('du', [[t, 'shock'], …]); erster Eintrag gilt ab Start */
  function mood(id, keys) {
    keys = keys.slice().sort((a, b) => a[0] - b[0]);
    let lastM = null;
    R.during(-1, 1e9, (p, now) => {
      let m = keys[0][1]; for (const [t, k] of keys) if (now >= t) m = k;
      if (m === lastM) return; lastM = m;
      MOODS.forEach(x => { const e = document.getElementById(id + '_' + x); if (e) e.style.display = x === m ? 'inline' : 'none'; });
    });
  }
  window.FIG = { human, humanFace, capy, capyFace, mood, colors: C };
})();
