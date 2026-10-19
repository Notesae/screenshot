import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { Canvas, StaticCanvas, FabricImage, Textbox } from 'fabric';
import { renderBase } from './render';
import { outputSize, type Annotation, type AnnotationKind, type ProjectDocument } from './document';
import { annotationFromObject as serialize, annotationToObject as restore, patchAnnotationObject } from './annotations';

export type CanvasHandle = { exportPng: (scale: number) => Promise<string>; add: (type: AnnotationKind) => void; remove: () => void; patchSelection: (change: {color: string; fontSize: number}) => boolean; interactionState: () => { editing: boolean; selected: boolean }; exitSelection: () => void };
type Props = { document: ProjectDocument; onAnnotations: (objects: Annotation[], group?: string) => void; onError: (error: unknown) => void; fixedDisplayScale?: { x: number; y: number }; onReady?: () => void };
// 每个底图都是renderBase私有canvas；替换/卸载时归零背板，避免等待GC回收大图像素。
function releaseBackground(canvas:Canvas){
  for(const object of canvas.getObjects())if(object instanceof FabricImage&&!object.selectable){const source=object.getElement();if(source instanceof HTMLCanvasElement)source.width=source.height=0;object.dispose();}
}
/** 保持真实像素尺寸，CSS 只缩放显示，不改变导出分辨率。 */
export const EditorCanvas = forwardRef<CanvasHandle, Props>(function EditorCanvas({ document: doc, onAnnotations, onError, fixedDisplayScale, onReady }, ref) {
  const element = useRef<HTMLCanvasElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const fabric = useRef<Canvas | null>(null);
  const updating = useRef(false);
  const loaded = useRef(false);
  const [zoom, setZoom] = useState(1);
  const displayScale = fixedDisplayScale || { x: zoom, y: zoom };
  const [size, setSize] = useState({ width: 720, height: 480 });
  const callbacks = useRef({ onAnnotations, onError }); callbacks.current = { onAnnotations, onError };
  const current = useRef(doc); current.current = doc;
  const properties = JSON.stringify([doc.editor.mode, doc.editor.padding, doc.editor.radius, doc.editor.background, doc.editor.shadow, doc.editor.borderWidth, doc.editor.borderColor, doc.editor.lineSpacing, doc.editor.paragraphSpacing, doc.editor.text, doc.editor.title, doc.editor.fontSize, doc.editor.textWidth, doc.editor.translation, doc.editor.textLayout, doc.editor.crop, doc.editor.resize]);
  const latestProperties = useRef(properties); latestProperties.current = properties;
  const rendered = useRef<{ image: ProjectDocument['image']; properties: string } | null>(null);
  const lastAnnotations = useRef<Annotation[]>([]);
  useEffect(() => {
    const canvas = new Canvas(element.current!, { enableRetinaScaling: false, preserveObjectStacking: true, selection: false, selectionKey: undefined });
    fabric.current = canvas;
    const changed = (group?: string) => {
      if (updating.current || !loaded.current) return;
      const objects = canvas.getObjects().filter(o => o.selectable).map(serialize);
      lastAnnotations.current = objects; callbacks.current.onAnnotations(objects, group);
    };
    canvas.on('object:modified', () => changed()); canvas.on('text:changed', event => {
      if (event.target.text.length > 5000) event.target.set({ text: event.target.text.slice(0, 5000) });
      changed(`annotation-text:${serialize(event.target).id}`);
    });
    return () => {
      fabric.current=null;releaseBackground(canvas);
      const lower=canvas.lowerCanvasEl,upper=canvas.upperCanvasEl;
      void canvas.dispose().finally(()=>{lower.width=lower.height=0;upper.width=upper.height=0;});
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    loaded.current = false;
    const canvas = fabric.current!;
    (async () => {
      const base = await renderBase(doc);
      if (cancelled) {base.width=base.height=0;return;}
      updating.current = true;
      releaseBackground(canvas);canvas.clear(); canvas.setDimensions({ width: base.width, height: base.height });
      canvas.add(new FabricImage(base, { originX: 'left', originY: 'top', selectable: false, evented: false }));
      // 底图异步渲染期间仍可删除或移动标注，恢复时读取最新文档，避免旧闭包复活对象。
      const annotations = current.current.editor.annotations;
      for (const a of annotations) canvas.add(restore(a));
      lastAnnotations.current = annotations;
      setSize({ width: base.width, height: base.height });
      canvas.requestRenderAll(); updating.current = false; rendered.current = { image: doc.image, properties }; loaded.current = true;
    })().catch(error => { if (!cancelled) callbacks.current.onError(error); });
    return () => { cancelled = true; };
    // 标注已直接存在于 Fabric 中，逐字输入时重建会丢失编辑焦点。
  }, [doc.image, properties]);
  // 撤销/重做仅变更标注时同步模型，正常文本输入复用现有对象以保留 IME 焦点。
  useEffect(() => {
    const canvas = fabric.current;
    if (!canvas || !loaded.current || doc.editor.annotations === lastAnnotations.current) return;
    updating.current = true; canvas.discardActiveObject();
    canvas.remove(...canvas.getObjects().filter(object => object.selectable));
    for (const annotation of doc.editor.annotations) canvas.add(restore(annotation));
    lastAnnotations.current = doc.editor.annotations; canvas.requestRenderAll(); updating.current = false;
  }, [doc.editor.annotations]);
  useEffect(() => {
    if (fixedDisplayScale) return;
    const observer = new ResizeObserver(entries => {
      const box = entries[0].contentRect;
      setZoom(Math.min(1, (box.width - 64) / size.width, (box.height - 64) / size.height));
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
      canvas.discardActiveObject(); canvas.renderAll();
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
      lastAnnotations.current = objects; callbacks.current.onAnnotations(objects); return true;
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
  return <div className="canvas-workspace" ref={wrapper}><div className="canvas-sheet" style={{ width: size.width * displayScale.x, height: size.height * displayScale.y }}><canvas ref={element}/></div><span className="zoom-label">{Math.round(displayScale.x * 100)}% · {size.width} × {size.height} px</span></div>;
});
