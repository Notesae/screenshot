import { describe, expect, it } from 'vitest';
import { overlayLayout, parseCapture, type OverlayMetadata } from './overlay';

const overlay: OverlayMetadata = {
  desktopBounds: { x: -1920, y: 0, width: 4480, height: 1440 },
  selection: { x: -1500, y: 200, width: 800, height: 600 },
  screens: [{ bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, primary: false }, { bounds: { x: 0, y: 0, width: 2560, height: 1440 }, primary: true }],
};
describe('in-place capture geometry', () => {
  it('uses a validated monitor work area for tools without changing image coordinates', () => {
    const workArea={x:-1920,y:0,width:1920,height:1040};
    const screen={...overlay.screens[0],workArea};
    const restricted={...overlay,screens:[screen,overlay.screens[1]]};
    const layout=overlayLayout(restricted,{width:2240,height:900},{width:800,height:600},0);
    expect(layout.screen).toEqual({x:0,y:0,width:960,height:650});
    expect(layout.frame).toEqual(overlayLayout(overlay,{width:2240,height:900},{width:800,height:600},0).frame);
    const image={dataUrl:'data:image/png;base64,iVBORw0KGgo=',name:'合成.png',width:800,height:600};
    expect(parseCapture({image,overlay:restricted}).overlay?.screens[0].workArea).toEqual(workArea);
    expect(()=>parseCapture({image,overlay:{...restricted,screens:[{...screen,workArea:{...workArea,width:3000}}]}})).toThrow();
  });
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
  it('moves a cropped content anchor by its source offset before applying beauty padding', () => {
    const layout = overlayLayout(overlay, { width: 2240, height: 900 }, { width: 296, height: 246 }, 48, { width: 560, height: 44 }, { x: 40, y: 20 });
    expect(layout.frame.x).toBe(210 + 20 - 24);
    expect(layout.frame.y).toBe(125 + 12.5 - 30);
    expect(layout.selection.width).toBe(100);
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

describe('shared compact docking',()=>{
  const one:OverlayMetadata={desktopBounds:{x:0,y:0,width:1280,height:800},selection:{x:600,y:80,width:240,height:120},screens:[{bounds:{x:0,y:0,width:1280,height:800},primary:true}]};
  const intersects=(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number})=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
  it('docks into free side space without covering the image, toolbar or recovery status',()=>{
    const a=overlayLayout(one,{width:1280,height:800},{width:240,height:120},0,{width:560,height:46,statusHeight:42,panelOpen:true}),p={...a.panel,height:a.panel.maxHeight};
    expect(intersects(p,a.toolbar)).toBe(0);expect(intersects(p,a.status)).toBe(0);expect(intersects(p,a.frame)).toBe(0);expect(a.panel.maxHeight).toBeGreaterThanOrEqual(400);
  });
  it('keeps a bottom-edge toolbar and its status outside the original content',()=>{
    const edge={...one,selection:{x:1090,y:650,width:160,height:100}},a=overlayLayout(edge,{width:1280,height:800},{width:160,height:100},0,{width:560,height:46,statusHeight:42,panelOpen:true});
    expect(intersects(a.toolbar,a.frame)).toBe(0);expect(intersects(a.status,a.frame)).toBe(0);expect(a.status.y+a.status.height).toBeLessThan(650);expect(a.frame).toEqual({x:1090,y:650,width:160,height:100});
  });
  it('bounds wrapped tools, status and panels on a short monitor without changing pixel mapping',()=>{
    const a=overlayLayout(one,{width:640,height:240},{width:240,height:120},0,{width:560,height:140,statusHeight:44,panelOpen:true});
    for(const b of [a.toolbar,a.status,{...a.panel,height:a.panel.maxHeight}]){expect(b.x).toBeGreaterThanOrEqual(0);expect(b.y).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(640);expect(b.y+b.height).toBeLessThanOrEqual(240);}
    expect(a.scale).toEqual({x:.5,y:.3});expect(a.frame.x).toBe(300);expect(intersects({...a.panel,height:a.panel.maxHeight},a.status)).toBe(0);
  });
});

it('reserves a usable short-monitor panel rather than centering a button behind its heading',()=>{
 const a=overlayLayout(overlay,{width:1120,height:360},{width:176,height:156},48,{width:560,height:80,statusHeight:42,panelOpen:true});
 expect(a.panel.maxHeight).toBeGreaterThanOrEqual(120);expect(a.panel.y+a.panel.maxHeight<=a.toolbar.y-8||a.panel.y>=a.status.y+a.status.height+8).toBe(true);
});
