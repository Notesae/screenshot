import { ControlButton } from './ControlMotion';
import { MotionButton } from './LiquidMotion';
import { useEffect, useState } from 'react';
import { Redo2, Undo2 } from 'lucide-react';
import { contentGeometry, type ContentResize, type ProjectDocument, type SourceCrop } from './document';

export function HistoryButtons({ canUndo, canRedo, undo, redo }: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void }) {
  return <><MotionButton group="history" data-tooltip="撤销 Ctrl+Z" aria-label="撤销" disabled={!canUndo} onClick={undo}><Undo2/></MotionButton><MotionButton group="history" data-tooltip="重做 Ctrl+Y" aria-label="重做" disabled={!canRedo} onClick={redo}><Redo2/></MotionButton></>;
}
export { AnnotationPalette } from './AnnotationPalette';

/** 数值裁剪与等比缩放是一次显式事务，未应用的输入草稿不会改变文档。 */
export function TransformPanel({ document: doc, onTransform }: { document: ProjectDocument; onTransform: (crop: SourceCrop | null, resize: ContentResize | null) => void }) {
  const content = contentGeometry(doc.image, doc.editor);
  const [crop, setCrop] = useState(content.crop), [width, setWidth] = useState(content.width);
  useEffect(() => { const content = contentGeometry(doc.image, doc.editor); setCrop(content.crop); setWidth(content.width); }, [doc.image, doc.editor.crop, doc.editor.resize]);
  if (!doc.image) return null;
  return <div className="transform-controls"><h3>裁剪与比例缩放</h3>{doc.editor.mode === 'reflow' ? <p className="compact-privacy">请切换原样或美化模式调整图片尺寸。</p> : <><p className="compact-privacy">裁剪坐标使用原图像素，修改可撤销。</p><div className="crop-inputs">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{({ x: 'X', y: 'Y', width: '宽', height: '高' })[key]}<input aria-label={`裁剪${key}`} type="number" min={key === 'x' || key === 'y' ? 0 : 1} max={16000} value={crop[key]} onChange={event => setCrop(value => ({ ...value, [key]: Number(event.target.value) }))}/></label>)}</div><ControlButton className="compact-secondary" onClick={() => onTransform(crop, null)}>应用裁剪</ControlButton><label className="resize-width">缩放宽度<input aria-label="缩放宽度" type="number" min={1} max={16000} value={width} onChange={event => setWidth(Number(event.target.value))}/><span>× {Math.max(1, Math.round(width * content.crop.height / content.crop.width))} px</span></label><ControlButton className="compact-secondary" onClick={() => onTransform(doc.editor.crop, { width, height: Math.max(1, Math.round(width * content.crop.height / content.crop.width)) })}>应用缩放</ControlButton><ControlButton className="compact-secondary" onClick={() => onTransform(null, null)}>还原原图尺寸</ControlButton></>}</div>;
}
