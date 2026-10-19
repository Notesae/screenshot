import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { Canvas, FabricImage, Textbox, Rect, type FabricObject } from 'fabric';
import { FONT, renderBase } from './render';
import { outputSize, type Annotation, type ProjectDocument } from './document';

export type CanvasHandle = { exportPng: (scale: number) => Promise<string>; add: (type: 'text' | 'rect') => void; remove: () => void; interactionState: () => { editing: boolean; selected: boolean }; exitSelection: () => void };
type Props = { document: ProjectDocument; onAnnotations: (objects: Annotation[]) => void; onError: (error: unknown) => void; fixedDisplayScale?: { x: number; y: number }; onReady?: () => void };
// 从 Fabric 提取受支持的几何与文字属性，供项目白名单校验。
function serialize(object: FabricObject): Annotation {
  return { type: object instanceof Textbox ? 'text' : 'rect', left: object.left, top: object.top, width: Math.max(1, object.width), height: Math.max(1, object.height), scaleX: object.scaleX, scaleY: object.scaleY, angle: object.angle, text: object instanceof Textbox ? object.text : '', color: String(object instanceof Textbox ? object.fill : object.stroke), fontSize: object instanceof Textbox ? object.fontSize : 26 };
}
// 只重建文字与矩形，禁止缩放翻转，保证保存后的几何可还原。
function restore(a: Annotation): FabricObject {
  const props = { originX: 'left' as const, originY: 'top' as const, left: a.left, top: a.top, width: a.width, height: a.height, scaleX: a.scaleX, scaleY: a.scaleY, angle: a.angle, cornerColor: '#b4432c', borderColor: '#b4432c', transparentCorners: false, lockScalingFlip: true };
  return a.type === 'text' ? new Textbox(a.text, { ...props, fontFamily: FONT, fontSize: a.fontSize, fill: a.color, splitByGrapheme: true }) : new Rect({ ...props, fill: 'transparent', stroke: a.color, strokeWidth: 3, strokeUniform: true });
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
  const properties = JSON.stringify([doc.editor.mode, doc.editor.padding, doc.editor.radius, doc.editor.background, doc.editor.shadow, doc.editor.text, doc.editor.title, doc.editor.fontSize, doc.editor.textWidth]);
  const latestProperties = useRef(properties); latestProperties.current = properties;
  const rendered = useRef<{ image: ProjectDocument['image']; properties: string } | null>(null);
  const lastAnnotations = useRef<Annotation[]>([]);
  useEffect(() => {
    const canvas = new Canvas(element.current!, { enableRetinaScaling: false, preserveObjectStacking: true, selection: false, selectionKey: undefined });
    fabric.current = canvas;
    const changed = () => {
      if (updating.current) return;
      const objects = canvas.getObjects().filter(o => o.selectable).map(serialize);
      lastAnnotations.current = objects; callbacks.current.onAnnotations(objects);
    };
    canvas.on('object:modified', changed); canvas.on('text:changed', changed);
    return () => { fabric.current = null; void canvas.dispose(); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    loaded.current = false;
    const canvas = fabric.current!;
    (async () => {
      const base = await renderBase(doc);
      if (cancelled) return;
      updating.current = true;
      canvas.clear(); canvas.setDimensions({ width: base.width, height: base.height });
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
  }, [doc.image, doc.editor.mode, doc.editor.padding, doc.editor.radius, doc.editor.background, doc.editor.shadow, doc.editor.text, doc.editor.title, doc.editor.fontSize, doc.editor.textWidth]);
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
      if (!canvas || !loaded.current || rendered.current?.image !== current.current.image || rendered.current?.properties !== latestProperties.current) throw new Error('画布正在更新，请稍后重试。');
      outputSize(current.current.image, current.current.editor, scale);
      canvas.discardActiveObject(); canvas.renderAll();
      // 未编辑的原样 PNG 跳过重编码，完整保留透明像素数据。
      const doc = current.current;
      if (scale === 1 && doc.editor.mode === 'raw' && !doc.editor.annotations.length && doc.image?.dataUrl.startsWith('data:image/png;base64,')) return doc.image.dataUrl;
      return canvas.toDataURL({ format: 'png', multiplier: scale, enableRetinaScaling: false });
    },
    add(type) {
      const canvas = fabric.current;
      if (!canvas || !loaded.current || lastAnnotations.current.length >= 100) return;
      const object = restore({ type, left: size.width * .2, top: size.height * .2, width: Math.min(240, size.width * .6), height: Math.min(140, size.height * .5), scaleX: 1, scaleY: 1, angle: 0, text: '双击编辑文字', color: '#b4432c', fontSize: 26 });
      canvas.add(object); canvas.setActiveObject(object); canvas.requestRenderAll();
      const objects = canvas.getObjects().filter(o => o.selectable).map(serialize);
      lastAnnotations.current = objects; callbacks.current.onAnnotations(objects);
    },
    remove() {
      const canvas = fabric.current;
      if (!canvas) return;
      canvas.remove(...canvas.getActiveObjects()); canvas.discardActiveObject(); canvas.requestRenderAll();
      const objects = canvas.getObjects().filter(o => o.selectable).map(serialize);
      lastAnnotations.current = objects; callbacks.current.onAnnotations(objects);
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
