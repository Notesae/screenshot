// 只在独立无头浏览器中发合成 DOM 事件；不读取桌面、不操作系统输入或剪贴板。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.SCREENSHOT_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../../../../..');
const out = path.join(root, 'output/design/liquid-v2-background');
const checks = [], errors = [], requests = [];
let browser;

async function check(name, work) {
  await work(); checks.push(name); console.log('PASS ' + name);
}

(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.SCREENSHOT_CHROMIUM_EXECUTABLE ?
    { executablePath: process.env.SCREENSHOT_CHROMIUM_EXECUTABLE } : { channel: 'msedge' }) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1040 }, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.goto(pathToFileURL(path.join(out, 'Screenshot-Background-v2.html')).href);
  await page.waitForFunction(() => !!window.backgroundMotion);
  const snap = () => page.evaluate(() => backgroundMotion.snapshot);
  const settle = () => page.waitForFunction(() => !backgroundMotion.snapshot.running);
  const click = selector => page.evaluate(selector => document.querySelector(selector).click(), selector);
  const toggle = (selector, checked) => page.evaluate(({ selector, checked }) => {
    const input = document.querySelector(selector); input.checked = checked; input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { selector, checked });
  const point = (nx, ny, type = 'pointermove', target = '#stage') => page.evaluate(({ nx, ny, type, target }) => {
    const r = document.querySelector('#stage').getBoundingClientRect();
    document.querySelector(target).dispatchEvent(new PointerEvent(type, { bubbles: true,
      pointerType: 'mouse', pointerId: 7, clientX: r.left + r.width * (nx + 1) / 2,
      clientY: r.top + r.height * (ny + 1) / 2 }));
  }, { nx, ny, type, target });
  const geometry = () => page.evaluate(() => {
    const box = id => { const r = document.querySelector(id).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    return { capture: box('#capture'), rail: box('#rail'), image: document.querySelector('#preview').toDataURL(),
      exported: demo.exportCanvas().toDataURL(), revision: demo.state.revision };
  });

  await settle();
  await check('初始化后背景停稳，调度休眠', async () => {
    const before = await snap(); await page.waitForTimeout(160);
    assert.equal((await snap()).frames, before.frames); assert.equal(before.entry, 1);
  });
  const baseline = await geometry();
  await check('背景同向跟随，位移受限', async () => {
    await point(1, 1); await settle(); const s = await snap();
    assert.equal(s.x, 6); assert.equal(s.y, 4); assert.equal(s.lightX, 12); assert.equal(s.lightY, 8);
    assert.deepEqual(await geometry(), baseline);
  });
  await check('快速反向保留当前姿态与速度，逐帧不越界', async () => {
    await point(-1, -1); await page.waitForTimeout(65);
    const before = await snap(); await point(1, 1); const after = await snap();
    assert.ok(Math.abs(after.x - before.x) < 1); assert.ok(before.vx < 0 && after.vx < 0);
    const samples = await page.evaluate(() => new Promise(resolve => {
      const samples = []; let n = 0;
      function frame() { samples.push(backgroundMotion.snapshot); if (++n < 50) requestAnimationFrame(frame); else resolve(samples); }
      requestAnimationFrame(frame);
    }));
    assert.ok(samples.every(s => Math.abs(s.x) <= 6.001 && Math.abs(s.y) <= 4.001));
    await settle();
  });
  await check('按住时保持当前背景，松开从当前值续接', async () => {
    await point(.8, .7, 'pointerdown', '#rail'); const before = await snap();
    await point(-.8, -.7); await page.waitForTimeout(130); const held = await snap();
    assert.equal(held.x, before.x); assert.equal(held.y, before.y); assert.equal(held.held, true);
    await point(-.8, -.7, 'pointerup'); await settle(); assert.ok((await snap()).x < 0);
  });
  await check('启动未结束时按住也不跳帧，丢失捕获后恢复', async () => {
    await click('#replay'); await page.waitForTimeout(35); const before = await snap();
    await point(.8, .7, 'pointerdown', '#rail'); const held = await snap();
    assert.ok(Math.abs(before.entry - held.entry) < .2);
    await page.waitForTimeout(80); assert.equal((await snap()).entry, held.entry);
    await point(.8, .7, 'lostpointercapture'); await settle(); assert.equal((await snap()).held, false);
  });
  await check('选区像素、导出、边框和工具轨位置保持不变', async () => {
    assert.deepEqual(await geometry(), baseline);
  });
  await check('四边及角落有真实边缘扩展，不露透明像素', async () => {
    assert.equal(await page.evaluate(() => {
      const c = document.querySelector('#backgroundPlane canvas'), q = c.getContext('2d');
      return [[0, 0], [c.width - 1, 0], [0, c.height - 1], [c.width - 1, c.height - 1], [16, 16]]
        .every(([x, y]) => q.getImageData(x, y, 1, 1).data[3] === 255);
    }), true);
  });
  await check('框选阶段在消费坐标之前归正，恢复编辑后可跟随', async () => {
    await click('#newCapture'); await page.waitForTimeout(30);
    assert.equal((await snap()).x, 0); await point(1, 1); assert.equal((await snap()).x, 0);
    await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await point(.8, .8); await settle(); assert.ok((await snap()).x > 0);
  });
  await check('离开舞台平滑回正，静态对照立即停止', async () => {
    await point(0, 0, 'pointerleave'); await settle(); assert.equal((await snap()).x, 0);
    await point(1, 1); await settle(); await click('#backgroundCompare');
    assert.equal((await snap()).x, 0); assert.equal((await snap()).running, false);
    await point(1, 1); assert.equal((await snap()).x, 0);
    await click('#backgroundCompare');
  });
  await check('幅度调节有上限，关闭跟手后保持静止', async () => {
    await page.evaluate(() => { const e = document.querySelector('#backgroundGain'); e.value = '1.25'; e.dispatchEvent(new Event('input')); });
    await point(1, 1); await settle(); assert.equal((await snap()).x, 7.5); assert.equal((await snap()).y, 5);
    await toggle('#backgroundEnabled', false); await point(1, 1); assert.equal((await snap()).x, 0);
    await toggle('#backgroundEnabled', true);
    await page.evaluate(() => { const e = document.querySelector('#backgroundGain'); e.value = '1'; e.dispatchEvent(new Event('input')); });
  });
  await check('减少动态可中断入场，系统偏好不可覆盖', async () => {
    await click('#replay'); await toggle('#backgroundReduced', true);
    assert.equal((await snap()).entry, 1); assert.equal((await snap()).running, false);
    await page.emulateMedia({ reducedMotion: 'reduce' }); await toggle('#backgroundReduced', false);
    await point(1, 1); assert.equal((await snap()).x, 0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });
  await check('低开销模式关闭背景跟手', async () => {
    await toggle('#economy', true); await point(1, 1); assert.equal((await snap()).x, 0);
    await toggle('#economy', false);
  });
  await check('隐藏、失焦与迟到指针不会唤醒背景', async () => {
    await point(1, 1); await page.waitForTimeout(40);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    const before = await snap(); await point(1, 1); await page.waitForTimeout(100);
    assert.equal((await snap()).frames, before.frames); assert.equal((await snap()).x, 0);
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('blur')); });
    await point(1, 1); assert.equal((await snap()).running, false);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await point(1, 1); await settle(); assert.ok((await snap()).x > 0);
  });
  await check('模态与阅读时回正，关闭后重新接受指针', async () => {
    await page.evaluate(() => demo.openSettings()); await settle(); assert.equal((await snap()).x, 0);
    await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await page.evaluate(() => demo.openReader(true)); await settle(); assert.equal((await snap()).x, 0);
    await click('#readerClose'); await point(1, 1); await settle(); assert.ok((await snap()).x > 0);
  });
  await check('完成与新截图交接不会遗留背景位移', async () => {
    await page.evaluate(() => demo.finish());
    await page.waitForFunction(() => demo.state.phase === 'hidden');
    assert.equal((await snap()).x, 0); assert.equal((await snap()).running, false);
    await click('#restart'); await settle(); await point(.8, .8); await settle(); assert.ok((await snap()).x > 0);
  });
  await check('参数导出包含当前背景幅度', async () => {
    const download = page.waitForEvent('download'); await click('#backgroundExport');
    const result = await download; const file = path.join(out, result.suggestedFilename()); await result.saveAs(file);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).motion.gain.default, 1);
  });
  await point(0, 0, 'pointerleave'); await settle(); await page.waitForTimeout(650);
  await page.screenshot({ path: path.join(out, 'preview-clay.png'), fullPage: true });
  await click('#themeToggle'); await page.screenshot({ path: path.join(out, 'preview-dark.png'), fullPage: true });
  await check('1280 / 1024 / 720 / 390 宽度不溢出，背景边缘仍覆盖舞台', async () => {
    for (const width of [1280, 1024, 720, 390]) {
      await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(140);
      await page.evaluate(() => demo.reset()); await settle();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'width ' + width);
      await point(1, 1); await settle();
      assert.equal(await page.evaluate(() => {
        const a = document.querySelector('#stage').getBoundingClientRect(), b = document.querySelector('#backgroundPlane').getBoundingClientRect();
        return b.left <= a.left && b.top <= a.top && b.right >= a.right && b.bottom >= a.bottom;
      }), true);
    }
  });
  await page.screenshot({ path: path.join(out, 'preview-narrow.png'), fullPage: true });
  const touch = await browser.newContext({ viewport: { width: 720, height: 1000 }, isMobile: true, hasTouch: true });
  const touchPage = await touch.newPage(); await touchPage.goto(page.url());
  await touchPage.waitForFunction(() => !!window.backgroundMotion);
  await check('粗指针环境不启动空间动效', async () => {
    assert.equal(await touchPage.evaluate(() => backgroundMotion.snapshot.running), false);
    assert.equal(await touchPage.evaluate(() => backgroundMotion.snapshot.x), 0);
  });
  await check('无页面异常或外部网络请求', async () => { assert.deepEqual(errors, []); assert.deepEqual(requests, []); });
  fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify({ checks, errors, externalRequests: requests,
    browser: await browser.version(), environment: '隔离无头 Edge；合成 DOM 输入；未操作桌面', passed: true }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); });
