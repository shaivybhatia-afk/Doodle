/* Air Doodle: camera and mouse drawing, gestures, shape recognition, cute art, sharing. */
(function () {
  'use strict';

  const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

  const MIN_SCORE = 0.72;       // below this we make a one-of-a-kind doodle instead
  const HOLD_MS = 1000;         // open palm held this long = done
  const PALM_GRACE_MS = 200;    // a flicker shorter than this does not cancel the hold
  const PINCH_DOWN = 0.32;      // pinch distance / palm size to start drawing
  const PINCH_UP = 0.5;         // ...and to stop
  const HAND_LOST_MS = 300;
  const HISTORY_KEY = 'airdoodle.recent.v1';
  const GESTURE_KEY = 'airdoodle.gesture';
  const HISTORY_MAX = 12;
  const CHEERS = ['Yay!', 'Ta-da!', 'Nice one!', 'Look at that!'];
  const CONFETTI = ['#f7b5c8', '#f9dc8d', '#a9d5f2', '#b7e4cf', '#d5c8f3', '#f9cfb0', '#ff5c8a'];

  const HINTS = {
    pointer: 'Point to draw · Peace sign to lift · Open palm to finish',
    pinch: 'Pinch to draw · Open fingers to lift · Hold an open palm to finish',
    mouse: 'Draw with your mouse or finger · Press Done when you are finished',
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    welcome: $('welcome'), app: $('app'), stage: $('stage'), video: $('video'), ink: $('ink'),
    ring: $('ring'), palm: $('palm'), palmFill: $('palm-fill'), pill: $('pill'), hint: $('hint'),
    loading: $('loading'), loadingText: $('loading-text'), ready: $('ready'), start: $('btn-start'),
    count: $('count'), countText: $('count-text'),
    result: $('result'), art: $('art'), confetti: $('confetti'), cheer: $('cheer'), name: $('name'),
    notice: $('notice'), toolbar: $('toolbar'), cards: $('cards'),
    actsDraw: $('acts-draw'), actsResult: $('acts-result'),
    undo: $('btn-undo'), restart: $('btn-restart'), done: $('btn-done'),
    again: $('btn-again'), share: $('btn-share'), save: $('btn-save'), switchBtn: $('btn-switch'),
    recent: $('recent'), thumbs: $('thumbs'), clear: $('btn-clear'),
  };
  const ctx = el.ink.getContext('2d');

  const state = {
    mode: null,          // 'camera' | 'mouse'
    gesture: 'pointer',  // 'pointer' | 'pinch'
    phase: 'idle',       // 'loading' | 'ready' | 'count' | 'idle' | 'result'
    strokes: [],         // arrays of normalised 0..1 stage points
    cur: null,           // stroke being drawn
    penDown: false,
    stream: null,
    landmarker: null,
    raf: 0,
    lastVideoTime: -1,
    handLostAt: 0,
    pose: 'other', pendingPose: null, poseVotes: 0,
    fingers: [false, false, false, false],
    palmSince: 0, palmLostAt: 0,
    current: null,       // item currently shown as a result
    startToken: 0,
    timers: [],
  };

  /* ---------- small helpers ---------- */

  const svgUri = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const stageSize = () => ({ w: el.stage.clientWidth || 1, h: el.stage.clientHeight || 1 });
  const setPill = (t) => { el.pill.textContent = t || ''; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  function setNotice(t) { el.notice.textContent = t || ''; el.notice.hidden = !t; }
  function later(fn, ms) { const id = setTimeout(fn, ms); state.timers.push(id); return id; }
  function clearTimers() { state.timers.forEach(clearTimeout); state.timers = []; }
  function totalPoints() { return state.strokes.reduce((n, s) => n + s.length, 0); }

  // One Euro filter: smooth when slow, responsive when fast
  class OneEuro {
    constructor(minCutoff = 1.2, beta = 0.015, dCutoff = 1) {
      Object.assign(this, { minCutoff, beta, dCutoff });
      this.reset();
    }
    reset() { this.x = null; this.dx = 0; this.t = 0; }
    alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
    filter(v, t) {
      if (this.x === null) { this.x = v; this.t = t; return v; }
      const dt = Math.max((t - this.t) / 1000, 1 / 120);
      const dv = (v - this.x) / dt;
      this.dx += this.alpha(this.dCutoff, dt) * (dv - this.dx);
      const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
      this.x += this.alpha(cutoff, dt) * (v - this.x);
      this.t = t;
      return this.x;
    }
  }
  const fx = new OneEuro();
  const fy = new OneEuro();

  /* ---------- drawing surface ---------- */

  function sizeCanvas() {
    const { w, h } = stageSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.ink.width = Math.round(w * dpr);
    el.ink.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }

  function strokePath(p) {
    ctx.beginPath();
    ctx.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < p.length - 1; i++) {
      ctx.quadraticCurveTo(p[i].x, p[i].y, (p[i].x + p[i + 1].x) / 2, (p[i].y + p[i + 1].y) / 2);
    }
    ctx.lineTo(p[p.length - 1].x, p[p.length - 1].y);
  }

  function redraw() {
    const { w, h } = stageSize();
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const lines = state.strokes.filter((s) => s.length).map((s) => s.map((q) => ({ x: q.x * w, y: q.y * h })));
    const paint = (color, width) => {
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width;
      lines.forEach((p) => {
        if (p.length < 3) {
          ctx.beginPath(); ctx.arc(p[0].x, p[0].y, width / 2, 0, Math.PI * 2); ctx.fill();
          if (p.length === 2) { ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[1].x, p[1].y); ctx.stroke(); }
          return;
        }
        strokePath(p);
        ctx.stroke();
      });
    };
    paint('rgba(255,255,255,.95)', 13);
    paint('#ff5c8a', 7);
  }

  function addPoint(nx, ny) {
    if (!state.penDown) return;
    // if the current line was undone mid-stroke, start a fresh one
    if (!state.cur || state.strokes[state.strokes.length - 1] !== state.cur) {
      state.cur = [];
      state.strokes.push(state.cur);
    }
    const last = state.cur[state.cur.length - 1];
    const { w, h } = stageSize();
    if (last && Math.hypot((nx - last.x) * w, (ny - last.y) * h) < 2.5) return;
    state.cur.push({ x: nx, y: ny });
    redraw();
    updateButtons();
  }

  function updateButtons() {
    const has = totalPoints() > 0;
    el.undo.disabled = !has;
    el.restart.disabled = !has;
  }

  /* ---------- pen up / down, undo, done ---------- */

  function penStart() {
    if (state.phase !== 'idle' || state.penDown) return;
    state.penDown = true;
    state.cur = [];
    state.strokes.push(state.cur);
    el.ring.classList.add('down');
    setPill('Drawing...');
    updateButtons();
  }

  function penEnd() {
    if (!state.penDown) return;
    state.penDown = false;
    el.ring.classList.remove('down');
    // a lone point is not a line
    if (state.cur && state.cur.length < 2) {
      const i = state.strokes.indexOf(state.cur);
      if (i >= 0) state.strokes.splice(i, 1);
      redraw();
    }
    state.cur = null;
    updateButtons();
    if (state.phase === 'idle') idleHint();
  }

  function idleHint() {
    if (state.mode === 'mouse') { setPill(totalPoints() ? 'Add more, or press Done' : 'Draw a simple shape'); return; }
    if (totalPoints()) setPill(state.gesture === 'pointer' ? 'Add more, or open your palm to finish' : 'Add more, or hold an open palm to finish');
    else setPill(state.gesture === 'pointer' ? 'Point to draw' : 'Pinch to draw');
  }

  function undoLine() {
    if (state.phase !== 'idle' || !state.strokes.length) return;
    state.strokes.pop();
    state.cur = null;
    redraw(); updateButtons(); idleHint();
  }

  function startOver() {
    if (state.phase !== 'idle') return;
    state.strokes = []; state.cur = null;
    redraw(); updateButtons(); idleHint();
  }

  function finish() {
    if (state.phase !== 'idle') return;
    resetPalm();
    if (state.penDown) penEnd();
    const { w, h } = stageSize();
    const strokesPx = state.strokes.filter((s) => s.length > 1).map((s) => s.map((p) => ({ x: p.x * w, y: p.y * h })));
    const flat = [].concat(...strokesPx);
    if (flat.length < 4) {
      setPill('Draw something first');
      later(idleHint, 1800);
      return;
    }
    const xs = flat.map((p) => p.x), ys = flat.map((p) => p.y);
    const big = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (big < 0.04 * Math.min(w, h)) {
      setPill('Draw a little bigger');
      later(idleHint, 1800);
      return;
    }
    const rec = flat.length >= 8 ? window.Recognizer.recognize(flat) : { name: null, score: 0 };
    state.lastRecognition = rec;
    const matched = rec.name && rec.score >= MIN_SCORE ? rec.name : null;
    const art = window.Art.build(matched, strokesPx);
    const item = { shape: art.shape || 'doodle', label: art.label, svg: art.svg, date: new Date().toISOString() };
    saveHistory(item);
    showResult(item, placeArt(art), matched ? CHEERS[Math.floor(Math.random() * CHEERS.length)] : 'Hmm, didn’t quite catch that one.');
  }

  // where to put the 400 x 400 art so it sits over what they drew
  function placeArt(art) {
    const { w, h } = stageSize();
    const minSide = Math.min(w, h);
    const size = clamp(window.Art.CANVAS / art.unitsPerPx, minSide * 0.52, minSide * 0.97);
    const k = size / window.Art.CANVAS;
    const slack = 0.06 * size;
    const left = clamp(art.strokeCentre.x - art.anchor.x * k, Math.min(0, w - size) - slack, Math.max(0, w - size) + slack);
    const top = clamp(art.strokeCentre.y - art.anchor.y * k, Math.min(0, h - size) - slack, Math.max(0, h - size) + slack);
    return { left: left / w, top: top / h, size: size / w, cx: (left + size / 2) / w, cy: (top + size / 2) / h };
  }

  function showResult(item, place, cheer) {
    state.phase = 'result';
    state.current = item;
    clearTimers();
    resetPalm();
    if (!place) {
      const { w, h } = stageSize();
      const size = Math.min(w, h) * 0.8;
      const left = (w - size) / 2, top = (h - size) / 2 - 0.02 * h;
      place = { left: left / w, top: top / h, size: size / w, cx: (left + size / 2) / w, cy: (top + size / 2) / h };
    }
    el.art.style.left = place.left * 100 + '%';
    el.art.style.top = place.top * 100 + '%';
    el.art.style.width = place.size * 100 + '%';
    el.art.alt = item.label;
    el.art.removeAttribute('src');
    void el.art.offsetWidth;
    el.art.src = svgUri(item.svg);
    el.cheer.textContent = cheer || '';
    el.name.textContent = item.label;
    // hide then show so the reveal animation replays every time
    el.result.hidden = true;
    void el.result.offsetWidth;
    el.result.hidden = false;
    el.ring.hidden = true; el.palm.hidden = true;
    el.ink.style.opacity = '0';
    el.hint.textContent = '';
    setPill('');
    el.actsDraw.hidden = true; el.actsResult.hidden = false;
    setNotice('');
    el.confetti.textContent = '';
    if (cheer) burst(place);
    markActive();
  }

  function burst(place) {
    const { w, h } = stageSize();
    for (let i = 0; i < 34; i++) {
      const s = document.createElement('span');
      if (Math.random() < 0.4) s.className = 'round';
      const ang = Math.random() * Math.PI * 2, dist = rand(70, Math.min(w, h) * 0.55);
      s.style.left = place.cx * w + 'px';
      s.style.top = place.cy * h + 'px';
      s.style.background = CONFETTI[i % CONFETTI.length];
      s.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      s.style.setProperty('--dy', Math.sin(ang) * dist - 30 + 'px');
      s.style.setProperty('--rot', rand(-540, 540) + 'deg');
      s.style.animationDelay = rand(0.05, 0.3) + 's';
      el.confetti.appendChild(s);
    }
  }

  function drawAgain() {
    clearTimers();
    state.strokes = []; state.cur = null; state.penDown = false;
    state.phase = 'idle';
    state.current = null;
    state.pose = 'other'; state.pendingPose = null; state.poseVotes = 0;
    resetPalm();
    el.result.hidden = true;
    el.ink.style.opacity = '1';
    el.ring.classList.remove('down');
    el.ring.hidden = true;
    el.actsDraw.hidden = false; el.actsResult.hidden = true;
    setNotice('');
    redraw(); updateButtons();
    el.hint.textContent = HINTS[state.mode === 'mouse' ? 'mouse' : state.gesture];
    idleHint();
    markActive();
  }

  /* ---------- camera mode ---------- */

  function resetPalm() {
    state.palmSince = 0; state.palmLostAt = 0;
    el.palm.hidden = true;
    el.palmFill.style.strokeDashoffset = '276.5';
  }

  // finger extended: fingertip is much farther from the wrist than its knuckle (about 1.7x when
  // straight, about 0.9x when curled). Two thresholds stop it flickering in between.
  function fingerUp(lm, i, tip, mcp, vw, vh) {
    const d = (a, b) => Math.hypot((a.x - b.x) * vw, (a.y - b.y) * vh);
    const r = d(lm[0], lm[tip]) / Math.max(d(lm[0], lm[mcp]), 1e-3);
    if (r > 1.45) state.fingers[i] = true; else if (r < 1.25) state.fingers[i] = false;
    return state.fingers[i];
  }

  function classify(lm, vw, vh) {
    const d = (a, b) => Math.hypot((a.x - b.x) * vw, (a.y - b.y) * vh);
    const palm = Math.max(d(lm[0], lm[9]), 1e-3);
    const idx = fingerUp(lm, 0, 8, 5, vw, vh), mid = fingerUp(lm, 1, 12, 9, vw, vh);
    const ring = fingerUp(lm, 2, 16, 13, vw, vh), pinky = fingerUp(lm, 3, 20, 17, vw, vh);
    const thumbOut = d(lm[4], lm[5]) / palm > 0.6;
    const pinch = d(lm[4], lm[8]) / palm;
    const openHand = idx && mid && ring && pinky && thumbOut;
    let pose;
    if (state.gesture === 'pinch') {
      const pinched = state.pose === 'draw' ? pinch < PINCH_UP : pinch < PINCH_DOWN;
      pose = pinched ? 'draw' : openHand && pinch > 0.7 ? 'palm' : 'lift';
    } else if (openHand) pose = 'palm';
    else if (idx && !mid && !ring && !pinky) pose = 'draw';
    else if (idx && mid && !ring && !pinky) pose = 'lift';
    else pose = 'other';
    const tip = state.gesture === 'pinch'
      ? { x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2 }
      : { x: lm[8].x, y: lm[8].y };
    return { pose, tip, palmPx: palm };
  }

  // landmarks: array of {x,y} normalised to the video frame, or null when no hand
  function handleHand(lm, now) {
    if (state.mode !== 'camera') return;
    if (state.phase === 'loading' || state.phase === 'result') { el.ring.hidden = true; return; }
    const vw = el.video.videoWidth || 4, vh = el.video.videoHeight || 3;

    if (!lm) {
      if (!state.handLostAt) state.handLostAt = now;
      if (now - state.handLostAt > HAND_LOST_MS) {
        el.ring.hidden = true;
        resetPalm();
        fx.reset(); fy.reset();
        state.pose = 'other'; state.pendingPose = null; state.poseVotes = 0;
        if (state.penDown) penEnd();
        if (state.phase === 'idle' && !state.penDown && !totalPoints()) setPill('Show me your hand');
      }
      return;
    }
    state.handLostAt = 0;

    const { w, h } = stageSize();
    const c = classify(lm, vw, vh);
    // mirrored: flip x so the line matches what the user sees
    const px = fx.filter((1 - c.tip.x) * w, now);
    const py = fy.filter(c.tip.y * h, now);

    if (state.phase !== 'idle') {
      // Start button or countdown: just show the ring so they can find their hand
      el.ring.hidden = false;
      el.ring.style.left = px + 'px'; el.ring.style.top = py + 'px';
      return;
    }

    // a pose must hold for two frames before it counts, so one bad frame does not break a line
    if (c.pose !== state.pose) {
      if (c.pose === state.pendingPose) state.poseVotes++;
      else { state.pendingPose = c.pose; state.poseVotes = 1; }
      if (state.poseVotes >= 2) { state.pose = c.pose; state.pendingPose = null; state.poseVotes = 0; }
    } else { state.pendingPose = null; state.poseVotes = 0; }

    // open palm held = done (only once there is something to finish)
    if (state.pose === 'palm' && totalPoints() > 0) {
      state.palmLostAt = 0;
      if (!state.palmSince) state.palmSince = now;
      if (state.penDown) penEnd();
      const p = clamp((now - state.palmSince) / HOLD_MS, 0, 1);
      const size = clamp(c.palmPx * Math.min(w, h) * 2.6, 90, 260);
      el.palm.hidden = false;
      el.palm.style.width = el.palm.style.height = size + 'px';
      el.palm.style.left = (1 - lm[9].x) * w + 'px'; el.palm.style.top = lm[9].y * h + 'px';
      el.palmFill.style.strokeDashoffset = String(276.5 * (1 - p));
      el.ring.hidden = true;
      setPill(p < 1 ? 'Hold to finish. Close your hand to cancel' : 'Done!');
      if (p >= 1) finish();
      return;
    }
    if (state.palmSince) {
      if (!state.palmLostAt) state.palmLostAt = now;
      if (now - state.palmLostAt > PALM_GRACE_MS) { resetPalm(); idleHint(); }
    }

    el.ring.hidden = false;
    el.ring.style.left = px + 'px'; el.ring.style.top = py + 'px';

    if (state.pose === 'draw') {
      if (!state.penDown) penStart();
      addPoint(px / w, py / h);
    } else if (state.penDown) {
      penEnd();
    }
  }

  async function loadLandmarker() {
    if (state.landmarker) return state.landmarker;
    const vision = await import(VISION_URL + '/vision_bundle.mjs');
    const fileset = await vision.FilesetResolver.forVisionTasks(VISION_URL + '/wasm');
    const make = (delegate) => vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try { state.landmarker = await make('GPU'); }
    catch (e) { state.landmarker = await make('CPU'); }
    return state.landmarker;
  }

  function stopCamera() {
    cancelAnimationFrame(state.raf);
    state.raf = 0;
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
    el.video.srcObject = null;
  }

  function loop() {
    if (state.mode !== 'camera' || !state.landmarker) return;
    state.raf = requestAnimationFrame(loop);
    const v = el.video;
    if (v.readyState < 2 || v.currentTime === state.lastVideoTime) return;
    state.lastVideoTime = v.currentTime;
    const now = performance.now();
    let res;
    try { res = state.landmarker.detectForVideo(v, now); } catch (e) { return; }
    handleHand(res && res.landmarks && res.landmarks[0] ? res.landmarks[0] : null, now);
  }

  function showLoading(text) { el.loadingText.textContent = text; el.loading.hidden = !text; }

  async function startCamera() {
    const token = ++state.startToken;
    clearTimers();
    enterApp('camera');
    state.phase = 'loading';
    showLoading('Waking up the camera...');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return fallbackToMouse('This browser cannot open a camera here, so let’s draw with the mouse instead.');
    }
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (e) {
      if (token !== state.startToken) return;
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      return fallbackToMouse(denied
        ? 'No problem! The camera is off, so you can draw with your mouse or finger instead.'
        : 'We could not find a camera, so you can draw with your mouse or finger instead.');
    }
    if (token !== state.startToken) { stopCamera(); return; }

    el.video.srcObject = state.stream;
    try { await el.video.play(); } catch (e) { /* muted autoplay is fine */ }
    if (!el.video.videoWidth) {
      await new Promise((r) => { el.video.onloadedmetadata = r; setTimeout(r, 3000); });
    }
    el.stage.style.setProperty('--ar', (el.video.videoWidth / el.video.videoHeight || 1.3333).toFixed(4));

    showLoading('Loading hand tracking...');
    try {
      await loadLandmarker();
    } catch (e) {
      console.error(e);
      if (token !== state.startToken) return;
      return fallbackToMouse('Hand tracking could not load. Check your connection, or draw with your mouse or finger instead.');
    }
    if (token !== state.startToken) return;

    showLoading('');
    sizeCanvas();
    showReady();
    state.lastVideoTime = -1;
    loop();
  }

  function fallbackToMouse(message) {
    stopCamera();
    startMouse();
    setNotice(message);
  }

  /* ---------- Start button and countdown ---------- */

  function showReady() {
    drawAgain();
    state.phase = 'ready';
    el.ready.hidden = false;
    setPill('Get your hand in view');
  }

  function onStart() {
    if (state.phase !== 'ready') return;
    const token = state.startToken;
    el.ready.hidden = true;
    state.phase = 'count';
    setPill('');
    const steps = [['3', 800], ['2', 800], ['1', 800], ['Draw!', 650]];
    let t = 0;
    steps.forEach(([text, ms], i) => {
      later(() => {
        if (token !== state.startToken) return;
        el.count.hidden = false;
        el.countText.textContent = text;
        el.countText.className = text === 'Draw!' ? 'go' : '';
        el.countText.style.animation = 'none'; void el.countText.offsetWidth; el.countText.style.animation = '';
        if (i === steps.length - 1) { state.phase = 'idle'; idleHint(); }
      }, t);
      t += ms;
    });
    later(() => { el.count.hidden = true; }, t);
  }

  /* ---------- mouse / touch mode ---------- */

  function startMouse() {
    state.startToken++;
    clearTimers();
    stopCamera();
    enterApp('mouse');
    showLoading('');
    el.stage.style.setProperty('--ar', window.innerWidth < 720 ? '1' : '1.3333');
    sizeCanvas();
    drawAgain();
    setNotice('');
  }

  function pointerPos(e) {
    const r = el.stage.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  el.stage.addEventListener('pointerdown', (e) => {
    if (state.mode !== 'mouse' || state.phase !== 'idle') return;
    if (e.button !== undefined && e.button > 0) return;
    try { el.stage.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety */ }
    penStart();
    const p = pointerPos(e);
    addPoint(p.x, p.y);
  });
  el.stage.addEventListener('pointermove', (e) => {
    if (state.mode !== 'mouse' || !state.penDown) return;
    const p = pointerPos(e);
    addPoint(p.x, p.y);
  });
  const up = () => { if (state.mode === 'mouse') penEnd(); };
  el.stage.addEventListener('pointerup', up);
  el.stage.addEventListener('pointercancel', up);

  /* ---------- screens and controls ---------- */

  function enterApp(mode) {
    state.mode = mode;
    el.welcome.hidden = true;
    el.app.hidden = false;
    el.stage.dataset.mode = mode;
    el.toolbar.hidden = mode !== 'camera';
    el.switchBtn.textContent = mode === 'camera' ? 'Draw with mouse instead' : 'Use camera instead';
    el.ring.hidden = true; el.result.hidden = true; el.ready.hidden = true; el.count.hidden = true;
    resetPalm();
    state.strokes = []; state.cur = null; state.penDown = false;
    state.phase = 'idle';
    state.pose = 'other'; state.pendingPose = null; state.poseVotes = 0;
    state.fingers = [false, false, false, false];
    redraw();
    setPill('');
    el.hint.textContent = HINTS[mode === 'mouse' ? 'mouse' : state.gesture];
    el.actsDraw.hidden = false; el.actsResult.hidden = true;
    updateButtons();
    renderThumbs();
  }

  function setGesture(g, save = true) {
    state.gesture = g === 'pinch' ? 'pinch' : 'pointer';
    if (save) { try { localStorage.setItem(GESTURE_KEY, state.gesture); } catch (e) { /* storage unavailable */ } }
    el.toolbar.querySelectorAll('[data-gesture]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.gesture === state.gesture)));
    state.pose = 'other'; state.pendingPose = null; state.poseVotes = 0;
    state.fingers = [false, false, false, false];
    if (state.penDown) penEnd();
    resetPalm();
    if (state.mode === 'camera' && state.phase !== 'result') {
      el.hint.textContent = HINTS[state.gesture];
      if (state.phase === 'idle') idleHint();
    }
  }
  (function initGesture() {
    let g = 'pointer';
    try { g = localStorage.getItem(GESTURE_KEY) || 'pointer'; } catch (e) { /* default */ }
    setGesture(g, false);
  })();
  el.toolbar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-gesture]');
    if (b) setGesture(b.dataset.gesture);
  });

  $('btn-camera').addEventListener('click', startCamera);
  $('btn-mouse').addEventListener('click', startMouse);
  el.switchBtn.addEventListener('click', () => (state.mode === 'camera' ? startMouse() : startCamera()));
  el.start.addEventListener('click', onStart);
  el.again.addEventListener('click', drawAgain);
  el.undo.addEventListener('click', undoLine);
  el.restart.addEventListener('click', startOver);
  el.done.addEventListener('click', () => {
    if (state.phase === 'idle' && !totalPoints()) { setPill('Draw something first'); later(idleHint, 1800); return; }
    finish();
  });

  // Space finishes, even if a button still has focus (so it never re-clicks Undo)
  const spaceActive = (e) => e.key === ' ' && !el.app.hidden && state.phase === 'idle';
  window.addEventListener('keydown', (e) => {
    if (spaceActive(e)) { e.preventDefault(); if (!e.repeat) el.done.click(); }
    else if (e.key === 'Escape' && state.phase === 'result') drawAgain();
  });
  window.addEventListener('keyup', (e) => { if (spaceActive(e)) e.preventDefault(); });

  if ('ResizeObserver' in window) new ResizeObserver(sizeCanvas).observe(el.stage);
  else window.addEventListener('resize', sizeCanvas);

  /* ---------- shape cards ---------- */

  function buildCards() {
    window.Recognizer.guides.forEach((g) => {
      const pts = g.points;
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      const gw = Math.max(...xs) - x0, gh = Math.max(...ys) - y0;
      const s = Math.min(60 / (gw || 1), 38 / (gh || 1));
      const ox = 40 - (gw * s) / 2, oy = 26 - (gh * s) / 2;
      const P = pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1).map((p) => ({ x: ox + (p.x - x0) * s, y: oy + (p.y - y0) * s }));
      const d = P.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join('');

      // small arrow a little way along the line, pointing the way to draw
      const a = Math.min(P.length - 2, Math.max(2, Math.round(P.length * 0.1)));
      const dx = P[a + 1].x - P[a].x, dy = P[a + 1].y - P[a].y, m = Math.hypot(dx, dy) || 1;
      const ux = dx / m, uy = dy / m, ax = P[a].x, ay = P[a].y;
      const arrow = `M${(ax + ux * 5).toFixed(1)} ${(ay + uy * 5).toFixed(1)}L${(ax - ux * 2 - uy * 3.6).toFixed(1)} ${(ay - uy * 2 + ux * 3.6).toFixed(1)}L${(ax - ux * 2 + uy * 3.6).toFixed(1)} ${(ay - uy * 2 - ux * 3.6).toFixed(1)}Z`;

      const b = document.createElement('button');
      b.type = 'button'; b.className = 'card'; b.setAttribute('role', 'listitem');
      b.setAttribute('aria-label', 'Show how to draw a ' + g.name.toLowerCase());
      b.innerHTML = `<svg viewBox="0 0 80 52" aria-hidden="true"><path class="dots" d="${d}"/><path class="live" d=""/><circle class="start" cx="${P[0].x.toFixed(1)}" cy="${P[0].y.toFixed(1)}" r="3.6"/><path class="arrow" d="${arrow}"/><circle class="pen" r="4.2" cx="${P[0].x.toFixed(1)}" cy="${P[0].y.toFixed(1)}"/></svg><span>${g.name}</span>`;
      b.addEventListener('click', () => playCard(b, P));
      el.cards.appendChild(b);
    });
  }

  // quick "how to draw it" animation: the line draws itself with a moving dot
  function playCard(btn, P) {
    clearTimeout(btn._anim); cancelAnimationFrame(btn._anim);
    const live = btn.querySelector('.live'), pen = btn.querySelector('.pen');
    let total = 0; const cum = [0];
    for (let i = 1; i < P.length; i++) { total += Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y); cum.push(total); }
    const dur = clamp(total * 24, 1200, 2200), t0 = performance.now();
    el.cards.querySelectorAll('.card.playing').forEach((c) => { if (c !== btn) c.classList.remove('playing'); });
    btn.classList.add('playing');
    const step = (now) => {
      const t = clamp((now - t0) / dur, 0, 1), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const target = e * total;
      let i = 1; while (i < P.length - 1 && cum[i] < target) i++;
      const f = clamp((target - cum[i - 1]) / (cum[i] - cum[i - 1] || 1), 0, 1);
      const cx = P[i - 1].x + (P[i].x - P[i - 1].x) * f, cy = P[i - 1].y + (P[i].y - P[i - 1].y) * f;
      let d = 'M' + P[0].x.toFixed(1) + ' ' + P[0].y.toFixed(1);
      for (let k = 1; k < i; k++) d += 'L' + P[k].x.toFixed(1) + ' ' + P[k].y.toFixed(1);
      d += 'L' + cx.toFixed(1) + ' ' + cy.toFixed(1);
      live.setAttribute('d', d);
      pen.setAttribute('cx', cx.toFixed(1)); pen.setAttribute('cy', cy.toFixed(1));
      if (t < 1) btn._anim = requestAnimationFrame(step);
      else btn._anim = setTimeout(() => { btn.classList.remove('playing'); live.setAttribute('d', ''); }, 900);
    };
    btn._anim = requestAnimationFrame(step);
  }

  /* ---------- recent drawings ---------- */

  function loadHistory() {
    try {
      const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(raw)
        ? raw.filter((r) => r && typeof r.svg === 'string' && r.svg.startsWith('<svg') && typeof r.shape === 'string').slice(0, HISTORY_MAX)
        : [];
    } catch (e) { return []; }
  }
  function storeHistory(list) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (e) { /* storage unavailable */ }
  }
  function saveHistory(item) {
    storeHistory([item, ...loadHistory()].slice(0, HISTORY_MAX));
    renderThumbs();
  }
  function renderThumbs() {
    const list = loadHistory();
    el.recent.hidden = !list.length;
    el.thumbs.textContent = '';
    list.forEach((item) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'thumb';
      b.dataset.date = item.date;
      b.title = item.label || item.shape;
      b.setAttribute('aria-label', 'View ' + (item.label || item.shape));
      const img = document.createElement('img');
      img.src = svgUri(item.svg);
      img.alt = '';
      b.appendChild(img);
      b.addEventListener('click', () => viewHistory(item));
      el.thumbs.appendChild(b);
    });
    markActive();
  }
  function markActive() {
    const d = state.current && state.current.date;
    el.thumbs.querySelectorAll('.thumb').forEach((b) => b.classList.toggle('active', !!d && b.dataset.date === d));
  }
  function viewHistory(item) {
    if (el.app.hidden) { enterApp('mouse'); sizeCanvas(); }
    clearTimers();
    state.penDown = false; state.strokes = []; state.cur = null;
    redraw();
    el.ready.hidden = true; el.count.hidden = true;
    showResult(item, null, '');
    el.app.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  el.clear.addEventListener('click', () => {
    storeHistory([]);
    renderThumbs();
    el.recent.hidden = true;
  });

  /* ---------- PNG, share, save ---------- */

  async function makePng(item) {
    const size = 1080;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 0, size);
    bg.addColorStop(0, '#fff6f9'); bg.addColorStop(1, '#fff1e6');
    g.fillStyle = bg; g.fillRect(0, 0, size, size);
    try { await document.fonts.load('800 64px Nunito'); } catch (e) { /* fall back to system font */ }
    const img = new Image();
    img.src = svgUri(item.svg);
    await img.decode();
    g.drawImage(img, 130, 100, 820, 820);
    g.textAlign = 'center';
    g.fillStyle = '#2f2740';
    g.font = '800 68px Nunito, ui-rounded, system-ui, sans-serif';
    g.fillText(item.label, size / 2, 990);
    g.fillStyle = '#ff5c8a';
    g.font = '800 34px Nunito, ui-rounded, system-ui, sans-serif';
    g.fillText('Air Doodle', size / 2, 1045);
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('png failed'))), 'image/png'));
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const fileName = (item) => `air-doodle-${item.shape}.png`;

  async function onSave() {
    if (!state.current) return;
    try { download(await makePng(state.current), fileName(state.current)); setNotice('Saved to your downloads.'); }
    catch (e) { setNotice('Sorry, that picture could not be saved.'); }
  }

  async function onShare() {
    const item = state.current;
    if (!item) return;
    let blob;
    try { blob = await makePng(item); } catch (e) { setNotice('Sorry, that picture could not be made.'); return; }
    const file = new File([blob], fileName(item), { type: 'image/png' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Air Doodle', text: item.label });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    download(blob, fileName(item));
    setNotice('Sharing is not available here, so the picture was saved instead.');
  }
  el.share.addEventListener('click', onShare);
  el.save.addEventListener('click', onSave);

  /* ---------- boot ---------- */

  buildCards();
  renderThumbs();

  // exposed for tests and tinkering
  window.AirDoodle = { state, handleHand, finish, loadHistory, makePng, onShare, onSave, startMouse, startCamera, drawAgain, viewHistory, onStart, undoLine, startOver, setGesture, showReady };
})();
