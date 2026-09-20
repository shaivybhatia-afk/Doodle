/* Hand-made cute SVG art, one per shape. All drawn on a 200 x 200 canvas. */
(function () {
  const INK = '#4b3a5e';
  const PINK = '#ffb3c7';
  const YELLOW = '#ffe28a';
  const BLUE = '#a9dcff';
  const MINT = '#b6f0d2';
  const LILAC = '#d9c9ff';
  const PEACH = '#ffd0a8';
  const BLUSH = '#ff8fab';

  const wrap = (inner) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200" fill="none" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

  const outline = `stroke="${INK}" stroke-width="5"`;

  const sparkle = (x, y, r, fill = '#fff') =>
    `<path d="M${x} ${y - r} Q${x + r * 0.15} ${y - r * 0.15} ${x + r} ${y} Q${x + r * 0.15} ${y + r * 0.15} ${x} ${y + r} Q${x - r * 0.15} ${y + r * 0.15} ${x - r} ${y} Q${x - r * 0.15} ${y - r * 0.15} ${x} ${y - r}Z" fill="${fill}" stroke="${INK}" stroke-width="3"/>`;

  // dot eyes, blush and a tiny smile centred on (x, y); gap = space between eyes
  const face = (x, y, gap = 28, smile = 8) =>
    `<circle cx="${x - gap / 2}" cy="${y}" r="4.6" fill="${INK}"/>` +
    `<circle cx="${x + gap / 2}" cy="${y}" r="4.6" fill="${INK}"/>` +
    `<circle cx="${x - gap / 2 - 1.4}" cy="${y - 1.6}" r="1.5" fill="#fff"/>` +
    `<circle cx="${x + gap / 2 - 1.4}" cy="${y - 1.6}" r="1.5" fill="#fff"/>` +
    `<ellipse cx="${x - gap / 2 - 9}" cy="${y + 8}" rx="6.5" ry="4.2" fill="${BLUSH}" opacity=".65"/>` +
    `<ellipse cx="${x + gap / 2 + 9}" cy="${y + 8}" rx="6.5" ry="4.2" fill="${BLUSH}" opacity=".65"/>` +
    `<path d="M${x - smile} ${y + 8} Q${x} ${y + 8 + smile * 1.1} ${x + smile} ${y + 8}" stroke="${INK}" stroke-width="3.6"/>`;

  const heart = wrap(
    `<path d="M100 174 C44 134 20 98 22 66 C24 36 62 22 84 44 C92 52 98 60 100 64 C102 60 108 52 116 44 C138 22 176 36 178 66 C180 98 156 134 100 174Z" fill="${PINK}" ${outline}/>` +
      `<path d="M46 62 C48 50 58 44 68 46" stroke="#fff" stroke-width="7" opacity=".8"/>` +
      face(100, 96, 30, 9) +
      sparkle(168, 28, 14, YELLOW) + sparkle(30, 150, 9, '#fff')
  );

  let rays = '';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x1 = 100 + Math.cos(a) * 64, y1 = 100 + Math.sin(a) * 64;
    const x2 = 100 + Math.cos(a) * 86, y2 = 100 + Math.sin(a) * 86;
    rays += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${INK}" stroke-width="15"/>` +
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#ffc25c" stroke-width="6"/>`;
  }
  const circle = wrap(
    rays +
      `<circle cx="100" cy="100" r="54" fill="${YELLOW}" ${outline}/>` +
      `<path d="M66 78 C72 64 84 58 96 58" stroke="#fff" stroke-width="7" opacity=".8"/>` +
      face(100, 102, 32, 12)
  );

  const wave = wrap(
    `<path d="M14 118 C30 96 52 100 62 116 C66 92 92 78 116 90 C126 66 158 62 176 82 C186 94 188 108 186 122 L186 158 Q186 176 168 176 L32 176 Q14 176 14 158Z" fill="${BLUE}" ${outline}/>` +
      `<path d="M26 156 Q42 146 58 156 T90 156 T122 156 T154 156 T180 152" stroke="#7cc4f4" stroke-width="5"/>` +
      `<path d="M30 118 C38 108 50 108 56 118" stroke="#fff" stroke-width="6" opacity=".9"/>` +
      `<path d="M96 96 C104 86 118 84 128 90" stroke="#fff" stroke-width="6" opacity=".9"/>` +
      `<circle cx="150" cy="76" r="4" fill="#fff" stroke="${INK}" stroke-width="2.5"/>` +
      `<circle cx="164" cy="64" r="2.8" fill="#fff" stroke="${INK}" stroke-width="2.5"/>` +
      face(100, 130, 34, 11) +
      sparkle(36, 56, 12, YELLOW) + sparkle(168, 36, 8, '#fff')
  );

  // spiral for the snail shell
  let spiral = '';
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const a = t * Math.PI * 5;
    const r = 3 + t * 30;
    spiral += `${i ? 'L' : 'M'}${(112 + r * Math.cos(a)).toFixed(1)} ${(108 + r * Math.sin(a)).toFixed(1)} `;
  }
  const swirl = wrap(
    `<path d="M40 168 L172 168 C188 168 188 128 172 128 L60 128Z" fill="${MINT}" ${outline}/>` +
      `<line x1="38" y1="96" x2="28" y2="64" stroke="${INK}" stroke-width="4.5"/><circle cx="27" cy="61" r="6" fill="${MINT}" stroke="${INK}" stroke-width="4"/>` +
      `<line x1="56" y1="96" x2="66" y2="64" stroke="${INK}" stroke-width="4.5"/><circle cx="67" cy="61" r="6" fill="${MINT}" stroke="${INK}" stroke-width="4"/>` +
      `<circle cx="46" cy="132" r="32" fill="${MINT}" ${outline}/>` +
      `<circle cx="112" cy="108" r="46" fill="${PEACH}" ${outline}/>` +
      `<path d="${spiral}" stroke="${INK}" stroke-width="4.5"/>` +
      `<path d="M84 76 C92 68 100 65 108 64" stroke="#fff" stroke-width="5" opacity=".8"/>` +
      face(42, 130, 20, 7) +
      sparkle(170, 46, 12, YELLOW) + sparkle(20, 30, 8, '#fff')
  );

  const starPts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 84 : 44;
    starPts.push(`${(100 + r * Math.cos(a)).toFixed(1)},${(106 + r * Math.sin(a)).toFixed(1)}`);
  }
  const star = wrap(
    `<polygon points="${starPts.join(' ')}" fill="${YELLOW}" stroke="${INK}" stroke-width="14"/>` +
      `<polygon points="${starPts.join(' ')}" fill="${YELLOW}" stroke="${YELLOW}" stroke-width="5"/>` +
      // sleepy closed eyes
      `<path d="M74 108 Q83 118 92 108" stroke="${INK}" stroke-width="4"/>` +
      `<path d="M108 108 Q117 118 126 108" stroke="${INK}" stroke-width="4"/>` +
      `<ellipse cx="68" cy="122" rx="6.5" ry="4.2" fill="${BLUSH}" opacity=".65"/><ellipse cx="132" cy="122" rx="6.5" ry="4.2" fill="${BLUSH}" opacity=".65"/>` +
      `<ellipse cx="100" cy="127" rx="4" ry="4.5" fill="${INK}"/>` +
      `<path d="M150 34 h16 l-16 16 h16" stroke="${INK}" stroke-width="4.5"/>` +
      `<path d="M172 14 h10 l-10 10 h10" stroke="${INK}" stroke-width="3.5"/>` +
      sparkle(30, 44, 11, '#fff') + sparkle(26, 160, 8, LILAC)
  );

  const triangle = wrap(
    `<path d="M100 26 L164 168 L36 168Z" fill="${LILAC}" ${outline}/>` +
      `<path d="M72 96 L128 96" stroke="${PINK}" stroke-width="10"/><path d="M55 134 L145 134" stroke="${PINK}" stroke-width="10"/>` +
      `<path d="M100 26 L164 168 L36 168Z" fill="none" ${outline}/>` +
      `<circle cx="100" cy="24" r="13" fill="${YELLOW}" ${outline}/>` +
      `<circle cx="95" cy="19" r="3" fill="#fff"/>` +
      face(100, 116, 26, 8) +
      sparkle(168, 60, 12, YELLOW) + sparkle(30, 90, 8, '#fff')
  );

  const square = wrap(
    `<rect x="52" y="152" width="34" height="24" rx="11" fill="${BLUE}" ${outline}/>` +
      `<rect x="114" y="152" width="34" height="24" rx="11" fill="${BLUE}" ${outline}/>` +
      `<rect x="30" y="30" width="140" height="132" rx="30" fill="${PEACH}" ${outline}/>` +
      `<path d="M50 62 C52 52 60 47 70 47" stroke="#fff" stroke-width="7" opacity=".8"/>` +
      face(100, 98, 40, 12) +
      sparkle(176, 22, 12, YELLOW) + sparkle(22, 176, 9, '#fff')
  );

  const zigzag = wrap(
    `<path d="M118 14 L48 108 L94 108 L70 186 L156 84 L108 84 L134 14Z" fill="${YELLOW}" stroke="${INK}" stroke-width="5"/>` +
      `<path d="M116 30 L74 88" stroke="#fff" stroke-width="6" opacity=".8"/>` +
      face(102, 95, 20, 6) +
      sparkle(26, 50, 12, PINK) + sparkle(172, 150, 10, '#fff') + sparkle(170, 34, 7, LILAC)
  );

  window.SHAPE_ART = {
    circle: { label: 'A sunny circle!', svg: circle },
    heart: { label: 'A heart!', svg: heart },
    wave: { label: 'A happy wave!', svg: wave },
    swirl: { label: 'A swirly snail!', svg: swirl },
    star: { label: 'A sleepy star!', svg: star },
    triangle: { label: 'A party triangle!', svg: triangle },
    square: { label: 'A cozy square!', svg: square },
    zigzag: { label: 'A zappy zigzag!', svg: zigzag },
  };
})();
