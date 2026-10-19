import { useEffect, useState, type RefObject } from 'react';
import { ArrowUpRight, Highlighter, Redo2, Square, Undo2 } from 'lucide-react';
import { contentGeometry, type ContentResize, type ProjectDocument, type SourceCrop } from './document';
import type { CanvasHandle } from './EditorCanvas';

export function HistoryButtons({ canUndo, canRedo, undo, redo }: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void }) {
  return <><button title="撤销 Ctrl+Z" aria-label="撤销" disabled={!canUndo} onClick={undo}><Undo2/></button><button title="重做 Ctrl+Y" aria-label="重做" disabled={!canRedo} onClick={redo}><Redo2/></button></>;
}
/** 工具只调用同一个画布内核；样式应用是可撤销的完整对象变更。 */
export function AnnotationPalette({ canvasRef, onError }: { canvasRef: RefObject<CanvasHandle | null>; onError: (error: unknown) => void }) {
  const [color, setColor] = useState('#30332e'), [fontSize, setFontSize] = useState(26);
  return <div className="annotation-palette"><div className="palette-shapes"><button onClick={() => canvasRef.current?.add('arrow')}><ArrowUpRight/>箭头</button><button onClick={() => canvasRef.current?.add('highlight')}><Highlighter/>高亮</button><button title="实色遮盖用于 PNG 和 OCR 输入；项目仍含原图" onClick={() => canvasRef.current?.add('cover')}><Square/>遮盖</button></div><div className="annotation-properties"><label>颜色<input aria-label="标注颜色" type="color" value={color} onChange={event => setColor(event.target.value)}/></label><label>字号<input aria-label="标注字号" type="number" min={8} max={240} value={fontSize} onChange={event => setFontSize(Number(event.target.value))}/></label><button onClick={() => { if (!canvasRef.current?.patchSelection({ color, fontSize })) onError(new Error('请先选中标注，字号范围为8至240。')); }}>应用到选中标注</button></div><p className="compact-privacy">遮盖为不透明实色。分享脱敏结果请导出 PNG；可编辑项目仍包含原图。</p></div>;
}

/** 数值裁剪与等比缩放是一次显式事务，未应用的输入草稿不会改变文档。 */
export function TransformPanel({ document: doc, onTransform }: { document: ProjectDocument; onTransform: (crop: SourceCrop | null, resize: ContentResize | null) => void }) {
  const content = contentGeometry(doc.image, doc.editor);
  const [crop, setCrop] = useState(content.crop), [width, setWidth] = useState(content.width);
  useEffect(() => { const content = contentGeometry(doc.image, doc.editor); setCrop(content.crop); setWidth(content.width); }, [doc.image, doc.editor.crop, doc.editor.resize]);
  if (!doc.image) return null;
  return <div className="transform-controls"><h3>裁剪与比例缩放</h3>{doc.editor.mode === 'reflow' ? <p className="compact-privacy">请切换原样或美化模式调整图片尺寸。</p> : <><p className="compact-privacy">裁剪坐标使用原图像素，修改可撤销。</p><div className="crop-inputs">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{({ x: 'X', y: 'Y', width: '宽', height: '高' })[key]}<input aria-label={`裁剪${key}`} type="number" min={key === 'x' || key === 'y' ? 0 : 1} max={16000} value={crop[key]} onChange={event => setCrop(value => ({ ...value, [key]: Number(event.target.value) }))}/></label>)}</div><button className="compact-secondary" onClick={() => onTransform(crop, null)}>应用裁剪</button><label className="resize-width">缩放宽度<input aria-label="缩放宽度" type="number" min={1} max={16000} value={width} onChange={event => setWidth(Number(event.target.value))}/><span>× {Math.max(1, Math.round(width * content.crop.height / content.crop.width))} px</span></label><button className="compact-secondary" onClick={() => onTransform(doc.editor.crop, { width, height: Math.max(1, Math.round(width * content.crop.height / content.crop.width)) })}>应用缩放</button><button className="compact-secondary" onClick={() => onTransform(null, null)}>还原原图尺寸</button></>}</div>;
}
