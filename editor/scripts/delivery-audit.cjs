// 独立无头进程只使用合成像素与内存桥接；不连接用户应用或服务。
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright'), { installMock } = require('./mock-host.cjs');
const dist = path.resolve(process.env.SCREENSHOT_BENCH_DIST || path.join(__dirname, '../dist')), output = path.resolve(process.argv[2] || 'artifacts/qa/product/delivery');
const pause = process.argv.includes('--pause'), verify = process.argv.includes('--verify'), records = [], checks = [], errors = [], actions = [];
fs.mkdirSync(output, { recursive: true });
const rl = require('node:readline').createInterface({ input: process.stdin, terminal: false });
let nextLine;
rl.on('line', () => { if (nextLine) {
    const f = nextLine;
    nextLine = null;
    f();
} });
const server = http.createServer((req, res) => { const url = new URL(req.url, 'http://127.0.0.1'), file = path.resolve(dist, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname))); if (!file.startsWith(dist + path.sep)) {
    res.writeHead(403).end();
    return;
} fs.readFile(file, (e, b) => { if (e) {
    res.writeHead(404).end();
    return;
} res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(b); }); });
let browser, origin, p;
async function settle() { await p.evaluate(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))); }); }
async function act(name, fn) { actions.push({ name, visibleButtons: await p.getByRole('button').evaluateAll(es => es.filter(e => e.checkVisibility()).map(e => ({ name: e.getAttribute('aria-label') || e.textContent.trim(), disabled: e.disabled }))) }); await fn(); await settle(); }
async function click(name, scope) { const l = (scope || p).getByRole('button', { name, exact: true }); assert.equal(await l.count(), 1, name + ' identifies one DOM control'); await act(name, () => l.click()); }
// 保存原始像素及当前DOM尺寸；--pause允许逐张复核后再继续。
async function snap(name, note) {
    await settle();
    const file = path.join(output, name + '.png');
    await p.screenshot({ path: file, animations: 'disabled' });
    const state = await p.evaluate(() => { const rect = e => { if (!e)
        return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, clientWidth: e.clientWidth, scrollWidth: e.scrollWidth, clientHeight: e.clientHeight, scrollHeight: e.scrollHeight, scrollLeft: e.scrollLeft }; }; return ({ panel: rect(document.querySelector('.compact-panel')), status: rect(document.querySelector('.compact-status-bar')), progress: rect(document.querySelector('.compact-progress')), cancel: rect(document.querySelector('.compact-status-bar .task-cancel')), viewport: { width: innerWidth, height: innerHeight }, darkPreference: matchMedia('(prefers-color-scheme: dark)').matches, rootColor: getComputedStyle(document.documentElement).color, rootBackground: getComputedStyle(document.documentElement).backgroundColor, app: !!document.querySelector('.app'), overlay: !!document.querySelector('.compact-overlay'), alerts: [...document.querySelectorAll('[role=alert]')].map(e => e.textContent), documentHeight: document.documentElement.scrollHeight }); });
    if (verify && ['05-ocr-corrected', '06-translation-partial-error'].includes(name)) {
        assert.ok(state.panel.scrollWidth <= state.panel.clientWidth + 1, 'narrow correction/translation panel has no horizontal overflow');
        assert.equal(state.panel.scrollLeft, 0, 'focused field does not pan the sticky heading');
    }
    if (verify && state.progress) {
        assert.ok(state.progress.y >= state.status.y && state.progress.y + state.progress.height <= state.status.y + state.status.height, 'loading progress fits in the status bar');
        if (state.cancel)
            assert.ok(state.cancel.y + state.cancel.height <= state.status.y + state.status.height, 'task cancellation stays visible');
    }
    if (verify && name.includes('compact-empty'))
        assert.ok(state.documentHeight <= state.viewport.height, 'compact workbench outer shell fits the window');
    records.push({ step: name, file, note, ...state });
    fs.writeFileSync(path.join(output, 'progress.json'), JSON.stringify({ records, checks, errors, actions }, null, 2));
    console.log('REVIEW ' + file);
    if (pause)
        await new Promise(r => nextLine = r);
}
async function ready() { await settle(); await p.waitForFunction(() => { const b = document.querySelector('.compact-toolbar .compact-save') || document.querySelector('.export-panel .primary'); return b && !b.disabled; }); }
async function fresh(color = 'light', viewport = { width: 1280, height: 800 }, options = {}) { p = await browser.newPage({ viewport, colorScheme: color, reducedMotion: 'reduce' }); p.on('pageerror', e => errors.push(e.message)); await p.route('**/*', r => new URL(r.request().url()).origin === origin ? r.continue() : r.abort()); await installMock(p, options); await p.goto(origin); await p.getByRole('button', { name: '选择一张图片', exact: true }).waitFor(); await settle(); }
async function image() { await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 960; c.height = 520; const g = c.getContext('2d'); g.fillStyle = '#f3f4ee'; g.fillRect(0, 0, 960, 520); g.fillStyle = '#e4e8df'; g.fillRect(0, 0, 960, 46); g.fillStyle = '#30372f'; g.font = 'bold 28px Microsoft YaHei'; g.fillText('交付复审 · 合成素材', 40, 100); g.font = '20px Microsoft YaHei'; g.fillText('完整选区编辑 → OCR校对 → 翻译 → 排版 → 导出', 40, 150); g.fillText('测试编号 TEST-000042', 40, 220); g.fillStyle = '#ac432e'; g.fillRect(40, 260, 200, 4); g.font = '18px Microsoft YaHei'; g.fillText('此图完全在内存生成，不含真实桌面或用户图片。', 40, 320); const image = { dataUrl: c.toDataURL(), name: '交付复审-合成素材.png', width: 960, height: 520 }; window.__source = image.dataUrl; window.__ocrResult = { modelVersion: 'synthetic', imageWidth: 960, imageHeight: 520, blocks: [{ id: 'delivery-a', polygon: [{ x: 40, y: 75 }, { x: 400, y: 75 }, { x: 400, y: 105 }, { x: 40, y: 105 }], text: '交付复审，保留原文。', confidence: .98, order: 0 }, { id: 'delivery-b', polygon: [{ x: 40, y: 125 }, { x: 180, y: 125 }, { x: 180, y: 155 }, { x: 40, y: 155 }], text: 'second', confidence: .96, order: 1 }] }; window.__emit({ event: 'image.loaded', payload: { image, overlay: { captureId: 'delivery-audit', desktopBounds: { x: 0, y: 0, width: 1280, height: 800 }, selection: { x: 120, y: 100, width: 960, height: 520 }, screens: [{ bounds: { x: 0, y: 0, width: 1280, height: 800 }, primary: true }] } } }); }); await p.locator('.compact-overlay').waitFor(); await ready(); await p.waitForFunction(() => window.__messages.some(m => m.method === 'presentation.ready')); }
async function panel(name) { if (!await p.locator('.compact-panel').count() || await p.locator('.compact-panel-heading strong').textContent() !== name) {
    if (await p.locator('.compact-panel').count())
        await click('关闭选项');
    await click(name === '文字与翻译' ? 'OCR' : '更多与完整工作台');
} }
async function documentSnapshot() { const compact = await p.locator('.compact-overlay').count(); if (compact)
    await panel('更多操作'); const n = await p.evaluate(() => window.__messages.filter(m => m.method === 'project.save').length); await click(compact ? '保存可编辑项目' : '保存项目'); await p.waitForFunction(n => window.__messages.filter(m => m.method === 'project.save').length > n, n); await ready(); return p.evaluate(() => window.__messages.filter(m => m.method === 'project.save').at(-1).payload.document); }
async function dismiss() { if (await p.getByRole('button', { name: '关闭提示', exact: true }).count())
    await click('关闭提示'); }
async function exported() { await ready(); const n = await p.evaluate(() => window.__messages.filter(m => m.method === 'image.save').length); await click('保存'); await p.waitForFunction(n => window.__messages.filter(m => m.method === 'image.save').length > n, n); await ready(); return p.evaluate(() => window.__messages.filter(m => m.method === 'image.save').at(-1).payload.dataUrl); }
async function pngSize(dataUrl) { return p.evaluate(s => new Promise(resolve => { const i = new Image(); i.onload = () => resolve({ width: i.width, height: i.height }); i.src = s; }), dataUrl); }
function hash(s) { return crypto.createHash('sha256').update(Buffer.from(s.split(',')[1], 'base64')).digest('hex'); }
(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-background-networking'] });
    await fresh();
    await snap('01-empty-light', '浅色空态：入口可见，导出与撤销无效时禁用。');
    await image();
    await click('添加矩形标注');
    await click('添加实色遮盖');
    const edited = await documentSnapshot();
    assert.equal(edited.editor.annotations.length, 2);
    await click('关闭选项');
    await dismiss();
    await snap('02-selection-edited', '等效选区原位编辑，矩形与实色遮盖进入同一文档。');
    checks.push('selection editor creates two annotations in shared history');
    await panel('文字与翻译');
    await p.evaluate(() => window.__holdMethod = 'ocr.local');
    await click('本地识别文字');
    await p.waitForFunction(() => window.__heldMethods.length === 1);
    await snap('03-ocr-loading', 'OCR模拟请求挂起，明确进度并可取消。');
    await click('关闭选项');
    await snap('03-loading-panel-closed', '关闭文字面板后，状态栏仍完整展示进度与取消任务。');
    await click('取消任务');
    await panel('文字与翻译');
    await p.evaluate(() => { window.__holdMethod = null; window.__heldMethods = []; window.__failNext['ocr.local'] = { code: 'model_invalid', message: '合成OCR错误：校验失败，请重试。' }; });
    await click('本地识别文字');
    await p.getByRole('alert').waitFor();
    await snap('04-ocr-error', 'OCR失败保留已有图像与标注，原操作可重试。');
    await click('本地识别文字');
    await p.getByLabel('当前块校正', { exact: true }).waitFor();
    await act('校对第一源块', () => p.getByLabel('当前块校正', { exact: true }).fill('交付复审，原文校对完成。'));
    assert.equal(await p.locator('#compact-text').inputValue(), '交付复审，原文校对完成。\nsecond');
    await snap('05-ocr-corrected', '识别两块并校对第一块，原识别文字与当前块分开呈现。');
    checks.push('OCR loading, cancellation, error, retry and correction keep the edited document');
    await p.evaluate(() => { window.__failBlockB = true; window.__failedBlockB = false; });
    const translatedBefore = await p.evaluate(() => window.__messages.filter(m => m.method === 'ai.translate').length);
    await click('翻译', p.locator('.translate-row'));
    await p.getByRole('button', { name: '仅重试失败块', exact: true }).waitFor();
    await p.locator('.translation-progress').evaluate(e => e.scrollIntoView({ block: 'center' }));
    await snap('06-translation-partial-error', '模拟第二块限流；成功块保留，提供仅重试失败块。');
    assert.equal(await p.evaluate(() => window.__messages.filter(m => m.method === 'ai.translate').length), translatedBefore + 2);
    await click('仅重试失败块');
    await p.waitForFunction(() => document.querySelector('textarea[aria-label="可校对的译文"]')?.value === 'synthetic translation\nsynthetic translation');
    assert.equal(await p.evaluate(() => window.__messages.filter(m => m.method === 'ai.translate').length), translatedBefore + 3);
    await p.getByLabel('可校对的译文', { exact: true }).evaluate(e => e.scrollIntoView({ block: 'center' }));
    await snap('07-translation-retried', '仅新增一个模拟请求完成译文；原文仍保留。');
    checks.push('translation keeps successful OCR-linked chunk and retries exactly one failed chunk');
    await act('正文行距', () => p.getByLabel('正文行距', { exact: true }).fill('1.8'));
    await act('段落间距', () => p.getByLabel('段落间距', { exact: true }).fill('24'));
    await act('双语上下排版', () => p.getByLabel('文字卡片布局', { exact: true }).selectOption('stacked'));
    await ready();
    await dismiss();
    await p.getByLabel('文字卡片布局', { exact: true }).evaluate(e => e.scrollIntoView({ block: 'center' }));
    await snap('08-bilingual-layout', '同一文档生成双语上下卡片，调整行距与段距。');
    await panel('更多操作');
    await act('2倍导出', () => p.locator('#compact-scale').selectOption('2'));
    const beforeExport = await documentSnapshot();
    await p.evaluate(() => window.__failNext['image.save'] = { code: 'disk_full', message: '合成保存失败：磁盘空间不足，请选择其他位置后重试。' });
    const failedPng = await exported();
    await p.getByRole('alert').waitFor();
    await snap('09-export-error', '导出写入模拟失败，编辑内容保持，保存按钮恢复可用。');
    const afterFailure = await documentSnapshot();
    assert.deepEqual(afterFailure, beforeExport);
    await p.evaluate(() => window.__holdMethod = 'image.save');
    const saves = await p.evaluate(() => window.__messages.filter(m => m.method === 'image.save').length);
    await click('保存');
    await p.waitForFunction(n => window.__messages.filter(m => m.method === 'image.save').length > n, saves);
    await snap('10-export-loading', '重试写入挂起时显示导出进度，避免重复保存。');
    await p.evaluate(() => { const r = window.__heldMethods.shift(); window.__holdMethod = null; window.__emit({ id: r.id, ok: true, result: { saved: true } }); });
    await ready();
    const finalPng = await p.evaluate(() => window.__messages.filter(m => m.method === 'image.save').at(-1).payload.dataUrl);
    assert.equal(hash(finalPng), hash(failedPng));
    const base = await p.locator('.lower-canvas').evaluate(e => ({ width: e.width, height: e.height })), size = await pngSize(finalPng);
    assert.deepEqual(size, { width: base.width * 2, height: base.height * 2 });
    fs.writeFileSync(path.join(output, 'export-2x.png'), Buffer.from(finalPng.split(',')[1], 'base64'));
    await click('关闭选项');
    await snap('11-export-retried', '同一PNG重试成功，2倍宽高与原内容一致。');
    checks.push('failed export retains document, retry sends identical PNG, busy state guards duplicates and 2x dimensions match');
    const final = await documentSnapshot();
    const aiCount = await p.evaluate(() => window.__messages.filter(m => m.method === 'ai.translate' || m.method === 'ocr.local').length);
    // 遍历整条共享历史；重做只恢复状态，不重新发起AI请求。
    let undoCount = 0, redoCount = 0;
    while (!await p.getByRole('button', { name: '撤销', exact: true }).isDisabled()) {
        assert.ok(++undoCount < 40);
        await click('撤销');
        await ready();
    }
    const initial = await documentSnapshot();
    assert.equal(initial.editor.annotations.length, 0);
    assert.equal(initial.editor.text, '');
    assert.equal(initial.editor.translation, '');
    assert.equal(initial.editor.mode, 'raw');
    await click('关闭选项');
    await dismiss();
    await snap('12-undo-to-original', '撤销整条路径回到原始选区，全部标注、OCR、译文与排版可撤回。');
    while (!await p.getByRole('button', { name: '重做', exact: true }).isDisabled()) {
        assert.ok(++redoCount < 40);
        await click('重做');
        await ready();
    }
    const redone = await documentSnapshot();
    assert.deepEqual(redone, final);
    assert.equal(redoCount, undoCount);
    assert.equal(await p.evaluate(() => window.__messages.filter(m => m.method === 'ai.translate' || m.method === 'ocr.local').length), aiCount);
    await click('关闭选项');
    await dismiss();
    await snap('13-redo-final', '重做整条路径精确恢复文档，不重复发送OCR或翻译请求。');
    checks.push(`undo/redo traverses all ${undoCount} history steps with exact final document and no new AI sends`);
    await panel('更多操作');
    await click('完整工作台');
    await p.locator('.app').waitFor();
    assert.deepEqual(await documentSnapshot(), final);
    await dismiss();
    await snap('14-workbench-shared-document', '用户主动进入工作台，沿用同一图像、标注、校对、译文和排版。');
    await p.close();
    for (const color of ['light', 'dark']) {
        await fresh(color, { width: 1000, height: 620 });
        await snap(`15-${color}-compact-empty`, '1000×620紧凑窗口空态，系统偏好单独记录。');
        await image();
        await panel('文字与翻译');
        await p.evaluate(() => window.__holdMethod = 'ocr.local');
        await click('本地识别文字');
        await p.waitForFunction(() => window.__heldMethods.length === 1);
        await snap(`16-${color}-compact-loading`, '同尺寸原位面板加载态与取消入口。');
        await click('取消识别');
        await p.evaluate(() => { window.__holdMethod = null; window.__heldMethods = []; window.__failNext['ocr.local'] = { code: 'model_invalid', message: '合成状态错误：本地模型暂不可用，请检查后重试。' }; });
        await click('本地识别文字');
        await p.getByRole('alert').waitFor();
        await snap(`17-${color}-compact-error`, '同尺寸错误态含文字说明，保存与编辑仍可继续。');
        const themePng = await exported();
        assert.equal(themePng, await p.evaluate(() => window.__source), 'system color preference does not recolor exported pixels');
        await p.close();
    }
    checks.push('narrow OCR/translation fields stay within the panel, loading progress and cancel remain visible, both system color preferences keep source export pixels');
    assert.deepEqual(errors, []);
    const report = { history: { undoCount, redoCount }, export: { ...size, sha256: hash(finalPng), retryBytesIdentical: hash(finalPng) === hash(failedPng) }, paletteChangesWithSystem: new Set(records.filter(r => r.step.includes("compact-empty")).map(r => r.rootColor + r.rootBackground)).size > 1, syntheticOnly: true, headless: true, nativeCalls: false, externalRequests: false, clipboardAccess: false, records, checks, errors, actions };
    fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('DONE ' + JSON.stringify({ screenshots: records.length, checks, undoCount, redoCount }));
})().catch(async (e) => { console.error(e); if (p && !p.isClosed())
    try {
        await p.screenshot({ path: path.join(output, 'unexpected-failure.png') });
    }
    catch { } fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ error: e.message, stack: e.stack, records, checks, actions }, null, 2)); process.exitCode = 1; }).finally(async () => { rl.close(); if (browser)
    await browser.close(); await new Promise(r => server.close(r)); });
