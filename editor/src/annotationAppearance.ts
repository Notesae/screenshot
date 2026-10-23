import type { AnnotationKind } from './document';

/** 文档颜色与界面主题分开；每种工具的默认笔触也用于属性卡的真实样式预览。 */
export const annotationNames: Record<AnnotationKind, string> = { text: '文字', rect: '矩形', ellipse: '圆形', arrow: '箭头', brush: '画笔', highlight: '高亮', mosaic: '马赛克', cover: '实色遮盖' };
export const annotationHints: Record<AnnotationKind, string> = {
  text: '点击画面输入文字，双击已有文字继续编辑。', rect: '拖动框出重点，按住 Shift 绘制正方形。', ellipse: '拖动圈出重点，按住 Shift 绘制正圆。',
  arrow: '从起点拖向目标，选中后可拖动两端。', brush: '按住拖动画线，松手完成一笔。', highlight: '拖动覆盖重点，保留下方内容。', mosaic: '拖动覆盖需要模糊的区域。', cover: '拖动调整遮盖位置与大小。'
};
export function annotationStyle(type: AnnotationKind) {
  return { color: type === 'cover' ? '#30332e' : type === 'highlight' ? '#fbbf24' : '#ef4444', fontSize: 26, strokeWidth: type === 'arrow' || type === 'brush' ? 4 : 3, blockSize: 12 };
}
export const hasStroke = (type: AnnotationKind) => ['rect', 'ellipse', 'arrow', 'brush'].includes(type);

/** 圆尾、渐宽箭杆与实心箭镞共用一个封闭轮廓；宽高仍是现有首尾几何的包围框。 */
export function arrowPath(width: number, height: number, weight: number) {
  const w = Math.max(1, width), h = Math.max(1, height), y = h / 2;
  const shaft = Math.min(weight / 2, h * .18, w * .12), neck = w - Math.min(w * .45, h * .85), round = Math.min(shaft * .55, h * .05);
  return `M${shaft} ${y - shaft} Q${neck * .7} ${y - shaft} ${neck} ${y - shaft * 1.25}`
    + ` L${neck} ${round} Q${neck} 0 ${neck + round} 0`
    + ` L${w} ${y} L${neck + round} ${h} Q${neck} ${h} ${neck} ${h - round}`
    + ` L${neck} ${y + shaft * 1.25} Q${neck * .7} ${y + shaft} ${shaft} ${y + shaft}`
    + ` A${shaft} ${shaft} 0 0 1 ${shaft} ${y - shaft} Z`;
}

/** 中点二次曲线经过首尾、平滑相邻采样；不增加采样点，不改变原始笔迹的保存格式。 */
export function brushPath(points: [number, number][]) {
  if (points.length < 3) return points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
  let path = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i], next = points[i + 1];
    path += ` Q${x} ${y} ${(x + next[0]) / 2} ${(y + next[1]) / 2}`;
  }
  const last = points[points.length - 1];
  return path + ` L${last[0]} ${last[1]}`;
}
