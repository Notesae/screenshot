import { describe, expect, it } from 'vitest';
import { overlayLayout, parseCapture, type OverlayMetadata } from './overlay';

const overlay: OverlayMetadata = {
  desktopBounds: { x: -1920, y: 0, width: 4480, height: 1440 },
  selection: { x: -1500, y: 200, width: 800, height: 600 },
  screens: [{ bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, primary: false }, { bounds: { x: 0, y: 0, width: 2560, height: 1440 }, primary: true }],
};
describe('in-place capture geometry', () => {
  it('maps a negative virtual origin using independent viewport axes, never primary DPI', () => {
    const layout = overlayLayout(overlay, { width: 2240, height: 900 }, { width: 800, height: 600 }, 0);
    expect(layout.scale).toEqual({ x: .5, y: .625 });
    expect(layout.selection).toEqual({ x: 210, y: 125, width: 400, height: 375 });
  });
  it('keeps original selected pixels anchored while beauty padding expands', () => {
    const raw = overlayLayout(overlay, { width: 2240, height: 900 }, { width: 800, height: 600 }, 0);
    const beauty = overlayLayout(overlay, { width: 2240, height: 900 }, { width: 896, height: 696 }, 48);
    expect(beauty.frame.x + 48 * beauty.scale.x).toBe(raw.frame.x);
    expect(beauty.frame.y + 48 * beauty.scale.y).toBe(raw.frame.y);
    expect(beauty.frame.width).toBe(448);
  });
  it('recomputes position on resize and clamps tools to the selected secondary screen', () => {
    const layout = overlayLayout(overlay, { width: 1120, height: 360 }, { width: 800, height: 600 }, 0, { width: 560, height: 80 });
    expect(layout.selection.x).toBe(105);
    expect(layout.selection.y).toBe(50);
    expect(layout.toolbar.x).toBeGreaterThanOrEqual(12);
    expect(layout.toolbar.x + layout.toolbar.width).toBeLessThanOrEqual(480 - 12);
    expect(layout.toolbar.y + layout.toolbar.height).toBeLessThanOrEqual(270 - 12);
    expect(layout.panel.x + layout.panel.width).toBeLessThanOrEqual(480 - 12);
  });
  it('places the toolbar above selections near the screen bottom', () => {
    const bottom = { ...overlay, selection: { x: -1800, y: 990, width: 800, height: 80 } };
    const layout = overlayLayout(bottom, { width: 2240, height: 900 }, { width: 800, height: 80 }, 0);
    expect(layout.toolbar.y + layout.toolbar.height).toBeLessThan(layout.selection.y);
  });
  it('shrinks a scrolling property panel instead of covering its toolbar', () => {
    const small = { ...overlay, selection: { ...overlay.selection, width: 80, height: 60 } };
    const layout = overlayLayout(small, { width: 2240, height: 900 }, { width: 176, height: 156 }, 48);
    expect(layout.panel.y >= layout.toolbar.y + layout.toolbar.height + 8 || layout.panel.y + layout.panel.maxHeight <= layout.toolbar.y - 8).toBe(true);
  });
  it('accepts plain imports without creating an overlay and rejects mismatched crop metadata', () => {
    const image = { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', name: '截图.png', width: 800, height: 600 };
    expect(parseCapture(image).overlay).toBeNull();
    expect(parseCapture({ image, overlay }).overlay).toEqual(overlay);
    expect(() => parseCapture({ image: { ...image, width: 799 }, overlay })).toThrow();
    expect(() => parseCapture({ image, overlay: { ...overlay, selection: { ...overlay.selection, x: -3000 } } })).toThrow();
  });
});
