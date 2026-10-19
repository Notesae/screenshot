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
    window.__messages = []; window.__heldMethods = []; window.__holdMethod = null; window.__recoveries = {}; window.__captureBackend = 'gdi';
    window.__heldDecodes = []; window.__heldReady = []; window.__holdReady = false; window.__currentCaptureId = null; window.__hotkey={enabled:true,ctrl:true,alt:false,shift:true,key:'S'};window.__snapSettings={snapWindows:true,windowArea:'window'};window.__providerRevision='a'.repeat(64);
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
        if (request.method === window.__holdMethod) { window.__heldMethods.push(request); return; }
        if (request.method === 'presentation.ready' && window.__holdReady) { window.__heldReady.push(request); return; }
        const results = { 'settings.read': { providers: [{ id: 'synthetic', name: '模拟服务', kind: 'ollama', model: 'test', baseUrl: 'http://127.0.0.1:0', hasApiKey: false, revision:window.__providerRevision }], defaultProviderId: 'synthetic' }, 'image.open': window.__openImage, 'image.copy': { copied: true }, 'text.copy': { copied:true }, 'image.save': { saved: true }, 'project.save': { saved: true }, 'ai.ocr': { text: '仅用于无头测试的合成文字' } };
        let result = results[request.method];
        if (request.method === 'ocr.status') result = { available: true, modelVersion: 'synthetic', message: 'synthetic only', missingFiles: [] };
        if (request.method === 'ai.cancel') result={cancelled:true};
        if (request.method === 'ocr.cancel') result = { cancelled: true };
        if (request.method === 'ocr.local') result = { modelVersion: 'synthetic', imageWidth: 80, imageHeight: 60, blocks: [{ id: 'block-a', polygon: [{x:1,y:1},{x:38,y:1},{x:38,y:20},{x:1,y:20}], text:'<b>原文</b>', confidence:.9, order:0 }, { id:'block-b', polygon:[{x:42,y:22},{x:78,y:22},{x:78,y:45},{x:42,y:45}], text:'second', confidence:null, order:1 }] };
        if (request.method === 'ai.translate') {
          if(window.__failBlockB&&request.payload.text==='second'&&!window.__failedBlockB){window.__failedBlockB=true;setTimeout(()=>window.__emit({id:request.id,ok:false,error:{code:'provider_rate_limited',message:'synthetic rate limit'}}),0);return;}

          if(window.__chunkMode && request.payload.text.startsWith('乙') && !window.__failedChunk){window.__failedChunk=true;setTimeout(()=>window.__emit({id:request.id,ok:false,error:{code:'provider_rate_limited',message:'模拟429限流'}}),0);return;}
          result = { text:window.__chunkMode?'translated-'+request.payload.text.slice(0,1):'synthetic translation' };
        }
        if(request.method==='ai.test')result={text:'PROBE_OK'};
        if(request.method==='ai.usage')result={items:[]};
        if (request.method === 'capture.settings') result = { backend:window.__captureBackend,...window.__snapSettings };
        if(request.method==='capture.monitors')result={monitors:[{handle:'9007199254740993',label:'Synthetic left',bounds:{x:-1920,y:-240,width:1920,height:1080},primary:false,current:true},{handle:'2',label:'Synthetic right',bounds:{x:0,y:0,width:2560,height:1440},primary:true,current:false}]};
        if(request.method==='capture.current'||request.method==='capture.screen')result={cancelled:true};
        if(request.method==='hotkey.read')result={binding:window.__hotkey,registered:true,applied:true,message:'synthetic current'};
        if(request.method==='hotkey.configure'){const conflict=request.payload.key==='Q';if(!conflict)window.__hotkey=request.payload;result={binding:window.__hotkey,registered:window.__hotkey.enabled,applied:!conflict,message:conflict?'synthetic conflict; original retained':'synthetic saved'};}

        if (request.method === 'capture.configure') { window.__captureBackend = request.payload.backend;for(const name of ['snapWindows','windowArea'])if(request.payload[name]!==undefined)window.__snapSettings[name]=request.payload[name]; result = { backend:window.__captureBackend,...window.__snapSettings }; }
        if (request.method === 'recovery.save') {
          const existing = window.__recoveries[request.payload.documentId], stale = Boolean(existing && existing.revision >= request.payload.revision);
          if (!stale) window.__recoveries[request.payload.documentId] = request.payload;
          result = { saved:!stale, stale };
        }
        if (request.method === 'recovery.list') result = { items:Object.values(window.__recoveries).map(item => ({ documentId:item.documentId, revision:item.revision, name:item.document.image?.name || 'synthetic text', updatedAtUtc:'2026-10-19T00:00:00Z' })) };
        if(request.method==='recovery.usage') result={documents:Object.keys(window.__recoveries).length,referencedAssetBytes:128,maxDocuments:20,maxAssetBytes:268435456};
        if(request.method==='recovery.deleteMany'){let deleted=0;for(const id of request.payload.documentIds){if(window.__recoveries[id]){delete window.__recoveries[id];deleted++;}}result={deleted,cleanupPending:false};}
        if (request.method === 'recovery.load') result = window.__recoveries[request.payload.documentId];
        if (request.method === 'recovery.delete') { delete window.__recoveries[request.payload.documentId]; result = { deleted:true }; }

        if (request.method.startsWith('presentation.')) {
          const active = window.__currentCaptureId;
          const accepted = active ? request.payload.captureId === active : request.payload.captureId === undefined;
          const target = request.method === 'presentation.ready' ? 'overlay' : request.method === 'presentation.workbench' ? 'workbench' : 'hidden';
          if (accepted && target !== 'overlay') window.__currentCaptureId = null; window.__hotkey={enabled:true,ctrl:true,alt:false,shift:true,key:'S'};window.__snapSettings={snapWindows:true,windowArea:'window'};window.__providerRevision='a'.repeat(64);
          result = { accepted, presentation: accepted ? target : active ? 'overlay' : 'workbench', captureId: window.__currentCaptureId };
        }
        setTimeout(() => window.__emit(result ? { id: request.id, ok: true, result } : { id: request.id, ok: false, error: { code: 'MOCK', message: '测试未模拟此操作' } }), ['image.copy','project.save'].includes(request.method)?75:0);
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
  if(!await page.getByRole('button',{name:'完整工作台',exact:true}).isVisible())await page.getByRole('button', { name: '更多与完整工作台', exact: true }).click();
  await page.getByRole('button', { name: '完整工作台', exact: true }).click(); await page.locator('.app').waitFor();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('.top-actions button')).some(b=>b.textContent.trim()==='保存项目'&&!b.disabled));
}
async function copied(page) {
  const count = await page.evaluate(() => window.__messages.filter(message => message.method === 'image.copy').length);
  await page.getByRole('button', { name: '复制', exact: true }).click();
  await page.waitForFunction(previous => window.__messages.filter(message => message.method === 'image.copy').length > previous, count);
  // 请求入队早于mock回包；等待复制按钮解除本地忙状态，不能把其当成复制已完成。
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('.compact-toolbar button')).some(b=>b.textContent.trim()==='复制'&&!b.disabled));
  return page.evaluate(() => window.__messages.filter(message => message.method === 'image.copy').at(-1).payload.dataUrl);
}
async function escape(page, target) { await (target || page.locator('.compact-toolbar')).dispatchEvent('keydown', { key: 'Escape', bubbles: true }); }
async function imagePixel(page, dataUrl, x = 30, y = 25) {
  return page.evaluate(({ dataUrl, x, y }) => new Promise(resolve => { const image = new Image(); image.onload = () => { const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); resolve({ width: image.width, height: image.height, pixel: [...ctx.getImageData(x, y, 1, 1).data] }); }; image.src = dataUrl; }), { dataUrl, x, y });
}
async function saveDocument(page) {
  const count = await page.evaluate(() => window.__messages.filter(message => message.method === 'project.save').length);
  await page.getByRole('button', { name: await page.locator('.app').count()?'保存项目':'保存可编辑项目', exact: true }).click();
  await page.waitForFunction(previous => window.__messages.filter(message => message.method === 'project.save').length > previous, count);
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>['保存项目','保存可编辑项目'].includes(b.textContent.trim())&&!b.disabled));
  return page.evaluate(() => window.__messages.filter(message => message.method === 'project.save').at(-1).payload.document);
}
async function waitCanvas(page, width, height) { await page.waitForFunction(({width,height}) => { const canvas = document.querySelector('.lower-canvas'); return canvas && canvas.width === width && canvas.height === height; }, { width, height }); }
// E1 像素与历史仅使用合成素材，所有 native 调用均为页面内存 mock。
async function e1Checks(page, source) {
  await capture(page, 'e1-history'); await page.locator('.compact-toolbar').waitFor(); await waitCanvas(page, 80, 60);
  assert.equal(await page.getByRole('button', { name: '撤销', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '更多与完整工作台', exact: true }).click();
  await page.getByRole('button', { name: '遮盖', exact: true }).click(); await escape(page);
  // CDP 输入仅发送到本脚本新建的 headless 页面，不移动系统鼠标或窗口焦点。
  await page.setViewportSize({ width: 4480, height: 1440 });
  await page.waitForFunction(() => Math.abs(document.querySelector('.compact-canvas').getBoundingClientRect().x - 420) < .1);
  const bounds = await page.locator('.compact-canvas').boundingBox();
  await page.mouse.move(bounds.x + 40, bounds.y + 27); await page.mouse.down(); await page.mouse.move(bounds.x + 48, bounds.y + 33, { steps: 5 }); await page.mouse.up();
  await page.getByRole('button', { name: '更多与完整工作台', exact: true }).click();
  let moved = await saveDocument(page); closeEnough(moved.editor.annotations[0].left, 24); closeEnough(moved.editor.annotations[0].top, 18);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); moved = await saveDocument(page); closeEnough(moved.editor.annotations[0].left, 16); closeEnough(moved.editor.annotations[0].top, 12);
  await escape(page);
  await page.setViewportSize({ width: 1120, height: 360 });
  await page.waitForFunction(() => Math.abs(document.querySelector('.compact-canvas').getBoundingClientRect().x - 105) < .1);
  assert.deepEqual((await imagePixel(page, await copied(page))).pixel, [48, 51, 46, 255]);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); assert.equal(await copied(page), source);
  await page.getByRole('button', { name: '重做', exact: true }).click(); assert.deepEqual((await imagePixel(page, await copied(page))).pixel, [48, 51, 46, 255]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByRole('button', { name: '更多与完整工作台', exact: true }).click();
  await page.getByRole('button', { name: '箭头', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '重做', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '高亮', exact: true }).click(); await page.getByRole('button', { name: '遮盖', exact: true }).click();
  await page.getByLabel('标注颜色', { exact: true }).fill('#112233'); await page.getByRole('button', { name: '应用到选中标注', exact: true }).click();
  const annotated = await saveDocument(page);
  assert.equal(annotated.schemaVersion, 2); assert.deepEqual(annotated.editor.annotations.map(a => a.type), ['arrow', 'highlight', 'cover']); assert.equal(annotated.editor.annotations.at(-1).color, '#112233');
  await escape(page); assert.deepEqual((await imagePixel(page, await copied(page))).pixel, [17, 34, 51, 255]);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); assert.deepEqual((await imagePixel(page, await copied(page))).pixel, [48, 51, 46, 255]);
  checks.push('new annotations serialize safely; cover PNG is opaque; properties undo and new edits clear redo');
  await e1Transforms(page, source);
}
// 原图被裁为右侧绿色区域，再缩放；输出和OCR均不得带回裁掉的红色区域。
async function e1Transforms(page, source) {
  await capture(page, 'e1-transform'); await waitCanvas(page, 80, 60);
  await page.getByRole('button', { name: '更多与完整工作台', exact: true }).click();
  for (const [key, value] of Object.entries({ x: 40, y: 10, width: 40, height: 40 })) await page.getByLabel(`裁剪${key}`, { exact: true }).fill(String(value));
  await page.getByRole('button', { name: '应用裁剪', exact: true }).click(); await waitCanvas(page, 40, 40);
  const cropFrame = await page.locator('.compact-canvas').boundingBox(); closeEnough(cropFrame.x, 115); closeEnough(cropFrame.y, 52.5);
  let exported = await imagePixel(page, await copied(page), 10, 10); assert.equal(exported.width, 40); assert.equal(exported.height, 40); assert.deepEqual(exported.pixel, [68, 136, 85, 255]);
  await page.getByLabel('缩放宽度', { exact: true }).fill('20'); await page.getByRole('button', { name: '应用缩放', exact: true }).click(); await waitCanvas(page, 20, 20);
  exported = await imagePixel(page, await copied(page), 10, 10); assert.equal(exported.width, 20); assert.equal(exported.height, 20);
  const transformed = await saveDocument(page); assert.equal(transformed.image.dataUrl, source); assert.deepEqual(transformed.editor.resize, { width: 20, height: 20 });
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await waitCanvas(page, 40, 40);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await waitCanvas(page, 80, 60); assert.equal(await copied(page), source);
  await page.getByRole('button', { name: '重做', exact: true }).click(); await waitCanvas(page, 40, 40);
  await page.getByRole('button', { name: '重做', exact: true }).click(); await waitCanvas(page, 20, 20); await escape(page);
  await page.getByRole('button', { name: 'OCR', exact: true }).click(); await page.getByLabel('识别方式', { exact:true }).selectOption('cloud'); await page.getByRole('button', { name:'云端识别文字', exact:true }).click(); await page.waitForFunction(() => window.__messages.some(message => message.method === 'ai.ocr'));
  const payload = await page.evaluate(() => window.__messages.filter(message => message.method === 'ai.ocr').at(-1).payload.imageDataUrl);
  exported = await imagePixel(page, payload, 10, 10); assert.equal(exported.width, 20); assert.equal(exported.height, 20); assert.deepEqual(exported.pixel, [68, 136, 85, 255]);
  await page.waitForFunction(() => document.querySelector('#compact-text')?.value === '仅用于无头测试的合成文字');
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await waitCanvas(page, 20, 20); assert.equal(await page.locator('#compact-text').inputValue(), '');
  const prevented = await page.locator('#compact-text').evaluate(input => { const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }); input.dispatchEvent(event); return event.defaultPrevented; });
  assert.equal(prevented, false); await waitCanvas(page, 20, 20);
  await page.locator('.compact-toolbar').dispatchEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }); await waitCanvas(page, 40, 40);
  await page.locator('.compact-toolbar').dispatchEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true }); await waitCanvas(page, 20, 20);
  checks.push('crop/resize retain source and overlay anchor; undo/redo restore dimensions; OCR sees only current crop and its result is undoable');
}

// 验证真正进入两种 OCR 桥接的 PNG 像素，而非仅验证遮盖模型。
async function privacyChecks(page) {
  await capture(page, 'privacy-cover'); await waitCanvas(page,80,60);
  await page.getByRole('button',{name:'更多与完整工作台',exact:true}).click();
  await page.getByRole('button',{name:'遮盖',exact:true}).click();
  const saved = await saveDocument(page);
  await page.getByRole('button',{name:'OCR',exact:true}).click();
  for (const engine of ['local','cloud']) {
    await page.getByLabel('识别方式',{exact:true}).selectOption(engine);
    const method = engine === 'local' ? 'ocr.local' : 'ai.ocr';
    const count = await page.evaluate(method=>window.__messages.filter(m=>m.method===method).length,method);
    await page.getByRole('button',{name:engine==='local'?'本地识别文字':'云端识别文字',exact:true}).click();
    await page.waitForFunction(({method,count})=>window.__messages.filter(m=>m.method===method).length>count,{method,count});
    const data = await page.evaluate(method=>window.__messages.filter(m=>m.method===method).at(-1).payload.imageDataUrl,method);
    assert.deepEqual((await imagePixel(page,data,30,20)).pixel,[48,51,46,255]);
    assert.deepEqual((await imagePixel(page,saved.image.dataUrl,30,20)).pixel,[204,68,34,255]);
    await page.waitForFunction(()=>!document.querySelector('.compact-progress'));
    if(engine==='local') {
      // 本地结果不切模式；云端结果进入文字卡片，因此放在最后。
      assert.equal(await page.getByRole('textbox',{name:'可校对的译文',exact:true}).inputValue(),'');
    }
  }
  const count=await page.evaluate(()=>window.__messages.filter(m=>m.method==='ai.ocr').length);
  await page.getByRole('button',{name:'云端识别文字',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'无法对应原图'}).waitFor();
  assert.equal(await page.evaluate(()=>window.__messages.filter(m=>m.method==='ai.ocr').length),count);
  checks.push('local/cloud OCR payload pixels contain opaque covers while project retains source; ambiguous reflow covers block upload');
}

// E2/S1 只模拟桥接，不访问真实模型、数据库或外部服务。
async function e2Checks(page) {
  await capture(page, 'e2-local'); await waitCanvas(page, 80, 60);
  await page.getByRole('button', { name: 'OCR', exact: true }).click();
  await page.getByLabel('识别方式', { exact: true }).selectOption('local');
  await page.getByRole('button', { name: '本地识别文字', exact: true }).click();
  await page.getByRole('group', { name: 'OCR 源框', exact: true }).waitFor();
  assert.equal(await page.locator('#compact-text').inputValue(), '<b>原文</b>\nsecond');
  assert.equal(await page.locator('.text-tools b,.text-tools img').count(), 0);
  await page.getByRole('button', { name: '选择文字块 2', exact: true }).click();
  await page.getByRole('textbox', { name: '当前块校正', exact: true }).fill('校正第二块');
  await page.getByRole('button', { name: '上移', exact: true }).click();
  assert.equal(await page.locator('#compact-text').inputValue(), '校正第二块\n<b>原文</b>');
  await page.getByRole('button', { name: '更多与完整工作台', exact: true }).click();
  const saved = await saveDocument(page);
  assert.equal(saved.editor.ocr.blocks[0].id, 'block-b'); assert.equal(saved.editor.ocr.blocks[0].originalText, 'second');
  await page.getByRole('button', { name: 'OCR', exact: true }).click();
  await page.evaluate(() => { window.__holdMethod = 'ai.translate'; });
  await page.getByRole('button', { name: '翻译', exact: true }).last().click();
  await page.waitForFunction(() => window.__heldMethods.length === 1);
  await page.getByRole('textbox', { name: '当前块校正', exact: true }).fill('翻译期间的新校正');
  await page.evaluate(() => { const request = window.__heldMethods.shift(); window.__holdMethod = null; window.__emit({ id:request.id, ok:true, result:{text:'stale translation'} }); });
  await page.waitForFunction(() => !document.querySelector('.compact-progress'));
  assert.equal(await page.getByRole('textbox', { name: '可校对的译文', exact: true }).inputValue(), '');
  await page.evaluate(() => { window.__holdMethod = 'ocr.local'; });
  await page.getByRole('button', { name: '本地识别文字', exact: true }).click(); await page.waitForFunction(() => window.__heldMethods.length === 1);
  await page.getByRole('button', { name: '取消识别', exact: true }).click();
  await page.locator('#compact-text').fill('取消后保留的全文');
  await page.evaluate(() => { const request = window.__heldMethods.shift(); window.__holdMethod = null; window.__emit({ id:request.id, ok:true, result:{invalid:'must not apply'} }); });
  assert.equal(await page.locator('#compact-text').inputValue(), '取消后保留的全文');
  await page.evaluate(() => { window.__holdMethod = 'ocr.local'; });
  await page.getByRole('button', { name: '本地识别文字', exact: true }).click(); await page.waitForFunction(() => window.__heldMethods.length === 1);
  await capture(page, 'e2-new-document'); await waitCanvas(page, 80, 60);
  await page.evaluate(() => { const request = window.__heldMethods.shift(); window.__holdMethod = null; window.__emit({ id:request.id, ok:true, result:{invalid:'must not apply'} }); });
  await page.getByRole('button', { name: 'OCR', exact: true }).click(); assert.equal(await page.locator('#compact-text').inputValue(), '');
  checks.push('local OCR boxes select/correct/reorder with immutable originals and text safety; stale translation, cancelled OCR and old-document OCR cannot overwrite edits');
  await e2LayoutRecovery(page);
}
async function e2LayoutRecovery(page) {
  const source = '原文测试'.repeat(120) + '原文尾标', translation = 'translated '.repeat(100) + 'TRANSLATION-END';
  await page.locator('#compact-text').fill(source); await page.getByRole('textbox', { name: '可校对的译文', exact: true }).fill(translation);
  await page.evaluate(() => { window.__drawnText = []; const original = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { window.__drawnText.push(text); return original.call(this, text, ...args); }; });
  for (const layout of ['parallel', 'stacked']) {
    await page.getByLabel('文字卡片布局', { exact:true }).selectOption(layout); await page.waitForFunction(() => document.querySelector('.lower-canvas')?.height > 1000);
    const png = await copied(page), info = await imagePixel(page, png, 50, 50); assert.equal(info.width, 720); assert.ok(info.height > 1000);
    assert.ok(await page.evaluate(() => window.__drawnText.join('').includes('TRANSLATION-END'))); assert.ok(await page.evaluate(() => window.__drawnText.join('').includes('原文尾标')));
    const bottomInk = await page.evaluate(dataUrl => new Promise(resolve => { const image = new Image(); image.onload = () => { const canvas = document.createElement('canvas'); canvas.width=image.width;canvas.height=image.height; const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,image.height-150,image.width,100).data;let ink=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]<150&&pixels[i+1]<150&&pixels[i+2]<150)ink++;resolve(ink); };image.src=dataUrl; }), png);
    assert.ok(bottomInk > 10, 'export includes ink near final lines');
  }
  await page.waitForFunction(() => window.__messages.filter(message => message.method === 'recovery.save').at(-1)?.payload.document.editor.translation.endsWith('TRANSLATION-END'));
  const persisted = await page.evaluate(() => window.__messages.filter(message => message.method === 'recovery.save').at(-1).payload);
  await capture(page, 'e2-recovery-switch'); await waitCanvas(page, 80, 60); await returnWorkbench(page);
  await page.getByRole('button', { name: '查看恢复记录', exact:true }).click();
  const row = page.locator(`[data-document-id="${persisted.documentId}"]`); await row.waitFor(); await row.getByRole('button', { name:'恢复', exact:true }).click();
  await page.waitForFunction(() => document.querySelector('#content')?.value.endsWith('原文尾标'));
  assert.equal(await page.getByRole('textbox', { name:'可校对的译文', exact:true }).inputValue(), translation);
  await page.waitForFunction(({ id, revision }) => window.__messages.some(message => message.method === 'recovery.save' && message.payload.documentId === id && message.payload.revision > revision), { id:persisted.documentId, revision:persisted.revision });
  await page.getByLabel('捕获后端', { exact:true }).selectOption('wgc'); await page.waitForFunction(() => window.__messages.some(message => message.method === 'capture.configure' && message.payload.backend === 'wgc'));
  assert.equal(await page.getByLabel('捕获后端', { exact:true }).inputValue(), 'wgc');
  await page.getByRole('button', { name:'查看恢复记录', exact:true }).click(); await page.locator(`[data-document-id="${persisted.documentId}"]`).getByRole('button', { name:'删除记录', exact:true }).click();
  await page.waitForFunction(id => !window.__recoveries[id], persisted.documentId); assert.equal(await page.locator('#content').inputValue(), source);
  checks.push('parallel/stacked bilingual PNGs retain final lines; explicit recovery restores ID and advances revision; deletion keeps edits; backend selection is explicit');
}

// 原文/译文、样式与目标倍率均验证实际应用路径；剪贴板仍仅在 mock 消息中。
async function editorOptionsChecks(page) {
  await page.locator('#content').fill('中文\n文字\n\nhello\nworld');
  await page.getByRole('status').filter({hasText:'译文已过期'}).waitFor();
  await page.getByLabel('复制文字换行',{exact:true}).selectOption('merge');
  await page.getByRole('button',{name:'复制原文',exact:true}).click();
  await page.waitForFunction(()=>window.__messages.some(m=>m.method==='text.copy'));
  assert.equal(await page.evaluate(()=>window.__messages.filter(m=>m.method==='text.copy').at(-1).payload.text),'中文文字\n\nhello world');
  await page.getByRole('button',{name:'已按当前原文校对',exact:true}).click();
  assert.equal(await page.getByRole('status').filter({hasText:'译文已过期'}).count(),0);
  await page.getByLabel('正文行距',{exact:true}).fill('2'); await page.getByLabel('段落间距',{exact:true}).fill('24');
  // 截获重绘时的变换矩阵，证明正文在2倍目标分辨率绘制，而非只放大旧位图。
  await page.evaluate(()=>{window.__exportDraws=[];const old=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){window.__exportDraws.push({text,scale:this.getTransform().a});return old.call(this,text,...args);};});
  await page.getByLabel('导出倍率',{exact:true}).selectOption('2');
  const exportCopy=async()=>{
    const count=await page.evaluate(()=>window.__messages.filter(m=>m.method==='image.copy').length);
    await page.getByRole('button',{name:'复制到剪贴板',exact:true}).click();
    await page.waitForFunction(count=>window.__messages.filter(m=>m.method==='image.copy').length>count,count);
    return page.evaluate(()=>window.__messages.filter(m=>m.method==='image.copy').at(-1).payload.dataUrl);
  };
  const textPng=await exportCopy(page);
  assert.equal((await imagePixel(page,textPng)).width,1440);
  assert.ok(await page.evaluate(()=>window.__exportDraws.some(d=>d.scale===2 && d.text.includes('hello'))));
  checks.push('text copy merges only soft lines through mock native bridge; translation source edits show stale status; 2x text is redrawn at target scale');
  await page.getByLabel('成品样式',{exact:true}).selectOption('outline');
  await page.getByRole('button',{name:'应用样式',exact:true}).click(); await waitCanvas(page,128,108);
  await page.getByLabel('边框颜色',{exact:true}).fill('#112233');
  await page.getByLabel('新样式名称',{exact:true}).fill('离屏合成样式');
  await page.getByRole('button',{name:'保存当前样式',exact:true}).click();
  const id=await page.getByLabel('成品样式',{exact:true}).inputValue();
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('screenshot.style-presets.v1')));
  assert.equal(stored.length,1);assert.equal(stored[0].style.borderColor,'#112233');assert.equal('text' in stored[0].style,false);
  await page.getByLabel('边框宽度',{exact:true}).fill('0');
  await page.getByRole('button',{name:'应用样式',exact:true}).click();
  assert.equal(await page.getByLabel('边框宽度',{exact:true}).inputValue(),'2');
  await page.getByLabel('导出倍率',{exact:true}).selectOption('1');
  const border=await exportCopy(page);assert.deepEqual((await imagePixel(page,border,24,60)).pixel,[17,34,51,255]);
  await capture(page,'styles-remount');await waitCanvas(page,80,60);
  await page.getByRole('button',{name:'美化',exact:true}).click();
  await page.getByLabel('成品样式',{exact:true}).selectOption(id);
  await page.getByRole('button',{name:'应用样式',exact:true}).click();await waitCanvas(page,128,108);
  assert.deepEqual((await imagePixel(page,await copied(page),24,60)).pixel,[17,34,51,255]);
  await page.setViewportSize({width:2240,height:900});await page.locator('.compact-panel').evaluate(panel=>panel.scrollTop=0);
  await page.screenshot({path:path.resolve(__dirname,'../output/editor-options.png')});
  checks.push('style presets persist only validated appearance across compact/workbench remount; border pixels match shared export');
}

// 长文分块、重试、定向取消及批量清理均只操作合成页面内存。
async function taskManagementChecks(page) {
  await page.getByRole('button',{name:'OCR',exact:true}).click();
  await page.locator('#compact-text').fill('甲'.repeat(2000)+'乙'.repeat(2000)+'丙'.repeat(300));
  await page.evaluate(()=>{window.__chunkMode=true;window.__failedChunk=false;});
  const before=await page.evaluate(()=>window.__messages.filter(m=>m.method==='ai.translate').length);
  await page.getByRole('button',{name:'翻译',exact:true}).last().click();
  await page.getByRole('button',{name:'仅重试失败块',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__messages.filter(m=>m.method==='ai.translate').length),before+3);
  await page.getByLabel('目标语言',{exact:true}).selectOption('English');
  assert.equal(await page.getByRole('button',{name:'仅重试失败块',exact:true}).isDisabled(),true);
  await page.getByLabel('目标语言',{exact:true}).selectOption('简体中文');
  await page.getByRole('button',{name:'仅重试失败块',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('textarea[aria-label="可校对的译文"]')?.value==='translated-甲\ntranslated-乙\ntranslated-丙');
  assert.equal(await page.evaluate(()=>window.__messages.filter(m=>m.method==='ai.translate').length),before+4);
  await page.locator('#compact-text').fill('丁'+'甲'.repeat(1999)+'乙'.repeat(2000)+'丙'.repeat(300));
  await page.evaluate(()=>{window.__holdMethod='ai.translate';});
  await page.getByRole('button',{name:'翻译',exact:true}).last().click();await page.waitForFunction(()=>window.__heldMethods.length===1);
  const held=await page.evaluate(()=>window.__heldMethods[0]);
  await page.getByRole('button',{name:'取消翻译',exact:true}).click();
  await page.waitForFunction(id=>window.__messages.some(m=>m.method==='ai.cancel'&&m.payload.taskId===id),held.payload.taskId);
  await page.evaluate(()=>{const request=window.__heldMethods.shift();window.__holdMethod=null;window.__chunkMode=false;window.__emit({id:request.id,ok:true,result:{text:'late'}});});
  assert.equal(await page.getByRole('textbox',{name:'可校对的译文',exact:true}).inputValue(),'translated-甲\ntranslated-乙\ntranslated-丙');
  checks.push('translation sends three ordered chunks, retries only one failed block, rejects target changes, and cancels exact task without merging late results');
  await page.locator('.provider-tests summary').click();
  await page.getByRole('button',{name:'测试文字接口',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.compact-progress'));
  await page.getByRole('button',{name:'测试图片接口',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.compact-progress'));
  const probes=await page.evaluate(()=>window.__messages.filter(m=>m.method==='ai.test'));
  assert.equal(probes.length,2);for(const probe of probes)assert.deepEqual(Object.keys(probe.payload).sort(),['kind','providerId','taskId']);
  checks.push('capability tests require explicit clicks and send no document text or screenshot through the bridge');
  await page.getByRole('button',{name:'更多与完整工作台',exact:true}).click();
  const ids=await page.evaluate(()=>{const seed=window.__messages.filter(m=>m.method==='recovery.save').at(-1).payload;const ids=[crypto.randomUUID(),crypto.randomUUID()];for(const id of ids)window.__recoveries[id]={...seed,documentId:id};return ids;});
  await page.getByRole('button',{name:'查看恢复记录',exact:true}).click();
  for(const id of ids)await page.getByLabel('选择恢复记录 '+id,{exact:true}).check();
  await page.getByRole('button',{name:'清理所选 2 条',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__messages.filter(m=>m.method==='recovery.deleteMany').length),0);
  await page.getByRole('button',{name:'确认清理所选记录',exact:true}).click();
  await page.waitForFunction(ids=>ids.every(id=>!window.__recoveries[id]),ids);
  assert.deepEqual(await page.evaluate(()=>window.__messages.filter(m=>m.method==='recovery.deleteMany').at(-1).payload.documentIds),ids);
  await page.getByRole('button',{name:'OCR',exact:true}).click();assert.equal((await page.locator('#compact-text').inputValue()).length,4300);
  checks.push('capacity metadata and explicit confirmed batch cleanup delete only selected recoveries and keep the current in-memory edits');
}


// These controls talk only to the synthetic bridge; no native enumeration or OS registration occurs.
async function captureControlsChecks(page){
  assert.equal(await page.evaluate(()=>window.__messages.filter(m=>m.method==='capture.monitors'||m.method==='hotkey.read').length),0);
  await capture(page,'controls');await page.locator('.compact-toolbar').waitFor();
  await page.getByRole('button',{name:'更多与完整工作台',exact:true}).click();
  await page.getByLabel('捕获后端',{exact:true}).selectOption('wgc');
  await page.locator('.capture-controls summary').click();
  await page.getByRole('button',{name:'刷新显示器列表',exact:true}).click();
  await page.getByRole('button',{name:'捕获所选屏幕',exact:true}).click();
  await page.waitForFunction(()=>window.__messages.some(m=>m.method==='capture.screen'));
  assert.deepEqual(await page.evaluate(()=>window.__messages.filter(m=>m.method==='capture.screen').at(-1).payload.target),{kind:'monitor',handle:'9007199254740993'});
  await page.getByRole('button',{name:'捕获当前屏幕',exact:true}).click();
  await page.waitForFunction(()=>window.__messages.some(m=>m.method==='capture.current'));
  await page.getByRole('button',{name:'读取捕获与快捷键设置',exact:true}).click();
  await page.getByLabel('吸附范围',{exact:true}).selectOption('client');await page.getByLabel('窗口吸附',{exact:true}).uncheck();
  await page.getByRole('button',{name:'应用吸附设置',exact:true}).click();
  await page.waitForFunction(()=>window.__snapSettings.windowArea==='client'&&!window.__snapSettings.snapWindows);
  await page.getByLabel('热键按键',{exact:true}).selectOption('Q');await page.getByRole('button',{name:'应用区域热键',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('select[aria-label="热键按键"]')?.value==='S');
  assert.equal(await page.evaluate(()=>window.__hotkey.key),'S');
  await page.getByLabel('热键按键',{exact:true}).selectOption('F8');await page.getByRole('button',{name:'应用区域热键',exact:true}).click();
  await page.waitForFunction(()=>window.__hotkey.key==='F8');assert.equal(await page.getByRole('alert').count(),0);
  await page.screenshot({path:path.resolve(__dirname,'../output/capture-controls.png')});
  checks.push('capture targets and hotkey settings are queried only on explicit clicks, preserve 64-bit string handles, share snap settings and retain old binding on simulated conflict');
  await returnWorkbench(page);
}
async function syntheticDrop(page,width,height,name,hold=false){
  return page.evaluate(async({width,height,name,hold})=>{
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.fillStyle='#7733aa';ctx.fillRect(0,0,width,height);const dataUrl=canvas.toDataURL('image/png');
    if(hold)window.__holdNextDecodeURL=dataUrl;
    const bytes=Uint8Array.from(atob(dataUrl.split(',')[1]),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],name,{type:'image/png'}));
    window.dispatchEvent(new DragEvent('dragenter',{dataTransfer:dt,bubbles:true}));document.querySelector('.compact-overlay').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));
    return dataUrl;
  },{width,height,name,hold});
}
async function dropChecks(page){
  await capture(page,'retained-drop');await page.waitForFunction(()=>window.__messages.some(m=>m.method==='presentation.ready'&&m.payload.captureId==='retained-drop'));
  const transitions=await page.evaluate(()=>window.__messages.filter(m=>m.method==='presentation.workbench').length);
  const png=await syntheticDrop(page,3000,1800,'synthetic-large.png');await waitCanvas(page,3000,1800);await page.waitForFunction(()=>!document.querySelector('.compact-progress'));
  const frame=await page.locator('.compact-canvas').boundingBox();assert.ok(frame.width<1920&&frame.height<1080);
  assert.equal(await page.locator('.compact-overlay').count(),1);assert.equal(await copied(page),png);
  assert.equal(await page.evaluate(()=>window.__messages.filter(m=>m.method==='presentation.ready'&&m.payload.captureId==='retained-drop').length),1);
  assert.equal(await page.evaluate(()=>window.__messages.filter(m=>m.method==='presentation.workbench').length),transitions);
  await syntheticDrop(page,19,11,'late-drop.png',true);await page.waitForFunction(()=>window.__heldDecodes.length===1);
  const winner=await capture(page,'drop-newer-capture');await page.waitForFunction(()=>window.__messages.some(m=>m.method==='presentation.ready'&&m.payload.captureId==='drop-newer-capture'));
  await releaseDecodes(page);await page.waitForFunction(()=>!document.querySelector('.compact-progress'));assert.equal(await copied(page),winner);
  checks.push('in-place synthetic file drop keeps compact presentation and single ready handshake, fits view without resizing export, and discards late drops after newer capture');
  await returnWorkbench(page);
}
async function persistedTranslationChecks(page){
  await capture(page,'persisted-translation');await page.locator('.compact-toolbar').waitFor();await page.getByRole('button',{name:'OCR',exact:true}).click();
  await page.getByLabel('识别方式',{exact:true}).selectOption('local');await page.getByRole('button',{name:'本地识别文字',exact:true}).click();await page.getByLabel('当前块校正',{exact:true}).waitFor();
  await page.evaluate(()=>{window.__failBlockB=true;window.__failedBlockB=false;});
  const before=await page.evaluate(()=>window.__messages.filter(m=>m.method==='ai.translate').length);
  await page.getByRole('button',{name:'翻译',exact:true}).last().click();await page.getByRole('button',{name:'仅重试失败块',exact:true}).waitFor();
  await page.waitForFunction(()=>Object.values(window.__recoveries).some(r=>r.document.editor.translationData?.chunks.some(c=>c.sourceBlockId==='block-b'&&c.status==='failed')));
  await returnWorkbench(page);const saved=await saveDocument(page);const data=saved.editor.translationData;
  assert.deepEqual(data.chunks.map(c=>[c.sourceBlockId,c.status]),[['block-a','done'],['block-b','failed']]);
  assert.equal(data.chunks.map(c=>c.source).join(''),saved.editor.text);assert.equal(data.providerRevision,'a'.repeat(64));
  await page.locator('input[type="file"]').first().setInputFiles({name:'synthetic-project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});
  await page.getByRole('button',{name:'仅重试失败块',exact:true}).waitFor();await page.getByRole('button',{name:'仅重试失败块',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('textarea[aria-label="可校对的译文"]')?.value==='synthetic translation\nsynthetic translation');
  assert.equal(await page.evaluate(()=>window.__messages.filter(m=>m.method==='ai.translate').length),before+3);
  await page.getByLabel('当前源块译文 1',{exact:true}).fill('人工校对块');const corrected=await saveDocument(page);
  assert.equal(corrected.editor.translationData.chunks[0].text,'人工校对块');assert.equal(corrected.editor.translationData.chunks[0].generatedText,'synthetic translation');
  await page.getByLabel('当前块校正',{exact:true}).fill('modified source');
  assert.equal(await page.getByLabel('当前源块译文 1',{exact:true}).count(),0);
  await page.screenshot({path:path.resolve(__dirname,'../output/persisted-translation.png')});
  checks.push('partial OCR-linked translation persists in autosave and editable project, resumes only failed block after reload, preserves generated text on correction, and suspends source mapping after text changes');
}

// 首次空启动不写库；已编辑的纯文字文档清空后必须用空快照替换旧内容。
async function emptyTextRecovery(page) {
  await page.waitForTimeout(1100);
  assert.equal(await page.evaluate(() => window.__messages.filter(message => message.method === 'recovery.save').length), 0);
  await page.locator('.modes button').filter({hasText:'文字重排'}).click();
  await page.locator('#content').fill('稍后会删除的原文');
  await page.getByRole('textbox', {name:'可校对的译文',exact:true}).fill('translation to delete');
  await page.waitForFunction(() => Object.values(window.__recoveries).some(item => !item.document.image && item.document.editor.text === '稍后会删除的原文' && item.document.editor.translation === 'translation to delete'));
  const previous = await page.evaluate(() => Object.values(window.__recoveries).find(item => item.document.editor.text === '稍后会删除的原文'));
  await page.locator('#content').fill(''); await page.getByRole('textbox', {name:'可校对的译文',exact:true}).fill('');
  await page.waitForFunction(({id,revision}) => { const latest=window.__recoveries[id]; return latest?.revision>revision && latest.document.editor.text === '' && latest.document.editor.translation === ''; }, {id:previous.documentId,revision:previous.revision}, {timeout:3500});
  checks.push('initial empty revision zero is not saved; clearing a previously saved text-only document persists an empty snapshot instead of reviving deleted text');
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-background-networking'] });
  const page = await browser.newPage({ viewport: { width: 2240, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await installMock(page); await page.goto(origin);
  await page.getByRole('button', { name: '选择一张图片', exact: true }).waitFor();
  await emptyTextRecovery(page);
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
  await page.waitForFunction(()=>{const button=document.querySelector('.copy-button');return button&&!button.disabled;});
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
  await e1Checks(page, source);
  await privacyChecks(page);
  await e2Checks(page);
  await editorOptionsChecks(page);
  await taskManagementChecks(page);
  await captureControlsChecks(page);
  await dropChecks(page);
  await persistedTranslationChecks(page);
  assert.deepEqual(errors, []);
  const evidence = { headless: true, syntheticOnly: true, nativeCalls: false, clipboardAccess: false, checks };
  const evidencePath = path.resolve(__dirname, '../output/headless-overlay.json'); fs.mkdirSync(path.dirname(evidencePath), { recursive: true }); fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
});
