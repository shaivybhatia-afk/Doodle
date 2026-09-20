/* Builds cute vector art around the person's OWN stroke.
   The stroke is smoothed, filled with a soft pastel, outlined in a rounded dark
   line, then dressed up with details that suit the recognised shape.
   Everything is drawn on a 400 x 400 canvas; the caller places it over the video. */
(function () {
  'use strict';

  const INK = '#3f3352';
  const OUT = 9;
  const CANVAS = 400;
  const f = (n) => +n.toFixed(1);
  // seeded per build so the layout pass and the render pass make the same choices
  let rng = Math.random;
  const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const rnd = (a, b) => a + rng() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const other = (arr, not) => pick(arr.filter((c) => c !== not));

  // small fixed pastel palette, a few choices per role
  const C = {
    heart: ['#f7b5c8', '#f5a3bb', '#e6c3f0'],
    sun: ['#f9dc8d', '#fbd3a0'],
    ray: '#f6c26a',
    star: ['#f9e39b', '#dfd0f7', '#c8e8d8'],
    mountain: ['#bcd3ea', '#c8dbb4', '#d9cdec'],
    body: ['#f9cfb0', '#b7e4cf', '#a9d5f2', '#f7b5c8'],
    accent: ['#f29ab2', '#f6c66b', '#8fc6e8', '#c7b4ee'],
    gem: ['#cfc3f5', '#b7e4cf', '#a9d5f2'],
    wave: ['#a9d5f2', '#9dd6d0', '#b6c8f4'],
    fish: ['#f9b79a', '#f29ab2', '#f6c66b'],
    snailBody: ['#c7e6b8', '#f9cfb0', '#f7dca0'],
    shell: ['#f9cfb0', '#d5c8f3', '#a9d5f2', '#f7b5c8'],
    zig: ['#f9dc8d', '#b7e4cf', '#f7b5c8', '#a9d5f2'],
    cloud: ['#e4effb', '#ece7fb', '#e5f3f0'],
    drop: '#8fc6e8',
    moon: ['#f9e39b', '#dfd0f7'],
    cap: ['#f29ab2', '#8fc6e8', '#b7e4cf'],
    bolt: ['#f9dc8d', '#f7c86a'],
    inf: ['#d5c8f3', '#f7b5c8', '#a9d5f2'],
    check: ['#9fd8b8', '#8fd0c2'],
    blush: '#ff98b0',
    white: '#ffffff',
  };

  /* ---------- geometry helpers ---------- */

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function pathLen(P, closed) {
    let d = 0;
    for (let i = 1; i < P.length; i++) d += dist(P[i - 1], P[i]);
    if (closed) d += dist(P[P.length - 1], P[0]);
    return d;
  }

  function resample(P, n, closed) {
    const pts = closed ? P.concat([P[0]]) : P.slice();
    const total = pathLen(pts, false);
    if (total === 0) return pts.slice(0, n);
    const step = total / (closed ? n : n - 1);
    const out = [pts[0]];
    let acc = 0, i = 1, prev = pts[0];
    while (out.length < n && i < pts.length) {
      const d = dist(prev, pts[i]);
      if (acc + d >= step) {
        const t = (step - acc) / d;
        const q = { x: prev.x + (pts[i].x - prev.x) * t, y: prev.y + (pts[i].y - prev.y) * t };
        out.push(q); prev = q; acc = 0;
      } else { acc += d; prev = pts[i]; i++; }
    }
    while (out.length < n) out.push(pts[pts.length - 1]);
    return out;
  }

  // [1 2 1] smoothing; open paths keep their end points, closed paths wrap around
  function smooth(P, passes, closed) {
    let cur = P;
    for (let k = 0; k < passes; k++) {
      const n = cur.length;
      cur = cur.map((p, i) => {
        if (!closed && (i === 0 || i === n - 1)) return p;
        const a = cur[(i - 1 + n) % n], b = cur[(i + 1) % n];
        return { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 };
      });
    }
    return cur;
  }

  // Catmull-Rom spline as a cubic bezier path
  function pathD(P, closed) {
    const n = P.length;
    if (n < 2) return '';
    const g = (i) => (closed ? P[(i + n) % n] : P[clamp(i, 0, n - 1)]);
    let d = `M${f(P[0].x)} ${f(P[0].y)}`;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
      d += `C${f(p1.x + (p2.x - p0.x) / 6)} ${f(p1.y + (p2.y - p0.y) / 6)} ${f(p2.x - (p3.x - p1.x) / 6)} ${f(p2.y - (p3.y - p1.y) / 6)} ${f(p2.x)} ${f(p2.y)}`;
    }
    return d + (closed ? 'Z' : '');
  }

  function bounds(P) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of P) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }

  const centroid = (P) => ({ x: P.reduce((s, p) => s + p.x, 0) / P.length, y: P.reduce((s, p) => s + p.y, 0) / P.length });

  /* ---------- little SVG bits ---------- */

  const sparkle = (x, y, r, fill = '#fff') =>
    `<path d="M${f(x)} ${f(y - r)}Q${f(x + r * 0.16)} ${f(y - r * 0.16)} ${f(x + r)} ${f(y)}Q${f(x + r * 0.16)} ${f(y + r * 0.16)} ${f(x)} ${f(y + r)}Q${f(x - r * 0.16)} ${f(y + r * 0.16)} ${f(x - r)} ${f(y)}Q${f(x - r * 0.16)} ${f(y - r * 0.16)} ${f(x)} ${f(y - r)}Z" fill="${fill}" stroke="${INK}" stroke-width="3.5"/>`;

  const dot = (x, y, r, fill = C.white) => `<circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="${fill}" stroke="${INK}" stroke-width="3"/>`;

  // kind: happy | sleepy | zap | calm
  function face(x, y, s = 1, kind = 'happy') {
    const g = 15 * s; // half the gap between the eyes
    const ey = y;
    let eyes;
    if (kind === 'sleepy' || kind === 'calm') {
      eyes = `<path d="M${f(x - g - 8 * s)} ${f(ey)}Q${f(x - g)} ${f(ey + 8 * s)} ${f(x - g + 8 * s)} ${f(ey)}" stroke="${INK}" stroke-width="${f(4 * s + 0.6)}" fill="none"/>` +
        `<path d="M${f(x + g - 8 * s)} ${f(ey)}Q${f(x + g)} ${f(ey + 8 * s)} ${f(x + g + 8 * s)} ${f(ey)}" stroke="${INK}" stroke-width="${f(4 * s + 0.6)}" fill="none"/>`;
    } else if (kind === 'zap') {
      eyes = `<circle cx="${f(x - g)}" cy="${f(ey)}" r="${f(7 * s)}" fill="#fff" stroke="${INK}" stroke-width="${f(3 * s + 0.5)}"/>` +
        `<circle cx="${f(x + g)}" cy="${f(ey)}" r="${f(7 * s)}" fill="#fff" stroke="${INK}" stroke-width="${f(3 * s + 0.5)}"/>` +
        `<circle cx="${f(x - g + 1.5 * s)}" cy="${f(ey + 1 * s)}" r="${f(3.4 * s)}" fill="${INK}"/>` +
        `<circle cx="${f(x + g + 1.5 * s)}" cy="${f(ey + 1 * s)}" r="${f(3.4 * s)}" fill="${INK}"/>`;
    } else {
      eyes = `<circle cx="${f(x - g)}" cy="${f(ey)}" r="${f(5 * s)}" fill="${INK}"/><circle cx="${f(x + g)}" cy="${f(ey)}" r="${f(5 * s)}" fill="${INK}"/>` +
        `<circle cx="${f(x - g - 1.5 * s)}" cy="${f(ey - 1.7 * s)}" r="${f(1.7 * s)}" fill="#fff"/><circle cx="${f(x + g - 1.5 * s)}" cy="${f(ey - 1.7 * s)}" r="${f(1.7 * s)}" fill="#fff"/>`;
    }
    const blush = `<ellipse cx="${f(x - g - 11 * s)}" cy="${f(ey + 10 * s)}" rx="${f(7.5 * s)}" ry="${f(4.6 * s)}" fill="${C.blush}" opacity=".6"/>` +
      `<ellipse cx="${f(x + g + 11 * s)}" cy="${f(ey + 10 * s)}" rx="${f(7.5 * s)}" ry="${f(4.6 * s)}" fill="${C.blush}" opacity=".6"/>`;
    let mouth;
    if (kind === 'sleepy') mouth = `<ellipse cx="${f(x)}" cy="${f(ey + 15 * s)}" rx="${f(4 * s)}" ry="${f(4.6 * s)}" fill="${INK}"/>`;
    else if (kind === 'zap') mouth = `<path d="M${f(x - 7 * s)} ${f(ey + 11 * s)}Q${f(x)} ${f(ey + 26 * s)} ${f(x + 7 * s)} ${f(ey + 11 * s)}Z" fill="${INK}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`;
    else mouth = `<path d="M${f(x - 9 * s)} ${f(ey + 10 * s)}Q${f(x)} ${f(ey + 21 * s)} ${f(x + 9 * s)} ${f(ey + 10 * s)}" stroke="${INK}" stroke-width="${f(3.8 * s + 0.4)}" fill="none"/>`;
    return eyes + blush + mouth;
  }

  const outlineFill = (d, fill, w = OUT) => `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`;

  function ribbon(d, fill, w) {
    return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${f(w + OUT * 2)}" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="${d}" fill="none" stroke="${fill}" stroke-width="${f(w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  const shine = (x, y, len, deg = -35) =>
    `<path d="M${f(-len / 2)} 0Q0 ${f(-len * 0.16)} ${f(len / 2)} 0" transform="translate(${f(x)} ${f(y)}) rotate(${deg})" stroke="#fff" stroke-width="7" stroke-linecap="round" fill="none" opacity=".85"/>`;

  /* ---------- per-shape dressing ---------- */

  // ctx: { P, d, closed, bb, c, R, s (face scale) }
  const B = {};

  B.heart = (x) => {
    const fill = pick(C.heart);
    return {
      label: 'A heart!',
      svg: outlineFill(x.d, fill) + shine(x.bb.x0 + x.bb.w * 0.24, x.bb.y0 + x.bb.h * 0.3, x.bb.w * 0.16) +
        face(x.bb.cx, x.bb.cy + x.bb.h * 0.0, x.s, 'happy') +
        sparkle(x.bb.x1 + 20, x.bb.y0 - 6, 13, '#f9e39b') + sparkle(x.bb.x0 - 14, x.bb.y1 - 6, 8),
    };
  };

  B.circle = (x) => {
    const fill = pick(C.sun);
    // rays sit just outside the person's own outline
    const bins = 36, rad = new Array(bins).fill(0), cnt = new Array(bins).fill(0);
    x.P.forEach((p) => {
      const a = Math.atan2(p.y - x.c.y, p.x - x.c.x);
      const b = Math.floor(((a + Math.PI) / (2 * Math.PI)) * bins) % bins;
      rad[b] += dist(p, x.c); cnt[b]++;
    });
    const avg = x.R;
    const rAt = (a) => {
      const b = Math.floor(((a + Math.PI) / (2 * Math.PI)) * bins) % bins;
      return cnt[b] ? rad[b] / cnt[b] : avg;
    };
    let rays = '';
    const n = 12, len = clamp(x.R * 0.32, 16, 40);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI + 0.13;
      const r0 = rAt(a) + OUT + 5, r1 = r0 + len;
      const p0 = `${f(x.c.x + Math.cos(a) * r0)} ${f(x.c.y + Math.sin(a) * r0)}`, p1 = `${f(x.c.x + Math.cos(a) * r1)} ${f(x.c.y + Math.sin(a) * r1)}`;
      rays += `<path d="M${p0}L${p1}" stroke="${INK}" stroke-width="17" stroke-linecap="round"/><path d="M${p0}L${p1}" stroke="${C.ray}" stroke-width="7" stroke-linecap="round"/>`;
    }
    return {
      label: 'A sunny circle!',
      pad: len + 30,
      svg: rays + outlineFill(x.d, fill) + shine(x.bb.x0 + x.bb.w * 0.28, x.bb.y0 + x.bb.h * 0.22, x.bb.w * 0.18) + face(x.c.x, x.c.y + x.bb.h * 0.04, x.s * 1.1, 'happy'),
    };
  };

  B.star = (x) => {
    const fill = pick(C.star);
    const zx = x.bb.x1 + 6, zy = x.bb.y0 + 4;
    return {
      label: 'A sleepy star!',
      svg: outlineFill(x.d, fill) + face(x.c.x, x.c.y + x.bb.h * 0.04, x.s, 'sleepy') +
        `<path d="M${f(zx)} ${f(zy)}h16l-16 16h16" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<path d="M${f(zx + 22)} ${f(zy - 20)}h10l-10 10h10" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
        sparkle(x.bb.x0 - 12, x.bb.y0 + x.bb.h * 0.15, 11) + sparkle(x.bb.x0 + 6, x.bb.y1 + 8, 8, '#dfd0f7'),
    };
  };

  B.triangle = (x) => {
    const fill = pick(C.mountain);
    let apex = x.P[0];
    x.P.forEach((p) => { if (p.y < apex.y) apex = p; });
    const sy = apex.y + x.bb.h * 0.36, depth = x.bb.h * 0.08, x0 = x.bb.x0 - 12, x1 = x.bb.x1 + 12;
    let snow = `M${f(x0)} ${f(apex.y - 12)}H${f(x1)}V${f(sy)}`;
    const teeth = 5;
    for (let i = 1; i <= teeth; i++) {
      const px = x1 - ((x1 - x0) * i) / teeth;
      snow += `L${f(px + ((x1 - x0) / teeth) / 2)} ${f(sy + depth)}L${f(px)} ${f(sy)}`;
    }
    snow += 'Z';
    const bird = (bx, by, k) => `<path d="M${f(bx)} ${f(by)}q${f(5 * k)} ${f(-8 * k)} ${f(10 * k)} 0q${f(5 * k)} ${f(-8 * k)} ${f(10 * k)} 0" stroke="${INK}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
    return {
      label: 'A snowy peak!',
      svg: `<clipPath id="mt"><path d="${x.d}"/></clipPath>` + outlineFill(x.d, fill, 1) +
        `<path d="${snow}" fill="#fff" clip-path="url(#mt)"/>` +
        `<path d="${x.d}" fill="none" stroke="${INK}" stroke-width="${OUT}" stroke-linejoin="round"/>` +
        face(x.c.x, x.bb.y0 + x.bb.h * 0.66, x.s * 0.85, 'happy') +
        `<circle cx="${f(x.bb.x0 - 6)}" cy="${f(x.bb.y0 + 6)}" r="13" fill="#f9e39b" stroke="${INK}" stroke-width="4"/>` +
        bird(x.bb.x1 - 4, x.bb.y0 - 4, 1) + bird(x.bb.x1 + 14, x.bb.y0 + 12, 0.7) + sparkle(x.bb.x0 + x.bb.w * 0.22, x.bb.y0 + x.bb.h * 0.45, 8),
    };
  };

  B.square = (x) => {
    const bb = x.bb;
    if (rng() < 0.5) {
      // little house
      const body = pick(C.body), roof = other(C.accent, body);
      const rx0 = bb.x0 - bb.w * 0.12, rx1 = bb.x1 + bb.w * 0.12, ry = bb.y0 + 3, ay = bb.y0 - bb.w * 0.5;
      const roofD = `M${f(rx0)} ${f(ry)}L${f(bb.cx)} ${f(ay)}L${f(rx1)} ${f(ry)}Z`;
      const dw = bb.w * 0.2, dh = bb.h * 0.4;
      const door = `M${f(bb.cx - dw / 2)} ${f(bb.y1)}V${f(bb.y1 - dh + dw / 2)}Q${f(bb.cx - dw / 2)} ${f(bb.y1 - dh)} ${f(bb.cx)} ${f(bb.y1 - dh)}Q${f(bb.cx + dw / 2)} ${f(bb.y1 - dh)} ${f(bb.cx + dw / 2)} ${f(bb.y1 - dh + dw / 2)}V${f(bb.y1)}Z`;
      const ws = bb.w * 0.17, wx = bb.x0 + bb.w * 0.27, wy = bb.cy - bb.h * 0.12;
      return {
        label: 'A cozy house!',
        top: bb.w * 0.55,
        svg: `<rect x="${f(rx1 - bb.w * 0.3)}" y="${f(ay + bb.w * 0.14)}" width="${f(bb.w * 0.11)}" height="${f(bb.w * 0.2)}" fill="${C.white}" stroke="${INK}" stroke-width="6"/>` +
          outlineFill(x.d, body) + outlineFill(roofD, roof) +
          `<path d="${door}" fill="#fff" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/><circle cx="${f(bb.cx + dw * 0.22)}" cy="${f(bb.y1 - dh * 0.4)}" r="3.4" fill="${INK}"/>` +
          `<rect x="${f(wx - ws / 2)}" y="${f(wy - ws / 2)}" width="${f(ws)}" height="${f(ws)}" rx="4" fill="#cfe8f8" stroke="${INK}" stroke-width="5"/><path d="M${f(wx)} ${f(wy - ws / 2)}V${f(wy + ws / 2)}M${f(wx - ws / 2)} ${f(wy)}H${f(wx + ws / 2)}" stroke="${INK}" stroke-width="3.5"/>` +
          sparkle(bb.x1 + 14, bb.y0 - bb.w * 0.3, 11, '#f9e39b') + sparkle(bb.x0 - 10, bb.y1 - 12, 8),
      };
    }
    // gift box
    const body = pick(C.body), rib = other(C.accent, body);
    const rw = bb.w * 0.18;
    const bx = bb.cx, by = bb.y0 - 4, bs = bb.w * 0.2;
    const loop = (sg) => `<ellipse cx="${f(bx + sg * bs * 0.85)}" cy="${f(by - bs * 0.45)}" rx="${f(bs)}" ry="${f(bs * 0.6)}" transform="rotate(${sg * -24} ${f(bx + sg * bs * 0.85)} ${f(by - bs * 0.45)})" fill="${rib}" stroke="${INK}" stroke-width="6"/>`;
    return {
      label: 'A little gift!',
      top: bb.w * 0.34,
      svg: `<clipPath id="gb"><path d="${x.d}"/></clipPath>` + outlineFill(x.d, body, 1) +
        `<rect x="${f(bb.cx - rw / 2)}" y="${f(bb.y0 - 6)}" width="${f(rw)}" height="${f(bb.h + 12)}" fill="${rib}" clip-path="url(#gb)"/>` +
        `<path d="M${f(bb.x0)} ${f(bb.y0 + bb.h * 0.24)}H${f(bb.x1)}" stroke="${INK}" stroke-width="5" clip-path="url(#gb)"/>` +
        `<path d="${x.d}" fill="none" stroke="${INK}" stroke-width="${OUT}" stroke-linejoin="round"/>` +
        `<path d="M${f(bb.cx - rw / 2)} ${f(bb.y0)}V${f(bb.y1)}M${f(bb.cx + rw / 2)} ${f(bb.y0)}V${f(bb.y1)}" stroke="${INK}" stroke-width="4" opacity=".55"/>` +
        loop(-1) + loop(1) + `<circle cx="${f(bx)}" cy="${f(by - bs * 0.2)}" r="${f(bs * 0.34)}" fill="${rib}" stroke="${INK}" stroke-width="5"/>` +
        face(bb.x0 + bb.w * 0.28, bb.y0 + bb.h * 0.62, x.s * 0.6, 'happy') +
        sparkle(bb.x1 + 14, bb.y0 - bb.w * 0.1, 11, '#f9e39b') + sparkle(bb.x0 - 12, bb.y1 - 8, 8),
    };
  };

  B.diamond = (x) => {
    const bb = x.bb, fill = pick(C.gem);
    const ty = bb.cy - bb.h * 0.06;
    return {
      label: 'A shiny gem!',
      svg: outlineFill(x.d, fill) +
        `<path d="M${f(bb.cx - bb.w * 0.3)} ${f(ty)}H${f(bb.cx + bb.w * 0.3)}M${f(bb.cx - bb.w * 0.3)} ${f(ty)}L${f(bb.cx)} ${f(bb.y0 + 4)}L${f(bb.cx + bb.w * 0.3)} ${f(ty)}" stroke="${INK}" stroke-width="4" fill="none" stroke-linejoin="round" stroke-linecap="round" opacity=".45"/>` +
        shine(bb.cx - bb.w * 0.16, bb.y0 + bb.h * 0.22, bb.w * 0.14, -55) +
        face(bb.cx, bb.cy + bb.h * 0.17, x.s * 0.7, 'happy') +
        sparkle(bb.x1 + 12, bb.y0 + 6, 13, '#f9e39b') + sparkle(bb.x0 - 10, bb.y0 + bb.h * 0.3, 9) + sparkle(bb.x1 - 4, bb.y1 + 8, 7, '#cfc3f5'),
    };
  };

  B.wave = (x) => {
    const bb = x.bb, fill = pick(C.wave), W = clamp(Math.max(bb.w, bb.h) * 0.15, 24, 44);
    // crests: local minima of y along the line
    const P = x.P, crest = [];
    const k = Math.max(3, Math.floor(P.length / 26));
    for (let i = k; i < P.length - k; i++) {
      let isMin = true;
      for (let j = -k; j <= k; j++) if (P[i + j].y < P[i].y - 0.001) { isMin = false; break; }
      if (isMin && (!crest.length || dist(crest[crest.length - 1], P[i]) > bb.w * 0.16)) crest.push(P[i]);
    }
    let top = crest[0] || P[Math.floor(P.length / 2)];
    crest.forEach((c) => { if (c.y < top.y) top = c; });
    let foam = '';
    crest.slice(0, 4).forEach((c) => {
      foam += dot(c.x, c.y - W * 0.72, 7) + dot(c.x + 13, c.y - W * 0.6, 5) + dot(c.x - 12, c.y - W * 0.55, 4);
    });
    const fx = top.x + W * 0.3, fy = top.y - W - 26, fc = pick(C.fish);
    const fish = `<g transform="translate(${f(fx)} ${f(fy)}) rotate(-24)">` +
      `<path d="M-22 0L-38 -12L-38 12Z" fill="${fc}" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>` +
      `<ellipse cx="0" cy="0" rx="24" ry="14" fill="${fc}" stroke="${INK}" stroke-width="4.5"/>` +
      `<circle cx="10" cy="-3" r="3.4" fill="${INK}"/><path d="M-4 -12Q0 -2 -4 12" stroke="${INK}" stroke-width="3" fill="none" opacity=".45"/></g>` +
      `<path d="M${f(fx - 30)} ${f(fy + 34)}q-6 -8 0 -14M${f(fx + 26)} ${f(fy + 38)}q6 -8 0 -14" stroke="${INK}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
    return {
      label: 'A happy wave!',
      top: W + 70,
      svg: ribbon(x.d, fill, W) +
        `<path d="${x.d}" transform="translate(0 ${f(-W * 0.2)})" stroke="#fff" stroke-width="${f(W * 0.16)}" fill="none" stroke-linecap="round" opacity=".55"/>` +
        foam + fish + sparkle(bb.x0 - 6, bb.y0 - 6, 9) + sparkle(bb.x1 + 10, bb.y1 + 10, 8, '#f9e39b'),
    };
  };

  B.swirl = (x) => {
    const bb = x.bb, R = Math.max(bb.w, bb.h) / 2;
    const dir = rng() < 0.5 ? 1 : -1;
    const bodyC = pick(C.snailBody), shellC = other(C.shell, bodyC);
    const cx = bb.cx, cy = bb.cy;
    const hx = cx + R * 1.72, hy = cy + R * 0.5, hr = R * 0.42;
    const body = `<rect x="${f(cx - R * 0.9)}" y="${f(cy + R * 0.28)}" width="${f(R * 2.6)}" height="${f(R * 0.74)}" rx="${f(R * 0.37)}" fill="${bodyC}" stroke="${INK}" stroke-width="${OUT}"/>` +
      `<circle cx="${f(hx)}" cy="${f(hy - R * 0.06)}" r="${f(hr)}" fill="${bodyC}" stroke="${INK}" stroke-width="${OUT}"/>` +
      `<rect x="${f(cx - R * 0.5)}" y="${f(cy + R * 0.32)}" width="${f(R * 2)}" height="${f(R * 0.66)}" rx="${f(R * 0.33)}" fill="${bodyC}"/>`;
    const ant = (sx) => `<path d="M${f(hx + sx * hr * 0.4)} ${f(hy - hr * 0.85)}Q${f(hx + sx * hr * 0.9)} ${f(hy - hr * 1.9)} ${f(hx + sx * hr * 0.75)} ${f(hy - hr * 2.2)}" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>` +
      `<circle cx="${f(hx + sx * hr * 0.75)}" cy="${f(hy - hr * 2.25)}" r="${f(hr * 0.2)}" fill="${bodyC}" stroke="${INK}" stroke-width="4"/>`;
    const snail = body + ant(-1) + ant(1) + face(hx + hr * 0.05, hy - R * 0.04, clamp(R / 95, 0.42, 1.1), 'happy');
    const shell = `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R + 6)}" fill="${shellC}" stroke="${INK}" stroke-width="${OUT}"/>` +
      `<path d="${x.d}" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` +
      shine(cx - R * 0.55, cy - R * 0.68, R * 0.32, -40);
    const g = dir === -1 ? `<g transform="translate(${f(2 * cx)} 0) scale(-1 1)">` : '<g>';
    return {
      label: 'A swirly snail!',
      anchorX: dir === 1 ? 145 : 255,
      svg: g + snail + '</g>' + shell + sparkle(dir === 1 ? cx + R * 1.4 : cx - R * 1.4, cy - R * 1.1, 11, '#f9e39b') + sparkle(dir === 1 ? cx - R * 1.2 : cx + R * 1.2, cy - R * 1.2, 8),
    };
  };

  B.zigzag = (x) => {
    const bb = x.bb, W = clamp(Math.max(bb.w, bb.h) * 0.09, 16, 30), fill = pick(C.zig);
    const sp = [];
    for (let i = 0; i < 4; i++) sp.push(sparkle(bb.x0 + bb.w * (0.12 + 0.26 * i) + rnd(-6, 6), (i % 2 ? bb.y1 + W + 16 : bb.y0 - W - 16), i % 2 ? 8 : 11, i % 2 ? '#fff' : '#f9e39b'));
    return { label: 'A zippy zigzag!', svg: ribbon(x.d, fill, W) + `<path d="${x.d}" transform="translate(0 ${f(-W * 0.18)})" stroke="#fff" stroke-width="${f(W * 0.18)}" fill="none" stroke-linecap="round" opacity=".55"/>` + sp.join('') };
  };

  B.cloud = (x) => {
    const bb = x.bb, fill = pick(C.cloud);
    let rain = '';
    const n = 5;
    for (let i = 0; i < n; i++) {
      const dx = bb.x0 + bb.w * (0.14 + (0.72 * i) / (n - 1)), dy = bb.y1 + 22 + (i % 2) * 16;
      rain += `<path d="M${f(dx)} ${f(dy)}C${f(dx + 8)} ${f(dy + 11)} ${f(dx + 9)} ${f(dy + 20)} ${f(dx)} ${f(dy + 22)}C${f(dx - 9)} ${f(dy + 20)} ${f(dx - 8)} ${f(dy + 11)} ${f(dx)} ${f(dy)}Z" fill="${C.drop}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`;
    }
    return {
      label: 'A rainy cloud!',
      bottom: 70,
      svg: rain + outlineFill(x.d, fill) + shine(bb.x0 + bb.w * 0.26, bb.y0 + bb.h * 0.32, bb.w * 0.14) + face(bb.cx, bb.cy + bb.h * 0.04, x.s * 0.95, 'happy') + sparkle(bb.x1 + 12, bb.y0 - 4, 11, '#f9e39b') + sparkle(bb.x0 - 12, bb.y0 + bb.h * 0.5, 7),
    };
  };

  B.moon = (x) => {
    const bb = x.bb, fill = pick(C.moon), capC = pick(C.cap);
    const sg = x.c.x <= bb.cx ? 1 : -1; // 1: thick side on the left, opening to the right
    let top = x.P[0];
    x.P.forEach((p) => { if (p.y < top.y) top = p; });
    const w = bb.w;
    const Bx = top.x - sg * w * 0.16, By = top.y + bb.h * 0.03;
    const m = (dx) => f(Bx + sg * dx * w);
    const capD = `M${m(-0.24)} ${f(By + bb.h * 0.04)}C${m(-0.26)} ${f(By - w * 0.36)} ${m(0.05)} ${f(By - w * 0.52)} ${m(0.55)} ${f(By - w * 0.34)}C${m(0.16)} ${f(By - w * 0.16)} ${m(0.24)} ${f(By - w * 0.04)} ${m(0.26)} ${f(By + bb.h * 0.04)}Z`;
    const brim = `<rect x="${f(Math.min(Bx - w * 0.29, Bx + w * 0.29))}" y="${f(By - w * 0.005)}" width="${f(w * 0.58)}" height="${f(w * 0.1)}" rx="${f(w * 0.05)}" fill="#fff" stroke="${INK}" stroke-width="6"/>`;
    const fx = sg === 1 ? bb.x0 + w * 0.3 : bb.x1 - w * 0.3;
    const zx = sg === 1 ? bb.x1 + 10 : bb.x0 - 40;
    return {
      label: 'A sleepy moon!',
      top: w * 0.5,
      svg: outlineFill(x.d, fill) + face(fx, bb.cy + bb.h * 0.02, x.s * 0.8, 'calm') +
        outlineFill(capD, capC) + brim + `<circle cx="${m(0.55)}" cy="${f(By - w * 0.34)}" r="${f(w * 0.075)}" fill="#fff" stroke="${INK}" stroke-width="5"/>` +
        `<path d="M${f(zx)} ${f(bb.cy - 4)}h14l-14 14h14" stroke="${INK}" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
        sparkle(sg === 1 ? bb.x1 + 6 : bb.x0 - 6, bb.y1 - 10, 10, '#f9e39b') + sparkle(sg === 1 ? bb.x0 - 12 : bb.x1 + 12, bb.y1 - bb.h * 0.2, 7),
    };
  };

  B.bolt = (x) => {
    const bb = x.bb, fill = pick(C.bolt);
    const W = clamp(Math.max(bb.w, bb.h) * 0.16, 30, 48);
    const body = x.closed ? outlineFill(x.d, fill) : ribbon(x.d, fill, W);
    const fx = x.closed ? x.c.x : x.P[Math.floor(x.P.length / 2)].x, fy = x.closed ? x.c.y : x.P[Math.floor(x.P.length / 2)].y;
    const zl = (ax, ay, bx2, by2) => `<path d="M${f(ax)} ${f(ay)}L${f(bx2)} ${f(by2)}" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`;
    return {
      label: 'A zappy bolt!',
      svg: body +
        face(fx, fy - 2, clamp(W / 46, 0.62, 0.9), 'zap') +
        zl(bb.x0 - 14, bb.y0 + bb.h * 0.2, bb.x0 - 32, bb.y0 + bb.h * 0.14) + zl(bb.x0 - 10, bb.y0 + bb.h * 0.32, bb.x0 - 28, bb.y0 + bb.h * 0.34) +
        zl(bb.x1 + 14, bb.y1 - bb.h * 0.2, bb.x1 + 32, bb.y1 - bb.h * 0.14) + sparkle(bb.x1 + 10, bb.y0 + 6, 12, '#f9e39b') + sparkle(bb.x0 - 6, bb.y1 - 4, 8),
    };
  };

  B.infinity = (x) => {
    const bb = x.bb, fill = pick(C.inf);
    const s = clamp(Math.min(bb.w * 0.2, bb.h * 0.6) / 32, 0.42, 0.95);
    return {
      label: 'Infinite good vibes!',
      svg: outlineFill(x.d, fill) + face(bb.x0 + bb.w * 0.25, bb.cy - bb.h * 0.04, s, 'happy') + face(bb.x1 - bb.w * 0.25, bb.cy - bb.h * 0.04, s, 'happy') +
        sparkle(bb.cx, bb.y0 - 14, 11, '#f9e39b') + sparkle(bb.x1 + 10, bb.y1 + 8, 8) + sparkle(bb.x0 - 8, bb.y0 - 4, 7, '#d5c8f3'),
    };
  };

  B.check = (x) => {
    const bb = x.bb, fill = pick(C.check), W = clamp(Math.max(bb.w, bb.h) * 0.2, 26, 50);
    const r = Math.max(bb.w, bb.h) * 0.78;
    return {
      label: 'Nailed it!',
      svg: `<circle cx="${f(bb.cx)}" cy="${f(bb.cy)}" r="${f(r)}" fill="#e6f6ec"/>` +
        ribbon(x.d, fill, W) + `<path d="${x.d}" transform="translate(${f(-W * 0.1)} ${f(-W * 0.12)})" stroke="#fff" stroke-width="${f(W * 0.16)}" fill="none" stroke-linecap="round" opacity=".55"/>` +
        sparkle(bb.cx + r * 0.72, bb.cy - r * 0.55, 13, '#f9e39b') + sparkle(bb.cx - r * 0.7, bb.cy - r * 0.45, 8) + sparkle(bb.cx + r * 0.5, bb.cy + r * 0.7, 7, '#c7b4ee'),
    };
  };

  // no shape matched: still a keeper
  B.doodle = (x) => {
    const bb = x.bb, fill = pick(C.zig);
    const inner = x.closed ? outlineFill(x.d, fill) + `<path d="${x.d}" transform="translate(-3 -3)" stroke="#fff" stroke-width="5" fill="none" opacity=".45"/>`
      : ribbon(x.d, fill, clamp(Math.min(Math.max(bb.w, bb.h) * 0.09, (Math.max(bb.w, bb.h) ** 2 / pathLen(x.P, false)) * 0.3), 7, 32));
    const r = Math.max(bb.w, bb.h);
    let sp = '';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + rnd(0, 1.2), rr = r * rnd(0.62, 0.78);
      sp += sparkle(bb.cx + Math.cos(a) * rr * (bb.w / r + 0.3), bb.cy + Math.sin(a) * rr * (bb.h / r + 0.3), rnd(7, 13), pick(['#fff', '#f9e39b', '#dfd0f7', '#f7b5c8']));
    }
    return { label: 'A one-of-a-kind doodle!', svg: inner + sp };
  };

  const CLOSED = { circle: 1, heart: 1, star: 1, triangle: 1, square: 1, diamond: 1, cloud: 1, moon: 1, infinity: 1 };
  const SMOOTH = { circle: 6, heart: 4, star: 2, triangle: 2, square: 2, diamond: 2, cloud: 4, moon: 3, infinity: 5, bolt: 2, wave: 6, swirl: 5, zigzag: 2, check: 2, doodle: 4 };
  // how big the person's own stroke is on the 400 canvas, and where its centre sits
  const FIT = { circle: 190, heart: 230, star: 230, triangle: 230, square: 190, diamond: 220, wave: 260, swirl: 165, zigzag: 260, cloud: 230, moon: 200, bolt: 230, infinity: 260, check: 220, doodle: 240 };

  /* ---------- public: build ---------- */

  // strokes: array of arrays of {x,y} in pixels. name: recognised shape id or null.
  function build(name, strokes) {
    const shape = B[name] ? name : 'doodle';
    const raw = [].concat(...strokes);
    const rb = bounds(raw);
    const big = Math.max(rb.w, rb.h, 1);
    const scale = FIT[shape] / big;

    let P = raw.map((p) => ({ x: (p.x - rb.cx) * scale, y: (p.y - rb.cy) * scale }));
    // drop near-duplicate points
    P = P.filter((p, i) => i === 0 || dist(p, P[i - 1]) > 0.4);
    if (P.length < 3) P = [P[0], { x: P[0].x + 1, y: P[0].y }, { x: P[0].x + 2, y: P[0].y + 1 }];

    const gap = dist(P[0], P[P.length - 1]);
    const closed = CLOSED[shape] ? true : (shape === 'bolt' || shape === 'doodle') ? gap < FIT[shape] * 0.22 : false;

    P = resample(P, 220, closed);
    P = smooth(P, SMOOTH[shape] || 3, closed);
    P = resample(P, closed ? 72 : 96, closed);
    if (!closed && (shape === 'zigzag' || shape === 'check' || shape === 'bolt')) P = resample(smooth(P, 1, false), 96, false);

    // put the smoothed stroke on the canvas; some shapes need extra room for their extras
    const bb = bounds(P);
    const seed = Math.floor(Math.random() * 1e9);
    const run = (ax, ay) => {
      rng = mulberry(seed);
      const Q = P.map((p) => ({ x: p.x + ax - bb.cx, y: p.y + ay - bb.cy }));
      const qb = bounds(Q), qc = centroid(Q);
      const R = Q.reduce((sum, p) => sum + dist(p, qc), 0) / Q.length;
      return B[shape]({ P: Q, d: pathD(Q, closed), closed, bb: qb, c: qc, R, s: clamp(Math.min(qb.w, qb.h) / 150, 0.55, 1.4) });
    };
    const first = run(CANVAS / 2, CANVAS / 2);
    const ax = first.anchorX || CANVAS / 2;
    const ay = CANVAS / 2 + ((first.top || 0) - (first.bottom || 0)) / 2;
    const out = first.anchorX || first.top || first.bottom ? run(ax, ay) : first;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}" fill="none" stroke-linecap="round" stroke-linejoin="round">${out.svg}</svg>`;
    return {
      shape: name && B[name] ? name : null,
      label: out.label,
      svg,
      // where the stroke's centre sits on the canvas, and how many canvas units per stage pixel
      anchor: { x: ax, y: ay },
      unitsPerPx: FIT[shape] / big,
      strokeCentre: { x: rb.cx, y: rb.cy },
    };
  }

  window.Art = { build, CANVAS, shapes: Object.keys(B).filter((k) => k !== 'doodle') };
})();
