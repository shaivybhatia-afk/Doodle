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
  const poly = (n, rot) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * TAU;
      out.push({ x: Math.cos(a), y: Math.sin(a) });
    }
    out.push(out[0]);
    return out;
  };
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

  const circle = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * TAU;
    circle.push({ x: Math.cos(a), y: Math.sin(a) });
  }

  const heart = [];
  for (let i = 0; i <= 96; i++) {
    const t = (i / 96) * TAU;
    heart.push({
      x: 16 * Math.pow(Math.sin(t), 3),
      y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
    });
  }

  const flipX = (pts) => pts.map((p) => ({ x: -p.x, y: p.y }));
  const flipY = (pts) => pts.map((p) => ({ x: p.x, y: -p.y }));
  const swapXY = (pts) => pts.map((p) => ({ x: p.y, y: p.x }));

  // People draw different numbers of humps, turns and zigs, so each open shape
  // gets a family of templates rather than a single one.
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
  for (const zigs of [3, 4, 5, 6]) {
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

  const starOuter = [], pentagram = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * TAU) / 5;
    starOuter.push({ x: Math.cos(a), y: Math.sin(a) });
  }
  const order = [0, 2, 4, 1, 3, 0];
  for (const k of order) pentagram.push(starOuter[k]);
  const starOutline = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * TAU) / 10;
    const r = i % 2 === 0 ? 1 : 0.42;
    starOutline.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  starOutline.push(starOutline[0]);

  const triUp = densify(poly(3, -Math.PI / 2), 14);
  const triDown = densify(poly(3, Math.PI / 2), 14);
  const squareShape = densify(poly(4, Math.PI / 4), 14);
  const diamondShape = densify(poly(4, 0), 14);
  // slightly tilted squares (hand drawn boxes are rarely level)
  const tiltedSquares = [-10, -5, 5, 10].map((deg) => densify(poly(4, Math.PI / 4 + (deg * Math.PI) / 180), 14));

  const SHAPES = [
    { name: 'circle', closed: true, paths: [circle] },
    { name: 'heart', closed: true, paths: [heart] },
    { name: 'wave', closed: false, paths: waves.concat([swapXY(waves[2])]) },
    { name: 'swirl', closed: false, paths: swirls },
    { name: 'star', closed: true, paths: [pentagram, starOutline] },
    { name: 'triangle', closed: true, paths: [triUp, triDown] },
    { name: 'square', closed: true, paths: [squareShape, diamondShape].concat(tiltedSquares) },
    { name: 'zigzag', closed: false, paths: zigzags.concat([swapXY(zigzags[2]), swapXY(zigzags[4])]) },
  ];

  const templates = [];
  function addTemplate(name, pts) {
    const n = normalize(pts);
    if (n) templates.push({ name, points: n });
  }
  for (const shape of SHAPES) {
    for (const base of shape.paths) {
      const variants = [base, base.slice().reverse()];
      for (const v of variants) {
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

  window.Recognizer = { recognize, templateCount: templates.length, normalize };
})();
