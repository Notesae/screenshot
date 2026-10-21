import type { PixelRect } from './overlay';

/** 编辑态支持八个边角手柄及整体移动；这里的增量始终为冻结桌面的物理像素。 */
export type CaptureHandle = 'n'|'ne'|'e'|'se'|'s'|'sw'|'w'|'nw'|'move';

/** 从按下快照计算边界，避免指针缩放、负屏幕原点和连续舍入造成漂移。 */
export function adjustSelection(area: PixelRect, handle: CaptureHandle, dx: number, dy: number, bounds: PixelRect): PixelRect {
  dx = Math.round(dx); dy = Math.round(dy);
  if (handle === 'move') return { ...area, x: Math.max(bounds.x, Math.min(bounds.x + bounds.width - area.width, area.x + dx)), y: Math.max(bounds.y, Math.min(bounds.y + bounds.height - area.height, area.y + dy)) };
  let { x, y, width, height } = area;
  const right = x + width, bottom = y + height;
  if (handle.includes('w')) x = Math.max(bounds.x, Math.min(right - 2, x + dx));
  if (handle.includes('n')) y = Math.max(bounds.y, Math.min(bottom - 2, y + dy));
  width = handle.includes('e') ? Math.max(2, Math.min(bounds.x + bounds.width - x, width + dx)) : right - x;
  height = handle.includes('s') ? Math.max(2, Math.min(bounds.y + bounds.height - y, height + dy)) : bottom - y;
  return { x, y, width, height };
}
