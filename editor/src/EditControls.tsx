import { MotionButton } from './LiquidMotion';
import { useEffect, useState, type RefObject } from 'react';
import { ColorField } from './ColorField';
import { ArrowUpRight, Highlighter, Redo2, Square, Undo2 } from 'lucide-react';
import { contentGeometry, type ContentResize, type ProjectDocument, type SourceCrop } from './document';
import type { CanvasHandle, CanvasSelection } from './EditorCanvas';

export function HistoryButtons({ canUndo, canRedo, undo, redo }: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void }) {
  return <><MotionButton group="history" data-tooltip="撤销 Ctrl+Z" aria-label="撤销" disabled={!canUndo} onClick={undo}><Undo2/></MotionButton><MotionButton group="history" data-tooltip="重做 Ctrl+Y" aria-label="重做" disabled={!canRedo} onClick={redo}><Redo2/></MotionButton></>;
}
/** 属性只针对当前标注，修改即时应用且沿用画布撤销；不重复堆放绘制工具。 */
export function AnnotationPalette({ canvasRef, onError, selection, disabled=false }: { canvasRef: RefObject<CanvasHandle | null>; onError: (error: unknown) => void; selection:CanvasSelection|null; disabled?:boolean }) {
  const [color,setColor]=useState('#30332e'),[fontSize,setFontSize]=useState(26);
  useEffect(()=>{if(selection){setColor(selection.color);setFontSize(selection.fontSize);}},[selection?.id,selection?.color,selection?.fontSize]);
  if(!selection)return <p className="selection-summary">选择一个标注以调整属性。</p>;
  const invalidFont=!Number.isFinite(fontSize)||fontSize<8||fontSize>240;
  return <div className="annotation-palette">
    <p className="selection-summary">{({text:'文字',rect:'矩形',arrow:'箭头',highlight:'高亮',cover:'实色遮盖'})[selection.type]}</p>
    <div className="annotation-properties">
      <label>颜色<ColorField label="标注颜色" disabled={disabled} value={color} onChange={next=>{setColor(next);if(!canvasRef.current?.patchSelection({color:next,fontSize:selection.fontSize}))onError(new Error('当前标注暂时无法修改，请稍后重试。'));}}/></label>
      {selection.type==='text'&&<label>字号<div className="clay-unit-field"><input aria-label="标注字号" aria-invalid={invalidFont||undefined} disabled={disabled} type="number" min={8} max={240} value={Number.isNaN(fontSize)?'':fontSize} onChange={event=>{const next=event.target.valueAsNumber;setFontSize(next);if(next>=8&&next<=240&&!canvasRef.current?.patchSelection({color,fontSize:next}))onError(new Error('当前标注暂时无法修改，请稍后重试。'));}} onBlur={()=>{if(invalidFont)setFontSize(selection.fontSize);}}/><span>px</span></div></label>}
    </div>
    {selection.type==='text'&&invalidFont&&<p className="field-error">字号范围为 8–240 px。</p>}
    {selection.type==='cover'&&<p className="compact-privacy">遮盖只应用于复制的图片，项目文件仍保留原图。</p>}
  </div>;
}

/** 数值裁剪与等比缩放是一次显式事务，未应用的输入草稿不会改变文档。 */
export function TransformPanel({ document: doc, onTransform }: { document: ProjectDocument; onTransform: (crop: SourceCrop | null, resize: ContentResize | null) => void }) {
  const content = contentGeometry(doc.image, doc.editor);
  const [crop, setCrop] = useState(content.crop), [width, setWidth] = useState(content.width);
  useEffect(() => { const content = contentGeometry(doc.image, doc.editor); setCrop(content.crop); setWidth(content.width); }, [doc.image, doc.editor.crop, doc.editor.resize]);
  if (!doc.image) return null;
  return <div className="transform-controls"><h3>裁剪与比例缩放</h3>{doc.editor.mode === 'reflow' ? <p className="compact-privacy">请切换原样或美化模式调整图片尺寸。</p> : <><p className="compact-privacy">裁剪坐标使用原图像素，修改可撤销。</p><div className="crop-inputs">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{({ x: 'X', y: 'Y', width: '宽', height: '高' })[key]}<input aria-label={`裁剪${key}`} type="number" min={key === 'x' || key === 'y' ? 0 : 1} max={16000} value={crop[key]} onChange={event => setCrop(value => ({ ...value, [key]: Number(event.target.value) }))}/></label>)}</div><button className="compact-secondary" onClick={() => onTransform(crop, null)}>应用裁剪</button><label className="resize-width">缩放宽度<input aria-label="缩放宽度" type="number" min={1} max={16000} value={width} onChange={event => setWidth(Number(event.target.value))}/><span>× {Math.max(1, Math.round(width * content.crop.height / content.crop.width))} px</span></label><button className="compact-secondary" onClick={() => onTransform(doc.editor.crop, { width, height: Math.max(1, Math.round(width * content.crop.height / content.crop.width)) })}>应用缩放</button><button className="compact-secondary" onClick={() => onTransform(null, null)}>还原原图尺寸</button></>}</div>;
}
