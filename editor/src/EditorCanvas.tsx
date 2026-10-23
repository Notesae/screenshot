import { ControlButton } from './ControlMotion';
import { Select } from './Select';
import { useEffect, useLayoutEffect, useRef, useState, forwardRef, useImperativeHandle, type PointerEvent as ReactPointerEvent } from 'react';
import { Canvas, StaticCanvas, Ellipse, FabricImage, FabricObject, Path, Point, Rect, Textbox } from 'fabric';
import { Minus, Plus } from 'lucide-react';
import { renderBase } from './render';
import { baseRenderKey } from './renderIdentity';
import { contentGeometry, MAX_BRUSH_POINTS, outputSize, type Annotation, type AnnotationKind, type ProjectDocument } from './document';
import { annotationFromObject as serialize, annotationToObject as restore, patchAnnotationObject, positionArrow, positionBrush, type AnnotationChange } from './annotations';
import { renderBeautyContent } from './beautyPreview';
import { annotationStyle } from './annotationAppearance';
import { AnnotationMotion } from './AnnotationMotion';
import { AnnotationElasticity } from './AnnotationElasticity';

// 属性浮卡只接收可编辑的样式，不复制画笔轨迹或马赛克采样图。
export type CanvasSelection = Pick<Annotation, 'id' | 'type' | 'color' | 'fontSize' | 'strokeWidth' | 'blockSize'>;
export type CanvasRenderStatus = 'loading' | 'ready' | 'error';
export type CanvasHandle = { exportPng: (scale: number) => Promise<string>; add: (type: AnnotationKind) => void; remove: () => void; patchSelection: (change: AnnotationChange, group?:string) => boolean; toolStyle: (type: AnnotationKind) => CanvasSelection; patchTool: (type: AnnotationKind, change: AnnotationChange) => boolean; interactionState: () => { editing: boolean; selected: boolean }; exitSelection: () => void; hasAnnotationAt: (event:PointerEvent) => boolean; getDisplayScale?: () => number };
// 设置与历史面板可隐藏视图工具，不卸载画布或影响文档。
type Props = { compareRaw?:boolean;onCompareError?:(error:unknown)=>void; showViewControls?:boolean; document: ProjectDocument; onAnnotations: (objects: Annotation[], group?: string) => void; onError: (error: unknown) => void; fixedDisplayScale?: { x: number; y: number }; onReady?: () => void; onRenderStatus?: (status: CanvasRenderStatus) => void; onSelection?: (selection:CanvasSelection|null)=>void; onDrawingToolChange?: (tool:AnnotationKind|null)=>void };
// 每个底图都是renderBase私有canvas；替换/卸载时归零背板，避免等待GC回收大图像素。
function releaseBackground(canvas:Canvas){
  for(const object of canvas.getObjects())if(object instanceof FabricImage&&!object.selectable){const source=object.getElement();if(source instanceof HTMLCanvasElement)source.width=source.height=0;object.dispose();}
}
/** 保持真实像素尺寸，CSS 只缩放显示，不改变导出分辨率。 */
export const EditorCanvas = forwardRef<CanvasHandle, Props>(function EditorCanvas({ document: doc, onAnnotations, onError, fixedDisplayScale, onReady, onRenderStatus, onSelection, onDrawingToolChange, showViewControls=true,compareRaw=false,onCompareError }, ref) {
  const element = useRef<HTMLCanvasElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const feedbackLayer = useRef<SVGSVGElement>(null), feedback = useRef<AnnotationMotion|null>(null);
  const elasticity = useRef<AnnotationElasticity|null>(null);
  // 只在当前编辑器记住各工具的样式；预设不写项目，实际落笔后才进入撤销历史。
  const toolStyles = useRef<Partial<Record<AnnotationKind, AnnotationChange>>>({});
  const styleFor = (type:AnnotationKind) => ({...annotationStyle(type),...toolStyles.current[type]});
  const fabric = useRef<Canvas | null>(null);
  const updating = useRef(false);
  const loaded = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [manualZoom, setManualZoom] = useState<number | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const actualZoom = manualZoom ?? zoom;
  const displayScale = fixedDisplayScale || { x: actualZoom, y: actualZoom };
  // 异步底图提交也使用当前显示比例，避免先按原尺寸展示一帧再缩放。
  const displayScaleRef=useRef(displayScale);displayScaleRef.current=displayScale;
  const [size, setSize] = useState({ width: 720, height: 480 });
  const callbacks = useRef({ onAnnotations, onError, onRenderStatus, onSelection, onDrawingToolChange }); callbacks.current = { onAnnotations, onError, onRenderStatus, onSelection, onDrawingToolChange };
  const current = useRef(doc); current.current = doc;
  const properties = baseRenderKey(doc.editor);
  const latestProperties = useRef(properties); latestProperties.current = properties;
  const rendered = useRef<{ image: ProjectDocument['image']; properties: string } | null>(null);
  const lastAnnotations = useRef<Annotation[]>([]);
  const [activeTool,setActiveTool]=useState<AnnotationKind|null>(null);
  const tool=useRef<AnnotationKind|null>(null);
  // 草稿只在当前画布预览，松手后整体入历史；取消不生成空对象或撤销记录。
  const drawing=useRef<{type:AnnotationKind;start:Point;object:FabricObject|null;points:Point[];pointer:number;element:HTMLElement}|null>(null);
  const selectedStyle = useRef<CanvasSelection|null>(null);
  function publishSelection() {
    if (updating.current) return;
    const object = fabric.current?.getActiveObject(), annotation = object ? serialize(object) : null;
    const next = annotation ? { id:annotation.id,type:annotation.type,color:annotation.color,fontSize:annotation.fontSize,strokeWidth:annotation.strokeWidth,blockSize:annotation.blockSize } : null;
    if (JSON.stringify(next) === JSON.stringify(selectedStyle.current)) return;
    if (object && next?.id !== selectedStyle.current?.id && !elasticity.current?.active(object)) feedback.current?.pulse(object, 'select');
    selectedStyle.current = next; callbacks.current.onSelection?.(next);
  }
  // 稳定ID使样式重绘及撤销保留同一选择；删除或新文档不自动选择别的对象。
  function restoreObjects(canvas:Canvas, annotations:Annotation[], selectedId?:string) {
    for (const a of annotations) { const object=restore(a);canvas.add(object);if(selectedId&&a.id===selectedId)canvas.setActiveObject(object); }
  }

  // 取消待命或当前草稿，恢复画布命中和选区拖动，不修改已提交的标注。
  function cancelDrawing(keepElasticity=false){
    const draft=drawing.current;drawing.current=null;
    feedback.current?.clear();
    if(!keepElasticity)elasticity.current?.clear();
    if(draft?.object)fabric.current?.remove(draft.object);
    if(draft?.element.hasPointerCapture(draft.pointer))draft.element.releasePointerCapture(draft.pointer);
    tool.current=null;setActiveTool(null);callbacks.current.onDrawingToolChange?.(null);
    if(fabric.current){fabric.current.defaultCursor='default';fabric.current.hoverCursor='move';fabric.current.requestRenderAll();}
  }
  function drawingPoint(event:ReactPointerEvent){
    const canvas=fabric.current!,box=canvas.upperCanvasEl.getBoundingClientRect();
    return new Point(Math.max(0,Math.min(canvas.width,(event.clientX-box.left)*canvas.width/box.width)),Math.max(0,Math.min(canvas.height,(event.clientY-box.top)*canvas.height/box.height)));
  }
  // 工具待命时接管实际画布上的按下，不让 Fabric 或外层将其解释为移动选区。
  function beginDrawing(event:ReactPointerEvent<HTMLDivElement>){
    const canvas=fabric.current,type=tool.current;
    if(!canvas||!loaded.current||!type||event.button!==0||!(event.target instanceof HTMLCanvasElement))return;
    event.preventDefault();event.stopPropagation();
    const start=drawingPoint(event),object=type==='text'?null:restore({id:crypto.randomUUID(),type,left:start.x,top:start.y,width:1,height:1,scaleX:1,scaleY:1,angle:0,text:'',...styleFor(type)});
    feedback.current?.contact(start.x,start.y);
    if(object){object.set({selectable:false,evented:false});canvas.add(object);elasticity.current?.begin(object,start);}
    drawing.current={type,start,object,points:[start],pointer:event.pointerId,element:event.currentTarget};event.currentTarget.setPointerCapture(event.pointerId);
  }
  // 笔迹按真实像素取样并限制点数；Shift 约束正圆或正方形，草稿只在松手时入历史。
  function moveDrawing(event:ReactPointerEvent<HTMLDivElement>){
    const draft=drawing.current;if(!draft||event.pointerId!==draft.pointer||!draft.object)return;
    event.preventDefault();event.stopPropagation();const next=drawingPoint(event);
    if(draft.type==='arrow')positionArrow(draft.object as Path,draft.start,next);
    else if(draft.type==='brush'){
      const previous=draft.points[draft.points.length-1];
      if(previous.distanceFrom(next)<.75&&event.type!=='pointerup')return;
      if(previous.distanceFrom(next)>0){
        // 长笔划逐步稀疏旧采样，首尾保留，避免到上限后尾部突然停止绘制。
        if(draft.points.length>=MAX_BRUSH_POINTS)draft.points=draft.points.filter((_,index)=>index%2===0||index===draft.points.length-1);
        draft.points.push(next);
      }
      positionBrush(draft.object as Path,draft.points);
    }else{
      if((draft.type==='ellipse'||draft.type==='rect')&&event.shiftKey){
        const edge=Math.min(Math.abs(next.x-draft.start.x),Math.abs(next.y-draft.start.y));
        next.setXY(draft.start.x+Math.sign(next.x-draft.start.x)*edge,draft.start.y+Math.sign(next.y-draft.start.y)*edge);
      }
      const width=Math.max(1,Math.abs(next.x-draft.start.x)),height=Math.max(1,Math.abs(next.y-draft.start.y));
      draft.object.set({left:Math.min(draft.start.x,next.x),top:Math.min(draft.start.y,next.y),width,height});
      if(draft.object instanceof Ellipse)draft.object.set({rx:width/2,ry:height/2});
      else if(draft.object instanceof Rect && (draft.type==='rect'||draft.type==='highlight'))draft.object.set({rx:Math.min(6,width/8,height/8),ry:Math.min(6,width/8,height/8)});
      draft.object.setCoords();
    }
    elasticity.current?.update(draft.object,next,true);
    fabric.current?.requestRenderAll();
  }
  // 有效手势只提交一次标注；文字点击定位后进入编辑，几何标注必须拖出范围。
  function endDrawing(event:ReactPointerEvent<HTMLDivElement>){
    const draft=drawing.current,canvas=fabric.current;if(!draft||!canvas||event.pointerId!==draft.pointer)return;
    event.preventDefault();event.stopPropagation();moveDrawing(event);const end=drawingPoint(event);
    const valid=draft.type==='text'||(draft.type==='brush'?draft.points.length>=2:draft.type==='arrow'?draft.start.distanceFrom(end)>=2:Math.abs(end.x-draft.start.x)>=2&&Math.abs(end.y-draft.start.y)>=2);
    if(!valid){elasticity.current?.clear();if(draft.object)canvas.remove(draft.object);drawing.current=null;if(draft.element.hasPointerCapture(draft.pointer))draft.element.releasePointerCapture(draft.pointer);return;}
    const object=draft.object??restore({id:crypto.randomUUID(),type:'text',left:end.x,top:end.y,width:Math.max(30,Math.min(240,canvas.width-end.x)),height:40,scaleX:1,scaleY:1,angle:0,text:'文字',...styleFor('text')});
    if(!draft.object)canvas.add(object);
    drawing.current=null;if(draft.element.hasPointerCapture(draft.pointer))draft.element.releasePointerCapture(draft.pointer);
    cancelDrawing(true);elasticity.current?.release();object.set({selectable:true,evented:true});object.setCoords();canvas.setActiveObject(object);canvas.requestRenderAll();
    if(!elasticity.current?.active(object))feedback.current?.pulse(object);
    const objects=canvas.getObjects().filter(item=>item.selectable).map(serialize);lastAnnotations.current=objects;callbacks.current.onAnnotations(objects);
    if(object instanceof Textbox){object.enterEditing();object.selectAll();}
  }

  useEffect(() => {
    const canvas = new Canvas(element.current!, { enableRetinaScaling: false, preserveObjectStacking: true, selection: false, selectionKey: undefined });
    fabric.current = canvas;
    feedback.current = new AnnotationMotion(feedbackLayer.current!, wrapper.current!);
    elasticity.current = new AnnotationElasticity(wrapper.current!);
    const changed = (group?: string) => {
      if (fabric.current !== canvas || updating.current || !loaded.current) return;
      const objects = canvas.getObjects().filter(o => o.selectable).map(serialize);
      lastAnnotations.current = objects; callbacks.current.onAnnotations(objects, group);
    };
    canvas.on('selection:created', publishSelection);canvas.on('selection:updated', publishSelection);canvas.on('selection:cleared', publishSelection);
    canvas.on('before:transform', event => elasticity.current?.begin(event.transform.target,canvas.getScenePoint(event.e),event.transform.action==='drag'));
    // mouse:move 在 Fabric 更新几何后触发，也覆盖箭头自定义首尾控制点。
    canvas.on('mouse:move', event => {if(event.transform?.actionPerformed)elasticity.current?.update(event.transform.target,event.scenePoint);});
    canvas.on('mouse:up', () => elasticity.current?.release());
    canvas.on('object:modified', event => {changed();if(event.target&&!elasticity.current?.active(event.target))feedback.current?.pulse(event.target);}); canvas.on('text:changed', event => {
      if (event.target.text.length > 5000) event.target.set({ text: event.target.text.slice(0, 5000) });
      changed(`annotation-text:${serialize(event.target).id}`);
    });
    return () => {
      fabric.current=null;
      feedback.current?.dispose();feedback.current=null;
      elasticity.current?.dispose();elasticity.current=null;
      // 错误可能发生在同步重建中；卸载必须绕过事件抑制，清掉跨文档的旧选择。
      selectedStyle.current=null;callbacks.current.onSelection?.(null);releaseBackground(canvas);
      const lower=canvas.lowerCanvasEl,upper=canvas.upperCanvasEl;
      void canvas.dispose().finally(()=>{lower.width=lower.height=0;upper.width=upper.height=0;});
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    feedback.current?.clear();
    elasticity.current?.clear();
    if(tool.current||drawing.current)cancelDrawing();
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
      canvas.setDimensions({width:base.width*displayScaleRef.current.x,height:base.height*displayScaleRef.current.y},{cssOnly:true});
      canvas.renderAll(); updating.current = false; rendered.current = { image: doc.image, properties }; loaded.current = true; publishSelection();callbacks.current.onRenderStatus?.('ready');
    })().catch(error => { if (!cancelled) { updating.current=false;publishSelection();callbacks.current.onRenderStatus?.('error'); callbacks.current.onError(error); } });
    return () => { cancelled = true; };
    // 标注已直接存在于 Fabric 中，逐字输入时重建会丢失编辑焦点。
  }, [doc.image, properties]);
  // 撤销/重做仅变更标注时同步模型，正常文本输入复用现有对象以保留 IME 焦点。
  useEffect(() => {
    const canvas = fabric.current;
    if (!canvas || !loaded.current || doc.editor.annotations === lastAnnotations.current) return;
    feedback.current?.clear();
    elasticity.current?.clear();
    const selectedId = canvas.getActiveObject() ? serialize(canvas.getActiveObject()!).id : undefined;
    updating.current = true; canvas.discardActiveObject();
    canvas.remove(...canvas.getObjects().filter(object => object.selectable));
    restoreObjects(canvas,doc.editor.annotations,selectedId);
    lastAnnotations.current = doc.editor.annotations; canvas.requestRenderAll(); updating.current = false;publishSelection();
  }, [doc.editor.annotations]);
  useEffect(()=>{if(compareRaw){elasticity.current?.clear();feedback.current?.clear();}},[compareRaw]);
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
  useLayoutEffect(() => {
    fabric.current?.setDimensions({ width: size.width * displayScale.x, height: size.height * displayScale.y }, { cssOnly: true });
    if (loaded.current && rendered.current?.image === current.current.image && rendered.current?.properties === latestProperties.current) onReady?.();
  }, [displayScale.x, displayScale.y, size]);
  useImperativeHandle(ref, () => ({
    toolStyle: type => ({ id:'tool-'+type,type,...styleFor(type) }),
    patchTool(type,change) {if(!validStyle(change))return false;toolStyles.current[type]={...styleFor(type),...change};return true;},
    getDisplayScale: () => Math.min(displayScaleRef.current.x, displayScaleRef.current.y),
    // 命中标注时交还 Fabric，空白背景才可拖动截图选区。
    hasAnnotationAt(event) { if(tool.current||drawing.current)return true;const target=fabric.current?.findTarget(event).target;return Boolean(target?.selectable||target?.evented); },
    async exportPng(scale) {
      // 同时核对模型与已渲染版本，防止快速切换样式时导出上一帧。
      const canvas = fabric.current;
      if (!canvas || drawing.current || !loaded.current || rendered.current?.image !== current.current.image || rendered.current?.properties !== latestProperties.current || lastAnnotations.current !== current.current.editor.annotations) throw new Error('画布正在更新，请稍后重试。');
      outputSize(current.current.image, current.current.editor, scale);
      // 导出独立从模型重建，不含选择手柄；保留活动对象供下一步编辑。
      canvas.renderAll();
      // 未编辑的原样 PNG 跳过重编码，完整保留透明像素数据。
      const doc = current.current;
      if (scale === 1 && doc.editor.mode === 'raw' && !doc.editor.crop && !doc.editor.resize && !doc.editor.annotations.length && !doc.editor.imageTranslation && doc.image?.dataUrl.startsWith('data:image/png;base64,')) return doc.image.dataUrl;
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
    // 选择工具只进入待绘制状态，不直接插入预设图形。
    add(type) {
      const canvas=fabric.current;if(!canvas||!loaded.current||lastAnnotations.current.length>=100)return;
      const next=tool.current===type?null:type;cancelDrawing();
      const selected=canvas.getActiveObject();if(selected instanceof Textbox&&selected.isEditing)selected.exitEditing();
      canvas.discardActiveObject();tool.current=next;setActiveTool(next);callbacks.current.onDrawingToolChange?.(next);
      canvas.defaultCursor=next?'crosshair':'default';canvas.hoverCursor=next?'crosshair':'move';canvas.requestRenderAll();
    },
    remove() {
      if(tool.current||drawing.current){cancelDrawing();return;}
      const canvas = fabric.current;
      if (!canvas) return;
      const removedIds = new Set(canvas.getActiveObjects().map(object => serialize(object).id));
      const removed = canvas.getActiveObject();if(removed)feedback.current?.pulse(removed,'remove');
      elasticity.current?.clear();
      canvas.remove(...canvas.getActiveObjects()); canvas.discardActiveObject(); canvas.requestRenderAll();
      const objects = loaded.current ? canvas.getObjects().filter(o => o.selectable).map(serialize) : current.current.editor.annotations.filter(annotation => !removedIds.has(annotation.id));
      lastAnnotations.current = objects; callbacks.current.onAnnotations(objects);
    },
    patchSelection(change, group) {
      const canvas = fabric.current, object = canvas?.getActiveObject();
      if (!canvas || !loaded.current || !object || !validStyle(change)) return false;
      patchAnnotationObject(object, change); canvas.requestRenderAll();
      toolStyles.current[serialize(object).type]={...styleFor(serialize(object).type),...change};
      const objects = canvas.getObjects().filter(o => o.selectable).map(serialize);
      lastAnnotations.current = objects; callbacks.current.onAnnotations(objects,group);publishSelection();feedback.current?.pulse(object); return true;
    },
    interactionState() {
      const object = fabric.current?.getActiveObject();
      return { editing: Boolean(drawing.current)||object instanceof Textbox && object.isEditing, selected: Boolean(object||tool.current||drawing.current) };
    },
    exitSelection() {
      if(tool.current||drawing.current){cancelDrawing();return;}
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
  // 对比占用同一个内容锚点，真正 Fabric 文档和 exportPng 始终保留美化后的配置。
  const sheet = <div className="canvas-sheet" inert={compareRaw} style={{ width:size.width * displayScale.x, height:size.height * displayScale.y }}><canvas ref={element}/><svg ref={feedbackLayer} className="annotation-feedback" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-hidden="true"/>{compareRaw&&<BeautyComparison document={doc} scale={displayScale} onError={onCompareError??onError}/>}</div>;
  // Fabric 会包装原始 canvas；呈现切换必须保留祖先结构，避免 React 移除已被包装的节点。
  return <div className="canvas-workspace" ref={wrapper} data-drawing-tool={activeTool??undefined} onPointerDownCapture={beginDrawing} onPointerMoveCapture={moveDrawing} onPointerUpCapture={endDrawing} onPointerCancel={()=>cancelDrawing()} onLostPointerCapture={()=>{if(drawing.current)cancelDrawing();}}>
    <div className="canvas-viewport" ref={viewport} tabIndex={fixedDisplayScale?-1:0} aria-label={fixedDisplayScale?'选区画布':'可滚动画布'} style={fixedDisplayScale?{position:'relative',inset:'auto',overflow:'visible'}:undefined}><div className="canvas-surface" style={fixedDisplayScale?{width:size.width*displayScale.x,height:size.height*displayScale.y,padding:0,minWidth:0,minHeight:0,alignItems:'flex-start',justifyContent:'flex-start'}:{width:size.width * displayScale.x + 64,height:size.height * displayScale.y + 64}}>{sheet}</div></div>
    <div className="canvas-zoom" hidden={!showViewControls||Boolean(fixedDisplayScale)} style={!showViewControls||fixedDisplayScale?{display:'none'}:undefined} role="group" aria-label="画布缩放"><ControlButton aria-label="缩小画布" disabled={actualZoom <= .1} onClick={() => stepZoom(-1)}><Minus size={14}/></ControlButton><Select aria-label="画布缩放比例" value={manualZoom ?? 'fit'} onChange={value=> changeZoom(value === 'fit' ? null : Number(value))}><option value="fit">适应窗口 · {Math.round(zoom * 100)}%</option>{steps.map(value => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}</Select><ControlButton aria-label="放大画布" disabled={actualZoom >= 2} onClick={() => stepZoom(1)}><Plus size={14}/></ControlButton><span className="zoom-label">{size.width} × {size.height} px</span></div>
  </div>;
});

/** 草稿与已有标注接受相同范围；非法输入不写模型，也不改变下次落笔样式。 */
function validStyle(change:AnnotationChange) {
  return /^#[0-9a-f]{6}$/i.test(change.color) && Number.isFinite(change.fontSize) && change.fontSize>=8 && change.fontSize<=240
    && (change.strokeWidth===undefined || Number.isFinite(change.strokeWidth)&&change.strokeWidth>=1&&change.strokeWidth<=48)
    && (change.blockSize===undefined || Number.isFinite(change.blockSize)&&change.blockSize>=6&&change.blockSize<=64);
}

/** 完整原样内容准备好后原子换入；旧结果、关闭或卸载释放背板，不改变主画布状态。 */
function BeautyComparison({document:doc,scale,onError}:{document:ProjectDocument;scale:{x:number;y:number};onError:(error:unknown)=>void}) {
  const root=useRef<HTMLDivElement>(null),[ready,setReady]=useState(false),errorHandler=useRef(onError);errorHandler.current=onError;
  const content=contentGeometry(doc.image,doc.editor),padding=doc.editor.mode==='beauty'?doc.editor.padding:0;
  useEffect(()=>{
    let cancelled=false,backing:HTMLCanvasElement|null=null;const node=root.current!,sheet=node.parentElement!;
    void renderBeautyContent(doc,16000).then(canvas=>{
      if(cancelled){canvas.width=canvas.height=0;return;}
      backing=canvas;node.append(canvas);sheet.dataset.beautyComparing='';setReady(true);
    }).catch(error=>{if(!cancelled)errorHandler.current(error);});
    return()=>{cancelled=true;delete sheet.dataset.beautyComparing;if(backing){backing.remove();backing.width=backing.height=0;}};
  },[doc]);
  return <><div ref={root} className="beauty-comparison" role="img" aria-label="原样对比，保留标注、遮盖与译文" style={{left:padding*scale.x,top:padding*scale.y,width:content.width*scale.x,height:content.height*scale.y}}/>{!ready&&<span className="beauty-comparison-pending" role="status">正在准备原样对比…</span>}</>;
}
