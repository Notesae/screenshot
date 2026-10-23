import { presentationMotion } from './LiquidMotion';
import {parseTranslationDocument,createTranslationDocument,canResumeTranslation,translationText} from './translationDocument';
import { prepareUpdateSnapshot, prepareLeaveSnapshot, SETTINGS_OPERATION } from './updateSafety';
import { runTranslationChunks,type TranslationChunk } from './translation';
import { RecoveryPanel } from './RecoveryPanel';
import type { RecoveryItem } from './recovery';
import { parseOcr, ocrText, requestMatches, type LocalOcrStatus, type RequestStamp } from './ocr';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { native, subscribeNative, type LoadedImage, type Settings, type PresentationResult } from './bridge';
import { defaultEditor, parseDocument, transformContent, type ContentResize, type SourceCrop, type EditorState, type ProjectDocument } from './document';
import { fileToImage, imageForProcessing, normalizeImage } from './render';
import type { CanvasHandle, CanvasRenderStatus, CanvasSelection } from './EditorCanvas';
import { overlayForImportedImage, parseCapture, type CaptureEnvelope, type OverlayMetadata, type PixelRect } from './overlay';
import { CompactOverlay } from './CompactOverlay';
import { groupImageTextLines, ocrImageRegions, parseImageTranslation, prepareImageTranslation, shouldTranslateImageText } from './imageTranslation';
import { useEditorHistory } from './useEditorHistory';
import { annotationKeyAction, historyKeyAction } from './keyboard';


const initial: ProjectDocument = { schemaVersion: 2, image: null, editor: defaultEditor() };


function download(data: string, name: string) { const link = document.createElement('a'); link.href = data; link.download = name; link.click(); }
function message(error: unknown) { return error instanceof Error ? error.message : '操作失败，请重试。'; }

/** 协调本地编辑、桌面桥接和显式 AI 操作；项目与服务配置互相独立。 */
export default function App() {
  const history = useEditorHistory(initial), doc = history.document;
  const [documentId, setDocumentId] = useState<string>(() => crypto.randomUUID());
  const documentIdRef = useRef(documentId); documentIdRef.current = documentId;
  function setDoc(document: ProjectDocument, restored?: { documentId: string; revision: number }) { const id = restored?.documentId || crypto.randomUUID(); history.reset(document, restored?.revision); documentIdRef.current = id; setDocumentId(id); }
  const [ocrEngine, setOcrEngine] = useState<'local' | 'cloud'>('local');
  const [localStatus, setLocalStatus] = useState<LocalOcrStatus | null>(null);
  const [captureBackend, setCaptureBackend] = useState<'wgc' | 'gdi' | null>(null);
  const aiSequence = useRef(0), aiTaskId = useRef<string | null>(null);
  const [overlay, setOverlay] = useState<OverlayMetadata | null>(null);
  const [overlayReady,setOverlayReady]=useState(false);
  // 暂停的是旧呈现而非文档；解码序号防止旧任务解锁下一次捕获。
  const [loadingCapture,setLoadingCapture]=useState<number|null>(null);
  const [busy, setBusy] = useState('');
  // 取消完成只作废收起意图；已交给系统的复制不能回滚，返回时仍复核身份。
  const completionCancelled=useRef(false);
  const operationRef=useRef(''); // 原生回调读取同步操作状态，避免 React 尚未重绘时误读上一次忙状态。
  const [canvasStatus, setCanvasStatus] = useState<CanvasRenderStatus>('loading');
  const [selection,setSelection] = useState<CanvasSelection|null>(null);
  const [aiBusy, setAiBusy] = useState('');
  const [translationJob,setTranslationJob]=useState<{chunks:TranslationChunk[];stamp:RequestStamp;providerId:string;providerRevision:string;targetLanguage:string}|null>(null);
  const [documentEpoch, setDocumentEpoch] = useState(0);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [hostLocked, setHostLocked] = useState(false);
  const hostLock = useRef(false), savedProject = useRef<{ id:string; revision:number } | null>(null);
  const [entryPanel, setEntryPanel] = useState<{kind:'more'|'recovery';sequence:number}|null>(null);
  const actions = useRef<(action:string,text?:string,error?:boolean)=>void>(()=>{});
  // 成功提示按长度留出阅读时间，错误保持到用户关闭；旧计时器不能清除较新的提示。
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(current => current === notice ? null : current), Math.min(12000, Math.max(6000, notice.text.length * 60)));
    return () => clearTimeout(timer);
  }, [notice]);
  const [settings, setSettings] = useState<Settings>({ providers: [] });
  const [providerId, setProviderId] = useState('');
  const [targetLanguage, setTargetLanguage] = useState('简体中文');
  const providerRevision=settings.providers.find(p=>p.id===providerId)?.revision||'';
  const aiOptions=useRef({providerId,targetLanguage,providerRevision});aiOptions.current={providerId,targetLanguage,providerRevision};
  const [scale, setScale] = useState(1);
  const canvas = useRef<CanvasHandle>(null);
  const imageInput = useRef<HTMLInputElement>(null), projectInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0), current = useRef(doc); current.current = doc;
  const overlayRef = useRef(overlay); overlayRef.current = overlay;
  // 图片对象沿撤销历史保留相应物理选区；不把桌面坐标写进项目或恢复库。
  const captureAdjusting = useRef(false);
  const captureGeometry = useRef(new WeakMap<LoadedImage,OverlayMetadata>());
  const imageGeometry = doc.image && captureGeometry.current.get(doc.image);
  const activeOverlay = overlay && imageGeometry && imageGeometry.captureId===overlay.captureId ? imageGeometry : overlay;
  const overlayReadyRef=useRef(overlayReady);overlayReadyRef.current=overlayReady;
  const pendingCapture = useRef<{ captureId?: string; revision: number } | null>(null);
  const expiredCaptures = useRef(new Set<string>());
  const timedOutCaptures = useRef(new Set<string>());
  const editor = doc.editor;
  useLayoutEffect(() => {
    window.screenshotPrepareUpdate = () => prepareUpdateSnapshot({ operation: busy, aiBusy: Boolean(aiBusy), editing: canvas.current?.interactionState().editing || false, loading: Boolean(doc.image) && canvasStatus !== 'ready', documentId, revision: history.revision, document: history.current() });
    window.screenshotPrepareLeave = reason => {
      if (hostLock.current) return { error: '正在确认编辑状态，请稍后再试。' };
      const snapshot = prepareLeaveSnapshot({ operation:operationRef.current, aiBusy:Boolean(aiBusy), editing:canvas.current?.interactionState().editing || false, loading:Boolean(doc.image) && canvasStatus !== 'ready', documentId, revision:history.currentRevision(), document:history.current(), projectSaved:savedProject.current?.id===documentId && savedProject.current.revision===history.currentRevision() }, reason);
      if (!('error' in snapshot)) {
        hostLock.current=true;setHostLocked(true);
        // 替换意图先使旧 AI 身份失效，捕获等待期间的迟到结果不能成为未保护的新修改。
        if(reason==='replace'&&aiTaskId.current){const taskId=aiTaskId.current;aiSequence.current++;aiTaskId.current=null;setAiBusy('');void native.request('ai.cancel',{taskId}).catch(()=>{});}
      }
      return snapshot;
    };
    window.screenshotFinishLeave = () => { hostLock.current=false; setHostLocked(false); };
    return () => { delete window.screenshotPrepareUpdate; delete window.screenshotPrepareLeave; delete window.screenshotFinishLeave; };
  }, [busy, aiBusy, canvasStatus, documentId, history.revision, doc]);
  useEffect(()=>{
    if(aiBusy)return;
    const data=doc.editor.translationData;
    setTranslationJob(data?{chunks:data.chunks,stamp:requestStamp(),providerId:data.providerId,providerRevision:data.providerRevision,targetLanguage:data.targetLanguage}:null);
  },[documentId,doc.editor.translationData,aiBusy]);

  const errorNotice = (error: unknown) => setNotice({ text: message(error), error: true });
  const update = (change: Partial<EditorState>, group?: string) => {
    if (hostLock.current||captureAdjusting.current) return;
    const fields = Object.keys(change), key = fields[0];
    history.change(change, group || (fields.length === 1 && ['text', 'translation', 'title', 'padding', 'radius', 'fontSize', 'textWidth'].includes(key) ? `input:${key}` : undefined));
  };
  function changeTransform(crop: SourceCrop | null, resize: ContentResize | null) {
    try { history.commitDocument(transformContent(history.current(), crop, resize)); } catch (error) { errorNotice(error); }
  }
  useEffect(() => {
    let composing = false;
    const start = () => { composing = true; }, end = () => { composing = false; };
    const keydown = (event: KeyboardEvent) => {
      if (hostLock.current||captureAdjusting.current) return;
      const target = event.target instanceof Element ? event.target : null, interaction = canvas.current?.interactionState();
      const action = historyKeyAction({ key: event.key, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey, composing: composing || event.isComposing, textInput: Boolean(target?.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]')), fabricEditing: interaction?.editing || false, selectedObject: false, panelOpen: false, textSelection: false });
      if (event.defaultPrevented) return;
      if (annotationKeyAction({ key:event.key, ctrl:event.ctrlKey, meta:event.metaKey, alt:event.altKey, shift:event.shiftKey, composing:composing||event.isComposing, textInput:Boolean(target?.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]')), fabricEditing:interaction?.editing||false, selectedObject:interaction?.selected||false, panelOpen:false, textSelection:false }) === 'delete') { event.preventDefault(); canvas.current?.remove(); return; }
      if (action === 'ignore') return;
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
    if (operationRef.current||hostLock.current) return;
    operationRef.current=label;setBusy(label); setNotice(null);
    try { await action(); } catch (error) { errorNotice(error); } finally { operationRef.current='';setBusy(''); }
  }
  // 每次载入推进代数；旧解码或旧 AI 结果不能覆盖之后打开的内容。
  async function acceptImage(value: unknown, revision = ++generation.current, retainOverlay=false) {
    if (revision !== generation.current) return;
    const sourceOverlay = overlayRef.current;
    if(retainOverlay&&(!sourceOverlay||!overlayReadyRef.current))throw new Error('原位编辑尚未就绪，请稍后导入。');
    const capture = parseCapture(value);
    if(capture.overlay?.captureId&&expiredCaptures.current.has(capture.overlay.captureId)&&!timedOutCaptures.current.has(capture.overlay.captureId))return;
    if (capture.overlay) {pendingCapture.current = { captureId: capture.overlay.captureId, revision };flushSync(()=>setLoadingCapture(revision));}
    try {
      const image = await normalizeImage(capture.image);
      if (revision !== generation.current) return;
      if(capture.overlay?.captureId&&expiredCaptures.current.has(capture.overlay.captureId)&&!timedOutCaptures.current.has(capture.overlay.captureId))return;
      if (native.available && !capture.overlay) await native.request('document.preserve');
      if (revision !== generation.current) return;
      if(retainOverlay&&sourceOverlay){
        if(overlayRef.current?.captureId!==sourceOverlay.captureId||(sourceOverlay.captureId&&expiredCaptures.current.has(sourceOverlay.captureId)))return;
        setOverlay(overlayForImportedImage(sourceOverlay,image));setDoc({schemaVersion:2,image,editor:defaultEditor()});setDocumentEpoch(v=>v+1);setNotice({text:'图片已在原位打开；显示适配不改变原始导出像素。'});return;
      }
      if (!capture.overlay && sourceOverlay) {
        const result = await native.request<PresentationResult>('presentation.editor', sourceOverlay.captureId ? { captureId: sourceOverlay.captureId } : {});
        if (result.accepted === false || revision !== generation.current) return;
      }
      const expired = Boolean(capture.overlay?.captureId && expiredCaptures.current.has(capture.overlay.captureId));
      if (pendingCapture.current?.revision === revision) pendingCapture.current = null;
      if(capture.overlay)captureGeometry.current.set(image,capture.overlay);
      flushSync(()=>{setOverlayReady(false);setOverlay(expired ? null : capture.overlay); setDoc({ schemaVersion: 2, image, editor: defaultEditor() }); setDocumentEpoch(value => value + 1);setLoadingCapture(null);setNotice(expired ? (timedOutCaptures.current.has(capture.overlay!.captureId!) ? { text: '选区编辑已超时，截图已保留在轻量编辑器。', error: true } : null) : capture.overlay ? null : { text: `已载入 ${image.name}` });});
    } finally {setLoadingCapture(current=>current===revision?null:current);if(pendingCapture.current?.revision===revision)pendingCapture.current=null;}
  }
  // 一次调整作为可撤销的文档修改；宿主不重新捕获，不改身份，不丢校对文字和标注。
  async function adjustCapture(area:PixelRect):Promise<boolean> {
    if(hostLock.current||captureAdjusting.current||busy||aiBusy||canvas.current?.interactionState().editing)return false;
    const source=overlayRef.current;
    if(!source?.captureId||source.contentScale||!overlayReadyRef.current)return false;
    captureAdjusting.current=true;let accepted=false;
    try{await run('调整截图选区',async()=>{
      const revision=++generation.current,document=current.current;
      const result=parseCapture(await native.request<CaptureEnvelope>('capture.adjust',{captureId:source.captureId,selection:area}));
      if(revision!==generation.current||overlayRef.current?.captureId!==source.captureId||!result.overlay||result.overlay.captureId!==source.captureId)return;
      const image=await normalizeImage(result.image);
      if(revision!==generation.current||overlayRef.current?.captureId!==source.captureId)return;
      captureGeometry.current.set(image,result.overlay);
      const editor=document.editor.mode==='reflow'?document.editor:transformContent(document,null,null).editor;
      history.commitDocument({...document,image,editor:{...editor,crop:null,resize:null,ocr:null,imageTranslation:null}});
      setSelection(null);accepted=true;
    });}finally{captureAdjusting.current=false;}
    return accepted;
  }
  // 项目校验与图片解码全部完成后才整体替换，并通过 epoch 清空旧画布标注。
  async function acceptProject(value: unknown, revision = ++generation.current, restored?: { documentId: string; revision: number }) {
    if (revision !== generation.current) return;
    const sourceOverlay = overlayRef.current, project = parseDocument(value);
    if (project.image) {
      project.image = await normalizeImage(project.image);
    }
    if (revision !== generation.current) return;
    if (native.available) await native.request('document.preserve');
    if (revision !== generation.current) return;
    if (sourceOverlay) {
      const result = await native.request<PresentationResult>('presentation.editor', sourceOverlay.captureId ? { captureId: sourceOverlay.captureId } : {});
      if (result.accepted === false || revision !== generation.current) return;
    }
    if (revision === generation.current) { setOverlay(null); setDoc(project, restored); setDocumentEpoch(value => value + 1); setNotice({ text: '项目已打开' }); }
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
        if(pendingCapture.current?.captureId===expiredId&&!presentation.timedOutCaptureId){generation.current++;pendingCapture.current=null;setLoadingCapture(null);}
      }
      // 退出或收起后的迟到裁剪不得继续修改已经保护的文档。
      if(captureAdjusting.current)generation.current++;

      // 显式恢复也是新的呈现意图；文件没有 captureId 时，代次仍能阻止迟到成功清空文档。
      if(presentation.reason==='user_editor'||presentation.reason==='user_workbench'){generation.current++;presentationMotion()?.restore();}
      setOverlay(null);
      if (presentation.reason === 'overlay_timeout') setNotice({ text: '选区编辑未及时就绪，已返回轻量编辑器。图片与编辑内容仍保留。', error: true });
    }, (action,text,error) => actions.current(action,text,error));
    if (native.available) {
      void native.request('app.updateReady').catch(() => {});
      void native.request<LocalOcrStatus>('ocr.status').then(value => {
        if (typeof value?.available !== 'boolean' || typeof value.message !== 'string' || typeof value.modelVersion !== 'string' || !Array.isArray(value.missingFiles) || value.missingFiles.some(file => typeof file !== 'string')) throw new Error('本地模型状态无效。');
        setLocalStatus(value);
      }).catch(error => setLocalStatus({ available: false, modelVersion: '', message: message(error), missingFiles: [] }));
      void native.request<{ backend: 'wgc' | 'gdi' }>('capture.settings').then(value => { if (value.backend !== 'wgc' && value.backend !== 'gdi') throw new Error('捕获后端设置无效。'); setCaptureBackend(value.backend); }).catch(errorNotice);
    } else setLocalStatus({ available: false, modelVersion: '', message: '需要 Windows 桌面应用。', missingFiles: [] });
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
  async function nativeImage(method: string, label: string, payload:object={}) {
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
      const capturing=method.startsWith('capture.');if(capturing)flushSync(()=>setLoadingCapture(revision));
      try {
        const image = await native.request<LoadedImage | CaptureEnvelope | null>(method,payload);
        if (!image || revision !== generation.current) return;
        const capture = parseCapture(image); if (capture.overlay) pendingCapture.current = { captureId: capture.overlay.captureId, revision };
        await acceptImage(image, revision);
      } finally {if(capturing)setLoadingCapture(current=>current===revision?null:current);}
    });
  }
  async function openProject() {
    if (!native.available) { projectInput.current?.click(); return; }
    await run('打开项目', async () => { const revision = ++generation.current; const result = await native.request<{ document: unknown } | null>('project.open'); if (result) await acceptProject(result.document, revision); });
  }
  // 恢复记录由用户主动选取；载入依旧经过项目边界和代数检查。
  async function restoreRecovery(item: RecoveryItem) {
    await run('恢复本机记录', async () => {
      const revision = ++generation.current;
      const loaded = await native.request<{ documentId: string; revision: number; document: unknown }>('recovery.load', { documentId: item.documentId });
      if (loaded.documentId !== item.documentId || !Number.isSafeInteger(loaded.revision) || loaded.revision < 0) throw new Error('恢复记录标识或修订无效。');
      await acceptProject(loaded.document, revision, loaded);
    });
  }
  // 写入前重新校验白名单字段，浏览器版本下载 JSON，桌面版本交给宿主保存。
  async function saveProject() {
    await run('保存项目', async () => {
      const document = parseDocument(current.current);
      if (native.available) { const stamp={id:documentIdRef.current,revision:history.currentRevision()}; const result = await native.request<{ saved: boolean }>('project.save', { document, suggestedName: '拾影项目.screenshot.json' }); if (result.saved) { savedProject.current=stamp; setNotice({ text: '项目已保存' }); } }
      else { const url = URL.createObjectURL(new Blob([JSON.stringify(document)], { type: 'application/json' })); download(url, '拾影项目.screenshot.json'); setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice({ text: '项目已导出，请保留此文件以继续编辑。' }); }
    });
  }
  function cancelCompletion(){completionCancelled.current=true;presentationMotion()?.restore();setNotice({text:'已取消收起；已经开始的复制请求可能仍会完成。'});}
  /** 钉图使用当前成品像素；宿主创建成功才收起，迟到或失败恢复导轨，文档和历史保留。 */
  async function pinImage() {
    await run('钉到桌面', async () => {
      if (!native.available) throw new Error('钉到桌面需要在 Windows 桌面应用中使用。');
      const stamp = { documentId: documentIdRef.current, revision: history.currentRevision(), generation: generation.current, captureId: overlayRef.current?.captureId };
      const matches = () => stamp.documentId === documentIdRef.current && stamp.revision === history.currentRevision() && stamp.generation === generation.current && stamp.captureId === overlayRef.current?.captureId;
      let motion: ReturnType<typeof presentationMotion> = null;
      try {
        const dataUrl = await canvas.current!.exportPng(1);
        if (!matches()) return;
        motion = presentationMotion();
        if (motion && !await motion.exit('dismiss')) return;
        if (!matches()) { motion?.restore(); return; }
        const result = await native.request<{ accepted: boolean; pinned?: boolean }>('image.pin', { ...stamp, dataUrl });
        if (!result.accepted || !result.pinned) throw new Error('图片未钉到桌面，编辑状态可能已变化，请重试。');
        if (!matches()) return;
        generation.current++; setOverlay(null); setNotice(null);
      } catch (error) { motion?.restore(); throw error; }
    });
  }
  // 完成只复制当前 PNG；先确认真实结果和身份，再播放收束，最后由宿主隐藏。
  async function completeEditing() {
    await run('完成截图', async () => {
      completionCancelled.current = false;
      const stamp = { documentId: documentIdRef.current, revision: history.currentRevision(), generation: generation.current, captureId: overlayRef.current?.captureId };
      const matches = () => !completionCancelled.current && stamp.documentId === documentIdRef.current && stamp.revision === history.currentRevision() && stamp.generation === generation.current && stamp.captureId === overlayRef.current?.captureId;
      let motion: ReturnType<typeof presentationMotion> = null;
      try {
        const dataUrl = await canvas.current!.exportPng(scale);
        if (!matches()) return;
        if (native.available) {
          const result = await native.request<{ copied: boolean }>('image.copy', { dataUrl });
          if (!matches()) return;
          if (!result.copied) throw new Error('图片未复制成功，请重试。');
        } else {
          if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('此浏览器不支持复制图片，请使用 Windows 桌面应用。');
          const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0));
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
          if (!matches()) return;
        }
        motion = presentationMotion();
        if (motion && !await motion.exit('complete')) return;
        if (!matches()) { motion?.restore(); return; }
        if (native.available) {
          const result = await native.request<{ accepted: boolean }>('presentation.complete', { ...stamp, text: '图片已复制到剪贴板' });
          if (!result.accepted) throw new Error('图片已复制，编辑状态已变化，请重新完成。');
          if (!matches()) return;
          generation.current++; setOverlay(null); setNotice(null);
        } else setNotice({ text: '图片已复制' });
        setDoc(initial); setDocumentEpoch(value => value + 1);
      } catch (error) {
        motion?.restore();
        if (!completionCancelled.current) throw error;
      }
    });
  }
  // 身份、历史修订和请求序号共同保护结果；本地与云端都只响应明确点击。
  function requestStamp(sequence = aiSequence.current): RequestStamp { return { documentId: documentIdRef.current, generation: generation.current, revision: history.currentRevision(), sequence }; }
  // 图片翻译只响应明确点击；独立译文图层同一次入历史，原图保留供撤销、重译和阅读。
  async function translateImage() {
    if(aiBusy||aiTaskId.current||operationRef.current||hostLock.current)return;
    const snapshot=history.current();
    if(!snapshot.image||snapshot.editor.mode==='reflow'){errorNotice(new Error('请在截图画面中使用图片翻译。'));return;}
    if(!providerId){await configureSettings('services');return;}
    const taskId=crypto.randomUUID(),sequence=++aiSequence.current,stamp=requestStamp(sequence);
    const matches=()=>requestMatches(stamp,requestStamp())&&aiOptions.current.providerId===providerId&&aiOptions.current.providerRevision===providerRevision;
    aiTaskId.current=taskId;setAiBusy('翻译图片');setNotice({text:'正在将选区中的外语翻译为中文…'});
    try{
      const input=await imageForProcessing(snapshot);
      if(!matches())return;
      // 有本地文字定位时只发送文字，专用翻译模型无需接收图片或生成坐标 JSON。
      let result:unknown;
      if(localStatus?.available){
        setNotice({text:'正在本地识别选区文字…'});
        const recognized=await native.request<unknown>('ocr.local',{taskId,imageDataUrl:input.dataUrl});
        if(!matches())return;
        const ocr=parseOcr(recognized,{crop:snapshot.editor.crop,resize:snapshot.editor.resize});
        if(ocr.imageWidth!==input.width||ocr.imageHeight!==input.height)throw new Error('识别位置与截图尺寸不一致。');
        const foreign=groupImageTextLines(ocrImageRegions(ocr).filter(block=>shouldTranslateImageText(block.source)));
        if(foreign.length>250||foreign.reduce((sum,block)=>sum+block.source.length+1,0)>20000)throw new Error('选区文字过多，请缩小范围后翻译。');
        const blocks=[];
        const translated=new Map<string,string>();
        for(const [index,block] of foreign.entries()){
          if(!matches())return;
          setNotice({text:'正在翻译 '+(index+1)+' / '+foreign.length+' 处文字…'});
          let text=translated.get(block.source);
          if(text===undefined){
            const id=crypto.randomUUID();aiTaskId.current=id;
            const response=await native.request<{text:string}>('ai.translate',{taskId:id,providerId,providerRevision,text:block.source,targetLanguage:'简体中文',purpose:'image'});
            if(!matches())return;
            if(typeof response.text!=='string'||!response.text.trim()||response.text.length>2000)throw new Error('有一段译文无效或过长，截图尚未修改。');
            text=response.text;translated.set(block.source,text);
          }
          if(text.trim()===block.source.trim())continue;
          blocks.push({...block,text});
        }
        result={blocks};
      }else{
        const model=settings.providers.find(provider=>provider.id===providerId)?.model??'';
        if(/(?:hunyuan-mt|hy-mt)/i.test(model))throw new Error('当前是文字翻译模型，需要先准备本地 OCR；不会把截图发给它。');
        try{result=await native.request<unknown>('ai.translateImage',{taskId,providerId,providerRevision,imageDataUrl:input.dataUrl});}
        catch(error){throw new Error(message(error)+' 当前未能使用本地识别，图片直译需要支持图片输入的模型。');}
      }
      if(!matches())return;
      const returned=parseImageTranslation(result),blocks=returned.filter(block=>shouldTranslateImageText(block.source)&&block.source.trim()!==block.text.trim());
      if(!blocks.length){setNotice({text:'没有发现需要替换的外语文字，截图保持原样。'});return;}
      // 短标签被扩写成解释时明确拒绝，避免将错误长文回填到图中；不自动追加付费重试。
      if(blocks.some(block=>block.source.trim().length<=40&&block.text.trim().length>Math.max(40,block.source.trim().length*2.5)))throw new Error('服务将短语扩写成了说明，未修改截图。请换用直接翻译的模型后重试。');
      const imageTranslation=await prepareImageTranslation(snapshot,blocks,canvas.current?.getDisplayScale?.());
      if(!matches())return;
      const text=blocks.map(block=>block.source).join('\n'),translation=blocks.map(block=>block.text).join('\n');
      history.commitDocument({...snapshot,editor:{...snapshot.editor,imageTranslation,ocr:null,text,translation,translationSource:text,translationData:null}});
      setNotice({text:imageTranslation.blocks.some(block=>block.overflow)?'已按原位置排版；空间不足处保留节选或原文，点击“阅读译文”可看全文。':imageTranslation.blocks.some(block=>block.needsReading)?'已按原位置排版；点击“阅读译文”可放大查看小字和长段落。':'已按原位置翻译，可用撤销恢复原图。'});
    }catch(error){if(sequence===aiSequence.current)errorNotice(error);}
    finally{if(sequence===aiSequence.current){aiTaskId.current=null;setAiBusy('');}}
  }
  async function ai(kind: 'ocr' | 'translate', retry=false) {
    if (aiBusy || aiTaskId.current) return;
    const taskId=crypto.randomUUID(); aiTaskId.current=taskId;
    const sequence = ++aiSequence.current;let stamp = requestStamp(sequence);const snapshot = history.current();
    const local = kind === 'ocr' && ocrEngine === 'local';
    const matches=()=>requestMatches(stamp,requestStamp())&&(local||(aiOptions.current.providerId===providerId&&aiOptions.current.providerRevision===providerRevision&&(kind==='ocr'||aiOptions.current.targetLanguage===targetLanguage)));
    setAiBusy(local ? '本地识别文字' : kind === 'ocr' ? '识别文字' : '翻译文字'); setNotice(null);
    try {
      if (!native.available) throw new Error('OCR 和翻译需要 Windows 桌面应用。');
      if (local ? !localStatus?.available : !providerId) throw new Error(local ? '本地模型不可用，请检查模型状态提示。' : '请先配置并选择 AI 服务。');
      const input = kind === 'ocr' ? await imageForProcessing(snapshot) : null;
      if (!matches()) return;
      let result:unknown;
      if(kind==='translate') {
        const previous=snapshot.editor.translationData;
        if(retry&&(!previous||!canResumeTranslation(previous,snapshot.editor,providerId,providerRevision,targetLanguage)))throw new Error('原文、源块或服务配置已改变，请重新发起翻译。');
        const data=retry?previous!:createTranslationDocument(snapshot.editor,providerId,providerRevision,targetLanguage,previous);
        const chunks=data.chunks;
        const completed=await runTranslationChunks(chunks,async text=>{
          const chunkId=crypto.randomUUID();aiTaskId.current=chunkId;
          const value=await native.request<{text:string}>('ai.translate',{taskId:chunkId,providerId,providerRevision,text,targetLanguage});return value.text;
        },chunks=>{
          if(!matches())return;
          const persisted=parseTranslationDocument({...data,chunks})!;
          history.change({translationData:persisted},`translation-task:${sequence}`);stamp=requestStamp(sequence);
          setTranslationJob({chunks,stamp,providerId,providerRevision,targetLanguage});
        },()=>matches());
        if(!matches())return;
        const failed=completed.filter(c=>c.status==='failed');
        if(failed.length){setNotice({text:`${failed.length} / ${completed.length} 块翻译失败，成功块已保留。可仅重试失败块。`,error:true});return;}
        result={text:translationText({...data,chunks:completed})};
      } else result=await native.request<unknown>(local?'ocr.local':'ai.ocr',{taskId,...(local?{}:{providerId,providerRevision}),imageDataUrl:input!.dataUrl});
      if (!matches()) { setNotice({ text: '内容已切换或修改，已忽略之前的识别或翻译结果。' }); return; }
      if (local) {
        const ocr = parseOcr(result, { crop: snapshot.editor.crop, resize: snapshot.editor.resize });
        if (ocr.imageWidth !== input!.width || ocr.imageHeight !== input!.height) throw new Error('识别坐标与输入尺寸不符。');
        const text = ocrText(ocr); if (!text.trim()) { setNotice({text:'没有识别到新的文字，原有校对内容已保留。可调整范围或换一张更清晰的图片。'}); return; } if (text.length > 20000) throw new Error('识别文字超过20000字，请缩小识别范围。');
        update({ ocr, text, translation: '', translationData:null, textLayout: 'source' });
      } else {
        const text = (result as { text?: unknown })?.text;
        if (typeof text !== 'string' || text.length > 20000) throw new Error('服务返回的文字无效或过长。');
        if (kind === 'ocr' && !text.trim()) { setNotice({text:'没有识别到新的文字，原有校对内容已保留。'}); return; }
        update(kind === 'ocr' ? { text, ocr: null, translation: '', translationData:null, textLayout: 'source' } : { translation: text, translationSource:snapshot.editor.text, textLayout: 'parallel' });
      }
      setNotice({ text: kind === 'ocr' ? '识别完成，请校对文字与阅读顺序。' : '翻译完成，原文已保留，请校对译文。' });
    } catch (error) { if (sequence === aiSequence.current) errorNotice(error); }
    finally { if (sequence===aiSequence.current) {aiTaskId.current=null;setAiBusy('');} }
  }
  async function cancelOcr() {
    const taskId=aiTaskId.current; aiTaskId.current=null; aiSequence.current++; setAiBusy('');
    try { if(taskId) await native.request('ai.cancel',{taskId}); setNotice({ text: '已取消此任务，现有校对内容保持不变。' }); } catch (error) { errorNotice(error); }
  }
  // 所有入口共用一张设置浮卡，关闭后同步服务和截图方式，避免沿用旧状态。
  async function configureSettings(section:'capture'|'services'='capture') {
    await run(SETTINGS_OPERATION, async () => {
      applySettings(await native.request<Settings>('settings.configure', {section}));
      const capture = await native.request<{backend:'wgc'|'gdi'}>('capture.settings');
      if (capture.backend !== 'wgc' && capture.backend !== 'gdi') throw new Error('截图方式无效。');
      setCaptureBackend(capture.backend);
    });
  }
  // 文件输入和拖放共用入口，限制项目体积后解析 JSON，不执行其中任何代码。
  async function chooseFiles(files: FileList | null,retainOverlay=false) {
    const file = files?.[0]; if (!file) return;
    await run('读取文件', async () => {
      const revision = ++generation.current;

      if (file.name.endsWith('.json')) { if (file.size > 36 * 1024 * 1024) throw new Error('项目文件不能超过 36 MB。'); await acceptProject(JSON.parse(await file.text()), revision); }
      else await acceptImage(await fileToImage(file), revision,retainOverlay);
    });
  }
  // 两种呈现共享同一文档；只有主动入口才切换完整轻量编辑器，退出会作废旧 AI 回复。
  async function presentation(mode: 'workbench' | 'hidden') {
    await run(mode === 'workbench' ? '打开轻量编辑器' : '退出编辑', async () => {
      const revision = generation.current;
      const captureId = overlayRef.current?.captureId;
      // 收起仅改变呈现；失败时恢复原位现场，文档与历史始终保留。
      const motion=presentationMotion();
      if(mode==='hidden'&&motion&&!await motion.exit('dismiss'))return;
      if(revision!==generation.current){motion?.restore();return;}
      let result:PresentationResult;
      try { result=await native.request<PresentationResult>(mode === 'workbench' ? 'presentation.editor' : 'presentation.dismiss', captureId ? { captureId } : {}); }
      catch(error){motion?.restore();throw error;}
      if (result.accepted === false || revision !== generation.current) {motion?.restore();return;}
      if (mode === 'hidden') generation.current++;
      setOverlay(null); setNotice(null);
    });
  }
  // 旧捕获确认不影响新选区；当前确认被拒绝时恢复不透明轻量编辑器，保留同一文档。
  function handleReadyResult(captureId: string, result: PresentationResult) {
    if(overlayRef.current?.captureId!==captureId)return;
    if(result.accepted!==false){setOverlayReady(true);return;}
    if ((pendingCapture.current?.captureId && pendingCapture.current.captureId !== captureId) || (result.captureId && result.captureId !== captureId)) return;
    expiredCaptures.current.add(captureId); setOverlay(null);
    setNotice({ text: '选区显示已失效，已保留图片并返回轻量编辑器。', error: true });
  }
  async function probeAi(kind:'text'|'image') {
    if(aiBusy||!providerId)return;
    const taskId=crypto.randomUUID(),sequence=++aiSequence.current;aiTaskId.current=taskId;setAiBusy('测试服务');
    try{const result=await native.request<{text:string}>('ai.test',{taskId,providerId,kind});if(sequence===aiSequence.current)setNotice({text:`${kind==='text'?'文字':'合成图片'}测试收到文字响应；仅证明此时接口可返回文字，不代表OCR准确率或所有功能兼容。${typeof result.text==='string'?' '+result.text.slice(0,120):''}`});}
    catch(error){if(sequence===aiSequence.current)errorNotice(error);}finally{if(sequence===aiSequence.current){aiTaskId.current=null;setAiBusy('');}}
  }
  async function copyPlainText(text: string) {
    await run('复制文字',async()=>{
      if(native.available) await native.request('text.copy',{text});
      else await navigator.clipboard.writeText(text);
      setNotice({text:'文字已复制'});
    });
  }
  const textTools = { onProbe:(kind:"text"|"image")=>{void probeAi(kind);}, translationProgress:translationJob?{done:translationJob.chunks.filter(c=>c.status==='done').length,total:translationJob.chunks.length,failed:translationJob.chunks.filter(c=>c.status==='failed').length,pending:translationJob.chunks.filter(c=>c.status==='pending'||c.status==='running').length,canRetry:!!doc.editor.translationData&&canResumeTranslation(doc.editor.translationData,doc.editor,providerId,providerRevision,targetLanguage),errors:translationJob.chunks.filter(c=>c.error).map(c=>c.error!)}:null, onRetryTranslation:()=>{void ai('translate',true);}, onCopyText:(text:string)=>{void copyPlainText(text);}, document: doc, update, settings, providerId, setProviderId, targetLanguage, setTargetLanguage, ocrEngine, setOcrEngine, localStatus, busy, aiBusy, onAi: (kind: 'ocr' | 'translate') => { void ai(kind); }, onCancelOcr: () => { void cancelOcr(); }, onConfigure: () => { void configureSettings('services'); }, onError: errorNotice };
  const recoveryPanel = <RecoveryPanel onRestore={restoreRecovery} onError={errorNotice} autoOpen/>;
  actions.current=(action,text,error)=>{
    if(action==='open-image')void openImage();
    else if(action==='open-project')void openProject();
    else if(action==='paste')void nativeImage('image.paste','粘贴图片');
    else if(action==='settings')void configureSettings();
    else if(action==='settings-updated'){
      // 托盘设置关闭只刷新公开配置，不恢复窗口、加载图片或改变编辑历史。
      void native.request<Settings>('settings.read').then(applySettings).catch(errorNotice);
      void native.request<{backend:'wgc'|'gdi'}>('capture.settings').then(value=>{if(value.backend==='wgc'||value.backend==='gdi')setCaptureBackend(value.backend);}).catch(errorNotice);
    }
    else if(action==='recovery')setEntryPanel(value=>({kind:action,sequence:(value?.sequence??0)+1}));
    else if(action==='notice'&&text)setNotice({text,error:error!==false});
  };
  return <>
    <input hidden ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>{void chooseFiles(event.currentTarget.files);event.currentTarget.value='';}}/>
    <input hidden ref={projectInput} type="file" accept=".json" onChange={event=>{void chooseFiles(event.currentTarget.files);event.currentTarget.value='';}}/>
    <CompactOverlay onTranslateImage={()=>{void translateImage();}} onCancelAi={()=>{void cancelOcr();}} suspended={loadingCapture!==null} onAdjustCapture={adjustCapture} locked={hostLocked} requestedPanel={entryPanel} onOpenImage={()=>{void openImage();}} onOpenProject={()=>{void openProject();}} onPaste={()=>{void nativeImage('image.paste','粘贴图片');}} selection={selection} onSelection={setSelection} renderStatus={canvasStatus} onRenderStatus={setCanvasStatus} skipReady={overlayReady} onFiles={files=>chooseFiles(files,Boolean(overlay))} onCapture={(method,payload)=>{void nativeImage(method,"捕获屏幕",payload);}} key={documentEpoch} document={doc} metadata={activeOverlay} canUndo={history.canUndo} canRedo={history.canRedo} undo={history.undo} redo={history.redo} onTransform={changeTransform} textTools={textTools} recoveryPanel={recoveryPanel} captureBackend={captureBackend} onReadyResult={handleReadyResult} canvasRef={canvas} update={update} onComplete={() => { void completeEditing(); }} onCancelComplete={cancelCompletion} onPin={() => { void pinImage(); }} onAi={kind => { void ai(kind); }} onPresentation={mode => { void presentation(mode); }} onConfigure={() => { void configureSettings(); }} onSaveProject={() => { void saveProject(); }} onError={errorNotice} busy={busy} aiBusy={aiBusy} settings={settings} providerId={providerId} setProviderId={setProviderId} targetLanguage={targetLanguage} setTargetLanguage={setTargetLanguage} scale={scale} setScale={setScale} notice={notice} clearNotice={() => setNotice(null)}/>
  </>;
}
