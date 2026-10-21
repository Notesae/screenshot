import { describe, expect, it } from 'vitest';
import { adjustSelection } from './selectionGeometry';

// 合成物理坐标覆盖跨屏负原点、八手柄与限制，测试不读取桌面。
describe('编辑态选区', () => {
  const bounds = { x: -1920, y: -240, width: 3840, height: 1440 };
  const area = { x: -600, y: 20, width: 400, height: 300 };
  it('整体移动保持尺寸并限制在冻结桌面内', () => {
    expect(adjustSelection(area, 'move', -4000, 4000, bounds)).toEqual({ x: -1920, y: 900, width: 400, height: 300 });
  });
  it('八个手柄均可调整且不穿过对边', () => {
    for (const handle of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const) {
      const next = adjustSelection(area, handle, 12, 18, bounds);
      expect(next).not.toEqual(area);
      expect(next.width).toBeGreaterThanOrEqual(2);
      expect(next.height).toBeGreaterThanOrEqual(2);
    }
    expect(adjustSelection(area, 'w', 10000, 0, bounds)).toEqual({ ...area, x: -202, width: 2 });
    expect(adjustSelection(area, 'nw', -10000, -10000, bounds)).toEqual({ x: -1920, y: -240, width: 1720, height: 560 });
  });
  it('像素微调按物理坐标舍入并约束上限', () => {
    expect(adjustSelection(area, 'move', 1.4, -1.6, bounds)).toEqual({ ...area, x: -599, y: 18 });
    expect(adjustSelection(area, 'se', 100000, 100000, bounds)).toEqual({ ...area, width: 2520, height: 1180 });
  });
});
