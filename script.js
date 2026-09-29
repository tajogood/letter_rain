(() => {
  'use strict';

  /* ================= 설정 ================= */
  const SETS = {
    latin: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    hangul: 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ가나다라마바사아자차카타파하별달꿈밤비눈빛',
    digits: '0123456789+-×÷=%',
  };
  SETS.mix = SETS.latin + SETS.hangul + SETS.digits + '!?&@#*';

  const PALETTE = ['#7df9ff', '#ff6ec7', '#ffe66d', '#9bff8a', '#b69cff', '#ff9f5a', '#f2f4ff'];
  const GRAVITY = 1500;        // 튕겨나간 글자에 적용
  const FALL_ACCEL = 520;      // 빗방울처럼 내리는 글자의 가속
  const FALL_MAX = 820;        // 종단 속도
  const PARK = 0.03;           // 와이퍼가 누워 있는 각도 (rad)
  const WIPE_DURATION = 1.8;   // 한 번 왕복 시간 (초)

  /* ================= 상태 ================= */
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  let W = 0, H = 0, dpr = 1;
  let CELL = 28, cols = 0, offsetX = 0;
  let maxRows = 10, hardRows = 20;
  let stacks = null;           // 열마다 쌓인 글자 배열 (아래 → 위)
  let falling = [];            // 떨어지는 중
  let flung = [];              // 와이퍼에 튕겨나간 글자
  let wipers = [];
  let bgGrad, floorGrad;

  let rate = 18;
  let charset = 'latin';
  let autoWipe = true;
  let spawnAcc = 0;
  let sweptCount = 0;
  let cooldown = 0;

  const wipe = { active: false, t: 0, a: PARK, prevA: PARK };

  /* ================= 유틸 ================= */
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const clampCol = (c) => Math.max(0, Math.min(cols - 1, c));
  const colX = (c) => offsetX + (c + 0.5) * CELL;
  const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x);

  function makeLetter(ch, col, y) {
    col = clampCol(col);
    return {
      ch,
      color: pick(PALETTE),
      col,
      x: colX(col),
      tx: colX(col),
      y,
      vx: 0,
      vy: rand(80, 220),
      rot: rand(-0.6, 0.6),
      vr: rand(-2, 2),
      restRot: rand(-0.18, 0.18),
      pop: 0,
      life: 0,
    };
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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    CELL = W < 600 ? 22 : 28;
    cols = Math.max(4, Math.floor(W / CELL));
    offsetX = (W - cols * CELL) / 2;
    maxRows = Math.max(4, Math.floor((H * 0.42) / CELL));
    hardRows = Math.max(maxRows + 2, Math.floor((H - 60) / CELL));

    // 크기가 바뀌면 쌓여 있던 글자는 날려 보낸다
    if (stacks) {
      for (const s of stacks) for (const l of s) fling(l, rand(-300, 300), rand(-600, -300));
    }
    stacks = Array.from({ length: cols }, () => []);
    for (const l of falling) {
      l.col = clampCol(l.col);
      l.tx = colX(l.col);
    }

    bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#060914');
    bgGrad.addColorStop(0.55, '#0f1433');
    bgGrad.addColorStop(1, '#1c1236');

    floorGrad = ctx.createLinearGradient(0, H - 220, 0, H);
    floorGrad.addColorStop(0, 'rgba(125,249,255,0)');
    floorGrad.addColorStop(1, 'rgba(125,249,255,0.07)');

    setupWipers();
  }

  function setupWipers() {
    const py = H + 14;
    if (W / H < 1.1) {
      // 세로 화면: 가운데 와이퍼 하나
      wipers = [{ px: W / 2, py, L: Math.max(W * 0.62, H * 0.52) }];
    } else {
      // 가로 화면: 자동차처럼 두 개
      const L = W * 0.52;
      wipers = [{ px: W * 0.27, py, L }, { px: W * 0.77, py, L }];
    }
  }

  /* ================= 생성 ================= */
  function spawnRandom() {
    const c = Math.floor(Math.random() * cols);
    if (stacks[c].length >= hardRows) return;
    falling.push(makeLetter(pick(SETS[charset]), c, -CELL));
  }

  function dropChar(ch) {
    const c = Math.floor(Math.random() * cols);
    const l = makeLetter(ch, c, -CELL);
    l.vy = 320;
    falling.push(l);
  }

  function dropWord(text) {
    const chars = Array.from(text.trim());
    if (!chars.length) return;
    const width = Math.min(chars.length, cols);
    const start = Math.max(0, Math.floor((cols - width) / 2));
    const color = pick(PALETTE);
    chars.forEach((ch, i) => {
      if (!ch.trim()) return;
      const row = Math.floor(i / cols);
      const l = makeLetter(ch, start + (i % cols), -CELL - row * CELL * 1.3);
      l.color = color;
      l.vy = 180;
      l.rot = 0;
      l.vr = 0;
      falling.push(l);
    });
  }

  function burst(px, py) {
    const baseCol = Math.floor((px - offsetX) / CELL);
    const n = 10 + Math.floor(Math.random() * 6);
    for (let i = 0; i < n; i++) {
      const c = clampCol(baseCol + Math.round(rand(-3, 3)));
      const top = H - (stacks[c].length + 1.5) * CELL;
      const l = makeLetter(pick(SETS[charset]), c, Math.min(py, top));
      l.x = px;
      l.vy = rand(-650, -250);
      l.vr = rand(-8, 8);
      falling.push(l);
    }
  }

  /* ================= 물리 ================= */
  function updateFalling(dt) {
    for (let i = falling.length - 1; i >= 0; i--) {
      const l = falling[i];
      l.vy = Math.min(l.vy + FALL_ACCEL * dt, FALL_MAX);
      l.y += l.vy * dt;
      l.x += (l.tx - l.x) * Math.min(1, dt * 12);
      l.rot += l.vr * dt;

      if (l.vy <= 0) continue;              // 위로 솟는 중이면 착지 판정 X

      const h = stacks[l.col].length;
      const landY = H - (h + 0.5) * CELL;
      if (l.y < landY) continue;

      // 너무 높이 쌓였으면 튕겨낸다
      if (h >= hardRows) {
        falling.splice(i, 1);
        fling(l, rand(-200, 200), rand(-400, -200));
        continue;
      }

      // 모래처럼 낮은 옆 칸으로 흘러내리기
      const nb = [];
      if (l.col > 0 && stacks[l.col - 1].length < h) nb.push(l.col - 1);
      if (l.col < cols - 1 && stacks[l.col + 1].length < h) nb.push(l.col + 1);
      if (nb.length) {
        l.col = pick(nb);
        l.tx = colX(l.col);
        l.vy *= 0.4;
        continue;
      }

      // 착지
      l.y = landY;
      l.x = l.tx;
      l.rot = l.restRot;
      l.pop = 1;
      stacks[l.col].push(l);
      falling.splice(i, 1);
    }
  }

  function fling(l, vx, vy) {
    l.vx = vx;
    l.vy = vy;
    l.vr = rand(-14, 14);
    l.life = 0;
    flung.push(l);
  }

  function updateFlung(dt) {
    for (let i = flung.length - 1; i >= 0; i--) {
      const l = flung[i];
      l.vy += GRAVITY * dt;
      l.x += l.vx * dt;
      l.y += l.vy * dt;
      l.rot += l.vr * dt;
      l.life += dt;
      if (l.life > 3 || l.y > H + 80 || l.x < -120 || l.x > W + 120) flung.splice(i, 1);
    }
  }

  /* ================= 와이퍼 ================= */
  function startWipe() {
    if (wipe.active) return;
    wipe.active = true;
    wipe.t = 0;
  }

  function updateWipe(dt) {
    if (cooldown > 0) cooldown -= dt;
    if (!wipe.active) return;

    wipe.t += dt;
    const p = Math.min(wipe.t / WIPE_DURATION, 1);
    const span = Math.PI - 2 * PARK;
    wipe.prevA = wipe.a;
    wipe.a = PARK + span * (p < 0.5 ? ease(p * 2) : ease(2 - p * 2));

    const omega = (wipe.a - wipe.prevA) / Math.max(dt, 1e-4);
    for (const w of wipers) sweep(w, wipe.prevA, wipe.a, omega);

    if (p >= 1) {
      wipe.active = false;
      wipe.a = wipe.prevA = PARK;
      cooldown = 0.8;
    }
  }

  function sweep(w, a0, a1, omega) {
    if (a0 === a1) return;
    const lo = Math.min(a0, a1);
    const hi = Math.max(a0, a1);

    const isHit = (l) => {
      const dx = l.x - w.px;
      const dy = w.py - l.y;
      const r = Math.hypot(dx, dy);
      if (r > w.L + CELL * 0.4 || r < 24) return false;
      const th = Math.atan2(dy, dx);
      const tol = (CELL * 0.5) / r;
      return th >= lo - tol && th <= hi + tol;
    };

    // 쌓인 글자: 맞은 글자 위쪽은 전부 무너져 내린다
    for (let c = 0; c < cols; c++) {
      if (Math.abs(colX(c) - w.px) > w.L + CELL) continue;
      const s = stacks[c];
      let first = -1;
      for (let k = 0; k < s.length; k++) {
        if (isHit(s[k])) { first = k; break; }
      }
      if (first < 0) continue;
      const removed = s.splice(first);
      for (const l of removed) {
        if (isHit(l)) launch(l, w, omega);
        else { l.vy = 0; l.vr = 0; falling.push(l); }
      }
    }

    // 떨어지는 글자도 와이퍼에 맞으면 튕겨나간다
    for (let i = falling.length - 1; i >= 0; i--) {
      if (isHit(falling[i])) {
        const l = falling.splice(i, 1)[0];
        launch(l, w, omega);
      }
    }
  }

  function launch(l, w, omega) {
    const dx = l.x - w.px;
    const dy = w.py - l.y;
    const r = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx);
    // 와이퍼 끝의 접선 속도: r·ω·(-sin a, -cos a)
    const tx = -r * omega * Math.sin(a) * 0.55;
    const ty = -r * omega * Math.cos(a) * 0.55;
    const vx = tx + rand(-120, 120);
    const vy = -Math.abs(ty) * 0.5 - rand(250, 600);
    fling(l, vx, vy);
    sweptCount++;
  }

  function checkAutoWipe() {
    if (!autoWipe || wipe.active || cooldown > 0) return;
    for (const s of stacks) {
      if (s.length >= maxRows) { startWipe(); return; }
    }
  }

  /* ================= 그리기 ================= */
  function drawLetter(l, scale) {
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.rotate(l.rot);
    if (scale !== 1) ctx.scale(scale, scale);
    ctx.fillStyle = l.color;
    ctx.fillText(l.ch, 0, 0);
    ctx.restore();
  }

  function drawWiper(w, a) {
    const cos = Math.cos(a), sin = -Math.sin(a);
    const ex = w.px + cos * w.L, ey = w.py + sin * w.L;
    const bx = w.px + cos * w.L * 0.16, by = w.py + sin * w.L * 0.16;
    // 나란히 붙은 고무날의 오프셋 (진행 방향 쪽)
    const nx = -sin * 5, ny = cos * 5;

    ctx.lineCap = 'round';

    // 금속 암
    ctx.strokeStyle = '#4a5270';
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(w.px, w.py); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = 'rgba(200,210,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(w.px, w.py - 2); ctx.lineTo(ex, ey - 2); ctx.stroke();

    // 고무날
    ctx.strokeStyle = '#05060a';
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(bx + nx, by + ny); ctx.lineTo(ex + nx, ey + ny); ctx.stroke();
    ctx.strokeStyle = 'rgba(125,249,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(bx + nx, by + ny); ctx.lineTo(ex + nx, ey + ny); ctx.stroke();

    // 축
    ctx.fillStyle = '#2b3150';
    ctx.beginPath(); ctx.arc(w.px, w.py, 20, 0, Math.PI * 2); ctx.fill();
  }

  function draw(dt) {
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, H - 220, W, 220);

    ctx.font = `700 ${Math.round(CELL * 0.86)}px "Space Mono", "Black Han Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 빗줄기 꼬리
    ctx.globalAlpha = 0.22;
    for (const l of falling) {
      if (l.vy > 150) {
        const len = Math.min(l.vy * 0.07, 70);
        ctx.fillStyle = l.color;
        ctx.fillRect(l.x - 1, l.y - CELL * 0.45 - len, 2, len);
      }
    }
    ctx.globalAlpha = 1;

    // 쌓인 글자
    for (const s of stacks) {
      for (const l of s) {
        if (l.pop > 0) {
          l.pop = Math.max(0, l.pop - dt * 5);
          drawLetter(l, 1 + l.pop * 0.35);
        } else {
          drawLetter(l, 1);
        }
      }
    }

    // 떨어지는 글자
    for (const l of falling) drawLetter(l, 1);

    // 와이퍼
    for (const w of wipers) drawWiper(w, wipe.a);

    // 튕겨나간 글자
    for (const l of flung) {
      ctx.globalAlpha = Math.max(0, 1 - l.life / 2.2);
      drawLetter(l, 1.1);
    }
    ctx.globalAlpha = 1;
  }

  /* ================= UI ================= */
  const piledEl = document.getElementById('piled');
  const sweptEl = document.getElementById('swept');
  let statTimer = 0;

  function updateStats(dt) {
    statTimer -= dt;
    if (statTimer > 0) return;
    statTimer = 0.2;
    let n = 0;
    for (const s of stacks) n += s.length;
    piledEl.textContent = n;
    sweptEl.textContent = sweptCount;
  }

  document.getElementById('rate').addEventListener('input', (e) => {
    rate = Number(e.target.value);
  });

  document.getElementById('charset').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    charset = btn.dataset.set;
    document.querySelectorAll('#charset button').forEach((b) => b.classList.toggle('on', b === btn));
  });

  document.getElementById('wipeBtn').addEventListener('click', startWipe);

  document.getElementById('autoWipe').addEventListener('change', (e) => {
    autoWipe = e.target.checked;
  });

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
  resize();

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;

    spawnAcc += rate * (cols / 60) * dt;
    while (spawnAcc >= 1) { spawnAcc -= 1; spawnRandom(); }

    updateFalling(dt);
    updateWipe(dt);
    updateFlung(dt);
    checkAutoWipe();
    draw(dt);
    updateStats(dt);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
