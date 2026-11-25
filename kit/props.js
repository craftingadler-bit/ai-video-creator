/* Wiederverwendbare Requisiten als SVG-Strings (Flat-Stil, passend zu figures.js).
   Einbinden nach runtime.js: <script src="../../kit/props.js"></script>
   Alle stehen mit dem Fuß auf (0,0) bzw. haben die Mitte auf (0,0) – in eine <g transform="translate(x y)"> packen,
   bewegen per GSAP auf einer äußeren <g id> (R.dropIn, R.wiggle, R.squash …).
   PROPS.cow(id)              Kuh seitlich (~300 breit), Kopf rechts, Schwanz <g id="<id>_tail">
   PROPS.column(h, w)         Säule (Mitte unten = 0,0)
   PROPS.temple(w)            Tempelfront mit Giebel, Fuß auf 0,0, Mitte x = 0
   PROPS.laurel(r)            Lorbeerkranz, Mitte 0,0
   PROPS.tree(h, kind)        Baum, kind: 'pine' | 'round' | 'cypress'
   PROPS.cloud(w)             Wolke
   PROPS.helmet(crest)        Römerhelm für FIG-Köpfe (Kopfmitte 0,0, Radius 80)
   PROPS.laurelHat()          Lorbeer auf FIG-Kopf
   PROPS.beard(id)            Bart für FIG-Kopf (wächst per scaleY, Ursprung oben)
   PROPS.laptop(id)           Laptop (Mitte unten 0,0), Bildschirm <g id="<id>_screen">
   PROPS.clock(id)            Wanduhr r=110, Zeiger <g id="<id>_h">, <g id="<id>_m">
   PROPS.thumb()              Daumen hoch (Mitte 0,0), drehen = runter
   PROPS.horse(id)            Pferd seitlich im Galopp-Pose, Beine <g id="<id>_legs">
   PROPS.chariot(id, color)   Streitwagen mit Pferd + Fahrer (Mitte unten 0,0), schaut nach rechts
   PROPS.sweat(id)            Schweißtropfen
   PROPS.heart(id)            Herz (Likes) */
(function () {
  const INK = '#15121F';
  const cow = (id = 'cow') => `<g id="${id}">
    <ellipse cx="0" cy="2" rx="150" ry="14" fill="rgba(0,0,0,.25)"/>
    <g id="${id}_tail"><path d="M-128 -150 Q-170 -120 -160 -60" stroke="#F4F1EA" stroke-width="12" fill="none" stroke-linecap="round"/><ellipse cx="-160" cy="-56" rx="12" ry="18" fill="${INK}"/></g>
    <rect x="-112" y="-80" width="30" height="80" rx="12" fill="#E6E1D6"/><rect x="66" y="-80" width="30" height="80" rx="12" fill="#E6E1D6"/>
    <rect x="-80" y="-80" width="30" height="80" rx="12" fill="#F4F1EA"/><rect x="96" y="-80" width="30" height="80" rx="12" fill="#F4F1EA"/>
    <path d="M-114 -6 h34 v8 h-34z M64 -6 h34 v8 h-34z M-82 -6 h34 v8 h-34z M94 -6 h34 v8 h-34z" fill="${INK}"/>
    <path d="M-140 -150 Q-142 -210 -80 -214 L90 -214 Q140 -210 140 -150 L136 -96 Q130 -66 90 -66 L-96 -66 Q-138 -66 -140 -100 Z" fill="#F4F1EA"/>
    <path d="M-70 -214 Q-40 -170 -86 -140 Q-120 -150 -126 -190 Q-110 -212 -70 -214Z M20 -150 Q60 -170 70 -120 Q40 -90 6 -110 Q0 -140 20 -150Z M84 -212 Q110 -190 100 -170 Q80 -180 70 -212Z" fill="${INK}"/>
    <ellipse cx="0" cy="-70" rx="26" ry="14" fill="#F7A8B8"/>
    <g transform="translate(150 -170)">
      <path d="M-14 -46 Q-34 -76 -20 -84 M30 -46 Q50 -76 36 -84" stroke="#E8D9B0" stroke-width="12" fill="none" stroke-linecap="round"/>
      <ellipse cx="-30" cy="-30" rx="24" ry="12" fill="#F4F1EA" transform="rotate(-30 -30 -30)"/><ellipse cx="48" cy="-30" rx="24" ry="12" fill="#F4F1EA" transform="rotate(30 48 -30)"/>
      <path d="M-22 -50 Q8 -66 38 -50 L46 30 Q8 60 -30 30 Z" fill="#F4F1EA"/>
      <path d="M-18 -50 Q8 -60 34 -50 Q20 -20 -4 -30Z" fill="${INK}"/>
      <ellipse cx="8" cy="34" rx="44" ry="30" fill="#F7A8B8"/><ellipse cx="-6" cy="34" rx="6" ry="8" fill="#C0607A"/><ellipse cx="22" cy="34" rx="6" ry="8" fill="#C0607A"/>
      <g class="blink"><circle cx="-6" cy="-10" r="8" fill="${INK}"/><circle cx="26" cy="-10" r="8" fill="${INK}"/><circle cx="-4" cy="-13" r="3" fill="#fff"/><circle cx="28" cy="-13" r="3" fill="#fff"/></g>
    </g>
  </g>`;

  const column = (h = 380, w = 130) => `<g>
    <rect x="${-w / 2 - 22}" y="${-h - 92}" width="${w + 44}" height="34" rx="6" fill="#E9E1CF"/>
    <rect x="${-w / 2 - 12}" y="${-h - 58}" width="${w + 24}" height="22" fill="#D4C9B0"/>
    <rect x="${-w / 2}" y="${-h - 36}" width="${w}" height="${h}" fill="#E9E1CF"/>
    ${[-.3, 0, .3].map(k => `<rect x="${k * w - 7}" y="${-h - 22}" width="14" height="${h - 28}" rx="7" fill="#D4C9B0"/>`).join('')}
    <rect x="${-w / 2 - 22}" y="-40" width="${w + 44}" height="40" rx="6" fill="#D4C9B0"/></g>`;

  const temple = (w = 900) => {
    const n = 6, cw = w / (n * 1.9), h = w * .46, top = -h - 60;
    let cols = ''; for (let i = 0; i < n; i++) { const x = -w / 2 + w / n * (i + .5); cols += `<g transform="translate(${x} -60)">${column(h - 70, cw)}</g>`; }
    return `<g>
      <rect x="${-w / 2 - 40}" y="-60" width="${w + 80}" height="30" fill="#D4C9B0"/><rect x="${-w / 2 - 70}" y="-30" width="${w + 140}" height="30" fill="#C2B593"/>
      ${cols}
      <rect x="${-w / 2 - 30}" y="${top - 30}" width="${w + 60}" height="40" fill="#E9E1CF"/>
      <path d="M${-w / 2 - 50} ${top - 30} L0 ${top - w * .22} L${w / 2 + 50} ${top - 30} Z" fill="#E9E1CF"/>
      <path d="M${-w / 2 + 10} ${top - 42} L0 ${top - w * .2 + 14} L${w / 2 - 10} ${top - 42} Z" fill="#D4C9B0"/>
      <text x="0" y="${top - 52}" text-anchor="middle" font-size="${w * .065}" font-weight="900" fill="#B89A5A" letter-spacing="6">SPQR</text>
    </g>`;
  };

  const laurel = (r = 190) => {
    let s = '';
    for (let i = 0; i < 13; i++) {
      const a0 = (200 - i * 12.5) * Math.PI / 180;
      [[1, a0], [-1, Math.PI - a0]].forEach(([sg, a]) => {
        const x = Math.cos(a) * r, y = Math.sin(a) * r, deg = a * 180 / Math.PI + (sg > 0 ? 60 : 120);
        s += `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${r * .21}" ry="${r * .09}" transform="rotate(${deg.toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)})" fill="${i % 2 ? '#6FAE4A' : '#8CC65A'}"/>`;
      });
    }
    return `<g>${s}</g>`;
  };

  const tree = (h = 300, kind = 'round') => kind === 'pine'
    ? `<g><rect x="-14" y="-60" width="28" height="60" fill="#5A3A24"/><path d="M0 ${-h} L${h * .32} ${-h * .45} L${h * .18} ${-h * .45} L${h * .4} -50 L${-h * .4} -50 L${-h * .18} ${-h * .45} L${-h * .32} ${-h * .45} Z" fill="#2F6B45"/></g>`
    : kind === 'cypress'
      ? `<g><rect x="-10" y="-40" width="20" height="40" fill="#5A3A24"/><ellipse cx="0" cy="${-h * .55}" rx="${h * .14}" ry="${h * .48}" fill="#2E5E3E"/></g>`
      : `<g><rect x="-16" y="-90" width="32" height="90" fill="#6B4528"/><circle cx="0" cy="${-h * .62}" r="${h * .34}" fill="#4E9A5A"/><circle cx="${-h * .2}" cy="${-h * .5}" r="${h * .22}" fill="#5DAE66"/><circle cx="${h * .16}" cy="${-h * .78}" r="${h * .16}" fill="#6BBE72"/></g>`;

  const cloud = (w = 260) => `<g opacity=".9"><ellipse cx="0" cy="0" rx="${w / 2}" ry="${w * .16}" fill="#fff"/><circle cx="${-w * .16}" cy="${-w * .1}" r="${w * .18}" fill="#fff"/><circle cx="${w * .12}" cy="${-w * .14}" r="${w * .22}" fill="#fff"/></g>`;

  const helmet = crest => `<g>
    <path d="M-88 -10 Q-96 -128 0 -128 Q96 -128 88 -10 L66 -10 L66 -44 L-66 -44 L-66 -10Z" fill="#C9C9D4"/>
    <path d="M-88 -10 Q-96 -128 0 -128 Q-60 -110 -70 -10Z" fill="#E4E4EC"/>
    <rect x="-94" y="-54" width="188" height="18" rx="9" fill="#9696A6"/>
    <path d="M-88 -20 L-96 50 L-66 40 L-66 -20Z M88 -20 L96 50 L66 40 L66 -20Z" fill="#B0B0BE"/>
    ${crest ? `<path d="M-90 -126 Q0 -250 90 -126 Q0 -160 -90 -126Z" fill="#E0342A"/><path d="M-60 -150 Q0 -220 60 -150" stroke="#B8241C" stroke-width="8" fill="none"/>` : `<rect x="-10" y="-170" width="20" height="46" rx="8" fill="#E0342A"/>`}
  </g>`;
  const laurelHat = () => `<g><path d="M-82 -40 Q0 -120 82 -40" stroke="#5E9E3C" stroke-width="10" fill="none"/>${Array.from({ length: 9 }, (_, i) => { const a = Math.PI * (1.08 + i * .1), x = Math.cos(a) * 84, y = -40 + Math.sin(a) * 62; return `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="22" ry="10" transform="rotate(${(a * 180 / Math.PI + 90).toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)})" fill="${i % 2 ? '#7BBE4E' : '#9AD46A'}"/>`; }).join('')}</g>`;
  const beard = (id = 'beard') => `<g id="${id}"><path d="M-70 30 Q-80 120 -40 230 Q0 300 40 230 Q80 120 70 30 Q40 70 0 66 Q-40 70 -70 30Z" fill="#D8D8DE"/><path d="M-30 90 Q-20 180 0 240 M20 90 Q24 170 10 230" stroke="#B4B4BE" stroke-width="6" fill="none"/></g>`;

  const laptop = (id = 'laptop') => `<g id="${id}">
    <path d="M-200 0 L200 0 L170 -20 L-170 -20 Z" fill="#9AA0B4"/><rect x="-210" y="-6" width="420" height="16" rx="8" fill="#7D839A"/>
    <rect x="-160" y="-250" width="320" height="230" rx="16" fill="#2A2740"/><g id="${id}_screen"><rect x="-144" y="-234" width="288" height="198" rx="8" fill="#7FD3FF"/></g>
  </g>`;

  const clock = (id = 'clock') => `<g id="${id}">
    <circle r="118" fill="${INK}"/><circle r="104" fill="#FBF8F1"/>
    ${Array.from({ length: 12 }, (_, i) => `<rect x="-4" y="-96" width="8" height="${i % 3 ? 12 : 22}" rx="4" fill="${INK}" transform="rotate(${i * 30})"/>`).join('')}
    <g id="${id}_h"><rect x="-7" y="-58" width="14" height="66" rx="7" fill="${INK}"/></g>
    <g id="${id}_m"><rect x="-5" y="-86" width="10" height="94" rx="5" fill="#E0342A"/></g>
    <circle r="12" fill="${INK}"/></g>`;

  const thumb = () => `<g transform="scale(1.5)">
    <rect x="-80" y="-30" width="160" height="150" rx="36" fill="#E8A97E" stroke="${INK}" stroke-width="8"/>
    <path d="M-80 10 H40 M-80 50 H40 M-80 88 H40" stroke="${INK}" stroke-width="6"/>
    <rect x="-40" y="-150" width="66" height="140" rx="33" fill="#E8A97E" stroke="${INK}" stroke-width="8"/></g>`;

  const horse = (id = 'horse', c = '#8A5A34') => `<g id="${id}">
    <g id="${id}_legs" class="gallop">
      <path d="M-90 -110 L-130 -30 L-150 -4" stroke="${c}" stroke-width="26" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M90 -110 L140 -50 L170 -40" stroke="${c}" stroke-width="26" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M-60 -110 L-70 -40 L-40 -10" stroke="#6E4628" stroke-width="24" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M60 -110 L100 -30 L90 0" stroke="#6E4628" stroke-width="24" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <path d="M-140 -110 Q-190 -130 -210 -80" stroke="#3A2416" stroke-width="22" fill="none" stroke-linecap="round"/>
    <ellipse cx="0" cy="-150" rx="150" ry="62" fill="${c}"/>
    <path d="M100 -180 Q140 -260 190 -290 L230 -250 Q190 -210 150 -130 Z" fill="${c}"/>
    <path d="M180 -300 Q240 -310 280 -260 Q290 -236 262 -232 L210 -236 Z" fill="${c}"/>
    <path d="M110 -200 Q140 -280 190 -300 Q170 -250 140 -170Z" fill="#3A2416"/>
    <path d="M196 -300 l-6 -30 l22 22Z" fill="${c}"/>
    <circle cx="232" cy="-272" r="7" fill="${INK}"/>
  </g>`;
  const chariot = (id = 'chariot', color = '#E0342A') => `<g id="${id}">
    <ellipse cx="0" cy="4" rx="300" ry="14" fill="rgba(0,0,0,.25)"/>
    <g transform="translate(150 0)">${horse(id + '_horse')}</g>
    <path d="M-150 -120 L60 -150" stroke="#6B4528" stroke-width="10"/>
    <g transform="translate(-200 0)">
      <g transform="translate(0 -170)"><circle r="40" fill="#E8A97E"/>${helmet(true).replace('<g>', '<g transform="scale(.5)">')}</g>
      <path d="M-40 -130 L40 -130 L36 -60 L-36 -60Z" fill="${color}"/>
      <path d="M-80 -110 Q-90 -40 -60 -40 L70 -40 Q90 -60 80 -110 Z" fill="${color}"/><path d="M-80 -110 L80 -110" stroke="#FFD23F" stroke-width="10"/>
      <g class="spin"><circle cx="0" cy="-50" r="52" fill="none" stroke="#3A2416" stroke-width="12"/><path d="M0 -102 V2 M-52 -50 H52 M-37 -87 L37 -13 M37 -87 L-37 -13" stroke="#3A2416" stroke-width="7"/></g>
    </g>
  </g>`;
  const sweat = (id = 'sweat') => `<path id="${id}" d="M0 -40 Q26 0 18 18 Q0 36 -18 18 Q-26 0 0 -40Z" fill="#7FD3FF" stroke="#fff" stroke-width="4"/>`;
  const heart = (id = 'heart') => `<path id="${id}" d="M0 30 C-60 -10 -50 -60 -20 -60 C-6 -60 0 -48 0 -40 C0 -48 6 -60 20 -60 C50 -60 60 -10 0 30Z" fill="#FF4D6D"/>`;

  window.PROPS = { cow, column, temple, laurel, tree, cloud, helmet, laurelHat, beard, laptop, clock, thumb, horse, chariot, sweat, heart };
})();
