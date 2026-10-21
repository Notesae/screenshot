// 独立无头页面只使用合成图片和内存桥；不读取桌面、剪贴板、真实窗口或网络服务。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.SCREENSHOT_PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'editor/dist');
const evidence = path.join(root, 'artifacts/qa/annotation-drawing');
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml' };
const server = http.createServer((request, response) => {
  const file = path.resolve(dist, '.' + new URL(request.url, 'http://localhost').pathname);
  if (!file.startsWith(dist + path.sep)) { response.writeHead(403).end(); return; }
  const target = fs.existsSync(file) && fs.statSync(file).isDirectory() ? path.join(file, 'index.html') : file;
  if (!fs.existsSync(target)) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
  fs.createReadStream(target).pipe(response);
});

/** 用浏览器 canvas 生成测试底图；模拟宿主仅提供启动、保存状态和截图交接消息。 */
function installHost() {
  const listeners = new Set();
  const state = { requests:[], holdReady:false, holdPainted:false, captureId:null, cropRequests:0, readyFrames:0 };
  const emit = data => listeners.forEach(listener => listener({ data }));
  const canvas = document.createElement('canvas'); canvas.width = 560; canvas.height = 300;
  const context = canvas.getContext('2d'); context.fillStyle = '#e5e9ee'; context.fillRect(0, 0, 560, 300);
  context.fillStyle = '#526071'; context.font = '20px sans-serif'; context.fillText('合成图片 · 手动绘制回归', 24, 32);
  const sample = { dataUrl:canvas.toDataURL(), name:'合成图片.png', width:560, height:300 };
  Object.assign(window.chrome ||= {}, { webview: {
    addEventListener:(_name, listener) => listeners.add(listener),
    removeEventListener:(_name, listener) => listeners.delete(listener),
    postMessage:async request => {
      state.requests.push(request.method);
      try {
        let result = {};
        switch (request.method) {
          case 'app.updateReady': result = { ready:true }; break;
          case 'settings.read': result = { providers:[], defaultProviderId:null }; break;
          case 'capture.settings': result = { backend:'wgc' }; break;
          case 'ocr.status': result = { available:false, modelVersion:'synthetic', message:'未调用 OCR', missingFiles:[] }; break;
          case 'recovery.list': result = { items:[] }; break;
          case 'recovery.usage': result = { documents:0, referencedAssetBytes:0, maxDocuments:100, maxAssetBytes:100000 }; break;
          case 'recovery.save': result = { saved:true, stale:false }; break;
          case 'document.preserve': result = { saved:true }; break;
          case 'presentation.ready':
            if (state.holdReady) await new Promise(resolve => state.releaseReady = resolve);
            state.readyFrames = 0;
            requestAnimationFrame(function countFrames() { state.readyFrames++; if (!state.paintedObservation) requestAnimationFrame(countFrames); });
            result = { accepted:request.payload.captureId === state.captureId, awaitingPaint:true, presentation:'overlay', captureId:state.captureId }; break;
          case 'presentation.painted': {
            const visible = selector => {
              const element = document.querySelector(selector); if (!element) return false;
              for (let current = element; current; current = current.parentElement) {
                const style = getComputedStyle(current);
                if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
              }
              return true;
            };
            state.paintedObservation = { captureId:request.payload.captureId, readyFrames:state.readyFrames,
              preparing:Boolean(document.querySelector('.is-preparing')), canvasVisible:visible('.clay-canvas-fixed'), selectionVisible:visible('.clay-capture-selection'), railVisible:visible('.clay-rail') };
            if (state.holdPainted) await new Promise(resolve => state.releasePainted = resolve);
            result = { accepted:request.payload.captureId === state.captureId, presentation:'overlay', captureId:state.captureId }; break;
          }
          case 'capture.adjust': state.cropRequests++; throw Error('绘制标注不应裁剪截图选区');
          default: throw Error('不支持的模拟请求：' + request.method);
        }
        emit({ id:request.id, ok:true, result });
      } catch (error) { emit({ id:request.id, ok:false, error:{ code:'mock_failure', message:error.message } }); }
    },
  } });
  window.__drawingHost = { state, capture() {
    state.captureId = 'synthetic-drawing-' + Date.now();
    emit({ event:'image.loaded', payload:{ image:sample, overlay:{ captureId:state.captureId,
      desktopBounds:{ x:0, y:0, width:1280, height:800 }, selection:{ x:300, y:180, width:560, height:300 },
      screens:[{ bounds:{ x:0, y:0, width:1280, height:800 }, workArea:{ x:0, y:0, width:1280, height:760 }, primary:true }],
    } } });
  } };
}

async function annotations(page) { return page.evaluate(() => window.screenshotPrepareUpdate().document.editor.annotations); }
async function click(page, name) { await page.getByRole('button', { name, exact:true }).click(); }
async function settle(page) { await page.waitForFunction(() => !window.screenshotPrepareUpdate?.().error && !document.querySelector('button[aria-label="保存 PNG"]').disabled); }

/** 坐标均相对合成画布，输入只发送给 headless 页面的虚拟指针。 */
async function draw(page, from, to) {
  const box = await page.locator('.upper-canvas').boundingBox();
  assert.ok(box, '合成画布必须存在');
  await page.mouse.move(box.x + from.x, box.y + from.y); await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps:8 }); await page.mouse.up();
}

/** 记录布局属性而非动画后的包围盒，退出时允许缩放，但浮卡不能更换停靠位置。 */
async function closeWithoutJump(page) {
  const card = page.locator('.clay-card');
  await card.waitFor();
  await card.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  const before = await card.evaluate(element => ({ left:element.style.left, top:element.style.top, width:element.style.width, maxHeight:element.style.maxHeight }));
  const samples = await page.evaluate(async () => {
    const card = document.querySelector('.clay-card');
    const samples = [];
    card.querySelector('button[aria-label="关闭浮卡"]').click();
    for (let frame = 0; frame < 5; frame++) {
      await new Promise(requestAnimationFrame);
      if (!card.isConnected) break;
      samples.push({ left:card.style.left, top:card.style.top, width:card.style.width, maxHeight:card.style.maxHeight });
    }
    return samples;
  });
  assert.ok(samples.length, '退出动画必须实际经历至少一帧');
  for (const position of samples) assert.deepEqual(position, before, '浮卡关闭时必须保留最后布局，不能先跳到右上角');
  await card.waitFor({ state:'detached' });
}

/** 断言实际模型的范围；标注的描边会增加约 3px 边界，允许 4px 几何误差。 */
function near(actual, expected, message, tolerance = 4) { assert.ok(Math.abs(actual - expected) <= tolerance, message + ': ' + actual + ' ≠ ' + expected); }

/** 只按文档公开的几何字段还原端点；不读取 Fabric 对象、事件或私有控制点。 */
function endpoints(annotation) {
  const radians = annotation.angle * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
  const width = annotation.width * annotation.scaleX, height = annotation.height * annotation.scaleY;
  const center = { x:annotation.left + cosine * (width + 3) / 2 - sine * (height + 3) / 2, y:annotation.top + sine * (width + 3) / 2 + cosine * (height + 3) / 2 };
  return { tail:{ x:center.x - cosine * width / 2, y:center.y - sine * width / 2 }, head:{ x:center.x + cosine * width / 2, y:center.y + sine * width / 2 } };
}

function nearPoint(actual, expected, message) { near(actual.x, expected.x, message + ' X'); near(actual.y, expected.y, message + ' Y'); }

const cases = [];
cases.push({ name:'ready-gate', async run(page) {
  await page.evaluate(() => { window.__drawingHost.state.holdReady = true; window.__drawingHost.state.holdPainted = true; window.__drawingHost.capture(); });
  await page.waitForFunction(() => window.__drawingHost.state.requests.includes('presentation.ready'));
  for (const selector of ['.clay-canvas-fixed', '.clay-capture-selection', '.clay-rail']) {
    const visible = await page.locator(selector).evaluate(element => {
      for (let current = element; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
      }
      return true;
    });
    assert.equal(visible, false, selector + ' 在原生交接确认前必须隐藏，避免两个选区叠加闪动');
  }
  await page.evaluate(() => window.__drawingHost.state.releaseReady());
  await page.waitForFunction(() => typeof window.__drawingHost.state.releasePainted === 'function');
  const observed = await page.evaluate(() => window.__drawingHost.state.paintedObservation);
  assert.equal(observed.captureId, await page.evaluate(() => window.__drawingHost.state.captureId), '第二阶段确认必须属于当前截图');
  assert.ok(observed.readyFrames >= 2, '解除原生遮挡之前必须完成至少两个浏览器绘制帧');
  assert.equal(observed.preparing, true, '第二阶段先恢复底图绘制，再等待宿主释放遮挡');
  assert.equal(observed.canvasVisible, true, '报告绘制完成时当前画布必须可绘制');
  assert.equal(observed.selectionVisible, true, '报告绘制完成时当前选区装饰必须就绪');
  assert.equal(observed.railVisible, false, '宿主第二阶段未确认时工具栏不能提前入场');
  assert.equal(await page.locator('.is-presented').count(), 0, 'painted 回复被挂起时不能进入可交互阶段');
  await page.evaluate(() => window.__drawingHost.state.releasePainted());
  await page.waitForSelector('.is-presented');
  assert.equal(await page.locator('.clay-canvas-fixed').isVisible(), true);
} });

for (const [type, label] of [['rect','矩形标注'], ['arrow','箭头标注'], ['highlight','高亮标注'], ['cover','实色遮盖']]) {
  cases.push({ name:'draw-' + type, async run(page) {
    await click(page, label);
    assert.equal((await annotations(page)).length, 0, '选择工具只应待绘制，不能自动插入' + label);
    assert.equal(await page.getByRole('button', { name:label, exact:true }).getAttribute('aria-pressed'), 'true', '待绘制工具需明确显示选中状态');
    await draw(page, { x:280, y:210 }, { x:80, y:80 });
    await page.waitForFunction(() => window.screenshotPrepareUpdate().document.editor.annotations.length === 1);
    const [object] = await annotations(page);
    assert.equal(object.type, type);
    if (type !== 'arrow') {
      near(object.left, 80, label + '左边界'); near(object.top, 80, label + '上边界');
      near(object.width * object.scaleX, 200, label + '手绘宽度'); near(object.height * object.scaleY, 130, label + '手绘高度');
    } else { const points = endpoints(object); nearPoint(points.tail, { x:280, y:210 }, '反向箭头的按下点为尾'); nearPoint(points.head, { x:80, y:80 }, '反向箭头的松手点为头'); }
    assert.equal(await page.evaluate(() => window.__drawingHost.state.cropRequests), 0, '绘制不能误触发移动截图选区');
    await closeWithoutJump(page);
    await click(page, '撤销'); await page.waitForFunction(() => window.screenshotPrepareUpdate().document.editor.annotations.length === 0);
    await click(page, '重做'); await page.waitForFunction(() => window.screenshotPrepareUpdate().document.editor.annotations.length === 1);
    assert.equal((await annotations(page))[0].id, object.id, '一次绘制只形成一个历史操作，重做保留对象身份');
  } });
}

cases.push({ name:'text-click', async run(page) {
  await click(page, '文字标注');
  assert.equal((await annotations(page)).length, 0, '选择文字工具也不能自动放入文字');
  await draw(page, { x:100, y:100 }, { x:100, y:100 });
  // 新文字立即进入输入状态；结束编辑后再读取受保护的公开导出快照。
  await page.waitForFunction(() => document.activeElement instanceof HTMLTextAreaElement);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.screenshotPrepareUpdate().document.editor.annotations.length === 1);
  const [text] = await annotations(page); assert.equal(text.type, 'text');
  near(text.left, 100, '文字从点击位置开始'); near(text.top, 100, '文字从点击位置开始');
  assert.equal(await page.evaluate(() => window.__drawingHost.state.cropRequests), 0);
  await closeWithoutJump(page);
} });

cases.push({ name:'property-close-position', async run(page) {
  await click(page, '矩形标注');
  // 单独复现退出布局缺陷：同时兼容旧版的立即插入和新版的手绘，以便分别记录红灯证据。
  if (!(await annotations(page)).length) await draw(page, { x:90, y:90 }, { x:260, y:190 });
  await page.getByRole('region', { name:'标注属性', exact:true }).waitFor();
  await closeWithoutJump(page);
} });

cases.push({ name:'arrow-endpoints', async run(page) {
  await click(page, '箭头标注');
  assert.equal((await annotations(page)).length, 0);
  const tail = { x:80, y:90 }, head = { x:270, y:90 }, movedHead = { x:310, y:180 }, movedTail = { x:100, y:180 };
  await draw(page, tail, head);
  await page.waitForFunction(() => window.screenshotPrepareUpdate().document.editor.annotations.length === 1);
  let points = endpoints((await annotations(page))[0]); nearPoint(points.tail, tail, '初始箭尾'); nearPoint(points.head, head, '初始箭头');
  await draw(page, head, movedHead);
  await page.waitForFunction(() => window.screenshotPrepareUpdate().document.editor.annotations[0].angle > 5);
  points = endpoints((await annotations(page))[0]); nearPoint(points.tail, tail, '只拖头时尾不动'); nearPoint(points.head, movedHead, '只拖头到落点');
  await draw(page, tail, movedTail);
  await page.waitForFunction(() => Math.abs(window.screenshotPrepareUpdate().document.editor.annotations[0].angle) < 5);
  points = endpoints((await annotations(page))[0]); nearPoint(points.tail, movedTail, '只拖尾到落点'); nearPoint(points.head, movedHead, '只拖尾时头不动');
  assert.equal(await page.evaluate(() => window.__drawingHost.state.cropRequests), 0, '端点调整不能误触发截图范围移动');
  await click(page, '撤销'); await settle(page);
  points = endpoints((await annotations(page))[0]); nearPoint(points.tail, tail, '撤销尾部调整'); nearPoint(points.head, movedHead, '撤销保留头部调整');
  await click(page, '撤销'); await settle(page);
  points = endpoints((await annotations(page))[0]); nearPoint(points.tail, tail, '撤销头部调整后尾'); nearPoint(points.head, head, '撤销头部调整后头');
} });

cases.push({ name:'rect-corner', async run(page) {
  await click(page, '矩形标注');
  assert.equal((await annotations(page)).length, 0);
  await draw(page, { x:80, y:80 }, { x:240, y:180 });
  await page.waitForFunction(() => window.screenshotPrepareUpdate().document.editor.annotations.length === 1);
  await draw(page, { x:240, y:180 }, { x:285, y:210 });
  await page.waitForFunction(() => window.screenshotPrepareUpdate().document.editor.annotations[0].width * window.screenshotPrepareUpdate().document.editor.annotations[0].scaleX > 195);
  const [rectangle] = await annotations(page);
  near(rectangle.left, 80, '拖右下角时左边界保持'); near(rectangle.top, 80, '拖右下角时上边界保持');
  near(rectangle.width * rectangle.scaleX, 205, '矩形通过角手柄改宽', 7); near(rectangle.height * rectangle.scaleY, 130, '矩形通过角手柄改高', 7);
  const right = rectangle.left + rectangle.width * rectangle.scaleX + 3, middle = rectangle.top + (rectangle.height * rectangle.scaleY + 3) / 2;
  await draw(page, { x:right, y:middle }, { x:right + 30, y:middle });
  await page.waitForFunction(width => window.screenshotPrepareUpdate().document.editor.annotations[0].width * window.screenshotPrepareUpdate().document.editor.annotations[0].scaleX > width + 20, rectangle.width * rectangle.scaleX);
  const [widened] = await annotations(page);
  near(widened.height * widened.scaleY, rectangle.height * rectangle.scaleY, '拖边手柄只调整对应方向');
  assert.equal(await page.evaluate(() => window.__drawingHost.state.cropRequests), 0);
} });

cases.push({ name:'cancel-and-tiny-drag', async run(page) {
  await click(page, '矩形标注');
  assert.equal((await annotations(page)).length, 0);
  await page.keyboard.press('Escape');
  assert.notEqual(await page.getByRole('button', { name:'矩形标注', exact:true }).getAttribute('aria-pressed'), 'true', 'Escape 必须退出待绘制状态');
  await click(page, '箭头标注'); await draw(page, { x:120, y:100 }, { x:121, y:101 });
  assert.equal((await annotations(page)).length, 0, '不到最小绘制距离不应留下意外标注');
  assert.equal(await page.evaluate(() => window.__drawingHost.state.cropRequests), 0);
} });

cases.push({ name:'cancel-live-drawing', async run(page) {
  await click(page, '矩形标注');
  assert.equal((await annotations(page)).length, 0);
  const box = await page.locator('.upper-canvas').boundingBox();
  await page.mouse.move(box.x + 90, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x + 220, box.y + 180, { steps:4 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  assert.equal((await annotations(page)).length, 0, 'Escape 取消正在绘制的预览，不能在松手后提交');
  assert.equal(await page.evaluate(() => window.__drawingHost.state.cropRequests), 0, '取消绘制不能退化为移动截图');
} });

/** 每个场景独立新建模拟页面；多项失败一起报告，方便在修复前保留明确的红灯证据。 */
async function main() {
  fs.mkdirSync(evidence, { recursive:true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless:true, ...(process.env.SCREENSHOT_CHROMIUM_EXECUTABLE ? { executablePath:process.env.SCREENSHOT_CHROMIUM_EXECUTABLE } : { channel:'msedge' }) });
  const results = [];
  try {
    for (const scenario of cases.filter(item => !process.env.ANNOTATION_CASE || item.name === process.env.ANNOTATION_CASE)) {
      const context = await browser.newContext({ viewport:{ width:1280, height:800 }, deviceScaleFactor:1 });
      const page = await context.newPage(); page.setDefaultTimeout(7000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
        await page.addInitScript(installHost); await page.goto('http://127.0.0.1:' + server.address().port + '/index.html');
        await page.getByRole('button', { name:'打开图片', exact:true }).waitFor();
        if (scenario.name !== 'ready-gate') {
          await page.evaluate(() => window.__drawingHost.capture()); await page.waitForSelector('.is-presented'); await settle(page);
          await closeWithoutJump(page);
        }
        await scenario.run(page); assert.deepEqual(errors, [], '无头页面不得报错');
        results.push({ name:scenario.name, passed:true }); console.log('PASS ' + scenario.name);
      } catch (error) {
        results.push({ name:scenario.name, passed:false, message:error.message }); console.error('FAIL ' + scenario.name + ': ' + error.message);
        await page.screenshot({ path:path.join(evidence, scenario.name + '-failed.png') }).catch(() => {});
      } finally { await context.close(); }
    }
  } finally { await browser.close(); server.close(); }
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify({ syntheticOnly:true, desktopAccess:false, scenarios:results }, null, 2));
  if (results.some(result => !result.passed)) process.exitCode = 1;
}
main().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
