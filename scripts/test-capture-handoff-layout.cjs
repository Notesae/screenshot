// 仅在独立无头 Edge 中仿真 viewport / DPR，合成图片不接触桌面、窗口、剪贴板或截图 API。
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.SCREENSHOT_PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'editor/dist');
const output = path.join(root, 'artifacts/qa/capture-handoff-layout');
const desktop = { x:-1920, y:-360, width:4480, height:1800 };
const selection = { x:-1400, y:180, width:560, height:300 };
const finalMetrics = { width:3584, height:1440, dpr:1.25 };
const intermediateMetrics = { width:2987, height:1200, dpr:1.5 };
const scenarios = [
  { name:'same-viewport', resize:'none' },
  { name:'resize-before-ready-reply', resize:'immediate' },
  { name:'resize-after-ready-reply', resize:'delayed' },
  { name:'delayed-second-resize', resize:'twice' },
  { name:'native-rejects-stale-viewport', resize:'recheck' },
];
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml' };
const server = http.createServer((request, response) => {
  const file = path.resolve(dist, '.' + new URL(request.url, 'http://localhost').pathname);
  if (!file.startsWith(dist + path.sep)) { response.writeHead(403).end(); return; }
  const target = fs.existsSync(file) && fs.statSync(file).isDirectory() ? path.join(file, 'index.html') : file;
  if (!fs.existsSync(target)) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
  fs.createReadStream(target).pipe(response);
});

/** 模拟宿主在 ready 前后更改独立页面的显示尺寸，并逐帧记录真实布局与两个交接时刻。 */
function installProbe(config) {
  const listeners = new Set();
  const state = { events:[], samples:[], imageSourceAssignments:[], capturing:false, captureId:'synthetic-layout-' + config.name, requests:[], resizePending:0, afterPresentedFrames:0, paintedAttempts:0, nativeViewport:null };
  const emit = data => listeners.forEach(listener => listener({ data }));
  const rounded = number => Math.round(number * 1000) / 1000;
  const toViewport = metrics => ({ width:metrics.width, height:metrics.height, scale:metrics.dpr });
  const matchesViewport = (actual, expected) => actual && expected && Math.abs(actual.width - expected.width) <= 1 && Math.abs(actual.height - expected.height) <= 1 && Math.abs(actual.scale - expected.scale) < .001;
  function sampleElement(selector) {
    const element = document.querySelector(selector); if (!element) return null;
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    let visible = true;
    for (let current = element; current; current = current.parentElement) {
      const ancestor = getComputedStyle(current);
      if (ancestor.visibility === 'hidden' || ancestor.display === 'none' || Number(ancestor.opacity) === 0) visible = false;
    }
    const css = { x:rounded(rect.x), y:rounded(rect.y), width:rounded(rect.width), height:rounded(rect.height) };
    // displayPhysical 代表设备实际像素；mappedPhysical 仅验证数学映射，不能代替实际 viewport 已稳定。
    const physical = (scaleX, scaleY) => ({ left:rounded(config.desktop.x + rect.left * scaleX), top:rounded(config.desktop.y + rect.top * scaleY), right:rounded(config.desktop.x + rect.right * scaleX), bottom:rounded(config.desktop.y + rect.bottom * scaleY) });
    return { css, layout:{ x:element.offsetLeft, y:element.offsetTop, width:element.offsetWidth, height:element.offsetHeight },
      visible, visibility:style.visibility, opacity:style.opacity, transform:style.transform,
      inline:{ left:element.style.left, top:element.style.top, width:element.style.width, height:element.style.height },
      displayPhysical:physical(devicePixelRatio, devicePixelRatio), mappedPhysical:physical(config.desktop.width / innerWidth, config.desktop.height / innerHeight),
      ...(element instanceof HTMLCanvasElement ? { bitmap:{ width:element.width, height:element.height } } : {}),
    };
  }
  function sample(label = 'raf') {
    const mask = document.querySelector('.clay-selection-mask'), maskPath = mask?.querySelector('path');
    const frame = document.querySelector('.clay-capture-selection');
    let maskHole = null;
    if (maskPath && frame) {
      const maskBounds = mask.getBoundingClientRect(), bounds = frame.getBoundingClientRect();
      const x = bounds.left - maskBounds.left, y = bounds.top - maskBounds.top, width = bounds.width, height = bounds.height;
      const filled = (px, py) => maskPath.isPointInFill(new DOMPoint(px, py));
      // 同时检查每条边内外两侧，避免只检查中心而漏掉遮罩洞尺寸偏差。
      maskHole = { fillRule:getComputedStyle(maskPath).fillRule, centerClear:!filled(x + width / 2, y + height / 2),
        leftInsideClear:!filled(x + 2, y + height / 2), rightInsideClear:!filled(x + width - 2, y + height / 2),
        topInsideClear:!filled(x + width / 2, y + 2), bottomInsideClear:!filled(x + width / 2, y + height - 2),
        leftOutsideFilled:filled(x - 2, y + height / 2), rightOutsideFilled:filled(x + width + 2, y + height / 2),
        topOutsideFilled:filled(x + width / 2, y - 2), bottomOutsideFilled:filled(x + width / 2, y + height + 2),
        desktopCornerFilled:filled(.5, .5), attributeWidth:mask.getAttribute('width'), attributeHeight:mask.getAttribute('height') };
    }
    return { time:rounded(performance.now()), label, viewport:{ width:innerWidth, height:innerHeight, dpr:devicePixelRatio,
      visualWidth:visualViewport?.width, visualHeight:visualViewport?.height, visualScale:visualViewport?.scale },
      rootClass:document.querySelector('[data-editor-root]')?.className,
      layer:sampleElement('.clay-capture-layer'), frame:sampleElement('.clay-capture-selection'),
      canvas:sampleElement('.clay-canvas-fixed'), lower:sampleElement('.lower-canvas'), upper:sampleElement('.upper-canvas'), rail:sampleElement('.clay-rail'), mask:sampleElement('.clay-selection-mask'), maskHole };
  }
  function record(type, detail = {}) { state.events.push({ type, time:rounded(performance.now()), ...detail }); }
  async function resize(stage, metrics) {
    state.resizePending++; record('resize-requested', { stage, metrics });
    try { await window.__resizeProbe({ stage, metrics }); record('resize-applied', { stage, actual:{ width:innerWidth, height:innerHeight, dpr:devicePixelRatio } }); }
    catch (error) { record('resize-error', { stage, message:String(error) }); }
    finally { state.resizePending--; }
  }
  addEventListener('resize', () => { if (state.capturing) { record('window-resize', { width:innerWidth, height:innerHeight, dpr:devicePixelRatio }); state.samples.push(sample('resize-event')); } });
  function observe() {
    if (state.capturing) {
      const current = sample(); state.samples.push(current);
      if (current.rootClass?.includes('is-overlay') && current.rootClass.includes('is-presented')) {
        if (!state.presentedAt) { state.presentedAt = current.time; record('first-presented'); }
        state.afterPresentedFrames++;
      }
    }
    if (state.samples.length < 300) requestAnimationFrame(observe);
  }
  requestAnimationFrame(observe);
  const image = document.createElement('canvas'); image.width = config.selection.width; image.height = config.selection.height;
  const context = image.getContext('2d'); context.fillStyle = '#e8edf3'; context.fillRect(0, 0, image.width, image.height);
  context.fillStyle = '#526071'; context.font = '20px sans-serif'; context.fillText('合成交接布局探针', 24, 34);
  const sampleImage = { dataUrl:image.toDataURL(), name:'合成交接.png', width:image.width, height:image.height };
  // 仅观察本探针生成的同一 PNG；保留原生 setter 与加载事件，不修改解码流程或缓存策略。
  const sourceDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', { ...sourceDescriptor, set(value) {
    if (value === sampleImage.dataUrl) {
      const assignment = { startedAt:rounded(performance.now()), afterCapture:state.capturing };
      state.imageSourceAssignments.push(assignment);
      this.addEventListener('load', () => { assignment.loadedAt = rounded(performance.now()); assignment.loadDurationMs = rounded(assignment.loadedAt - assignment.startedAt); }, { once:true });
      this.addEventListener('error', () => { assignment.errorAt = rounded(performance.now()); }, { once:true });
    }
    sourceDescriptor.set.call(this, value);
  } });
  Object.assign(window.chrome ||= {}, { webview: {
    addEventListener:(_name, listener) => listeners.add(listener), removeEventListener:(_name, listener) => listeners.delete(listener),
    postMessage:async request => {
      state.requests.push(request.method);
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
          case 'document.preserve': result = { saved:true }; break;
          case 'presentation.ready':
            record('ready-request', { snapshot:sample('ready-request') });
            if (config.resize === 'immediate') await resize('final', config.finalMetrics);
            if (config.resize === 'twice' || config.resize === 'recheck') await resize('intermediate', config.intermediateMetrics);
            // 原生几何先于 Chromium viewport 收敛；目标直接来自模拟宿主，而非从旧浏览器尺寸回推。
            state.nativeViewport = config.resize === 'none' ? { width:innerWidth, height:innerHeight, scale:devicePixelRatio }
              : toViewport(config.resize === 'recheck' ? config.intermediateMetrics : config.finalMetrics);
            record('ready-reply', { viewport:state.nativeViewport, snapshot:sample('ready-reply') });
            if (config.resize === 'delayed') setTimeout(() => void resize('final', config.finalMetrics), 8);
            if (config.resize === 'twice') setTimeout(() => void resize('final', config.finalMetrics), 120);
            result = { accepted:true, awaitingPaint:true, viewport:state.nativeViewport, captureId:state.captureId, presentation:'overlay' }; break;
          case 'presentation.painted': {
            state.paintedAttempts++;
            // 模拟宿主在二次核对时发现最新DPI已变：拒绝旧目标，继续保留遮挡，120ms后浏览器才收到对应resize。
            if (config.resize === 'recheck' && state.paintedAttempts === 1) {
              state.nativeViewport = toViewport(config.finalMetrics);
              setTimeout(() => void resize('final', config.finalMetrics), 120);
            }
            const accepted = request.payload.captureId === state.captureId && matchesViewport(request.payload.viewport, state.nativeViewport);
            record('painted-request', { attempt:state.paintedAttempts, accepted, expectedViewport:state.nativeViewport,
              captureId:request.payload.captureId, payload:request.payload, snapshot:sample('painted-request') });
            result = { accepted, ...(!accepted ? { awaitingPaint:true } : {}), viewport:state.nativeViewport, captureId:state.captureId, presentation:'overlay' };
            record('painted-reply', { attempt:state.paintedAttempts, accepted, viewport:state.nativeViewport }); break;
          }
          default: throw Error('不支持的模拟请求：' + request.method);
        }
        emit({ id:request.id, ok:true, result });
      } catch (error) { record('bridge-error', { message:error.message }); emit({ id:request.id, ok:false, error:{ code:'mock_failure', message:error.message } }); }
    },
  } });
  window.__layoutProbe = { state, capture() {
    state.capturing = true; record('capture-delivered');
    emit({ event:'image.loaded', payload:{ image:sampleImage, overlay:{ captureId:state.captureId, desktopBounds:config.desktop, selection:config.selection,
      screens:[{ bounds:{ x:-1920, y:0, width:1920, height:1080 }, workArea:{ x:-1920, y:0, width:1920, height:1040 }, primary:false },
        { bounds:{ x:0, y:-360, width:2560, height:1800 }, workArea:{ x:0, y:-360, width:2560, height:1760 }, primary:true }],
    } } });
  } };
}

function difference(before, after) {
  if (!before || !after) return null;
  return Math.max(...Object.keys(before).map(key => Math.abs(before[key] - after[key])));
}

/** 只汇总采样事实，不给应用额外稳定等待，也不把 resize 后发生跳变解释为通过。 */
function summarize(recording, scenario) {
  const { samples, events } = recording;
  const capture = events.find(event => event.type === 'capture-delivered'), ready = events.find(event => event.type === 'ready-reply');
  const paintRequests = events.filter(event => event.type === 'painted-request');
  const painted = paintRequests.find(event => event.accepted), rejected = paintRequests.filter(event => !event.accepted);
  const finalResize = events.find(event => event.type === 'resize-applied' && event.stage === 'final');
  const presented = samples.filter(sample => sample.label === 'raf' && sample.rootClass?.includes('is-overlay') && sample.rootClass.includes('is-presented'));
  const shifts = [];
  for (let index = 1; index < presented.length; index++) {
    const before = presented[index - 1], after = presented[index];
    const frameCss = difference(before.frame?.css, after.frame?.css), canvasCss = difference(before.canvas?.css, after.canvas?.css);
    const framePhysical = difference(before.frame?.displayPhysical, after.frame?.displayPhysical), railLayout = difference(before.rail?.layout, after.rail?.layout);
    if (Math.max(frameCss || 0, canvasCss || 0, framePhysical || 0, railLayout || 0) > 1)
      shifts.push({ beforeTime:before.time, afterTime:after.time, frameCss, canvasCss, framePhysical, railLayout,
        beforeViewport:before.viewport, afterViewport:after.viewport, beforeFrame:before.frame, afterFrame:after.frame });
  }
  const wrongBitmap = samples.filter(sample => sample.label === 'raf' && sample.rootClass?.includes('is-overlay') && sample.lower?.visible && (sample.lower.bitmap.width !== selection.width || sample.lower.bitmap.height !== selection.height));
  const paintedAtWrongViewport = paintRequests.filter(event => event.accepted && (Math.abs(event.snapshot.viewport.width - event.expectedViewport.width) > 1 || Math.abs(event.snapshot.viewport.height - event.expectedViewport.height) > 1 || Math.abs(event.snapshot.viewport.dpr - event.expectedViewport.scale) >= .001));
  const failedRetry = scenario.resize === 'recheck' && (!rejected.length || !painted || paintRequests.length < 2);
  const presentedBeforeAcceptance = Boolean(recording.presentedAt && (!painted || recording.presentedAt < painted.time));
  const maskFailures = [...presented, ...paintRequests.filter(event => event.accepted).map(event => event.snapshot)].filter(sample => {
    const mask = sample.mask, hole = sample.maskHole;
    return !mask?.visible || !hole || hole.fillRule !== 'evenodd' || Math.abs(mask.css.x) > 1 || Math.abs(mask.css.y) > 1
      || Math.abs(mask.css.width - sample.viewport.width) > 1 || Math.abs(mask.css.height - sample.viewport.height) > 1
      || Object.entries(hole).some(([key, value]) => !['fillRule','attributeWidth','attributeHeight'].includes(key) && !value);
  });
  const imageAssignmentsBeforeReady = recording.imageSourceAssignments.filter(assignment => capture && ready && assignment.startedAt >= capture.time && assignment.startedAt <= ready.time);
  return { readyAt:ready?.time, paintedAt:painted?.time, readyToPaintedMs:painted && ready ? +(painted.time - ready.time).toFixed(3) : null,
    captureToReadyMs:ready && capture ? +(ready.time - capture.time).toFixed(3) : null,
    captureToFirstPresentedMs:recording.presentedAt && capture ? +(recording.presentedAt - capture.time).toFixed(3) : null,
    finalResizeAt:finalResize?.time, paintedBeforeFinalResize:Boolean(painted && finalResize && painted.time < finalResize.time),
    firstPresentedAt:recording.presentedAt, presentedFrameCount:presented.length, presentedShiftCount:shifts.length,
    paintedRequestCount:paintRequests.length, rejectedPaintedCount:rejected.length, failedRetry, presentedBeforeAcceptance,
    paintedAtWrongViewportCount:paintedAtWrongViewport.length,
    imageAssignmentsBeforeReady, imageAssignmentCountMismatch:imageAssignmentsBeforeReady.length !== 1,
    maskFailureCount:maskFailures.length, maskFailureExamples:maskFailures.slice(0, 3),
    visibleWrongBitmapFrames:wrongBitmap.length, wrongBitmapExamples:wrongBitmap.slice(0, 3), shifts,
    paintedViewport:painted?.snapshot.viewport, paintedFrame:painted?.snapshot.frame, lastViewport:samples.at(-1)?.viewport, errors:recording.errors };
}

/** 每组都从真实启动用的 1100×760 开始；显示尺寸仅通过独立无头页面 CDP 修改。 */
async function main() {
  fs.mkdirSync(output, { recursive:true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless:true, ...(process.env.SCREENSHOT_CHROMIUM_EXECUTABLE ? { executablePath:process.env.SCREENSHOT_CHROMIUM_EXECUTABLE } : { channel:'msedge' }) });
  const results = [];
  try {
    for (const scenario of scenarios.filter(item => !process.env.HANDOFF_LAYOUT_CASE || item.name === process.env.HANDOFF_LAYOUT_CASE)) {
      const context = await browser.newContext({ viewport:{ width:1100, height:760 }, deviceScaleFactor:1 });
      const page = await context.newPage(), cdp = await context.newCDPSession(page), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.exposeFunction('__resizeProbe', async ({ metrics }) => cdp.send('Emulation.setDeviceMetricsOverride', {
          width:metrics.width, height:metrics.height, deviceScaleFactor:metrics.dpr, mobile:false, screenWidth:metrics.width, screenHeight:metrics.height,
        }));
        await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
        await page.addInitScript(installProbe, { ...scenario, desktop, selection, finalMetrics, intermediateMetrics });
        await page.goto('http://127.0.0.1:' + server.address().port + '/index.html');
        await page.getByRole('button', { name:'打开图片', exact:true }).waitFor();
        await page.evaluate(() => window.__layoutProbe.capture());
        // 这里的等待仅为了取证；不会延迟或改写应用发出的 painted 消息。
        await page.waitForFunction(() => window.__layoutProbe.state.events.some(event => event.type === 'painted-request'), null, { timeout:8000 });
        await page.waitForFunction(resize => {
          const state = window.__layoutProbe.state;
          return state.afterPresentedFrames >= 32 && !state.resizePending && (resize === 'none' || state.events.some(event => event.type === 'resize-applied' && event.stage === 'final'));
        }, scenario.resize, { timeout:8000 });
        const recording = await page.evaluate(() => window.__layoutProbe.state); recording.errors = errors;
        const summary = summarize(recording, scenario);
        fs.writeFileSync(path.join(output, scenario.name + '.json'), JSON.stringify({ scenario, syntheticOnly:true, desktopAccess:false, summary, recording }, null, 2));
        results.push({ name:scenario.name, ...summary });
        console.log(JSON.stringify({ name:scenario.name, readyToPaintedMs:summary.readyToPaintedMs, paintedBeforeFinalResize:summary.paintedBeforeFinalResize,
          presentedShiftCount:summary.presentedShiftCount, visibleWrongBitmapFrames:summary.visibleWrongBitmapFrames, paintedRequestCount:summary.paintedRequestCount,
          rejectedPaintedCount:summary.rejectedPaintedCount, failedRetry:summary.failedRetry, paintedAtWrongViewportCount:summary.paintedAtWrongViewportCount,
          presentedBeforeAcceptance:summary.presentedBeforeAcceptance, imageAssignmentsBeforeReady:summary.imageAssignmentsBeforeReady,
          maskFailureCount:summary.maskFailureCount, paintedViewport:summary.paintedViewport, lastViewport:summary.lastViewport }));
      } catch (error) { results.push({ name:scenario.name, error:error.message }); console.error('ERROR ' + scenario.name + ': ' + error.message); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); server.close(); }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ syntheticOnly:true, desktopAccess:false, desktop, selection, initialViewport:{ width:1100, height:760, dpr:1 }, finalMetrics, results }, null, 2));
  // 探针保留缺陷为失败状态，便于后续用同一场景验证修复；不扩大等待门槛掩盖位移。
  if (results.some(result => result.error || result.errors?.length || result.presentedShiftCount || result.visibleWrongBitmapFrames || result.paintedBeforeFinalResize || result.failedRetry || result.presentedBeforeAcceptance || result.paintedAtWrongViewportCount || result.imageAssignmentCountMismatch || result.maskFailureCount)) process.exitCode = 1;
}
main().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
