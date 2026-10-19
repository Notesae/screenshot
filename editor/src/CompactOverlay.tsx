import { StyleTools } from './StyleTools';
import { TextTools, CaptureBackendSelector, type TextToolsProps } from './TextTools';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ArrowDownToLine, Check, Copy, Frame, Languages, Maximize2, MoreHorizontal, ScanText, Sparkles, Trash2, Type, X } from 'lucide-react';
import { EditorCanvas, type CanvasHandle } from './EditorCanvas';
import { outputSize, type ContentResize, type SourceCrop, type EditorState, type ProjectDocument } from './document';
import { native, type Settings, type PresentationResult } from './bridge';
import { overlayLayout, type OverlayMetadata } from './overlay';
import { overlayKeyAction } from './keyboard';
import { AnnotationPalette, HistoryButtons, TransformPanel } from './EditControls';

type Props = {
  recoveryPanel: ReactNode; textTools: TextToolsProps; captureBackend: 'wgc' | 'gdi' | null; onCaptureBackend: (backend: 'wgc' | 'gdi') => void;
  document: ProjectDocument; metadata: OverlayMetadata; canvasRef: RefObject<CanvasHandle | null>;
  update: (change: Partial<EditorState>, group?: string) => void; onExport: (copy?: boolean) => void;
  canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void;
  onTransform: (crop: SourceCrop | null, resize: ContentResize | null) => void;
  onAi: (kind: 'ocr' | 'translate') => void; onPresentation: (mode: 'workbench' | 'hidden') => void;
  onConfigure: () => void; onSaveProject: () => void; onError: (error: unknown) => void;
  busy: string; aiBusy: string; settings: Settings; providerId: string; setProviderId: (id: string) => void;
  targetLanguage: string; setTargetLanguage: (language: string) => void; scale: number; setScale: (scale: number) => void;
  notice: { text: string; error?: boolean } | null; clearNotice: () => void;
  onReadyResult: (captureId: string, result: PresentationResult) => void;
};
const colors = ['#e9dfd1', '#e4e9df', '#e1e7ec', '#eadbd8', '#363b37', '#f8f4eb'];

/** 紧凑呈现只保存面板和视口状态，图片、文字、标注和导出均复用 App 的同一个文档。 */
export function CompactOverlay(props: Props) {
  const { document: doc, metadata, canvasRef, update, busy, aiBusy } = props;
  const [panel, setPanel] = useState<'beauty' | 'text' | 'more' | null>(null);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [tools, setTools] = useState({ width: 560, height: 44 });
  const [canvasReady, setCanvasReady] = useState(false);
  const toolbar = useRef<HTMLDivElement>(null), readySent = useRef(false), composing = useRef(false);
  const latest = useRef({ props, panel }); latest.current = { props, panel };
  const editor = doc.editor;
  let output = { width: doc.image?.width || 1, height: doc.image?.height || 1 };
  try { output = outputSize(doc.image, editor); } catch { /* 画布会显示尺寸错误，工具仍可用于缩短文字。 */ }
  const layout = overlayLayout(metadata, viewport, output, editor.mode === 'beauty' ? editor.padding : 0, tools, editor.mode === 'reflow' ? undefined : editor.crop || (editor.resize ? { x: 0, y: 0 } : undefined));

  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    const observer = new ResizeObserver(entries => setTools(size => ({ ...size, height: entries[0].target.getBoundingClientRect().height })));
    if (toolbar.current) observer.observe(toolbar.current);
    return () => { window.removeEventListener('resize', resize); observer.disconnect(); };
  }, []);
  useEffect(() => {
    if (!canvasReady || readySent.current || !metadata.captureId) return;
    let cancelled = false;
    // 隐藏 WebView 不依赖动画帧；布局提交后通知宿主展示，并携带捕获 ID 拒绝迟到确认。
    const timer = setTimeout(() => {
      readySent.current = true;
      void native.request<PresentationResult>('presentation.ready', { captureId: metadata.captureId }).then(result => { if (!cancelled) props.onReadyResult(metadata.captureId!, result); }).catch(error => { if (!cancelled) props.onError(error); });
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [canvasReady, metadata.captureId]);
  useEffect(() => {
    const compositionStart = () => { composing.current = true; }, compositionEnd = () => { composing.current = false; };
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const { props: current, panel: currentPanel } = latest.current;
      const interaction = current.canvasRef.current?.interactionState();
      const target = event.target instanceof Element ? event.target : null;
      const action = overlayKeyAction({ key: event.key, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey, composing: event.isComposing || composing.current, textInput: Boolean(target?.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]')), fabricEditing: interaction?.editing || false, selectedObject: interaction?.selected || false, panelOpen: Boolean(currentPanel), textSelection: Boolean(window.getSelection()?.toString()) });
      if (action === 'ignore') return;
      event.preventDefault(); event.stopPropagation();
      if (action === 'close-panel') setPanel(null);
      else if (action === 'exit-object') current.canvasRef.current?.exitSelection();
      else if (action === 'copy-image') current.onExport(true);
      else current.onPresentation('hidden');
    };
    window.addEventListener('compositionstart', compositionStart); window.addEventListener('compositionend', compositionEnd); window.addEventListener('keydown', keydown);
    return () => { window.removeEventListener('compositionstart', compositionStart); window.removeEventListener('compositionend', compositionEnd); window.removeEventListener('keydown', keydown); };
  }, []);

  return <div className="compact-overlay" aria-label="截图选区编辑">
    <div className="compact-canvas" style={{ left: layout.frame.x, top: layout.frame.y, width: layout.frame.width, height: layout.frame.height }}>
      <EditorCanvas ref={canvasRef} document={doc} fixedDisplayScale={layout.scale} onReady={() => setCanvasReady(true)} onAnnotations={(annotations, group) => update({ annotations }, group)} onError={props.onError}/>
    </div>
    <div className="compact-toolbar" role="toolbar" aria-label="截图工具" ref={toolbar} style={{ left: layout.toolbar.x, top: layout.toolbar.y, width: layout.toolbar.width }}>
      <HistoryButtons canUndo={props.canUndo} canRedo={props.canRedo} undo={props.undo} redo={props.redo}/>
      <button title="添加文字标注" aria-label="添加文字标注" onClick={() => canvasRef.current?.add('text')}><Type/></button><button title="添加矩形标注" aria-label="添加矩形标注" onClick={() => canvasRef.current?.add('rect')}><Frame/></button><span className="compact-divider"/>
      <button className={panel === 'beauty' ? 'active' : ''} aria-expanded={panel === 'beauty'} onClick={() => { update({ mode: 'beauty' }); setPanel(panel === 'beauty' ? null : 'beauty'); }}><Sparkles/>美化</button>
      <button disabled={!!busy || !!aiBusy} onClick={() => { setPanel('text'); }}><ScanText/>OCR</button><button className={panel === 'text' ? 'active' : ''} aria-expanded={panel === 'text'} onClick={() => setPanel(panel === 'text' ? null : 'text')}><Languages/>翻译</button><span className="compact-divider"/>
      <button disabled={!!busy} onClick={() => props.onExport(true)}><Copy/>复制</button><button className="compact-save" disabled={!!busy} onClick={() => props.onExport()}><ArrowDownToLine/>保存</button>
      <button className={panel === 'more' ? 'active' : ''} aria-expanded={panel === 'more'} title="更多与完整工作台" aria-label="更多与完整工作台" onClick={() => setPanel(panel === 'more' ? null : 'more')}><MoreHorizontal/></button><button disabled={!!busy} title="退出选区编辑" aria-label="退出选区编辑" onClick={() => props.onPresentation('hidden')}><X/></button>
    </div>
    {panel && <section className="compact-panel" aria-label={panel === 'beauty' ? '美化选项' : panel === 'text' ? '文字与翻译选项' : '更多选项'} style={{ left: layout.panel.x, top: layout.panel.y, width: layout.panel.width, maxHeight: layout.panel.maxHeight }}>
      <div className="compact-panel-heading"><strong>{panel === 'beauty' ? '美化选区' : panel === 'text' ? '文字与翻译' : '更多操作'}</strong><button aria-label="关闭选项" onClick={() => setPanel(null)}><X/></button></div>
      {panel === 'beauty' && <><StyleTools editor={editor} update={update} onError={props.onError}/><div className="swatches">{colors.map(color => <button key={color} aria-label={`背景 ${color}`} style={{ background: color }} className={editor.background === color ? 'active' : ''} onClick={() => update({ background: color })}>{editor.background === color && <Check size={14}/>}</button>)}</div><CompactRange label="留白" value={editor.padding} max={200} onChange={padding => update({ padding })}/><CompactRange label="圆角" value={editor.radius} max={100} onChange={radius => update({ radius })}/><label className="checkbox-row"><input type="checkbox" checked={editor.shadow} onChange={event => update({ shadow: event.target.checked })}/>柔和阴影</label><button className="compact-secondary" onClick={() => update({ mode: 'raw' })}>恢复原样</button></>}
      {panel === 'text' && <TextTools {...props.textTools} compact/>}
      {panel === 'more' && <><CaptureBackendSelector backend={props.captureBackend} disabled={!!busy} onChange={props.onCaptureBackend}/>{props.recoveryPanel}<div className="compact-size">选区 {doc.image?.width} × {doc.image?.height} 像素</div><AnnotationPalette canvasRef={canvasRef} onError={props.onError}/><button className="compact-secondary" onClick={() => canvasRef.current?.remove()}><Trash2/>删除选中标注</button><TransformPanel document={doc} onTransform={props.onTransform}/><label className="control-label" htmlFor="compact-scale">导出倍率</label><select id="compact-scale" value={props.scale} onChange={event => props.setScale(Number(event.target.value))}><option value={1}>1× 当前尺寸</option><option value={2}>2× 尺寸</option></select><button className="compact-secondary" disabled={!!busy} onClick={props.onSaveProject}>保存可编辑项目</button><button className="compact-secondary" disabled={!!busy} onClick={() => props.onPresentation('workbench')}><Maximize2/>完整工作台</button></>}
    </section>}
    {(busy || aiBusy) && <div className="compact-progress" role="status" style={{ left: layout.toolbar.x, top: Math.max(8, layout.toolbar.y - 27) }}><span className="spinner"/>{busy || aiBusy}…</div>}
    {props.notice && <div className={`compact-notice ${props.notice.error ? 'error' : ''}`} role={props.notice.error ? 'alert' : 'status'} style={{ left: layout.screen.x + 12, top: layout.screen.y + 12, maxWidth: Math.max(80, layout.screen.width - 24) }}><span>{props.notice.text}</span><button aria-label="关闭提示" onClick={props.clearNotice}><X/></button></div>}
  </div>;
}

function CompactRange({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (value: number) => void }) { return <label className="range-control"><span>{label}<output>{value} px</output></span><input type="range" min={0} max={max} value={value} onChange={event => onChange(Number(event.target.value))}/></label>; }
