/* $1 Unistroke Recognizer (Wobbrock, Wilson, Li 2007), written for Air Doodle.
   Templates are generated in code from clean shape outlines, with several
   start points and both directions so any way of drawing a shape matches. */
(function () {
  const NUM_POINTS = 64;
  const SQUARE_SIZE = 250;
  const HALF_DIAGONAL = 0.5 * Math.sqrt(SQUARE_SIZE * SQUARE_SIZE + SQUARE_SIZE * SQUARE_SIZE);
  const PHI = 0.5 * (-1 + Math.sqrt(5));
  const ANGLE_RANGE = (15 * Math.PI) / 180;
  const ANGLE_PRECISION = (2 * Math.PI) / 180;

  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

  function pathLength(pts) {
    let d = 0;
    for (let i = 1; i < pts.length; i++) d += dist(pts[i - 1], pts[i]);
    return d;
  }

  function resample(points, n) {
    const pts = points.map((p) => ({ x: p.x, y: p.y }));
    const interval = pathLength(pts) / (n - 1);
    if (!isFinite(interval) || interval === 0) return null;
    let D = 0;
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const d = dist(pts[i - 1], pts[i]);
      if (D + d >= interval) {
        const t = (interval - D) / d;
        const q = {
          x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x),
          y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y),
        };
        out.push(q);
        pts.splice(i, 0, q);
        D = 0;
      } else {
        D += d;
      }
    }
    while (out.length < n) out.push(pts[pts.length - 1]);
    return out.slice(0, n);
  }

  function centroid(pts) {
    let x = 0, y = 0;
    for (const p of pts) { x += p.x; y += p.y; }
    return { x: x / pts.length, y: y / pts.length };
  }

  function boundingBox(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function rotateBy(pts, rad) {
    const c = centroid(pts);
    const cos = Math.cos(rad), sin = Math.sin(rad);
    return pts.map((p) => ({
      x: (p.x - c.x) * cos - (p.y - c.y) * sin + c.x,
      y: (p.x - c.x) * sin + (p.y - c.y) * cos + c.y,
    }));
  }

  function scaleTo(pts, size) {
    const b = boundingBox(pts);
    const w = Math.max(b.w, 1e-6), h = Math.max(b.h, 1e-6);
    return pts.map((p) => ({ x: (p.x * size) / w, y: (p.y * size) / h }));
  }

  function translateToOrigin(pts) {
    const c = centroid(pts);
    return pts.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
  }

  function pathDistance(a, b) {
    let d = 0;
    for (let i = 0; i < a.length; i++) d += dist(a[i], b[i]);
    return d / a.length;
  }

  function distanceAtAngle(pts, tpl, rad) {
    return pathDistance(rotateBy(pts, rad), tpl);
  }

  // Golden section search over a small angle window. Templates keep their
  // upright orientation (a heart should be an upright heart), so the window is
  // narrow: it forgives a tilted hand but does not turn a wave into a swirl.
  function distanceAtBestAngle(pts, tpl) {
    let a = -ANGLE_RANGE, b = ANGLE_RANGE;
    let x1 = PHI * a + (1 - PHI) * b;
    let f1 = distanceAtAngle(pts, tpl, x1);
    let x2 = (1 - PHI) * a + PHI * b;
    let f2 = distanceAtAngle(pts, tpl, x2);
    while (Math.abs(b - a) > ANGLE_PRECISION) {
      if (f1 < f2) {
        b = x2; x2 = x1; f2 = f1;
        x1 = PHI * a + (1 - PHI) * b;
        f1 = distanceAtAngle(pts, tpl, x1);
      } else {
        a = x1; x1 = x2; f1 = f2;
        x2 = (1 - PHI) * a + PHI * b;
        f2 = distanceAtAngle(pts, tpl, x2);
      }
    }
    return Math.min(f1, f2);
  }

  function normalize(points) {
    const r = resample(points, NUM_POINTS);
    if (!r) return null;
    return translateToOrigin(scaleTo(r, SQUARE_SIZE));
  }

  /* ---------- clean outlines used to build templates ---------- */

  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;
  const densify = (pts, per) => {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      for (let k = 0; k < per; k++) {
        const t = k / per;
        out.push({
          x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
          y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
        });
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  };
  const polygon = (verts, per = 14) => densify(verts.concat([verts[0]]), per);
  const regular = (n, rot) => {
    const v = [];
    for (let i = 0; i < n; i++) v.push({ x: Math.cos(rot + (i / n) * TAU), y: Math.sin(rot + (i / n) * TAU) });
    return v;
  };
  const arc = (cx, cy, r, a0, a1, n = 24) => {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = (a0 + ((a1 - a0) * i) / n) * DEG;
      out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return out;
  };
  const flipX = (pts) => pts.map((p) => ({ x: -p.x, y: p.y }));
  const flipY = (pts) => pts.map((p) => ({ x: p.x, y: -p.y }));
  const swapXY = (pts) => pts.map((p) => ({ x: p.y, y: p.x }));
  const rot = (pts, deg) => {
    const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
    return pts.map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
  };

  // Every base outline starts where a person would naturally start, because
  // the same outlines are used for the "how to draw it" cards.
  const circle = arc(0, 0, 1, -90, 270, 64);

  const heart = [];
  for (let i = 0; i <= 96; i++) {
    const t = Math.PI + (i / 96) * TAU;
    heart.push({
      x: 16 * Math.pow(Math.sin(t), 3),
      y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
    });
  }

  const starPoints = regular(5, -Math.PI / 2);
  const pentagram = densify([0, 2, 4, 1, 3, 0].map((k) => starPoints[k]), 12);
  const starOutline = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 1 : 0.42;
    const a = -Math.PI / 2 + (i * TAU) / 10;
    starOutline.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  const starOutlineClosed = polygon(starOutline, 8);

  const triUp = polygon(regular(3, -Math.PI / 2));
  const triDown = polygon(regular(3, Math.PI / 2));
  const squareShape = polygon([{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }]);
  const tiltedSquares = [-10, -5, 5, 10].map((d) => rot(squareShape, d));
  const diamondShape = polygon([{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }]);
  const tiltedDiamonds = [-10, 10].map((d) => rot(diamondShape, d));

  const waves = [];
  for (const cycles of [1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.5]) {
    for (const phase of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) {
      const w = [];
      for (let i = 0; i <= 64; i++) {
        const t = i / 64;
        w.push({ x: t * 4, y: Math.sin(phase + t * TAU * cycles) * 0.6 });
      }
      waves.push(w, flipY(w));
    }
  }

  const zigzags = [];
  for (const zigs of [4, 5, 6, 7]) {
    const z = [];
    for (let i = 0; i <= zigs; i++) z.push({ x: i, y: i % 2 });
    const d = densify(z, 12);
    zigzags.push(d, flipY(d));
  }

  const swirls = [];
  for (const turns of [1.5, 2, 2.5, 3.25]) {
    for (const start of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const sp = [];
      for (let i = 0; i <= 120; i++) {
        const t = i / 120;
        const a = start + t * TAU * turns;
        const r = 0.06 + t * 0.94;
        sp.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
      }
      swirls.push(sp, flipX(sp));
    }
  }
  const swirlGuide = (() => {
    const sp = [];
    for (let i = 0; i <= 120; i++) {
      const t = i / 120;
      const a = -Math.PI / 2 + t * TAU * 2.25;
      const r = 0.06 + t * 0.94;
      sp.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
    }
    return sp;
  })();

  // cloud: small bump, big bump, right bump, flat bottom (clockwise from bottom left)
  const cloud = densify(
    []
      .concat(arc(0.6, 0.85, 0.35, 90, 270, 12))
      .concat(arc(1.4, 0.55, 0.6, 200, 350, 16))
      .concat(arc(2.5, 0.7, 0.5, 240, 450, 14))
      .concat([{ x: 0.6, y: 1.2 }]),
    2
  );
  const cloudScallop = densify(
    []
      .concat(arc(0.5, 0.8, 0.4, 90, 270, 12))
      .concat(arc(1.15, 0.45, 0.45, 205, 335, 12))
      .concat(arc(1.85, 0.45, 0.45, 205, 335, 12))
      .concat(arc(2.5, 0.8, 0.4, 270, 450, 12))
      .concat([{ x: 0.5, y: 1.2 }]),
    2
  );
  const cloudRound = densify(
    []
      .concat(arc(0.7, 0.8, 0.4, 90, 250, 10))
      .concat(arc(1.5, 0.5, 0.7, 195, 345, 16))
      .concat(arc(2.3, 0.8, 0.4, 290, 450, 10))
      .concat([{ x: 0.7, y: 1.2 }]),
    2
  );
  const cloudVariants = [cloud, flipX(cloud), cloudScallop, cloudRound];

  // crescent opening to the right, from the top tip anticlockwise round the outside
  const moon = densify(
    arc(0, 0, 1, -58, -302, 40).concat(arc(0.5, 0, 0.85, 88, 272, 30)).concat([{ x: 0.5299, y: -0.848 }]),
    2
  );
  const moonVariants = [moon, flipX(moon)];

  const boltClosed = polygon(
    [{ x: 0.55, y: 0 }, { x: 0, y: 0.62 }, { x: 0.36, y: 0.62 }, { x: 0.2, y: 1.25 }, { x: 0.8, y: 0.45 }, { x: 0.42, y: 0.45 }, { x: 0.7, y: 0 }],
    12
  );
  const boltOpen = densify([{ x: 0.7, y: 0 }, { x: 0.15, y: 0.6 }, { x: 0.8, y: 0.5 }, { x: 0.25, y: 1.15 }], 16);
  const boltOpen2 = densify([{ x: 0.6, y: 0 }, { x: 0.05, y: 0.55 }, { x: 0.7, y: 0.5 }, { x: 0.15, y: 1.1 }], 16);

  const infinity = [];
  for (let i = 0; i <= 96; i++) {
    const t = Math.PI / 2 + (i / 96) * TAU;
    const d = 1 + Math.sin(t) * Math.sin(t);
    infinity.push({ x: Math.cos(t) / d, y: (1.4 * Math.sin(t) * Math.cos(t)) / d });
  }

  const check = densify([{ x: 0, y: 0.55 }, { x: 0.35, y: 0.95 }, { x: 1.15, y: 0 }], 18);
  const check2 = densify([{ x: 0, y: 0.5 }, { x: 0.3, y: 0.9 }, { x: 1, y: 0.1 }], 18);

  const SHAPES = [
    { name: 'circle', closed: true, paths: [circle] },
    { name: 'heart', closed: true, paths: [heart] },
    { name: 'star', closed: true, paths: [pentagram, starOutlineClosed] },
    { name: 'triangle', closed: true, paths: [triUp, triDown] },
    { name: 'square', closed: true, paths: [squareShape].concat(tiltedSquares) },
    { name: 'diamond', closed: true, paths: [diamondShape].concat(tiltedDiamonds) },
    { name: 'wave', closed: false, paths: waves.concat([swapXY(waves[2])]) },
    { name: 'swirl', closed: false, paths: swirls },
    { name: 'zigzag', closed: false, paths: zigzags },
    { name: 'cloud', closed: true, paths: cloudVariants },
    { name: 'moon', closed: true, paths: moonVariants },
    { name: 'bolt', closed: true, paths: [boltClosed] },
    { name: 'bolt', closed: false, paths: [boltOpen, boltOpen2, flipX(boltOpen)] },
    { name: 'infinity', closed: true, paths: [infinity] },
    { name: 'check', closed: false, paths: [check, check2] },
  ];

  // how to draw each shape, in the order shown on the cards
  const GUIDES = [
    ['circle', 'Circle', circle],
    ['heart', 'Heart', heart],
    ['star', 'Star', pentagram],
    ['triangle', 'Triangle', triUp],
    ['square', 'Square', squareShape],
    ['diamond', 'Diamond', diamondShape],
    ['wave', 'Wave', (() => { const w = []; for (let i = 0; i <= 64; i++) { const t = i / 64; w.push({ x: t * 4, y: -Math.sin(t * TAU * 2) * 0.6 }); } return w; })()],
    ['swirl', 'Swirl', swirlGuide],
    ['zigzag', 'Zigzag', zigzags[6]],
    ['cloud', 'Cloud', cloud],
    ['moon', 'Moon', moon],
    ['bolt', 'Bolt', boltOpen],
    ['infinity', 'Infinity', infinity],
    ['check', 'Check', check],
  ].map(([id, name, points]) => ({ id, name, points }));

  const templates = [];
  function addTemplate(name, pts) {
    const n = normalize(pts);
    if (n) templates.push({ name, points: n });
  }
  for (const shape of SHAPES) {
    for (const base of shape.paths) {
      for (const v of [base, base.slice().reverse()]) {
        if (shape.closed) {
          // closed outlines can start anywhere: evenly spaced start points by arc length
          const ring = resample(v, 97).slice(0, 96);
          for (let s = 0; s < ring.length; s += 4) {
            const rotated = ring.slice(s).concat(ring.slice(0, s));
            rotated.push(rotated[0]);
            addTemplate(shape.name, rotated);
          }
        } else {
          addTemplate(shape.name, v);
        }
      }
    }
  }

  function recognize(points) {
    if (!points || points.length < 8) return { name: null, score: 0 };
    const pts = normalize(points);
    if (!pts) return { name: null, score: 0 };
    let best = Infinity, bestName = null;
    const perShape = {};
    for (const t of templates) {
      const d = distanceAtBestAngle(pts, t.points);
      if (d < (perShape[t.name] ?? Infinity)) perShape[t.name] = d;
      if (d < best) { best = d; bestName = t.name; }
    }
    return { name: bestName, score: Math.max(0, 1 - best / HALF_DIAGONAL), perShape };
  }

  window.Recognizer = { recognize, templateCount: templates.length, normalize, guides: GUIDES };
})();
