(() => {
  'use strict';

  const { Engine, Bodies, Body, Composite, Events, Query, Sleeping, Vertices } = Matter;

  /* ================= 설정 ================= */
  const SETS = {
    latin: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    hangul: 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ가나다라마바사아자차카타파하별달꿈밤비눈빛',
    digits: '0123456789+×÷=%',
  };
  SETS.mix = SETS.latin + SETS.hangul + SETS.digits + '!?&@#*';

  const PALETTE = ['#7df9ff', '#ff6ec7', '#ffe66d', '#9bff8a', '#b69cff', '#ff9f5a', '#f2f4ff'];
  const FILL_LIMIT = 0.6;       // 화면 높이의 60%까지만 쌓임
  const STEP = 1000 / 60;       // 물리 한 스텝 (ms)
  const SUBSTEPS_WIPE = 3;      // 와이퍼가 움직일 땐 잘게 나눠 계산 (글자가 뚫고 지나가지 않게)
  const WIPE_TIME = 2.4;        // 와이퍼 왕복 시간 (초)
  const FONT = (s) => `700 ${s}px "Space Mono", "Black Han Sans", sans-serif`;

  /* ================= 상태 ================= */
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  const engine = Engine.create({ enableSleeping: true, positionIterations: 6, velocityIterations: 4 });
  engine.gravity.y = 1;
  const world = engine.world;

  let W = 0, H = 0, dpr = 1, BASE = 26, MAX_LETTERS = 1100;
  let bounds = [];
  let wipers = [];
  let letters = [];             // 생성 순서대로 (앞쪽이 가장 오래된 글자)
  let ghosts = [];              // 지워지면서 사라지는 글자 (물리 X)
  let bgGrad, floorGrad;

  let rate = 18;
  let charset = 'mix';
  let autoWipe = true;
  let hits = 0;
  let fill = 0;
  let pileTop = 0;

  const wipe = { active: false, t: 0, a: 0, id: 0, sinceLast: 0, nextAuto: 10 };

  /* ================= 유틸 ================= */
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x);
  const gauss = () => {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  /* ================= 글자 모양 ================= */
  // 글자를 실제로 그려서 잉크 픽셀의 볼록 껍질(convex hull)을 충돌 모양으로 사용
  const glyphCache = new Map();

  function convexHull(pts) {
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }

  function simplify(h, maxN) {
    h = h.slice();
    const area = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]));
    while (h.length > maxN) {
      let best = 0, bestA = Infinity;
      for (let i = 0; i < h.length; i++) {
        const A = area(h[(i - 1 + h.length) % h.length], h[i], h[(i + 1) % h.length]);
        if (A < bestA) { bestA = A; best = i; }
      }
      h.splice(best, 1);
    }
    return h;
  }

  function getGlyph(ch, size) {
    const key = ch + '|' + size;
    let g = glyphCache.get(key);
    if (g) return g;

    const cw = Math.ceil(size * 2), chh = Math.ceil(size * 2);
    const c = document.createElement('canvas');
    c.width = cw; c.height = chh;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.font = FONT(size);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = '#fff';
    x.fillText(ch, cw / 2, chh / 2);
    const data = x.getImageData(0, 0, cw, chh).data;

    // 줄마다 가장 왼쪽/오른쪽 잉크 픽셀만 모으면 껍질 계산이 빠르다
    const pts = [];
    for (let yy = 0; yy < chh; yy++) {
      let l = -1, r = -1;
      for (let xx = 0; xx < cw; xx++) {
        if (data[(yy * cw + xx) * 4 + 3] > 90) { if (l < 0) l = xx; r = xx; }
      }
      if (l >= 0) pts.push([l, yy], [l, yy + 1], [r + 1, yy], [r + 1, yy + 1]);
    }

    let hull;
    if (pts.length < 6) {
      const s = size * 0.3;
      hull = [[cw / 2 - s, chh / 2 - s], [cw / 2 + s, chh / 2 - s], [cw / 2 + s, chh / 2 + s], [cw / 2 - s, chh / 2 + s]];
    } else {
      hull = simplify(convexHull(pts), 10);
    }

    let verts = hull.map((p) => ({ x: p[0], y: p[1] }));
    const centre = Vertices.centre(verts);
    // 얇은 글자(-, =)도 잘 부딪히도록 살짝 부풀림
    verts = verts.map((p) => {
      const dx = p.x - centre.x, dy = p.y - centre.y, d = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / d) * 1.2 - centre.x, y: p.y + (dy / d) * 1.2 - centre.y };
    });

    let minX = Infinity, maxX = -Infinity;
    for (const p of verts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); }

    g = { ch, size, cw, chh, cx: centre.x, cy: centre.y, verts, width: maxX - minX, sprites: {} };
    glyphCache.set(key, g);
    return g;
  }

  function getSprite(g, color) {
    let s = g.sprites[color];
    if (s) return s;
    s = document.createElement('canvas');
    s.width = Math.ceil(g.cw * dpr);
    s.height = Math.ceil(g.chh * dpr);
    const x = s.getContext('2d');
    x.scale(dpr, dpr);
    x.font = FONT(g.size);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = color;
    x.fillText(g.ch, g.cw / 2, g.chh / 2);
    g.sprites[color] = s;
    return s;
  }

  /* ================= 글자 생성 ================= */
  function addLetter(ch, size, x, y, opts = {}) {
    const g = getGlyph(ch, size);
    const body = Bodies.fromVertices(x, y, [g.verts.map((p) => ({ x: p.x + x, y: p.y + y }))], {
      friction: 0.5,
      frictionStatic: 0.9,
      frictionAir: 0.012,
      restitution: 0.2,
      slop: 0.03,
      sleepThreshold: 30,
    });
    Body.setPosition(body, { x, y });
    Body.setAngle(body, opts.angle ?? rand(-0.5, 0.5));
    Body.setVelocity(body, { x: opts.vx ?? 0, y: opts.vy ?? rand(1, 4) });
    Body.setAngularVelocity(body, opts.spin ?? rand(-0.04, 0.04));

    const l = { body, g, color: opts.color || pick(PALETTE), still: 0, hitId: -1 };
    body.plugin.letter = l;
    Composite.add(world, body);
    letters.push(l);
    return l;
  }

  function randSize() {
    let s = BASE * (0.62 + 0.95 * Math.pow(Math.random(), 2.2));
    if (Math.random() < 0.04) s *= rand(1.5, 2.1);   // 가끔 큰 글자
    return Math.max(12, Math.round(s / 2) * 2);
  }

  /* ================= 날씨 (불규칙한 비) ================= */
  const weather = {
    t: 0,
    phase: [rand(0, 9), rand(0, 9), rand(0, 9), rand(0, 9)],
    clouds: [],
    gust: null,
    wind: 0,
    next: 0,
  };

  function initClouds() {
    weather.clouds = Array.from({ length: 3 }, () => ({
      x: rand(0.1, 0.9) * W,
      vx: rand(-50, 50),
      sigma: W * rand(0.04, 0.11),
      w: rand(0.5, 1.5),
    }));
  }

  function intensity() {
    const t = weather.t, p = weather.phase;
    let n = 0.5 + 0.28 * Math.sin(t * 0.11 + p[0]) + 0.17 * Math.sin(t * 0.31 + p[1]) + 0.1 * Math.sin(t * 0.9 + p[2]);
    n = clamp(n, 0.06, 1.05);
    if (weather.gust) n *= weather.gust.mult;
    return n;
  }

  function updateWeather(dt) {
    weather.t += dt;
    const t = weather.t;

    for (const c of weather.clouds) {
      c.x += c.vx * dt;
      if (c.x < 0 || c.x > W) { c.vx *= -1; c.x = clamp(c.x, 0, W); }
      if (Math.random() < dt * 0.15) c.vx = rand(-60, 60);
      c.w = clamp(c.w + rand(-1, 1) * dt, 0.2, 1.8);
    }

    if (weather.gust) {
      weather.gust.time -= dt;
      if (weather.gust.time <= 0) weather.gust = null;
    } else if (Math.random() < dt * 0.07) {
      weather.gust = {
        x: rand(0.1, 0.9) * W,
        sigma: W * rand(0.03, 0.09),
        mult: rand(2, 4),
        time: rand(1.2, 3.5),
        wind: rand(-2, 2),
      };
    }

    weather.wind = 0.8 * Math.sin(t * 0.07 + weather.phase[3]) + (weather.gust ? weather.gust.wind : 0);
  }

  function spawnX() {
    const r = Math.random();
    if (weather.gust && r < 0.7) return weather.gust.x + gauss() * weather.gust.sigma;
    if (r < 0.72) {
      const total = weather.clouds.reduce((s, c) => s + c.w, 0);
      let k = Math.random() * total;
      for (const c of weather.clouds) {
        k -= c.w;
        if (k <= 0) return c.x + gauss() * c.sigma;
      }
    }
    return Math.random() * W;
  }

  function spawnRain(dt) {
    const lambda = rate * (W / 1700) * intensity();
    if (lambda <= 0) return;
    weather.next -= dt;
    while (weather.next <= 0) {
      weather.next += -Math.log(Math.random() || 1e-6) / lambda;
      const clump = Math.random() < 0.15 ? 2 + Math.floor(Math.random() * 4) : 1;
      const cx = spawnX();
      for (let i = 0; i < clump; i++) {
        const size = randSize();
        const x = clamp(cx + (clump > 1 ? gauss() * BASE * 1.5 : 0), size, W - size);
        addLetter(pick(SETS[charset]), size, x, -rand(30, 160), {
          vx: weather.wind + rand(-0.4, 0.4),
          vy: rand(2, 6),
        });
      }
    }
  }

  /* ================= 경계 / 와이퍼 ================= */
  function buildBounds() {
    Composite.remove(world, bounds);
    const t = 400;
    const top = -3 * H, bottom = H + t;
    bounds = [
      Bodies.rectangle(W / 2, H + t / 2, W + 2 * t, t, { isStatic: true, friction: 0.8, restitution: 0.1 }),
      Bodies.rectangle(-t / 2, (top + bottom) / 2, t, bottom - top, { isStatic: true, friction: 0.05, restitution: 0.7 }),
      Bodies.rectangle(W + t / 2, (top + bottom) / 2, t, bottom - top, { isStatic: true, friction: 0.05, restitution: 0.7 }),
    ];
    Composite.add(world, bounds);
  }

  function buildWipers() {
    Composite.remove(world, wipers.map((w) => w.body));
    const landscape = W / H >= 1.1;
    const T = Math.max(14, Math.round(BASE * 0.6));
    const py = H + T / 2 + 4;                  // 쉬는 동안엔 바닥 아래에 숨어 있음
    const specs = landscape
      ? [{ px: W * 0.24, L: W * 0.26 }, { px: W * 0.74, L: W * 0.26 }]
      : [{ px: W * 0.5, L: W * 0.46 }];

    wipers = specs.map(({ px, L }) => {
      L = Math.min(L, H * 0.6);
      const body = Bodies.rectangle(px + L / 2, py, L, T, {
        isStatic: true,
        friction: 0.05,
        restitution: 0.55,
      });
      body.plugin.wiper = true;
      Composite.add(world, body);
      return { body, px, py, L, T };
    });
    setWiperAngle(wipe.a, false);
  }

  function setWiperAngle(a, updateVelocity) {
    for (const w of wipers) {
      const cx = w.px + Math.cos(a) * w.L / 2;
      const cy = w.py - Math.sin(a) * w.L / 2;
      Body.setPosition(w.body, { x: cx, y: cy }, updateVelocity);
      Body.setAngle(w.body, -a, updateVelocity);
    }
  }

  function startWipe() {
    if (wipe.active) return;
    wipe.active = true;
    wipe.t = 0;
    wipe.id++;
  }

  function stepWiper(dt) {
    if (!wipe.active) return;
    wipe.t += dt;
    const p = Math.min(wipe.t / WIPE_TIME, 1);
    wipe.a = Math.PI * (p < 0.5 ? ease(p * 2) : ease(2 - p * 2));
    setWiperAngle(wipe.a, true);
    if (p >= 1) {
      wipe.active = false;
      wipe.a = 0;
      setWiperAngle(0, false);
      wipe.sinceLast = 0;
      wipe.nextAuto = rand(8, 18);
    }
  }

  // 잠든 글자는 정적 물체와 충돌 계산을 안 하므로, 와이퍼 주변 글자를 깨운다
  function wakeNearWipers() {
    if (!wipe.active) return;
    const bodies = letters.map((l) => l.body);
    for (const w of wipers) {
      const b = w.body.bounds;
      const region = { min: { x: b.min.x - 60, y: b.min.y - 60 }, max: { x: b.max.x + 60, y: b.max.y + 60 } };
      for (const body of Query.region(bodies, region)) Sleeping.set(body, false);
    }
  }

  Events.on(engine, 'collisionStart', (e) => {
    for (const pair of e.pairs) {
      const a = pair.bodyA, b = pair.bodyB;
      const other = a.plugin.wiper ? b : b.plugin.wiper ? a : null;
      if (!other || !other.plugin.letter || !wipe.active) continue;
      const l = other.plugin.letter;
      if (l.hitId !== wipe.id) { l.hitId = wipe.id; hits++; }
    }
  });

  /* ================= 60% 유지 (먼저 온 글자부터 삭제) ================= */
  function removeLetter(i) {
    const l = letters[i];
    letters.splice(i, 1);
    Composite.remove(world, l.body);
    ghosts.push({
      g: l.g, color: l.color,
      x: l.body.position.x, y: l.body.position.y, angle: l.body.angle,
      life: 0.45,
    });
    // 위에 얹혀 자고 있던 글자들을 깨워서 무너지게
    const b = l.body.bounds;
    const region = { min: { x: b.min.x - BASE, y: -H }, max: { x: b.max.x + BASE, y: b.max.y + 4 } };
    for (const body of Query.region(letters.map((k) => k.body), region)) Sleeping.set(body, false);
  }

  let fillTimer = 0;
  function maintainFill(dt) {
    fillTimer -= dt;
    if (fillTimer > 0) return;
    fillTimer = 0.2;

    let top = H;
    for (const l of letters) {
      if (l.still > 0.4 && l.body.position.y > 0) top = Math.min(top, l.body.bounds.min.y);
    }
    pileTop = top;
    fill = clamp((H - top) / H, 0, 1);

    let n = 0;
    if (fill > FILL_LIMIT) n = 2 + Math.floor((fill - FILL_LIMIT) * 100);
    n = Math.max(n, letters.length - MAX_LETTERS);
    for (let k = 0; k < n && letters.length; k++) removeLetter(0);
  }

  function postPhysics(dt) {
    for (let i = letters.length - 1; i >= 0; i--) {
      const l = letters[i], b = l.body;
      l.still = b.isSleeping || b.speed < 0.5 ? l.still + dt : 0;
      // 혹시 경계를 뚫고 나간 글자는 정리
      if (b.position.y > H + 300 || b.position.x < -300 || b.position.x > W + 300) {
        letters.splice(i, 1);
        Composite.remove(world, b);
      }
    }
    for (let i = ghosts.length - 1; i >= 0; i--) {
      ghosts[i].life -= dt;
      if (ghosts[i].life <= 0) ghosts.splice(i, 1);
    }

    wipe.sinceLast += dt;
    if (autoWipe && !wipe.active) {
      wipe.nextAuto -= dt;
      if (wipe.nextAuto <= 0 || (fill >= FILL_LIMIT - 0.03 && wipe.sinceLast > 6)) startWipe();
    }
  }

  /* ================= 인터랙션 ================= */
  function dropChar(ch) {
    const size = Math.round(BASE * 1.5 / 2) * 2;
    addLetter(ch, size, rand(size, W - size), -60, { vy: 5 });
  }

  function dropWord(text) {
    const chars = Array.from(text.trim());
    if (!chars.length) return;
    let size = Math.round(Math.min(BASE * 1.7, (W * 0.85) / (chars.length * 0.75)) / 2) * 2;
    size = Math.max(size, 16);
    const color = pick(PALETTE);
    const gap = size * 0.12;
    const glyphs = chars.map((ch) => (ch.trim() ? getGlyph(ch, size) : null));
    const widthOf = (g) => (g ? g.width : size * 0.5);

    // 줄바꿈
    const lines = [[]];
    let lineW = 0;
    glyphs.forEach((g, i) => {
      const w = widthOf(g) + gap;
      if (lineW + w > W * 0.9 && lines[lines.length - 1].length) { lines.push([]); lineW = 0; }
      lines[lines.length - 1].push(i);
      lineW += w;
    });

    lines.forEach((idx, row) => {
      const total = idx.reduce((s, i) => s + widthOf(glyphs[i]) + gap, -gap);
      let x = (W - total) / 2;
      for (const i of idx) {
        const w = widthOf(glyphs[i]);
        if (glyphs[i]) {
          addLetter(chars[i], size, x + w / 2, -60 - (lines.length - 1 - row) * size * 1.4, {
            color, angle: 0, spin: 0, vx: 0, vy: 3,
          });
        }
        x += w + gap;
      }
    });
  }

  function burst(px, py) {
    const n = 10 + Math.floor(Math.random() * 6);
    const y0 = Math.min(py, pileTop - BASE * 1.5);
    for (let i = 0; i < n; i++) {
      addLetter(pick(SETS[charset]), randSize(), clamp(px + rand(-20, 20), BASE, W - BASE), y0 + rand(-20, 20), {
        vx: rand(-6, 6),
        vy: rand(-14, -6),
        spin: rand(-0.3, 0.3),
      });
    }
  }

  /* ================= 화면 크기 ================= */
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    // 화면 60%를 약 700개 글자로 채우도록 화면 크기에 맞춰 글자 크기를 정함 (성능 유지)
    BASE = Math.round(clamp(Math.sqrt((W * H * 0.45) / 700) / 0.58, 22, 60));
    MAX_LETTERS = W < 600 ? 600 : 950;

    bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#060914');
    bgGrad.addColorStop(0.55, '#0f1433');
    bgGrad.addColorStop(1, '#1c1236');
    floorGrad = ctx.createLinearGradient(0, H - 220, 0, H);
    floorGrad.addColorStop(0, 'rgba(125,249,255,0)');
    floorGrad.addColorStop(1, 'rgba(125,249,255,0.07)');

    buildBounds();
    buildWipers();
    initClouds();

    // 화면 밖으로 나간 글자는 위에서 다시 떨어뜨림
    for (const l of letters) {
      const p = l.body.position;
      if (p.x > W - 10 || p.y > H) {
        Body.setPosition(l.body, { x: rand(BASE, W - BASE), y: -rand(40, 300) });
        Sleeping.set(l.body, false);
      }
    }
  }

  /* ================= 그리기 ================= */
  function drawGlyph(g, color, x, y, angle, alpha, scale) {
    const s = getSprite(g, color);
    const c = Math.cos(angle) * dpr * scale, sn = Math.sin(angle) * dpr * scale;
    ctx.setTransform(c, sn, -sn, c, x * dpr, y * dpr);
    if (alpha !== 1) ctx.globalAlpha = alpha;
    ctx.drawImage(s, -g.cx, -g.cy, g.cw, g.chh);
    if (alpha !== 1) ctx.globalAlpha = 1;
  }

  function drawWiper(w) {
    const a = wipe.a;
    const cos = Math.cos(a), sin = -Math.sin(a);
    const ex = w.px + cos * w.L, ey = w.py + sin * w.L;

    // 고무날 (실제 충돌 모양)
    const v = w.body.vertices;
    ctx.fillStyle = '#05060c';
    ctx.beginPath();
    ctx.moveTo(v[0].x, v[0].y);
    for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(125,249,255,0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 금속 암
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#5a6388';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(w.px, w.py); ctx.lineTo(ex, ey); ctx.stroke();

    // 축
    ctx.fillStyle = '#2b3150';
    ctx.beginPath(); ctx.arc(w.px, w.py, w.T * 0.9, 0, Math.PI * 2); ctx.fill();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, H - 220, W, 220);

    // 60% 기준선
    const limitY = H * (1 - FILL_LIMIT);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.setLineDash([4, 8]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, limitY); ctx.lineTo(W, limitY); ctx.stroke();
    ctx.setLineDash([]);

    // 빗줄기 꼬리
    ctx.globalAlpha = 0.22;
    for (const l of letters) {
      const b = l.body;
      if (b.isSleeping) continue;
      const vy = Body.getVelocity(b).y;
      if (vy > 7) {
        const len = Math.min(vy * 4, 60);
        ctx.fillStyle = l.color;
        ctx.fillRect(b.position.x - 1, b.bounds.min.y - len, 2, len);
      }
    }
    ctx.globalAlpha = 1;

    for (const l of letters) drawGlyph(l.g, l.color, l.body.position.x, l.body.position.y, l.body.angle, 1, 1);
    for (const gh of ghosts) {
      const k = gh.life / 0.45;
      drawGlyph(gh.g, gh.color, gh.x, gh.y, gh.angle, k, 0.6 + 0.4 * k);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const w of wipers) drawWiper(w);
  }

  /* ================= UI ================= */
  const countEl = document.getElementById('count');
  const fillEl = document.getElementById('fill');
  const hitsEl = document.getElementById('hits');
  let statTimer = 0;

  function updateStats(dt) {
    statTimer -= dt;
    if (statTimer > 0) return;
    statTimer = 0.25;
    countEl.textContent = letters.length;
    fillEl.textContent = Math.round(fill * 100) + '%';
    hitsEl.textContent = hits;
  }

  document.getElementById('rate').addEventListener('input', (e) => { rate = Number(e.target.value); });

  document.getElementById('charset').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    charset = btn.dataset.set;
    document.querySelectorAll('#charset button').forEach((b) => b.classList.toggle('on', b === btn));
  });

  document.getElementById('wipeBtn').addEventListener('click', startWipe);
  document.getElementById('autoWipe').addEventListener('change', (e) => { autoWipe = e.target.checked; });

  const msgInput = document.getElementById('msg');
  document.getElementById('msgForm').addEventListener('submit', (e) => {
    e.preventDefault();
    dropWord(msgInput.value);
    msgInput.value = '';
  });

  canvas.addEventListener('pointerdown', (e) => burst(e.clientX, e.clientY));

  window.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input[type="text"], textarea')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      startWipe();
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.trim()) {
      dropChar(e.key.toUpperCase());
    }
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });

  if (window.innerWidth < 700) document.getElementById('panel').removeAttribute('open');

  /* ================= 루프 ================= */
  let last = 0, acc = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    updateWeather(dt);
    spawnRain(dt);
    wakeNearWipers();

    acc += dt * 1000;
    let n = 0;
    while (acc >= STEP && n < 3) {
      const sub = wipe.active ? SUBSTEPS_WIPE : 1;
      for (let k = 0; k < sub; k++) {
        stepWiper(STEP / sub / 1000);
        Engine.update(engine, STEP / sub);
      }
      acc -= STEP;
      n++;
    }
    if (n === 3) acc = 0;

    postPhysics(dt);
    maintainFill(dt);
    draw();
    updateStats(dt);
    requestAnimationFrame(frame);
  }

  // 웹폰트가 준비된 뒤에 글자 모양을 계산해야 충돌 모양이 정확하다
  const fontsReady = Promise.all([
    document.fonts.load('700 30px "Space Mono"', 'A'),
    document.fonts.load('30px "Black Han Sans"', '가'),
  ]).catch(() => {});
  Promise.race([fontsReady, new Promise((r) => setTimeout(r, 2500))]).then(() => {
    resize();
    last = performance.now();
    requestAnimationFrame(frame);
  });
})();
