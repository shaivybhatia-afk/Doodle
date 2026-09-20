/* Air Doodle: camera and mouse drawing, shape recognition, cute art, sharing. */
(function () {
  'use strict';

  const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

  const PAUSE_MS = 1000;        // pen up for this long, then recognise
  const MIN_SCORE = 0.72;       // below this we say "not sure"
  const PINCH_DOWN = 0.32;      // pinch distance / palm size to start drawing
  const PINCH_UP = 0.5;         // ...and to stop
  const HAND_LOST_MS = 300;
  const HISTORY_KEY = 'airdoodle.recent.v1';
  const HISTORY_MAX = 12;
  const NOT_SURE = 'Hmm, not sure what that is. Try again?';

  const $ = (id) => document.getElementById(id);
  const el = {
    welcome: $('welcome'), app: $('app'), stage: $('stage'), video: $('video'), ink: $('ink'),
    ring: $('ring'), pill: $('pill'), loading: $('loading'), loadingText: $('loading-text'),
    result: $('result'), art: $('art'), sparks: $('sparks'), label: $('label'), notice: $('notice'),
    again: $('btn-again'), share: $('btn-share'), save: $('btn-save'), switchBtn: $('btn-switch'),
    recent: $('recent'), thumbs: $('thumbs'), clear: $('btn-clear'),
  };
  const ctx = el.ink.getContext('2d');

  const state = {
    mode: null,          // 'camera' | 'mouse'
    phase: 'idle',       // 'idle' | 'result' | 'unsure'
    points: [],          // normalised 0..1 stage coordinates
    penDown: false,
    pauseTimer: null,
    stream: null,
    landmarker: null,
    raf: 0,
    lastVideoTime: -1,
    handLostAt: 0,
    pinchVotes: 0,
    current: null,       // item currently shown as a result
    startToken: 0,
  };

  /* ---------- small helpers ---------- */

  const svgUri = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const stageSize = () => ({ w: el.stage.clientWidth || 1, h: el.stage.clientHeight || 1 });
  const setPill = (t) => { el.pill.textContent = t || ''; };
  function setNotice(t) { el.notice.textContent = t || ''; el.notice.hidden = !t; }

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

  function redraw() {
    const { w, h } = stageSize();
    ctx.clearRect(0, 0, w, h);
    const p = state.points.map((q) => ({ x: q.x * w, y: q.y * h }));
    if (!p.length) return;
    const stroke = (color, width) => {
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (p.length < 3) {
        ctx.beginPath(); ctx.arc(p[0].x, p[0].y, width / 2, 0, Math.PI * 2); ctx.fill();
        if (p.length === 2) { ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[1].x, p[1].y); ctx.stroke(); }
        return;
      }
      ctx.beginPath();
      ctx.moveTo(p[0].x, p[0].y);
      for (let i = 1; i < p.length - 1; i++) {
        const mx = (p[i].x + p[i + 1].x) / 2, my = (p[i].y + p[i + 1].y) / 2;
        ctx.quadraticCurveTo(p[i].x, p[i].y, mx, my);
      }
      ctx.lineTo(p[p.length - 1].x, p[p.length - 1].y);
      ctx.stroke();
    };
    stroke('rgba(255,255,255,.95)', 13);
    stroke('#ff5c8a', 7);
  }

  function addPoint(nx, ny) {
    const last = state.points[state.points.length - 1];
    const { w, h } = stageSize();
    if (last && Math.hypot((nx - last.x) * w, (ny - last.y) * h) < 2.5) return;
    state.points.push({ x: nx, y: ny });
    redraw();
  }

  /* ---------- pen up / down and auto recognise ---------- */

  function penStart() {
    if (state.phase !== 'idle') return;
    clearTimeout(state.pauseTimer);
    state.penDown = true;
    el.ring.classList.add('down');
    setPill('Drawing...');
  }

  function penEnd() {
    if (!state.penDown) return;
    state.penDown = false;
    el.ring.classList.remove('down');
    if (state.phase !== 'idle') return;
    if (!state.points.length) return;
    setPill('Nice! Hold still...');
    clearTimeout(state.pauseTimer);
    state.pauseTimer = setTimeout(finish, PAUSE_MS);
  }

  function idleHint() {
    setPill(state.mode === 'camera' ? 'Pinch to draw' : 'Draw a simple shape');
  }

  function finish() {
    clearTimeout(state.pauseTimer);
    if (state.phase !== 'idle' || state.penDown) return;
    const { w, h } = stageSize();
    const px = state.points.map((p) => ({ x: p.x * w, y: p.y * h }));
    const xs = px.map((p) => p.x), ys = px.map((p) => p.y);
    const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
    const big = Math.max(bw, bh);
    const rec = px.length >= 8 && big > 0.1 * Math.min(w, h)
      ? window.Recognizer.recognize(px)
      : { name: null, score: 0 };
    state.lastRecognition = rec;

    if (!rec.name || rec.score < MIN_SCORE) {
      showUnsure();
      return;
    }
    const art = window.SHAPE_ART[rec.name];
    const item = { shape: rec.name, label: art.label, svg: art.svg, date: new Date().toISOString() };
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const minSide = Math.min(w, h);
    const size = Math.min(Math.max(big * 1.3, minSide * 0.32), minSide * 0.82);
    const ax = Math.min(Math.max(cx, size / 2), w - size / 2);
    const ay = Math.min(Math.max(cy, size / 2), h - size / 2);
    saveHistory(item);
    showResult(item, { cx: ax / w, cy: ay / h, size: size / w });
  }

  function showResult(item, place) {
    state.phase = 'result';
    state.current = item;
    place = place || { cx: 0.5, cy: 0.46, size: Math.min(0.6, 0.6 * (el.stage.clientHeight / el.stage.clientWidth)) };
    el.result.classList.remove('unsure');
    el.art.style.left = place.cx * 100 + '%';
    el.art.style.top = place.cy * 100 + '%';
    el.art.style.width = place.size * 100 + '%';
    el.art.alt = item.label;
    // restart the reveal animation each time
    el.art.removeAttribute('src');
    void el.art.offsetWidth;
    el.art.src = svgUri(item.svg);
    el.label.textContent = item.label;
    // hide then show so the reveal animation replays every time
    el.result.hidden = true;
    void el.result.offsetWidth;
    el.result.hidden = false;
    el.ring.hidden = true;
    setPill('');
    el.again.hidden = false; el.share.hidden = false; el.save.hidden = false;
    setNotice('');
    burst(place);
    markActive();
  }

  function showUnsure() {
    state.phase = 'unsure';
    state.current = null;
    el.result.classList.add('unsure');
    el.label.textContent = NOT_SURE;
    el.result.hidden = false;
    el.ring.hidden = true;
    setPill('');
    el.again.hidden = false; el.share.hidden = true; el.save.hidden = true;
    markActive();
  }

  function burst(place) {
    el.sparks.textContent = '';
    const { w, h } = stageSize();
    for (let i = 0; i < 9; i++) {
      const s = document.createElement('span');
      s.textContent = '✦';
      const ang = (i / 9) * Math.PI * 2 + Math.random() * 0.5;
      const dist = 50 + Math.random() * 70;
      s.style.left = place.cx * w + 'px';
      s.style.top = place.cy * h + 'px';
      s.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      s.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
      s.style.animationDelay = (0.1 + Math.random() * 0.2) + 's';
      el.sparks.appendChild(s);
    }
  }

  function drawAgain() {
    clearTimeout(state.pauseTimer);
    state.points = [];
    state.penDown = false;
    state.phase = 'idle';
    state.current = null;
    el.result.hidden = true;
    el.ring.classList.remove('down');
    el.ring.hidden = state.mode !== 'camera';
    el.again.hidden = true; el.share.hidden = true; el.save.hidden = true;
    setNotice('');
    redraw();
    idleHint();
    markActive();
  }

  /* ---------- camera mode ---------- */

  // landmarks: array of {x,y} normalised to the video frame, or null when no hand
  function handleHand(lm, now) {
    if (state.mode !== 'camera') return;
    const vw = el.video.videoWidth || 4, vh = el.video.videoHeight || 3;
    if (!lm) {
      if (!state.handLostAt) state.handLostAt = now;
      if (now - state.handLostAt > HAND_LOST_MS) {
        el.ring.hidden = true;
        fx.reset(); fy.reset();
        state.pinchVotes = 0;
        if (state.penDown) penEnd();
        if (state.phase === 'idle' && !state.penDown && !state.points.length) setPill('Show me your hand');
      }
      return;
    }
    state.handLostAt = 0;

    const t = lm[4], i = lm[8], wrist = lm[0], mid = lm[9];
    const dist = (a, b) => Math.hypot((a.x - b.x) * vw, (a.y - b.y) * vh);
    const palm = Math.max(dist(wrist, mid), 1e-3);
    const ratio = dist(t, i) / palm;

    // mirrored: flip x so the line matches what the user sees
    const { w, h } = stageSize();
    const px = fx.filter((1 - (t.x + i.x) / 2) * w, now);
    const py = fy.filter(((t.y + i.y) / 2) * h, now);

    if (state.phase !== 'idle') return;

    el.ring.hidden = false;
    el.ring.style.transform = '';
    el.ring.style.left = px + 'px';
    el.ring.style.top = py + 'px';

    // hysteresis + two-frame vote so a flicker does not break the line
    const wantDown = state.penDown ? ratio < PINCH_UP : ratio < PINCH_DOWN;
    if (wantDown !== state.penDown) {
      state.pinchVotes++;
      if (state.pinchVotes >= 2) {
        state.pinchVotes = 0;
        if (wantDown) penStart(); else penEnd();
      }
    } else {
      state.pinchVotes = 0;
    }

    if (state.penDown) addPoint(px / w, py / h);
    else if (!state.points.length) setPill('Pinch to draw');
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
    enterApp('camera');
    showLoading('Waking up the camera...');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return fallbackToMouse('This browser cannot open a camera here, so let\'s draw with the mouse instead.');
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
    try { await el.video.play(); } catch (e) { /* autoplay is fine, muted */ }
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
    drawAgain();
    setPill('Show me your hand');
    state.lastVideoTime = -1;
    loop();
  }

  function fallbackToMouse(message) {
    stopCamera();
    startMouse();
    setNotice(message);
  }

  /* ---------- mouse / touch mode ---------- */

  function startMouse() {
    state.startToken++;
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

  /* ---------- screens ---------- */

  function enterApp(mode) {
    state.mode = mode;
    el.welcome.hidden = true;
    el.app.hidden = false;
    el.stage.dataset.mode = mode;
    el.switchBtn.textContent = mode === 'camera' ? 'Draw with mouse instead' : 'Use camera instead';
    el.ring.hidden = true;
    el.result.hidden = true;
    state.points = [];
    state.phase = 'idle';
    clearTimeout(state.pauseTimer);
    redraw();
    setPill('');
    el.again.hidden = true; el.share.hidden = true; el.save.hidden = true;
    el.recent.hidden = !loadHistory().length;
    renderThumbs();
  }

  document.getElementById('btn-camera').addEventListener('click', startCamera);
  document.getElementById('btn-mouse').addEventListener('click', startMouse);
  el.switchBtn.addEventListener('click', () => (state.mode === 'camera' ? startMouse() : startCamera()));
  el.again.addEventListener('click', drawAgain);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.phase !== 'idle') drawAgain(); });

  if ('ResizeObserver' in window) new ResizeObserver(sizeCanvas).observe(el.stage);
  else window.addEventListener('resize', sizeCanvas);

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
    const list = [item, ...loadHistory()].slice(0, HISTORY_MAX);
    storeHistory(list);
    el.recent.hidden = false;
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
    clearTimeout(state.pauseTimer);
    state.penDown = false;
    state.points = [];
    redraw();
    showResult(item, null);
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
    g.fillStyle = '#4b3a5e';
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

  renderThumbs();

  // exposed for tests and tinkering
  window.AirDoodle = { state, handleHand, finish, loadHistory, makePng, onShare, onSave, startMouse, startCamera, drawAgain, viewHistory };
})();
