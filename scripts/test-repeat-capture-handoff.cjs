// 独立无头合成桥验证连续截图交接；不访问桌面、真实窗口、剪贴板或捕获 API。
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.SCREENSHOT_PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'editor/dist');
const output = path.join(root, 'artifacts/qa/repeat-capture-handoff');
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml' };
const scenarios = ['event-replace', 'request-replace', 'event-cancel-during-decode', 'request-late-after-cancel', 'stale-decode-after-c', 'stale-ready-after-c', 'stale-painted-after-c', 'request-cancel-without-image', 'host-frame-gate'];
const server = http.createServer((request, response) => {
  const file = path.resolve(dist, '.' + new URL(request.url, 'http://localhost').pathname);
  if (!file.startsWith(dist + path.sep)) { response.writeHead(403).end(); return; }
  const target = fs.existsSync(file) && fs.statSync(file).isDirectory() ? path.join(file, 'index.html') : file;
  if (!fs.existsSync(target)) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream'); fs.createReadStream(target).pipe(response);
});

/** A/B/C 图片及选区完全由测试生成，B 的原生 Image.src setter 可挂起，精确控制解码完成时刻。 */
function installHost() {
  const listeners = new Set(), heldImages = [];
  const areas = { a:{ x:120, y:100, width:420, height:240 }, b:{ x:620, y:320, width:560, height:300 }, c:{ x:180, y:410, width:360, height:260 } };
  const images = Object.fromEntries(Object.entries(areas).map(([key, area]) => {
    const canvas = document.createElement('canvas'); canvas.width = area.width; canvas.height = area.height;
    const context = canvas.getContext('2d'); context.fillStyle = key === 'a' ? '#dce9f5' : key === 'b' ? '#f1e2d2' : '#ddeddb'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#364251'; context.font = '24px sans-serif'; context.fillText('合成截图 ' + key.toUpperCase(), 25, 45);
    return [key, { dataUrl:canvas.toDataURL(), name:'合成截图-' + key + '.png', width:area.width, height:area.height }];
  }));
  const state = { active:'a', phase:'initial', samples:[], events:[], requests:[], holdDecode:false, holdCapture:false, holdReady:false, holdPainted:false, cancelResponse:false, bDeliveredAt:null, protectedA:null };
  const emit = data => listeners.forEach(listener => listener({ data }));
  const record = (type, detail = {}) => state.events.push({ type, time:performance.now(), ...detail });
  function envelope(key) { return { image:images[key], overlay:{ captureId:'repeat-' + key, desktopBounds:{ x:0, y:0, width:1280, height:800 }, selection:areas[key], screens:[{ bounds:{ x:0, y:0, width:1280, height:800 }, workArea:{ x:0, y:0, width:1280, height:760 }, primary:true }] } }; }
  function protect() {
    const snapshot = window.screenshotPrepareLeave('replace');
    try {
      if (snapshot.error) throw Error(snapshot.error);
      if (snapshot.document?.image?.name === images.a.name && !state.protectedA) state.protectedA = structuredClone(snapshot);
      record('document-protected', { documentId:snapshot.documentId, revision:snapshot.revision, name:snapshot.document?.image?.name });
    } finally { window.screenshotFinishLeave(); }
  }
  function deliver(key, channel) {
    // 取消后迟到的请求回复不代表宿主重新激活该选区；仍把旧结果交给前端验证拒绝路径。
    if (key !== 'b' || !state.invalidatedB) state.active = key;
    state.phase = key + '-delivered';
    if (key === 'b') state.bDeliveredAt = performance.now();
    record('image-delivered', { key, channel });
    if (channel === 'event') emit({ event:'image.loaded', payload:envelope(key) });
    return envelope(key);
  }
  const sourceDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', { ...sourceDescriptor, set(value) {
    const key = value === images.b.dataUrl && state.holdDecode ? 'b' : value === images.c.dataUrl && state.holdCDecode ? 'c' : null;
    if (key) {
      heldImages.push({ image:this, value, key }); record(key + '-decode-held'); return;
    }
    sourceDescriptor.set.call(this, value);
  } });
  function visible(element) {
    if (!element) return false;
    for (let current = element; current; current = current.parentElement) {
      const style = getComputedStyle(current); if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
    }
    return true;
  }
  function sample() {
    const frame = document.querySelector('.clay-capture-selection'), mask = document.querySelector('.clay-selection-mask'), rail = document.querySelector('.clay-rail');
    const rect = frame?.getBoundingClientRect(), maskPath = mask?.querySelector('path');
    const sameAsA = rect && Math.abs(rect.x - areas.a.x) < 1 && Math.abs(rect.y - areas.a.y) < 1 && Math.abs(rect.width - areas.a.width) < 1 && Math.abs(rect.height - areas.a.height) < 1;
    return { time:performance.now(), phase:state.phase, rootClass:document.querySelector('[data-editor-root]')?.className,
      frame:rect ? { x:rect.x, y:rect.y, width:rect.width, height:rect.height, visible:visible(frame), sameAsA:Boolean(sameAsA) } : null,
      mask:maskPath ? { visible:visible(mask), holeAtA:!maskPath.isPointInFill(new DOMPoint(areas.a.x + areas.a.width / 2, areas.a.y + areas.a.height / 2)),
        holeAtB:!maskPath.isPointInFill(new DOMPoint(areas.b.x + areas.b.width / 2, areas.b.y + areas.b.height / 2)) } : null,
      rail:{ visible:visible(rail), left:rail?.style.left, top:rail?.style.top }, cardVisible:visible(document.querySelector('.clay-card')) };
  }
  function observe() { if (state.samples.length < 600) { state.samples.push(sample()); requestAnimationFrame(observe); } }
  requestAnimationFrame(observe);
  Object.assign(window.chrome ||= {}, { webview:{ addEventListener:(_name, listener) => listeners.add(listener), removeEventListener:(_name, listener) => listeners.delete(listener), postMessage:async request => {
    state.requests.push({ method:request.method, captureId:request.payload.captureId });
    try {
      let result = {};
      switch (request.method) {
        case 'app.updateReady': result = { ready:true }; break;
        case 'settings.read': result = { providers:[], defaultProviderId:null }; break;
        case 'capture.settings': result = { backend:'wgc' }; break;
        case 'ocr.status': result = { available:false, modelVersion:'synthetic', message:'未运行 OCR', missingFiles:[] }; break;
        case 'recovery.list': result = { items:[] }; break;
        case 'recovery.usage': result = { documents:0, referencedAssetBytes:0, maxDocuments:100, maxAssetBytes:100000 }; break;
        case 'recovery.save': result = { saved:true, stale:false }; break;
        case 'document.preserve': protect(); result = { saved:true }; break;
        case 'capture.region':
          protect(); state.active = 'b'; state.phase = 'b-requested'; record('capture-region-request');
          if (state.holdCapture) await new Promise(resolve => state.releaseCapture = resolve);
          result = state.cancelResponse ? null : deliver('b', 'reply'); record('capture-region-reply', { empty:result === null }); break;
        case 'presentation.ready': {
          record('ready-request', { captureId:request.payload.captureId });
          if (request.payload.captureId === 'repeat-b' && state.holdReady) await new Promise(resolve => state.releaseReady = resolve);
          const accepted = request.payload.captureId === 'repeat-' + state.active;
          result = { accepted, ...(accepted ? { awaitingPaint:true } : {}), ...(state.hostFrameGate && request.payload.captureId === 'repeat-b' ? { hostFrameGate:true } : {}), captureId:'repeat-' + state.active, presentation:'overlay', viewport:{ width:innerWidth, height:innerHeight, scale:devicePixelRatio } };
          record('ready-reply', { captureId:request.payload.captureId, accepted }); break;
        }
        case 'presentation.painted': {
          record('painted-request', { captureId:request.payload.captureId });
          if (state.hostFrameGate && request.payload.captureId === 'repeat-b') {
            const before = sample();
            const staleResult = window.screenshotPresentCapture?.('repeat-a'), afterStale = sample();
            const currentResult = window.screenshotPresentCapture?.('repeat-b'), afterCurrent = sample();
            const secondStaleResult = window.screenshotPresentCapture?.('repeat-a'), afterSecondStale = sample();
            // 模拟宿主先订阅帧变化再揭示当前静态层；回执挂起期间不能提前出现工具栏。
            record('host-frame-requested', { before, staleResult, afterStale, currentResult, afterCurrent, secondStaleResult, afterSecondStale });
            await new Promise(resolve => state.releaseHostFrame = resolve);
            record('host-frame-released');
          }
          if (request.payload.captureId === 'repeat-b' && state.holdPainted) await new Promise(resolve => state.releasePainted = resolve);
          const accepted = request.payload.captureId === 'repeat-' + state.active;
          result = { accepted, captureId:'repeat-' + state.active, presentation:'overlay' }; record('painted-reply', { captureId:request.payload.captureId, accepted }); break;
        }
        case 'presentation.dismiss': result = { accepted:true, presentation:'hidden' }; break;
        default: throw Error('不支持的模拟请求：' + request.method);
      }
      emit({ id:request.id, ok:true, result });
    } catch (error) { record('bridge-error', { method:request.method, message:error.message }); emit({ id:request.id, ok:false, error:{ code:'mock_failure', message:error.message } }); }
  } } });
  window.__repeatHost = { state, startA:() => deliver('a', 'event'), deliverB:() => { protect(); deliver('b', 'event'); },
    deliverC:() => { protect(); deliver('c', 'event'); }, releaseDecode(key = 'b') {
      if (key === 'b') state.holdDecode = false; else state.holdCDecode = false;
      record(key + '-decode-released');
      for (let index = heldImages.length - 1; index >= 0; index--) if (heldImages[index].key === key) {
        const [held] = heldImages.splice(index, 1); sourceDescriptor.set.call(held.image, held.value);
      }
    },
    cancelB() { state.active = 'a'; state.invalidatedB = true; state.phase = 'b-cancelled'; record('b-invalidated'); emit({ event:'presentation.changed', payload:{ presentation:'hidden', reason:'overlay_cancelled', invalidatedCaptureId:'repeat-b' } }); },
    finish() { state.phase = 'finished'; },
  };
}

/** 只等待虚拟页面的绘制帧或明确桥状态；受控解码门不依赖机器速度或固定毫秒延时。 */
async function frames(page, count = 10) { await page.evaluate(async total => { for (let index = 0; index < total; index++) await new Promise(requestAnimationFrame); }, count); }
async function presented(page, key) {
  await page.waitForFunction(value => window.__repeatHost.state.events.some(event => event.type === 'painted-reply' && event.captureId === 'repeat-' + value && event.accepted) && document.querySelector('.is-presented'), key);
}
async function snapshot(page) { return page.evaluate(() => window.screenshotPrepareUpdate()); }
async function clickRecapture(page) {
  const more=page.getByRole('button',{name:'更多操作',exact:true});
  if(await more.getAttribute('aria-expanded')!=='true')await more.click();
  await page.getByRole('button', { name:'重新框选', exact:true }).click();
}

/** 新结果尚未解码时，旧选区边框/遮罩/工具必须先退出；底图是否显示由宿主遮挡决定，不在此伪造。 */
function summarize(recording, name, initial, final, finalChromeVisible) {
  const delivered = recording.events.find(event => event.type === 'image-delivered' && event.key === 'b');
  const ready = recording.events.find(event => event.type === 'ready-request' && event.captureId === 'repeat-b');
  const cancelled = recording.events.find(event => event.type === 'b-invalidated');
  // 取消后恢复 A 属于正确行为；旧选区不可见的要求只覆盖 B 尚有效且等待交接的区间。
  const pending = delivered ? recording.samples.filter(sample => sample.time >= delivered.time && (!ready || sample.time < ready.time) && (!cancelled || sample.time < cancelled.time) && sample.phase !== 'finished') : [];
  const oldFrames = pending.filter(sample => sample.frame?.visible && sample.frame.sameAsA);
  const oldMasks = pending.filter(sample => sample.mask?.visible && sample.mask.holeAtA && !sample.mask.holeAtB);
  const oldTools = pending.filter(sample => sample.frame?.sameAsA && sample.rail.visible);
  const captureRequest = recording.events.find(event => event.type === 'capture-region-request');
  const captureReply = recording.events.find(event => event.type === 'capture-region-reply');
  const requestPending = captureRequest ? recording.samples.filter(sample => sample.time >= captureRequest.time && (!captureReply || sample.time < captureReply.time) && (!cancelled || sample.time < cancelled.time)) : [];
  const oldRequestFrames = requestPending.filter(sample => sample.frame?.visible && sample.frame.sameAsA || sample.mask?.visible && sample.mask.holeAtA && !sample.mask.holeAtB || sample.frame?.sameAsA && sample.rail.visible);
  const saved = recording.protectedA;
  const protectedAIntact = Boolean(saved && saved.documentId === initial.documentId && saved.revision === initial.revision && saved.document.image.name === initial.document.image.name
    && JSON.stringify(saved.document.editor) === JSON.stringify(initial.document.editor));
  const mustKeepA = ['event-cancel-during-decode','request-late-after-cancel','request-cancel-without-image'].includes(name);
  const expectedName = mustKeepA ? '合成截图-a.png' : name.startsWith('stale-') ? '合成截图-c.png' : '合成截图-b.png';
  const hostFrameRequest = recording.events.find(event => event.type === 'host-frame-requested'), hostFrameRelease = recording.events.find(event => event.type === 'host-frame-released');
  const heldFrames = hostFrameRequest && hostFrameRelease ? recording.samples.filter(sample => sample.time >= hostFrameRequest.time && sample.time < hostFrameRelease.time) : [];
  const frameIsB = sample => sample.frame?.visible && !sample.frame.sameAsA && Math.abs(sample.frame.x - 620) < 1 && Math.abs(sample.frame.y - 320) < 1 && Math.abs(sample.frame.width - 560) < 1 && Math.abs(sample.frame.height - 300) < 1;
  const hostFrameGateValid = name !== 'host-frame-gate' || Boolean(hostFrameRequest && hostFrameRelease && heldFrames.length >= 10
    && !hostFrameRequest.before.frame?.visible && !hostFrameRequest.before.mask?.visible && !hostFrameRequest.before.rail.visible
    && hostFrameRequest.staleResult === false && !hostFrameRequest.afterStale.frame?.visible && !hostFrameRequest.afterStale.mask?.visible
    && hostFrameRequest.currentResult === true && frameIsB(hostFrameRequest.afterCurrent) && !hostFrameRequest.afterCurrent.rail.visible
    && hostFrameRequest.secondStaleResult === false && frameIsB(hostFrameRequest.afterSecondStale)
    && heldFrames.every(sample => frameIsB(sample) && sample.mask?.visible && sample.mask.holeAtB && !sample.mask.holeAtA && !sample.rail.visible && !sample.cardVisible));
  return { oldFrameCountBeforeReady:oldFrames.length, oldMaskCountBeforeReady:oldMasks.length, oldToolsCountBeforeReady:oldTools.length,
    hostFrameGateValid, hostFrameHeldCount:heldFrames.length,
    oldUiCountDuringCaptureRequest:oldRequestFrames.length, finalChromeVisible,
    oldFrameExamples:oldFrames.slice(0, 3), protectedAIntact, finalDocumentName:final.document?.image?.name, finalDocumentId:final.documentId,
    finalDocumentMatches:final.document?.image?.name === expectedName && (!mustKeepA || final.documentId === initial.documentId),
    pendingFrameCount:pending.length, error:final.error, readyRequests:recording.events.filter(event => event.type === 'ready-request').map(event => event.captureId) };
}

async function runScenario(page, name) {
  await page.evaluate(() => window.__repeatHost.startA()); await presented(page, 'a'); await frames(page, 3);
  const initial = await snapshot(page); assert.ok(initial.document?.image, 'A 的文档必须已准备好');
  if (name === 'host-frame-gate') {
    await page.evaluate(() => { window.__repeatHost.state.hostFrameGate = true; window.__repeatHost.deliverB(); });
    await page.waitForFunction(() => typeof window.__repeatHost.state.releaseHostFrame === 'function');
    await frames(page, 12);
    await page.evaluate(() => window.__repeatHost.state.releaseHostFrame()); await presented(page, 'b');
  } else if (['event-replace','request-replace','event-cancel-during-decode'].includes(name)) {
    await page.evaluate(() => { window.__repeatHost.state.holdDecode = true; });
    if (name === 'request-replace') await clickRecapture(page); else await page.evaluate(() => window.__repeatHost.deliverB());
    await page.waitForFunction(() => window.__repeatHost.state.events.some(event => event.type === 'b-decode-held')); await frames(page, 12);
    if (name === 'event-cancel-during-decode') await page.evaluate(() => window.__repeatHost.cancelB());
    await page.evaluate(() => window.__repeatHost.releaseDecode());
    if (name !== 'event-cancel-during-decode') await presented(page, 'b');
    else await frames(page, 12);
  } else if (name === 'request-late-after-cancel' || name === 'request-cancel-without-image') {
    await page.evaluate(() => { window.__repeatHost.state.holdCapture = true; }); await clickRecapture(page);
    await page.waitForFunction(() => typeof window.__repeatHost.state.releaseCapture === 'function');
    await frames(page, 12);
    await page.evaluate(empty => { window.__repeatHost.cancelB(); window.__repeatHost.state.cancelResponse = empty; window.__repeatHost.state.releaseCapture(); }, name === 'request-cancel-without-image');
    await frames(page, 15);
  } else if (name === 'stale-decode-after-c') {
    await page.evaluate(() => { window.__repeatHost.state.holdDecode = true; window.__repeatHost.state.holdCDecode = true; window.__repeatHost.deliverB(); });
    await page.waitForFunction(() => window.__repeatHost.state.events.some(event => event.type === 'b-decode-held'));
    await page.evaluate(() => window.__repeatHost.deliverC());
    await page.waitForFunction(() => window.__repeatHost.state.events.some(event => event.type === 'c-decode-held'));
    await page.evaluate(() => window.__repeatHost.releaseDecode('b')); await frames(page, 6);
    await page.evaluate(() => window.__repeatHost.releaseDecode('c')); await presented(page, 'c'); await frames(page, 6);
  } else {
    const waiting = name === 'stale-ready-after-c' ? 'holdReady' : 'holdPainted';
    const release = name === 'stale-ready-after-c' ? 'releaseReady' : 'releasePainted';
    await page.evaluate(key => { window.__repeatHost.state[key] = true; window.__repeatHost.deliverB(); }, waiting);
    await page.waitForFunction(key => typeof window.__repeatHost.state[key] === 'function', release);
    await page.evaluate(() => window.__repeatHost.deliverC()); await presented(page, 'c');
    await page.evaluate(key => window.__repeatHost.state[key](), release); await frames(page, 12);
  }
  await page.waitForFunction(() => !window.screenshotPrepareUpdate().error);
  // 给正常入场动画一次实际绘制机会；旧选区泄露仍按此前完整的待交接区间统计，不会被这两帧抹去。
  await frames(page, 2);
  const final = await snapshot(page); await page.evaluate(() => window.__repeatHost.finish());
  const finalChromeVisible = await page.locator('.clay-rail').evaluate(element => {
    for (let current = element; current; current = current.parentElement) {
      const style = getComputedStyle(current); if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
    }
    return true;
  });
  const recording = await page.evaluate(() => {
    const state = window.__repeatHost.state;
    return { ...state, releaseCapture:undefined, releaseReady:undefined, releasePainted:undefined, releaseHostFrame:undefined };
  });
  const summary = summarize(recording, name, initial, final, finalChromeVisible);
  // 报告只保留文档身份与名称；内存中保存的完整 A 快照用于比较，合成图片字节不打印。
  recording.protectedA = recording.protectedA ? { documentId:recording.protectedA.documentId, revision:recording.protectedA.revision, name:recording.protectedA.document?.image?.name } : null;
  return { syntheticOnly:true, desktopAccess:false, name, summary, recording };
}

async function main() {
  fs.mkdirSync(output, { recursive:true }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless:true, ...(process.env.SCREENSHOT_CHROMIUM_EXECUTABLE ? { executablePath:process.env.SCREENSHOT_CHROMIUM_EXECUTABLE } : { channel:'msedge' }) });
  const results = [];
  try {
    for (const name of scenarios.filter(value => !process.env.REPEAT_CAPTURE_CASE || value === process.env.REPEAT_CAPTURE_CASE)) {
      const context = await browser.newContext({ viewport:{ width:1280, height:800 }, deviceScaleFactor:1 });
      const page = await context.newPage(), errors = []; page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message));
      try {
        await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
        await page.addInitScript(installHost); await page.goto('http://127.0.0.1:' + server.address().port + '/index.html');
        await page.getByRole('button', { name:'打开图片', exact:true }).waitFor();
        const result = await runScenario(page, name); result.errors = errors;
        result.passed = !errors.length && result.summary.protectedAIntact && result.summary.finalDocumentMatches
          && result.summary.hostFrameGateValid
          && result.summary.finalChromeVisible && !result.summary.oldUiCountDuringCaptureRequest
          && !result.summary.oldFrameCountBeforeReady && !result.summary.oldMaskCountBeforeReady && !result.summary.oldToolsCountBeforeReady;
        fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify(result, null, 2));
        results.push({ name, passed:result.passed, ...result.summary, errors }); console.log(JSON.stringify(results.at(-1)));
      } catch (error) {
        const state = await page.evaluate(() => ({ events:window.__repeatHost?.state.events, samples:window.__repeatHost?.state.samples.slice(-20), notice:document.querySelector('[role="alert"]')?.textContent })).catch(() => ({}));
        fs.writeFileSync(path.join(output, name + '-error.json'), JSON.stringify({ name, error:error.message, state, errors }, null, 2));
        results.push({ name, passed:false, error:error.message, errors }); console.error('ERROR ' + name + ': ' + error.message);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); server.close(); }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ syntheticOnly:true, desktopAccess:false, dist:fs.readdirSync(path.join(dist, 'assets')).filter(name => /^index-.*\.js$/.test(name)), results }, null, 2));
  if (results.some(result => !result.passed)) process.exitCode = 1;
}
main().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
