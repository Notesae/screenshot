import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Clipboard, Copy, Crop, FileImage, FolderOpen, Frame, ImagePlus, Monitor, ScanText, Settings2, Sparkles, TextCursorInput, Trash2, Type, Languages, Save, MousePointer2, Check, X } from 'lucide-react';
import { native, subscribeNative, type LoadedImage, type Settings, type PresentationResult } from './bridge';
import { defaultEditor, parseDocument, transformContent, type ContentResize, type SourceCrop, type EditorState, type Mode, type ProjectDocument } from './document';
import { fileToImage, imageForProcessing, normalizeImage } from './render';
import { EditorCanvas, type CanvasHandle } from './EditorCanvas';
import { parseCapture, type CaptureEnvelope, type OverlayMetadata } from './overlay';
import { CompactOverlay } from './CompactOverlay';
import { useEditorHistory } from './useEditorHistory';
import { historyKeyAction } from './keyboard';
import { AnnotationPalette, HistoryButtons, TransformPanel } from './EditControls';

const initial: ProjectDocument = { schemaVersion: 2, image: null, editor: defaultEditor() };
const modes = [ { id: 'raw', icon: FileImage, name: '原样', description: '留住真实像素' }, { id: 'beauty', icon: Sparkles, name: '美化', description: '给内容一点留白' }, { id: 'reflow', icon: TextCursorInput, name: '文字重排', description: '让文字重新呼吸' } ] as const;
const swatches = ['#e9dfd1', '#e4e9df', '#e1e7ec', '#eadbd8', '#363b37', '#f8f4eb'];
function download(data: string, name: string) { const link = document.createElement('a'); link.href = data; link.download = name; link.click(); }
function message(error: unknown) { return error instanceof Error ? error.message : '操作失败，请重试。'; }

/** 协调本地编辑、桌面桥接和显式 AI 操作；项目与服务配置互相独立。 */
export default function App() {
  const history = useEditorHistory(initial), doc = history.document, setDoc = history.reset;
  const [overlay, setOverlay] = useState<OverlayMetadata | null>(null);
  const [busy, setBusy] = useState('');
  const [aiBusy, setAiBusy] = useState('');
  const [documentEpoch, setDocumentEpoch] = useState(0);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [settings, setSettings] = useState<Settings>({ providers: [] });
  const [providerId, setProviderId] = useState('');
  const [targetLanguage, setTargetLanguage] = useState('简体中文');
  const [scale, setScale] = useState(1);
  const [dragging, setDragging] = useState(false);
  const canvas = useRef<CanvasHandle>(null);
  const imageInput = useRef<HTMLInputElement>(null), projectInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0), current = useRef(doc); current.current = doc;
  const overlayRef = useRef(overlay); overlayRef.current = overlay;
  const pendingCapture = useRef<{ captureId?: string; revision: number } | null>(null);
  const expiredCaptures = useRef(new Set<string>());
  const timedOutCaptures = useRef(new Set<string>());
  const editor = doc.editor;
  const hasContent = Boolean(doc.image) || editor.mode === 'reflow';
  const errorNotice = (error: unknown) => setNotice({ text: message(error), error: true });
  const update = (change: Partial<EditorState>, group?: string) => {
    const fields = Object.keys(change), key = fields[0];
    history.change(change, group || (fields.length === 1 && ['text', 'title', 'padding', 'radius', 'fontSize', 'textWidth'].includes(key) ? `input:${key}` : undefined));
  };
  function changeTransform(crop: SourceCrop | null, resize: ContentResize | null) {
    try { history.commitDocument(transformContent(history.current(), crop, resize)); } catch (error) { errorNotice(error); }
  }
  useEffect(() => {
    let composing = false;
    const start = () => { composing = true; }, end = () => { composing = false; };
    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null, interaction = canvas.current?.interactionState();
      const action = historyKeyAction({ key: event.key, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey, composing: composing || event.isComposing, textInput: Boolean(target?.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]')), fabricEditing: interaction?.editing || false, selectedObject: false, panelOpen: false, textSelection: false });
      if (event.defaultPrevented || action === 'ignore') return;
      event.preventDefault(); action === 'undo' ? history.undo() : history.redo();
    };
    window.addEventListener('keydown', keydown); window.addEventListener('compositionstart', start); window.addEventListener('compositionend', end);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('compositionstart', start); window.removeEventListener('compositionend', end); };
  }, []);
  // 透明仅作用于呈现外壳，冻结桌面从不成为编辑文档或画布底图。
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('capture-overlay', Boolean(overlay));
    return () => document.documentElement.classList.remove('capture-overlay');
  }, [overlay]);
  // 本地文件/剪贴板操作共享忙状态，AI 使用独立状态以保持本地操作可用。
  async function run(label: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(label); setNotice(null);
    try { await action(); } catch (error) { errorNotice(error); } finally { setBusy(''); }
  }
  // 每次载入推进代数；旧解码或旧 AI 结果不能覆盖之后打开的内容。
  async function acceptImage(value: unknown, revision = ++generation.current) {
    if (revision !== generation.current) return;
    const sourceOverlay = overlayRef.current;
    const capture = parseCapture(value);
    if (capture.overlay) pendingCapture.current = { captureId: capture.overlay.captureId, revision };
    const image = await normalizeImage(capture.image);
    if (revision !== generation.current) return;
    if (!capture.overlay && sourceOverlay) {
      const result = await native.request<PresentationResult>('presentation.workbench', sourceOverlay.captureId ? { captureId: sourceOverlay.captureId } : {});
      if (result.accepted === false || revision !== generation.current) return;
    }
    const expired = Boolean(capture.overlay?.captureId && expiredCaptures.current.has(capture.overlay.captureId));
    if (pendingCapture.current?.revision === revision) pendingCapture.current = null;
    setOverlay(expired ? null : capture.overlay); setDoc({ schemaVersion: 2, image, editor: defaultEditor() }); setDocumentEpoch(value => value + 1); setNotice(expired ? (timedOutCaptures.current.has(capture.overlay!.captureId!) ? { text: '选区编辑已超时，截图已保留在工作台。', error: true } : null) : capture.overlay ? null : { text: `已载入 ${image.name}` });
  }
  // 项目校验与图片解码全部完成后才整体替换，并通过 epoch 清空旧画布标注。
  async function acceptProject(value: unknown, revision = ++generation.current) {
    if (revision !== generation.current) return;
    const sourceOverlay = overlayRef.current, project = parseDocument(value);
    if (project.image) {
      project.image = await normalizeImage(project.image);
    }
    if (revision !== generation.current) return;
    if (sourceOverlay) {
      const result = await native.request<PresentationResult>('presentation.workbench', sourceOverlay.captureId ? { captureId: sourceOverlay.captureId } : {});
      if (result.accepted === false || revision !== generation.current) return;
    }
    if (revision === generation.current) { setOverlay(null); setDoc(project); setDocumentEpoch(value => value + 1); setNotice({ text: '项目已打开' }); }
  }
  function applySettings(value: Settings) { setSettings(value); setProviderId(value.defaultProviderId || value.providers[0]?.id || ''); }
  useEffect(() => {
    const unsubscribe = subscribeNative(image => { void acceptImage(image).catch(errorNotice); }, presentation => {
      const expiredId = presentation.timedOutCaptureId || presentation.invalidatedCaptureId;
      if (expiredId) {
        expiredCaptures.current.add(expiredId);
        if (presentation.timedOutCaptureId) timedOutCaptures.current.add(expiredId);
        if (expiredCaptures.current.size > 64) { const oldest = expiredCaptures.current.values().next().value!; expiredCaptures.current.delete(oldest); timedOutCaptures.current.delete(oldest); }
        const activeId = pendingCapture.current?.captureId || overlayRef.current?.captureId;
        if (activeId && activeId !== expiredId) return;
      }
      setOverlay(null);
      if (presentation.reason === 'overlay_timeout') setNotice({ text: '选区编辑未及时就绪，已返回工作台。图片与编辑内容仍保留。', error: true });
    });
    if (native.available) void native.request<Settings>('settings.read').then(applySettings).catch(errorNotice);
    const paste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files || []).find(f => f.type.startsWith('image/'));
      if (file) { event.preventDefault(); const revision = ++generation.current; void fileToImage(file).then(image => acceptImage(image, revision)).catch(errorNotice); }
    };
    window.addEventListener('paste', paste);
    return () => { unsubscribe(); window.removeEventListener('paste', paste); };
  }, []);
  async function openImage() {
    if (!native.available) { imageInput.current?.click(); return; }
    await run('导入图片', async () => { const revision = ++generation.current; const image = await native.request<LoadedImage | null>('image.open'); if (image) await acceptImage(image, revision); });
  }
  // 桌面捕获交给宿主；浏览器粘贴使用本地剪贴板权限与相同图片校验流程。
  async function nativeImage(method: string, label: string) {
    if (!native.available && method === 'image.paste') {
      await run(label, async () => {
        const revision = ++generation.current;
        if (!navigator.clipboard?.read) throw new Error('请按 Ctrl + V 粘贴图片，或使用「导入图片」。');
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const type = item.types.find(type => /^image\/(png|jpeg|webp)$/.test(type));
          if (type) { await acceptImage(await fileToImage(new File([await item.getType(type)], '剪贴板图片.png', { type })), revision); return; }
        }
        throw new Error('剪贴板中没有支持的图片。');
      });
      return;
    }
    await run(label, async () => {
      const revision = ++generation.current;
      const image = await native.request<LoadedImage | CaptureEnvelope | null>(method);
      if (!image || revision !== generation.current) return;
      const capture = parseCapture(image); if (capture.overlay) pendingCapture.current = { captureId: capture.overlay.captureId, revision };
      await acceptImage(image, revision);
    });
  }
  async function openProject() {
    if (!native.available) { projectInput.current?.click(); return; }
    await run('打开项目', async () => { const revision = ++generation.current; const result = await native.request<{ document: unknown } | null>('project.open'); if (result) await acceptProject(result.document, revision); });
  }
  // 写入前重新校验白名单字段，浏览器版本下载 JSON，桌面版本交给宿主保存。
  async function saveProject() {
    await run('保存项目', async () => {
      const document = parseDocument(current.current);
      if (native.available) { const result = await native.request<{ saved: boolean }>('project.save', { document, suggestedName: '拾影项目.screenshot.json' }); if (result.saved) setNotice({ text: '项目已保存' }); }
      else { const url = URL.createObjectURL(new Blob([JSON.stringify(document)], { type: 'application/json' })); download(url, '拾影项目.screenshot.json'); setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice({ text: '项目已导出，请保留此文件以继续编辑。' }); }
    });
  }
  // 保存与复制复用同一 PNG 输出，原生与浏览器只负责最终文件/剪贴板写入。
  async function exportImage(copy = false) {
    await run(copy ? '复制图片' : '导出图片', async () => {
      const dataUrl = await canvas.current!.exportPng(scale);
      if (native.available) {
        const result = await native.request<{ saved?: boolean; copied?: boolean }>(copy ? 'image.copy' : 'image.save', { dataUrl, suggestedName: `${(doc.image?.name || '拾影').replace(/\.[^.]+$/, '')}-${editor.mode}.png` });
        if (result.saved || result.copied) setNotice({ text: copy ? '图片已复制到剪贴板' : 'PNG 已保存' });
      } else if (copy) {
        if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('此浏览器不支持复制图片，请使用导出 PNG。');
        const binary = atob(dataUrl.split(',')[1]); const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]); setNotice({ text: '图片已复制' });
      } else { download(dataUrl, '拾影.png'); setNotice({ text: 'PNG 已导出' }); }
    });
  }
  // 仅响应明确点击；请求完成时校验图片代数和文字快照，保留用户后续修改。
  async function ai(kind: 'ocr' | 'translate') {
    if (aiBusy) return;
    setAiBusy(kind === 'ocr' ? '识别文字' : '翻译文字'); setNotice(null);
    try {
      if (!native.available) throw new Error('OCR 和翻译需要在 Windows 桌面应用中配置服务。');
      if (!providerId) throw new Error('请先打开「服务设置」，配置并选择服务商。本地 ONNX OCR 尚未安装模型。');
      const revision = generation.current, documentRevision = history.currentRevision(), snapshot = history.current(), oldText = snapshot.editor.text;
      const payload = kind === 'ocr' ? { providerId, imageDataUrl: (await imageForProcessing(snapshot)).dataUrl } : { providerId, text: snapshot.editor.text, targetLanguage };
      if (revision !== generation.current || documentRevision !== history.currentRevision()) { setNotice({ text: '内容已修改，未发送之前的 AI 请求。' }); return; }
      const result = await native.request<{ text: string }>(`ai.${kind}`, payload);
      if (revision !== generation.current || documentRevision !== history.currentRevision() || current.current.editor.text !== oldText) { setNotice({ text: '内容已切换或修改，已忽略之前的 AI 结果。' }); return; }
      if (typeof result.text !== 'string' || result.text.length > 20000) throw new Error('服务返回的文字无效或过长。');
      update({ text: result.text, mode: 'reflow' }); setNotice({ text: kind === 'ocr' ? '识别完成，请校对文字后导出。' : '翻译完成，请校对译文后导出。' });
    } catch (error) { errorNotice(error); } finally { setAiBusy(''); }
  }
  // 文件输入和拖放共用入口，限制项目体积后解析 JSON，不执行其中任何代码。
  async function chooseFiles(files: FileList | null) {
    const file = files?.[0]; if (!file) return;
    await run('读取文件', async () => {
      const revision = ++generation.current;
      if (file.name.endsWith('.json')) { if (file.size > 36 * 1024 * 1024) throw new Error('项目文件不能超过 36 MB。'); await acceptProject(JSON.parse(await file.text()), revision); }
      else await acceptImage(await fileToImage(file), revision);
    });
  }
  // 两种呈现共享同一文档；只有主动入口才切换完整工作台，退出会作废旧 AI 回复。
  async function presentation(mode: 'workbench' | 'hidden') {
    await run(mode === 'workbench' ? '打开工作台' : '退出编辑', async () => {
      const revision = generation.current;
      const captureId = overlayRef.current?.captureId;
      const result = await native.request<PresentationResult>(mode === 'workbench' ? 'presentation.workbench' : 'presentation.dismiss', captureId ? { captureId } : {});
      if (result.accepted === false || revision !== generation.current) return;
      if (mode === 'hidden') generation.current++;
      setOverlay(null); setNotice(null);
    });
  }
  // 旧捕获确认不影响新选区；当前确认被拒绝时恢复不透明工作台，保留同一文档。
  function handleReadyResult(captureId: string, result: PresentationResult) {
    if (result.accepted !== false || overlayRef.current?.captureId !== captureId) return;
    if ((pendingCapture.current?.captureId && pendingCapture.current.captureId !== captureId) || (result.captureId && result.captureId !== captureId)) return;
    expiredCaptures.current.add(captureId); setOverlay(null);
    setNotice({ text: '选区显示已失效，已保留图片并返回工作台。', error: true });
  }
  if (overlay && doc.image) return <CompactOverlay key={documentEpoch} document={doc} metadata={overlay} canUndo={history.canUndo} canRedo={history.canRedo} undo={history.undo} redo={history.redo} onTransform={changeTransform} onReadyResult={handleReadyResult} canvasRef={canvas} update={update} onExport={copy => { void exportImage(copy); }} onAi={kind => { void ai(kind); }} onPresentation={mode => { void presentation(mode); }} onConfigure={() => { void run('服务设置', async () => applySettings(await native.request<Settings>('settings.configure'))); }} onSaveProject={() => { void saveProject(); }} onError={errorNotice} busy={busy} aiBusy={aiBusy} settings={settings} providerId={providerId} setProviderId={setProviderId} targetLanguage={targetLanguage} setTargetLanguage={setTargetLanguage} scale={scale} setScale={setScale} notice={notice} clearNotice={() => setNotice(null)}/>;
  return <div className="app" onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); void chooseFiles(event.dataTransfer.files); }}>
    <header className="topbar"><a className="brand" href="#" aria-label="拾影"><span className="brand-mark"><Frame size={22}/></span><strong>拾影</strong><span>SCREENSHOT</span></a><div className="top-actions"><HistoryButtons canUndo={history.canUndo} canRedo={history.canRedo} undo={history.undo} redo={history.redo}/><button onClick={openProject} disabled={!!busy}><FolderOpen/>打开项目</button><button onClick={saveProject} disabled={!!busy || !hasContent}><Save/>保存项目</button><span className="separator"/><button onClick={() => run('服务设置', async () => applySettings(await native.request<Settings>('settings.configure')))} disabled={!!busy}><Settings2/>服务设置</button></div></header>
    <div className="body"><aside className="left-panel"><div className="eyebrow">从这里开始</div><button className="import-button" onClick={openImage} disabled={!!busy}><ImagePlus size={19}/>导入图片<span>+</span></button><div className="capture-actions"><button title={native.available ? '捕获整个桌面' : '需要 Windows 桌面应用'} onClick={() => nativeImage('capture.screen', '捕获桌面')} disabled={!!busy}><Monitor/>桌面</button><button title="在桌面上选择矩形区域" onClick={() => nativeImage('capture.region', '选择区域')} disabled={!!busy}><Crop/>区域</button><button onClick={() => nativeImage('image.paste', '粘贴图片')} disabled={!!busy}><Clipboard/>粘贴</button></div><div className="section-label">编辑意图</div><nav className="modes" aria-label="编辑意图">{modes.map(mode => <button key={mode.id} className={editor.mode === mode.id ? 'selected' : ''} onClick={() => update({ mode: mode.id as Mode })}><mode.icon size={19}/><span><strong>{mode.name}</strong><small>{mode.description}</small></span><span className="mode-dot"/></button>)}</nav><div className="section-label">标注工具</div><div className="tool-grid"><button onClick={() => canvas.current?.add('text')} disabled={!hasContent}><Type/>文字</button><button onClick={() => canvas.current?.add('rect')} disabled={!hasContent}><Frame/>矩形</button><button onClick={() => canvas.current?.remove()} disabled={!hasContent}><Trash2/>删除选中</button></div><AnnotationPalette canvasRef={canvas} onError={errorNotice}/><p className="tool-hint"><MousePointer2 size={13}/>拖动调整位置，双击编辑文字。</p><div className="local-note"><span className="status-dot"/><span>{native.available ? '本地桌面工作台' : '浏览器预览模式'}<small>只有点击 AI 操作才发送内容。</small></span></div></aside>
      <main className="main-panel"><div className="workspace-bar"><div><span className="eyebrow">工作台</span><strong>{doc.image?.name || (editor.mode === 'reflow' ? '文字阅读卡片' : '新的截图')}</strong></div><span className="mode-badge">{modes.find(m => m.id === editor.mode)?.name}</span></div><div className="stage">{hasContent ? <EditorCanvas key={documentEpoch} ref={canvas} document={doc} onAnnotations={(annotations, group) => update({ annotations }, group)} onError={errorNotice}/> : <div className="empty-state"><div className="empty-art" aria-hidden="true"><span className="art-corner top-left"/><span className="art-corner bottom-right"/><div className="art-paper"><div className="paper-sun"/><div className="paper-mountain"/></div><span className="art-caption">每一个好内容，都值得留下。</span></div><div className="eyebrow">CAPTURE. CRAFT. KEEP.</div><h1>留下画面，<br/>也留下你的表达。</h1><p>导入一张图片，或从桌面捕获。<br/>原样保存、精心美化，或将文字重新编排。</p><button className="primary" onClick={openImage} disabled={!!busy}><ImagePlus/>选择一张图片</button><span className="empty-tip">支持拖入 PNG / JPG / WebP · Ctrl + V 粘贴</span></div>}</div><footer className="workspace-footer"><span>{(busy || aiBusy) ? <><span className="spinner"/>{busy || aiBusy}…</> : '编辑在本地完成'}</span><span>{doc.image ? `${doc.image.width} × ${doc.image.height} 原始像素` : '准备好，留下一张好截图。'}</span></footer></main>
      <aside className="right-panel"><div className="inspector-heading"><h2>{editor.mode === 'raw' ? '保留原貌' : editor.mode === 'beauty' ? '画面样式' : '文字排版'}</h2><span>01</span></div>{editor.mode === 'raw' && <div className="raw-note"><FileImage size={30}/><h3>像素，原封不动。</h3><p>不添加背景、圆角或阴影。1× 按当前裁剪与缩放尺寸输出；标注会合并到导出图片。</p></div>}{editor.mode === 'beauty' && <><label className="control-label">背景色</label><div className="swatches">{swatches.map(color => <button key={color} aria-label={`背景 ${color}`} className={editor.background === color ? 'active' : ''} style={{ background: color }} onClick={() => update({ background: color })}>{editor.background === color && <Check size={14} color={color === '#363b37' ? '#f8f4eb' : '#554d42'}/>}</button>)}<input type="color" value={editor.background} onChange={e => update({ background: e.target.value })} aria-label="自定义背景色"/></div><Range label="留白" value={editor.padding} min={0} max={200} onChange={padding => update({ padding })}/><Range label="圆角" value={editor.radius} min={0} max={100} onChange={radius => update({ radius })}/><label className="checkbox-row"><input type="checkbox" checked={editor.shadow} onChange={e => update({ shadow: e.target.checked })}/>柔和阴影</label></>}{editor.mode === 'reflow' && <><label className="control-label" htmlFor="title">卡片标题</label><input id="title" value={editor.title} maxLength={240} onChange={e => update({ title: e.target.value })}/><Range label="文字大小" value={editor.fontSize} min={14} max={64} onChange={fontSize => update({ fontSize })}/><Range label="卡片宽度" value={editor.textWidth} min={360} max={1400} step={20} onChange={textWidth => update({ textWidth })}/></>}
        <TransformPanel document={doc} onTransform={changeTransform}/><div className="inspector-divider"/><div className="ai-heading"><h3><ScanText size={16}/>文字与翻译</h3><span>按需调用</span></div><label className="sr-only" htmlFor="provider">AI 服务</label><select id="provider" value={providerId} onChange={e => setProviderId(e.target.value)}><option value="">{settings.providers.length ? '选择服务商' : '请先配置 AI 服务'}</option>{settings.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select><button className="wide-button" onClick={() => ai('ocr')} disabled={!!busy || !!aiBusy || !doc.image}><ScanText/>从原图识别文字</button><label className="control-label text-label" htmlFor="content">可校对的文字<span>{editor.text.length} / 20000</span></label><textarea id="content" placeholder="在这里输入文字，或从截图中识别。选择「文字重排」即可生成阅读卡片。" value={editor.text} maxLength={20000} onChange={e => update({ text: e.target.value })}/><div className="translate-row"><select aria-label="翻译目标语言" value={targetLanguage} onChange={e => setTargetLanguage(e.target.value)}><option>简体中文</option><option>English</option><option>日本語</option><option>한국어</option></select><button onClick={() => ai('translate')} disabled={!!busy || !!aiBusy || !editor.text.trim()}><Languages/>翻译</button></div><p className="ai-note">识别与翻译会把相应内容发送给所选服务。本地 ONNX 模型尚未安装。</p><div className="export-panel"><div><strong>导出 PNG</strong><select aria-label="导出倍率" value={scale} onChange={e => setScale(Number(e.target.value))}><option value={1}>1× 当前尺寸</option><option value={2}>2× 尺寸</option></select></div><button className="primary" onClick={() => exportImage()} disabled={!!busy || !hasContent}><ArrowDownToLine/>保存图片</button><button className="copy-button" onClick={() => exportImage(true)} disabled={!!busy || !hasContent}><Copy/>复制到剪贴板</button></div></aside></div>
    {notice && <div role={notice.error ? 'alert' : 'status'} className={`notice ${notice.error ? 'error' : ''}`}><span>{notice.text}</span><button aria-label="关闭提示" onClick={() => setNotice(null)}><X size={16}/></button></div>}{dragging && <div className="drop-overlay"><ImagePlus size={44}/><strong>松开，开始编辑。</strong><span>图片或拾影项目文件</span></div>}
    <input className="sr-only" ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { void chooseFiles(e.target.files); e.target.value = ''; }}/><input className="sr-only" ref={projectInput} type="file" accept=".json" onChange={e => { void chooseFiles(e.target.files); e.target.value = ''; }}/>
  </div>;
}
function Range({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) { return <label className="range-control"><span>{label}<output>{value} px</output></span><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))}/></label>; }
