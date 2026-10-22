'use strict';
/* 候选背景控制器：复用 v2 弹簧，只操作合成桌面的显示副本。 */
(() => {
  const { $, Spring, clamp, reduced } = window.Liquid;
  const tokens = JSON.parse($('#backgroundTokenData').textContent), T = tokens.motion;
  const stage = $('#stage'), desktop = $('#desktop'), shade = $('#shade');
  const plane = document.createElement('div'), texture = document.createElement('canvas');
  const atmosphere = document.createElement('div');
  plane.id = 'backgroundPlane'; plane.setAttribute('aria-hidden', 'true'); plane.append(texture);
  atmosphere.id = 'backgroundAtmosphere'; atmosphere.setAttribute('aria-hidden', 'true');
  desktop.after(plane); shade.append(atmosphere);
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const x = new Spring(), y = new Spring(), lightX = new Spring(), lightY = new Spring();
  const entry = new Spring(0), axes = [x, y, lightX, lightY];
  entry.to = 1;
  const pointer = { x: 0, y: 0, inside: false };
  const state = { gain: T.gain.default, compare: false, held: false, blurred: false,
    raf: 0, last: 0, quiet: 0, frames: 0, status: '', source: null, width: 0, height: 0 };
  let bounds = stage.getBoundingClientRect();
  const max = () => ({ x: T.desktop.x * state.gain, y: T.desktop.y * state.gain });
  const disabled = () => !$('#backgroundEnabled').checked || state.compare || reduced() ||
    $('#economy').checked || !fine.matches;
  const blocked = () => document.hidden || state.blurred || window.demo.state.phase === 'hidden';
  const capturePhase = () => window.demo.state.phase === 'capturing';
  const focusedTask = () => !$('#modalRoot').hidden || !$('#reader').hidden ||
    window.demo.state.phase !== 'editing';

  // 原尺寸桌面按参数复制边缘；跟手不需要放大、模糊或每帧重绘图像。
  function rebuildTexture() {
    bounds = stage.getBoundingClientRect();
    const source = window.demo.state.source, w = stage.clientWidth, h = stage.clientHeight, p = T.edgePadding;
    if (!source || !w || !h) return;
    if (state.source === source && state.width === w && state.height === h) return;
    state.source = source; state.width = w; state.height = h;
    texture.width = w + p * 2; texture.height = h + p * 2;
    const q = texture.getContext('2d'), sw = source.width, sh = source.height;
    q.drawImage(source, 0, 0, sw, sh, p, p, w, h);
    q.drawImage(source, 0, 0, sw, 1, p, 0, w, p);
    q.drawImage(source, 0, sh - 1, sw, 1, p, p + h, w, p);
    q.drawImage(source, 0, 0, 1, sh, 0, p, p, h);
    q.drawImage(source, sw - 1, 0, 1, sh, p + w, p, p, h);
    for (const [sx, sy, dx, dy] of [[0, 0, 0, 0], [sw - 1, 0, p + w, 0],
      [0, sh - 1, 0, p + h], [sw - 1, sh - 1, p + w, p + h]]) {
      q.drawImage(source, sx, sy, 1, 1, dx, dy, p, p);
    }
    plane.style.inset = `${-p}px`;
    desktop.style.visibility = 'hidden';
    resetPose();
  }

  function status() {
    if (document.hidden || state.blurred) return '背景已挂起';
    if (reduced()) return '减少动态 · 背景静止';
    if ($('#economy').checked) return '低开销 · 背景静止';
    if (!fine.matches) return '触控模式 · 背景静止';
    if (state.compare || !$('#backgroundEnabled').checked) return '静态对照';
    if (capturePhase()) return '框选中 · 背景归正';
    if (blocked()) return '已收起 · 背景静止';
    if (state.held) return '按住操作 · 背景停稳';
    if (focusedTask()) return '专注内容 · 背景归正';
    return state.raf ? '背景轻移' : '背景已停稳';
  }

  function paint() {
    const limit = max();
    const dx = clamp(x.x, -limit.x, limit.x), dy = clamp(y.x, -limit.y, limit.y);
    plane.style.transform = `translate3d(${dx}px, ${dy + (1 - entry.x) * T.entry.offsetY}px, 0)`;
    atmosphere.style.transform = `translate3d(${lightX.x}px, ${lightY.x}px, 0)`;
    atmosphere.style.opacity = String(entry.x);
    const next = status();
    if (next !== state.status) { state.status = next; $('#backgroundStatus').textContent = next; }
    if (!$('#lab').hidden) $('#backgroundMetrics').textContent =
      `背景偏移：${dx.toFixed(2)} / ${dy.toFixed(2)} px\n位移上限：${limit.x.toFixed(1)} / ${limit.y.toFixed(1)} px\n背景调度：${state.raf ? '运行' : '休眠'}\n累计背景帧：${state.frames}\n截图、框线、命中层：固定`;
  }

  function stop() {
    cancelAnimationFrame(state.raf); state.raf = 0; state.last = 0; state.quiet = 0;
    plane.style.willChange = ''; atmosphere.style.willChange = '';
  }

  function resetPose() {
    stop(); axes.forEach(axis => axis.snap(0)); entry.snap(1); pointer.inside = false; paint();
  }

  function targets() {
    if (state.held) return;
    const active = pointer.inside && !focusedTask() && !capturePhase();
    const px = active ? pointer.x : 0, py = active ? pointer.y : 0;
    x.to = px * T.desktop.x * state.gain; y.to = py * T.desktop.y * state.gain;
    lightX.to = px * T.atmosphere.x * state.gain; lightY.to = py * T.atmosphere.y * state.gain;
  }

  function wake() {
    if (disabled() || blocked() || capturePhase()) { resetPose(); return; }
    targets();
    if (!state.raf) {
      state.last = performance.now(); state.quiet = 0;
      plane.style.willChange = 'transform'; atmosphere.style.willChange = 'transform';
      state.raf = requestAnimationFrame(frame);
    }
  }

  // 沿用 v2 的步长/阈值；反向只换目标，保留当前位移和速度。
  function frame(now) {
    state.raf = 0;
    if (disabled() || blocked() || capturePhase()) { resetPose(); return; }
    const dt = clamp((now - state.last) / 1000, .001, Liquid.T.motion.solver.maxElapsed);
    state.last = now; state.frames++;
    targets();
    x.tick(dt, T.desktop.k, T.desktop.c); y.tick(dt, T.desktop.k, T.desktop.c);
    lightX.tick(dt, T.atmosphere.k, T.atmosphere.c); lightY.tick(dt, T.atmosphere.k, T.atmosphere.c);
    entry.tick(dt, T.entry.k, T.entry.c);
    if ([...axes, entry].some(axis => axis.moving)) state.quiet = 0;
    else state.quiet++;
    if (state.quiet < T.sleepFrames) state.raf = requestAnimationFrame(frame);
    else stop();
    paint();
  }

  function move(event) {
    if (event.pointerType !== 'mouse' || disabled() || blocked() || capturePhase()) return;
    pointer.x = clamp((event.clientX - bounds.left) / bounds.width * 2 - 1, -1, 1);
    pointer.y = clamp((event.clientY - bounds.top) / bounds.height * 2 - 1, -1, 1);
    pointer.inside = true;
    wake();
  }

  function leave() { pointer.inside = false; wake(); }
  function release() { state.held = false; entry.to = 1; wake(); }
  // 真实拖动保持背景当前姿态；新框选在消费指针坐标之前强制对齐源图。
  stage.addEventListener('pointerdown', () => {
    if (capturePhase()) { resetPose(); return; }
    state.held = true; stop(); axes.forEach(axis => axis.snap(axis.x)); entry.snap(entry.x); paint();
  }, true);
  stage.addEventListener('pointermove', move, { passive: true });
  stage.addEventListener('pointerleave', leave);
  addEventListener('pointerup', release);
  addEventListener('pointercancel', () => { pointer.inside = false; release(); });
  stage.addEventListener('lostpointercapture', release);
  addEventListener('blur', () => { state.blurred = true; state.held = false; resetPose(); });
  addEventListener('focus', () => { state.blurred = false; resetPose(); });
  document.addEventListener('visibilitychange', () => { state.held = false; resetPose(); });
  // 页面滚动也更新舞台坐标，不用上一帧的视口矩形计算指针归一化。
  addEventListener('scroll', () => { bounds = stage.getBoundingClientRect(); leave(); }, { passive: true, capture: true });
  const resize = new ResizeObserver(() => { rebuildTexture(); wake(); }); resize.observe(stage);
  const sourceObserver = new MutationObserver(() => { rebuildTexture(); wake(); });
  sourceObserver.observe(desktop, { attributes: true, attributeFilter: ['style'] });
  const lifecycle = new MutationObserver(() => { wake(); });
  lifecycle.observe(stage, { attributes: true, attributeFilter: ['class'] });
  lifecycle.observe($('#phase'), { childList: true });
  for (const element of [$('#modalRoot'), $('#reader')]) lifecycle.observe(element, { attributes: true, attributeFilter: ['hidden'] });
  fine.addEventListener('change', () => resetPose());
  document.addEventListener('liquid-motion-change', () => {
    $('#backgroundReduced').checked = $('#reduced').checked; resetPose();
  });
  $('#backgroundEnabled').onchange = () => { state.compare = false; $('#backgroundCompare').setAttribute('aria-pressed', 'false'); resetPose(); };
  $('#backgroundCompare').onclick = () => {
    state.compare = !state.compare;
    $('#backgroundCompare').setAttribute('aria-pressed', String(state.compare));
    resetPose();
  };
  const gain = $('#backgroundGain');
  gain.min = T.gain.min; gain.max = T.gain.max; gain.step = T.gain.step; gain.value = T.gain.default;
  gain.oninput = () => {
    state.gain = clamp(Number(gain.value), T.gain.min, T.gain.max);
    $('#backgroundGainValue').textContent = `${Math.round(state.gain * 100)}%`; wake();
  };
  $('#backgroundReduced').onchange = event => {
    $('#reduced').checked = event.target.checked; Liquid.refreshReduced();
  };
  function replay() {
    if (disabled() || blocked() || capturePhase() || focusedTask() || state.held) return;
    // 已经播放到一半时沿用当前进度，避免连点造成可见闪烁。
    if (entry.x === 1) entry.snap(0);
    entry.to = 1; wake();
  }
  $('#replay').addEventListener('click', replay);
  $('#backgroundExport').onclick = () => {
    const candidate = structuredClone(tokens); candidate.motion.gain.default = state.gain;
    const url = URL.createObjectURL(new Blob([JSON.stringify(candidate, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'background-v2.tokens.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  rebuildTexture(); replay();
  // 只读观测供隔离验证，不包含任何系统输入、截图或桥接权限。
  window.backgroundMotion = { get snapshot() { return {
    x: x.x, y: y.x, vx: x.v, vy: y.v, targetX: x.to, targetY: y.to,
    lightX: lightX.x, lightY: lightY.x, entry: entry.x, frames: state.frames,
    running: !!state.raf, held: state.held, status: status(), limit: max(),
  }; } };
})();
