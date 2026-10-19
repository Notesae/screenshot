// 独立无头会话只加载合成素材与模拟桥接；不连接已有浏览器，不调用系统截图或剪贴板。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dist = path.resolve(__dirname, '../dist');
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const file = path.resolve(dist, `.${url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)}`);
  if (!file.startsWith(dist + path.sep)) { response.writeHead(403).end(); return; }
  fs.readFile(file, (error, bytes) => {
    if (error) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    response.end(bytes);
  });
});
let browser;
const checks = [];
const closeEnough = (actual, expected) => assert.ok(Math.abs(actual - expected) < .1, `${actual} ≈ ${expected}`);

// 全部模拟响应仅写入页面内存；任何意外浏览器剪贴板调用都会令测试失败。
async function installMock(page) {
  await page.addInitScript(() => {
    const listeners = [];
    window.__messages = [];
    window.__heldDecodes = []; window.__heldReady = []; window.__holdReady = false; window.__currentCaptureId = null;
    window.__emit = data => {
      if (data.event === 'image.loaded' && data.payload.overlay) window.__currentCaptureId = data.payload.overlay.captureId;
      if (data.event === 'presentation.changed' && (!data.payload.timedOutCaptureId || data.payload.timedOutCaptureId === window.__currentCaptureId)) window.__currentCaptureId = null;
      listeners.forEach(listener => listener({ data }));
    };
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    Object.defineProperty(HTMLImageElement.prototype, 'src', { ...descriptor, set(value) {
      if (value === window.__holdNextDecodeURL) { window.__holdNextDecodeURL = null; window.__heldDecodes.push(() => descriptor.set.call(this, value)); }
      else descriptor.set.call(this, value);
    } });
    const webview = {
      addEventListener(type, listener) { if (type === 'message') listeners.push(listener); },
      removeEventListener(type, listener) { const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1); },
      postMessage(request) {
        window.__messages.push(request);
        if (request.method === 'presentation.ready' && window.__holdReady) { window.__heldReady.push(request); return; }
        const results = { 'settings.read': { providers: [{ id: 'synthetic', name: '模拟服务', kind: 'ollama', model: 'test', baseUrl: 'http://127.0.0.1:0', hasApiKey: false }], defaultProviderId: 'synthetic' }, 'image.open': window.__openImage, 'image.copy': { copied: true }, 'image.save': { saved: true }, 'ai.ocr': { text: '仅用于无头测试的合成文字' } };
        let result = results[request.method];
        if (request.method.startsWith('presentation.')) {
          const active = window.__currentCaptureId;
          const accepted = active ? request.payload.captureId === active : request.payload.captureId === undefined;
          const target = request.method === 'presentation.ready' ? 'overlay' : request.method === 'presentation.workbench' ? 'workbench' : 'hidden';
          if (accepted && target !== 'overlay') window.__currentCaptureId = null;
          result = { accepted, presentation: accepted ? target : active ? 'overlay' : 'workbench', captureId: window.__currentCaptureId };
        }
        setTimeout(() => window.__emit(result ? { id: request.id, ok: true, result } : { id: request.id, ok: false, error: { code: 'MOCK', message: '测试未模拟此操作' } }), 0);
      },
    };
    window.chrome = window.chrome || {};
    Object.defineProperty(window.chrome, 'webview', { value: webview });
    Object.defineProperty(navigator, 'clipboard', { value: { read() { throw new Error('测试禁止读取剪贴板'); }, write() { throw new Error('测试禁止写入剪贴板'); } } });
  });
}

// 生成两色 PNG，不读取任何用户图片或真实桌面。
async function capture(page, captureId = 'headless-a', holdDecode = false) {
  return page.evaluate(({ id, holdDecode }) => {
    const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 60;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#cc4422'; ctx.fillRect(0, 0, 40, 60); ctx.fillStyle = '#448855'; ctx.fillRect(40, 0, 40, 60);
    const dataUrl = canvas.toDataURL('image/png');
    if (holdDecode) window.__holdNextDecodeURL = dataUrl;
    window.__emit({ event: 'image.loaded', payload: { image: { dataUrl, name: '合成测试.png', width: 80, height: 60 }, overlay: { captureId: id, desktopBounds: { x: -1920, y: 0, width: 4480, height: 1440 }, selection: { x: -1500, y: 200, width: 80, height: 60 }, screens: [{ bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, primary: false }, { bounds: { x: 0, y: 0, width: 2560, height: 1440 }, primary: true }] } } });
    return dataUrl;
  }, { id: captureId, holdDecode });
}

// 制造受控的迟到图片解码，验证异步读文件不越过后来的捕获意图。
async function lateImage(page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 12; canvas.height = 10;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f0a5ce'; ctx.fillRect(0, 0, 12, 10);
    const image = { dataUrl: canvas.toDataURL('image/png'), name: '迟到合成图.png', width: 12, height: 10 };
    window.__openImage = image; window.__holdNextDecodeURL = image.dataUrl;
    return image;
  });
}
async function releaseDecodes(page) { await page.evaluate(() => window.__heldDecodes.splice(0).forEach(release => release())); }
async function returnWorkbench(page) {
  await page.getByRole('button', { name: '更多与完整工作台', exact: true }).click();
  await page.getByRole('button', { name: '完整工作台', exact: true }).click(); await page.locator('.app').waitFor();
}
async function copied(page) {
  const count = await page.evaluate(() => window.__messages.filter(message => message.method === 'image.copy').length);
  await page.getByRole('button', { name: '复制', exact: true }).click();
  await page.waitForFunction(previous => window.__messages.filter(message => message.method === 'image.copy').length > previous, count);
  return page.evaluate(() => window.__messages.filter(message => message.method === 'image.copy').at(-1).payload.dataUrl);
}
async function escape(page, target) { await (target || page.locator('.compact-toolbar')).dispatchEvent('keydown', { key: 'Escape', bubbles: true }); }

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-background-networking'] });
  const page = await browser.newPage({ viewport: { width: 2240, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await installMock(page); await page.goto(origin);
  await page.getByRole('button', { name: '选择一张图片', exact: true }).waitFor();
  await lateImage(page);
  await page.locator('.import-button').click();
  await page.waitForFunction(() => window.__heldDecodes.length === 1);
  const nativeWinner = await capture(page, 'native-load-winner');
  await page.waitForFunction(() => window.__messages.some(message => message.method === 'presentation.ready' && message.payload.captureId === 'native-load-winner'));
  let transitionCount = await page.evaluate(() => window.__messages.filter(message => message.method === 'presentation.workbench').length);
  await releaseDecodes(page); await page.waitForFunction(() => !document.querySelector('.compact-progress'));
  assert.equal(await page.evaluate(() => window.__messages.filter(message => message.method === 'presentation.workbench').length), transitionCount);
  assert.equal(await copied(page), nativeWinner); await returnWorkbench(page);
  const lateFile = await lateImage(page);
  await page.locator('input[type="file"]').first().setInputFiles({ name: '迟到合成图.png', mimeType: 'image/png', buffer: Buffer.from(lateFile.dataUrl.split(',')[1], 'base64') });
  await page.waitForFunction(() => window.__heldDecodes.length === 1);
  const fileWinner = await capture(page, 'file-load-winner');
  await page.waitForFunction(() => window.__messages.some(message => message.method === 'presentation.ready' && message.payload.captureId === 'file-load-winner'));
  transitionCount = await page.evaluate(() => window.__messages.filter(message => message.method === 'presentation.workbench').length);
  await releaseDecodes(page); await page.waitForFunction(() => !document.querySelector('.compact-progress'));
  assert.equal(await page.evaluate(() => window.__messages.filter(message => message.method === 'presentation.workbench').length), transitionCount);
  assert.equal(await copied(page), fileWinner); await returnWorkbench(page);
  checks.push('late native image decode and file read cannot replace a newer capture or request native workbench');
  const source = await capture(page);
  await page.waitForFunction(() => window.__messages.some(message => message.method === 'presentation.ready' && message.payload.captureId === 'headless-a'));
  const frame = await page.locator('.compact-canvas').boundingBox();
  closeEnough(frame.x, 210); closeEnough(frame.y, 125); closeEnough(frame.width, 40); closeEnough(frame.height, 37.5);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.equal(await copied(page), source); checks.push('negative-origin independent-axis placement, transparent shell, ready ID and byte-exact raw PNG');

  await page.getByRole('button', { name: '添加矩形标注', exact: true }).click();
  await page.evaluate(dataUrl => { window.__holdNextDecodeURL = dataUrl; }, source);
  await page.getByRole('button', { name: '美化', exact: true }).click();
  await page.waitForFunction(() => window.__heldDecodes.length === 1);
  await page.getByRole('button', { name: '更多与完整工作台', exact: true }).click();
  await page.getByRole('button', { name: '删除选中标注', exact: true }).click();
  await releaseDecodes(page);
  await page.waitForFunction(() => document.querySelector('.lower-canvas')?.width === 176);
  await page.getByRole('button', { name: '美化', exact: true }).click();
  await page.waitForFunction(() => Math.abs(document.querySelector('.compact-canvas').getBoundingClientRect().x - 186) < .1);
  const beauty = await page.locator('.compact-canvas').boundingBox(); closeEnough(beauty.x + 24, frame.x); closeEnough(beauty.y + 30, frame.y);
  await escape(page, page.locator('input[type="range"]').first()); assert.equal(await page.locator('.compact-panel').count(), 1);
  await escape(page); assert.equal(await page.locator('.compact-panel').count(), 0);
  const withoutAnnotation = await copied(page);
  const deletedInk = await page.evaluate(dataUrl => new Promise(resolve => { const image = new Image(); image.onload = () => { const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); const pixels = ctx.getImageData(0, 0, image.width, image.height).data; let count = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 180 && pixels[i + 1] === 67 && pixels[i + 2] === 44 && pixels[i + 3] === 255) count++; resolve(count); }; image.src = dataUrl; }), withoutAnnotation);
  assert.equal(deletedInk, 0); checks.push('deleting annotations during delayed base rendering does not resurrect stale Fabric objects');
  await page.getByRole('button', { name: '添加矩形标注', exact: true }).click();
  const beautified = await copied(page);
  const dimensions = await page.evaluate(dataUrl => new Promise(resolve => { const image = new Image(); image.onload = () => resolve([image.width, image.height]); image.src = dataUrl; }), beautified);
  assert.deepEqual(dimensions, [176, 156]); checks.push('beauty padding keeps selected content anchored and export contains only 176×156 edited crop');

  await page.setViewportSize({ width: 1120, height: 360 });
  await page.waitForFunction(() => Math.abs(document.querySelector('.compact-canvas').getBoundingClientRect().x - 93) < .1);
  const toolbar = await page.locator('.compact-toolbar').boundingBox(); assert.ok(toolbar.x >= 12 && toolbar.x + toolbar.width <= 468.1); assert.ok(toolbar.y >= 12 && toolbar.y + toolbar.height <= 258.1);
  checks.push('resize recomputes geometry and clamps toolbar to selected secondary screen');

  await page.getByRole('button', { name: '更多与完整工作台', exact: true }).click();
  await page.getByRole('button', { name: '完整工作台', exact: true }).click();
  await page.locator('.app').waitFor();
  const copyCount = await page.evaluate(() => window.__messages.filter(message => message.method === 'image.copy').length);
  await page.getByRole('button', { name: '复制到剪贴板', exact: true }).click();
  await page.waitForFunction(previous => window.__messages.filter(message => message.method === 'image.copy').length > previous, copyCount);
  assert.equal(await page.evaluate(() => window.__messages.filter(message => message.method === 'image.copy').at(-1).payload.dataUrl), beautified);
  checks.push('workbench shares document, annotations and identical edited export');

  await capture(page, 'headless-b'); await page.locator('.compact-toolbar').waitFor();
  await page.waitForFunction(() => window.__messages.some(message => message.method === 'presentation.ready' && message.payload.captureId === 'headless-b'));
  await page.getByRole('button', { name: '翻译', exact: true }).click();
  await escape(page, page.locator('#compact-text')); assert.equal(await page.locator('.compact-panel').count(), 1);
  await escape(page); assert.equal(await page.locator('.compact-panel').count(), 0);
  await page.getByRole('button', { name: '添加矩形标注', exact: true }).click();
  await escape(page); assert.equal(await page.locator('.compact-overlay').count(), 1);
  await escape(page); await page.locator('.app').waitFor();
  assert.equal(await page.evaluate(() => window.__messages.filter(message => message.method === 'presentation.dismiss').length), 1);
  checks.push('Esc preserves inputs, closes panels, deselects objects and only then dismisses');

  await capture(page, 'decode-timeout', true); await page.waitForFunction(() => window.__heldDecodes.length === 1);
  await page.evaluate(() => window.__emit({ event: 'presentation.changed', payload: { presentation: 'workbench', reason: 'overlay_timeout', timedOutCaptureId: 'decode-timeout' } }));
  await releaseDecodes(page); await page.getByRole('alert').filter({ hasText: '截图已保留在工作台' }).waitFor(); assert.equal(await page.locator('.compact-overlay').count(), 0);
  checks.push('timeout before image decode completes preserves image in workbench and never revives compact overlay');
  await page.evaluate(() => { window.__holdReady = true; });
  await capture(page, 'late-ready-a'); await page.waitForFunction(() => window.__heldReady.length === 1);
  await page.evaluate(() => { window.__holdReady = false; });
  await capture(page, 'late-ready-b'); await page.waitForFunction(() => window.__messages.some(message => message.method === 'presentation.ready' && message.payload.captureId === 'late-ready-b'));
  await page.evaluate(() => { const request = window.__heldReady.shift(); window.__emit({ id: request.id, ok: true, result: { accepted: false, presentation: 'overlay', captureId: 'late-ready-b' } }); window.__emit({ event: 'presentation.changed', payload: { presentation: 'workbench', reason: 'overlay_timeout', timedOutCaptureId: 'late-ready-a' } }); });
  assert.equal(await page.locator('.compact-overlay').count(), 1); assert.equal(await copied(page), source);
  checks.push('rejected old ready and timed-out old capture cannot clear the newer overlay');
  await returnWorkbench(page);
  await capture(page, 'tray-during-decode', true); await page.waitForFunction(() => window.__heldDecodes.length === 1);
  await page.evaluate(() => window.__emit({ event: 'presentation.changed', payload: { presentation: 'workbench', reason: 'user_workbench', invalidatedCaptureId: 'tray-during-decode' } }));
  await releaseDecodes(page); await page.waitForFunction(() => !document.querySelector('.compact-overlay') && document.querySelector('.workspace-bar strong')?.textContent === '合成测试.png');
  assert.equal(await page.getByRole('alert').count(), 0); checks.push('user workbench restoration invalidates pending capture without a timeout warning');
  assert.deepEqual(errors, []);
  const evidence = { headless: true, syntheticOnly: true, nativeCalls: false, clipboardAccess: false, checks };
  const evidencePath = path.resolve(__dirname, '../output/headless-overlay.json'); fs.mkdirSync(path.dirname(evidencePath), { recursive: true }); fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
});
