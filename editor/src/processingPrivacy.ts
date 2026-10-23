import { contentGeometry, type ProjectDocument } from './document';
export type ProcessingMask = { x: number; y: number; width: number; height: number; color: string };
/** 识别副本将马赛克和旧实色遮盖都实色封闭，再缩放；旋转范围保守扩大以隔离采样。 */
export function processingMasks(doc: ProjectDocument): ProcessingMask[] {
  const covers = doc.editor.annotations.filter(a => a.type === 'cover' || a.type === 'mosaic');
  if (!covers.length) return [];
  // 文字卡片的对象属于另一坐标空间，无法证明对应原图时拒绝发送。
  if (doc.editor.mode === 'reflow') throw new Error('文字卡片含遮盖，无法对应原图。请返回原样或美化模式核对遮盖后识别。');
  const { crop, width, height } = contentGeometry(doc.image, doc.editor);
  const pad = doc.editor.mode === 'beauty' ? doc.editor.padding : 0;
  return covers.flatMap(a => {
    const radians = a.angle * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
    const points = [[0, 0], [a.width * a.scaleX, 0], [0, a.height * a.scaleY], [a.width * a.scaleX, a.height * a.scaleY]];
    const xs = points.map(([x, y]) => (a.left - pad + x * c - y * s) * crop.width / width);
    const ys = points.map(([x, y]) => (a.top - pad + x * s + y * c) * crop.height / height);
    const x = Math.max(0, Math.floor(Math.min(...xs)) - 2), y = Math.max(0, Math.floor(Math.min(...ys)) - 2);
    const right = Math.min(crop.width, Math.ceil(Math.max(...xs)) + 2), bottom = Math.min(crop.height, Math.ceil(Math.max(...ys)) + 2);
    return right > x && bottom > y ? [{ x, y, width: right - x, height: bottom - y, color: a.type === 'mosaic' ? '#30332e' : a.color }] : [];
  });
}
