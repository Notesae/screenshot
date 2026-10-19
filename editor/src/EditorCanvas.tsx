import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { Canvas, StaticCanvas, FabricImage, Textbox } from 'fabric';
import { Minus, Plus } from 'lucide-react';
import { renderBase } from './render';
import { baseRenderKey } from './renderIdentity';
import { outputSize, type Annotation, type AnnotationKind, type ProjectDocument } from './document';
import { annotationFromObject as serialize, annotationToObject as restore, patchAnnotationObject } from './annotations';

export type CanvasSelection = Pick<Annotation, 'id' | 'type' | 'color' | 'fontSize'>;
export type CanvasRenderStatus = 'loading' | 'ready' | 'error';
export type CanvasHandle = { exportPng: (scale: number) => Promise<string>; add: (type: AnnotationKind) => void; remove: () => void; patchSelection: (change: {color: string; fontSize: number}) => boolean; interactionState: () => { editing: boolean; selected: boolean }; exitSelection: () => void };
type Props = { document: ProjectDocument; onAnnotations: (objects: Annotation[], group?: string) => void; onError: (error: unknown) => void; fixedDisplayScale?: { x: number; y: number }; onReady?: () => void; onRenderStatus?: (status: CanvasRenderStatus) => void; onSelection?: (selection:CanvasSelection|null)=>void };
// 每个底图都是renderBase私有canvas；替换/卸载时归零背板，避免等待GC回收大图像素。
function releaseBackground(canvas:Canvas){
  for(const object of canvas.getObjects())if(object instanceof FabricImage&&!object.selectable){const source=object.getElement();if(source instanceof HTMLCanvasElement)source.width=source.height=0;object.dispose();}
}
/** 保持真实像素尺寸，CSS 只缩放显示，不改变导出分辨率。 */
export const EditorCanvas = forwardRef<CanvasHandle, Props>(function EditorCanvas({ document: doc, onAnnotations, onError, fixedDisplayScale, onReady, onRenderStatus, onSelection }, ref) {
  const element = useRef<HTMLCanvasElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const fabric = useRef<Canvas | null>(null);
  const updating = useRef(false);
  const loaded = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [manualZoom, setManualZoom] = useState<number | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const actualZoom = manualZoom ?? zoom;
  const displayScale = fixedDisplayScale || { x: actualZoom, y: actualZoom };
  const [size, setSize] = useState({ width: 720, height: 480 });
  const callbacks = useRef({ onAnnotations, onError, onRenderStatus, onSelection }); callbacks.current = { onAnnotations, onError, onRenderStatus, onSelection };
  const current = useRef(doc); current.current = doc;
  const properties = baseRenderKey(doc.editor);
  const latestProperties = useRef(properties); latestProperties.current = properties;
  const rendered = useRef<{ image: ProjectDocument['image']; properties: string } | null>(null);
  const lastAnnotations = useRef<Annotation[]>([]);
  const selectedStyle = useRef<CanvasSelection|null>(null);
  function publishSelection() {
    if (updating.current) return;
    const object = fabric.current?.getActiveObject(), annotation = object ? serialize(object) : null;
    const next = annotation ? { id:annotation.id,type:annotation.type,color:annotation.color,fontSize:annotation.fontSize } : null;
    if (JSON.stringify(next) === JSON.stringify(selectedStyle.current)) return;
    selectedStyle.current = next; callbacks.current.onSelection?.(next);
  }
  // 稳定ID使样式重绘及撤销保留同一选择；删除或新文档不自动选择别的对象。
  function restoreObjects(canvas:Canvas, annotations:Annotation[], selectedId?:string) {
    for (const a of annotations) { const object=restore(a);canvas.add(object);if(selectedId&&a.id===selectedId)canvas.setActiveObject(object); }
  }

  useEffect(() => {
    const canvas = new Canvas(element.current!, { enableRetinaScaling: false, preserveObjectStacking: true, selection: false, selectionKey: undefined });
    fabric.current = canvas;
    const changed = (group?: string) => {
      if (fabric.current !== canvas || updating.current || !loaded.current) return;
      const objects = canvas.getObjects().filter(o => o.selectable).map(serialize);
      lastAnnotations.current = objects; callbacks.current.onAnnotations(objects, group);
    };
    canvas.on('selection:created', publishSelection);canvas.on('selection:updated', publishSelection);canvas.on('selection:cleared', publishSelection);
    canvas.on('object:modified', () => changed()); canvas.on('text:changed', event => {
      if (event.target.text.length > 5000) event.target.set({ text: event.target.text.slice(0, 5000) });
      changed(`annotation-text:${serialize(event.target).id}`);
    });
    return () => {
      fabric.current=null;publishSelection();releaseBackground(canvas);
      const lower=canvas.lowerCanvasEl,upper=canvas.upperCanvasEl;
      void canvas.dispose().finally(()=>{lower.width=lower.height=0;upper.width=upper.height=0;});
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    loaded.current = false; callbacks.current.onRenderStatus?.('loading');
    const canvas = fabric.current!;
    (async () => {
      const base = await renderBase(doc);
      if (cancelled) {base.width=base.height=0;return;}
      const selectedId = canvas.getActiveObject() ? serialize(canvas.getActiveObject()!).id : undefined;
      updating.current = true;
      releaseBackground(canvas);canvas.clear(); canvas.setDimensions({ width: base.width, height: base.height });
      canvas.add(new FabricImage(base, { originX: 'left', originY: 'top', selectable: false, evented: false }));
      // 底图异步渲染期间仍可删除或移动标注，恢复时读取最新文档，避免旧闭包复活对象。
      const annotations = current.current.editor.annotations;
      restoreObjects(canvas,annotations,selectedId);
      lastAnnotations.current = annotations;
      setSize({ width: base.width, height: base.height });
      canvas.requestRenderAll(); updating.current = false; rendered.current = { image: doc.image, properties }; loaded.current = true; publishSelection();callbacks.current.onRenderStatus?.('ready');
    })().catch(error => { if (!cancelled) { callbacks.current.onRenderStatus?.('error'); callbacks.current.onError(error); } });
    return () => { cancelled = true; };
    // 标注已直接存在于 Fabric 中，逐字输入时重建会丢失编辑焦点。
  }, [doc.image, properties]);
  // 撤销/重做仅变更标注时同步模型，正常文本输入复用现有对象以保留 IME 焦点。
  useEffect(() => {
    const canvas = fabric.current;
    if (!canvas || !loaded.current || doc.editor.annotations === lastAnnotations.current) return;
    const selectedId = canvas.getActiveObject() ? serialize(canvas.getActiveObject()!).id : undefined;
    updating.current = true; canvas.discardActiveObject();
    canvas.remove(...canvas.getObjects().filter(object => object.selectable));
    restoreObjects(canvas,doc.editor.annotations,selectedId);
    lastAnnotations.current = doc.editor.annotations; canvas.requestRenderAll(); updating.current = false;publishSelection();
  }, [doc.editor.annotations]);
  useEffect(() => {
    if (fixedDisplayScale) return;
    const observer = new ResizeObserver(entries => {
      const box = entries[0].contentRect;
      setZoom(Math.max(.01, Math.min(1, (box.width - 64) / size.width, (box.height - 64) / size.height)));
    });
    if (wrapper.current) observer.observe(wrapper.current);
    return () => observer.disconnect();
  }, [size, fixedDisplayScale?.x, fixedDisplayScale?.y]);
  // 紧凑覆盖层直接使用物理选区映射比例，不执行工作台的留边自适应缩放。
  useEffect(() => {
    fabric.current?.setDimensions({ width: size.width * displayScale.x, height: size.height * displayScale.y }, { cssOnly: true });
    if (loaded.current && rendered.current?.image === current.current.image && rendered.current?.properties === latestProperties.current) onReady?.();
  }, [displayScale.x, displayScale.y, size]);
  useImperativeHandle(ref, () => ({
    async exportPng(scale) {
      // 同时核对模型与已渲染版本，防止快速切换样式时导出上一帧。
      const canvas = fabric.current;
      if (!canvas || !loaded.current || rendered.current?.image !== current.current.image || rendered.current?.properties !== latestProperties.current || lastAnnotations.current !== current.current.editor.annotations) throw new Error('画布正在更新，请稍后重试。');
      outputSize(current.current.image, current.current.editor, scale);
      // 导出独立从模型重建，不含选择手柄；保留活动对象供下一步编辑。
      canvas.renderAll();
      // 未编辑的原样 PNG 跳过重编码，完整保留透明像素数据。
      const doc = current.current;
      if (scale === 1 && doc.editor.mode === 'raw' && !doc.editor.crop && !doc.editor.resize && !doc.editor.annotations.length && doc.image?.dataUrl.startsWith('data:image/png;base64,')) return doc.image.dataUrl;
      // 重排文字在目标倍率重新绘制，避免仅放大预览底图；标注仍由同一 Fabric 对象内核合成。
      const size = outputSize(doc.image, doc.editor, scale), base = await renderBase(doc, scale);
      // 无标注时底图已经是目标像素，直接编码，避免额外Fabric画布及一次整图复制。
      if(!doc.editor.annotations.length){try{return base.toDataURL('image/png');}finally{base.width=0;base.height=0;}}
      const output = new StaticCanvas(undefined, { width:size.width, height:size.height, enableRetinaScaling:false });
      try {
        output.add(new FabricImage(base, { originX:'left',originY:'top',scaleX:1/scale,scaleY:1/scale }));
        for (const annotation of doc.editor.annotations) output.add(restore(annotation));
        return output.toDataURL({ format:'png',multiplier:scale,enableRetinaScaling:false });
      } finally { await output.dispose();base.width=0;base.height=0; }
    },
    add(type) {
      const canvas = fabric.current;
      if (!canvas || !loaded.current || lastAnnotations.current.length >= 100) return;
      const object = restore({ id: crypto.randomUUID(), type, left: size.width * .2, top: size.height * .2, width: Math.min(240, size.width * .6), height: type === 'arrow' ? 24 : Math.min(140, size.height * .5), scaleX: 1, scaleY: 1, angle: 0, text: '双击编辑文字', color: type === 'cover' ? '#30332e' : type === 'highlight' ? '#ffe066' : '#b4432c', fontSize: 26 });
      canvas.add(object); canvas.setActiveObject(object); canvas.requestRenderAll();
      const objects = canvas.getObjects().filter(o => o.selectable).map(serialize);
      lastAnnotations.current = objects; callbacks.current.onAnnotations(objects);
    },
    remove() {
      const canvas = fabric.current;
      if (!canvas) return;
      const removedIds = new Set(canvas.getActiveObjects().map(object => serialize(object).id));
      canvas.remove(...canvas.getActiveObjects()); canvas.discardActiveObject(); canvas.requestRenderAll();
      const objects = loaded.current ? canvas.getObjects().filter(o => o.selectable).map(serialize) : current.current.editor.annotations.filter(annotation => !removedIds.has(annotation.id));
      lastAnnotations.current = objects; callbacks.current.onAnnotations(objects);
    },
    patchSelection(change) {
      const canvas = fabric.current, object = canvas?.getActiveObject();
      if (!canvas || !loaded.current || !object || !/^#[0-9a-f]{6}$/i.test(change.color) || !Number.isFinite(change.fontSize) || change.fontSize < 8 || change.fontSize > 240) return false;
      patchAnnotationObject(object, change); canvas.requestRenderAll();
      const objects = canvas.getObjects().filter(o => o.selectable).map(serialize);
      lastAnnotations.current = objects; callbacks.current.onAnnotations(objects);publishSelection(); return true;
    },
    interactionState() {
      const object = fabric.current?.getActiveObject();
      return { editing: object instanceof Textbox && object.isEditing, selected: Boolean(object) };
    },
    exitSelection() {
      const canvas = fabric.current, object = canvas?.getActiveObject();
      if (object instanceof Textbox && object.isEditing) object.exitEditing();
      else canvas?.discardActiveObject();
      canvas?.requestRenderAll();
    },
  }), [size]);
  // 缩放仅改变 CSS 视图，不修改文档尺寸、历史或导出像素。大画布从左上开始可滚动访问。
  const steps = [.1, .25, .5, .75, 1, 1.5, 2];
  function changeZoom(next: number | null) { setManualZoom(next); viewport.current?.scrollTo({ left:0, top:0 }); }
  function stepZoom(direction: -1 | 1) {
    const candidates = direction > 0 ? steps : [...steps].reverse();
    changeZoom(candidates.find(value => direction > 0 ? value > actualZoom + .001 : value < actualZoom - .001) ?? actualZoom);
  }
  const sheet = <div className="canvas-sheet" style={{ width:size.width * displayScale.x, height:size.height * displayScale.y }}><canvas ref={element}/></div>;
  return <div className="canvas-workspace" ref={wrapper}>{fixedDisplayScale ? sheet : <>
    <div className="canvas-viewport" ref={viewport} tabIndex={0} aria-label="可滚动画布"><div className="canvas-surface" style={{width:size.width * displayScale.x + 64,height:size.height * displayScale.y + 64}}>{sheet}</div></div>
    <div className="canvas-zoom" role="group" aria-label="画布缩放"><button aria-label="缩小画布" disabled={actualZoom <= .1} onClick={() => stepZoom(-1)}><Minus size={14}/></button><select aria-label="画布缩放比例" value={manualZoom ?? 'fit'} onChange={event => changeZoom(event.target.value === 'fit' ? null : Number(event.target.value))}><option value="fit">适应窗口 · {Math.round(zoom * 100)}%</option>{steps.map(value => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}</select><button aria-label="放大画布" disabled={actualZoom >= 2} onClick={() => stepZoom(1)}><Plus size={14}/></button><span className="zoom-label">{size.width} × {size.height} px</span></div>
  </>}</div>;
});
