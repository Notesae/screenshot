import { parseImage } from './document';
import type { LoadedImage } from './bridge';

/** 坐标全部来自虚拟桌面物理像素，屏幕元数据只用于放置工具条，不含冻结桌面图片。 */
export type PixelRect = { x: number; y: number; width: number; height: number };
export type OverlayMetadata = { captureId?: string; contentScale?:number; desktopBounds: PixelRect; selection: PixelRect; screens: { bounds: PixelRect; primary: boolean }[] };
export type CaptureEnvelope = { image: LoadedImage; overlay: OverlayMetadata };
type Size = { width: number; height: number };

function rect(value: unknown): PixelRect {
  if (!value || typeof value !== 'object') throw new Error('截图坐标格式无效。');
  const r = value as PixelRect;
  if (![r.x, r.y, r.width, r.height].every(n => typeof n === 'number' && Number.isInteger(n) && Math.abs(n) <= 1_000_000) || r.width <= 0 || r.height <= 0) throw new Error('截图坐标超出安全范围。');
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}
function contains(outer: PixelRect, inner: PixelRect) { return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height; }
function clamp(value: number, min: number, max: number) { return Math.min(Math.max(value, min), Math.max(min, max)); }

/** 同时接受普通导入图片与新截图封装，背景和显示元数据不进入项目文档。 */
export function parseCapture(value: unknown): { image: LoadedImage; overlay: OverlayMetadata | null } {
  if (!value || typeof value !== 'object' || !('overlay' in value)) return { image: parseImage(value), overlay: null };
  const envelope = value as CaptureEnvelope;
  const image = parseImage(envelope.image), source = envelope.overlay;
  if (!source || !Array.isArray(source.screens) || !source.screens.length || source.screens.length > 32) throw new Error('截图屏幕信息无效。');
  const desktopBounds = rect(source.desktopBounds), selection = rect(source.selection);
  if (!contains(desktopBounds, selection) || selection.width !== image.width || selection.height !== image.height) throw new Error('截图选区与图片尺寸不符。');
  const screens = source.screens.map(screen => {
    const bounds = rect(screen.bounds);
    if (typeof screen.primary !== 'boolean' || !contains(desktopBounds, bounds)) throw new Error('截图屏幕边界无效。');
    return { bounds, primary: screen.primary };
  });
  if (source.captureId !== undefined && (typeof source.captureId !== 'string' || !/^[a-z0-9-]{1,80}$/i.test(source.captureId))) throw new Error('截图标识无效。');
  return { image, overlay: { ...(source.captureId ? { captureId: source.captureId } : {}), desktopBounds, selection, screens } };
}

/** 以屏幕交叠面积选择工具所在屏幕，兼容跨屏选区及虚拟桌面中的空洞。 */
export function selectedScreen(overlay: OverlayMetadata) {
  const s = overlay.selection;
  return overlay.screens.reduce((best, screen) => {
    const intersection = (r: PixelRect) => Math.max(0, Math.min(r.x + r.width, s.x + s.width) - Math.max(r.x, s.x)) * Math.max(0, Math.min(r.y + r.height, s.y + s.height) - Math.max(r.y, s.y));
    return intersection(screen.bounds) > intersection(best.bounds) ? screen : best;
  }).bounds;
}

/** 独立映射 X/Y，不使用主屏 DPI；美化只向外扩张，原选区内容锚点保持不变。 */
export function overlayLayout(overlay: OverlayMetadata, viewport: Size, output: Size, padding: number, tools: Size & {statusHeight?:number;panelOpen?:boolean} = { width: 560, height: 44 }, crop?: { x: number; y: number }) {
  if (![viewport.width, viewport.height, output.width, output.height].every(n => Number.isFinite(n) && n > 0) || !Number.isFinite(padding) || padding < 0) throw new Error('编辑区域尺寸无效。');
  const desktop = overlay.desktopBounds, mapping = { x: viewport.width / desktop.width, y: viewport.height / desktop.height };
  const factor=overlay.contentScale??1;if(!Number.isFinite(factor)||factor<=0||factor>1)throw new Error('原位导入显示比例无效。');
  const scale={x:mapping.x*factor,y:mapping.y*factor};
  const map = (r: PixelRect): PixelRect => ({ x: (r.x - desktop.x) * mapping.x, y: (r.y - desktop.y) * mapping.y, width: r.width * mapping.x, height: r.height * mapping.y });
  const physicalSelection = crop ? { x: overlay.selection.x + crop.x*factor, y: overlay.selection.y + crop.y*factor, width: (output.width - padding * 2)*factor, height: (output.height - padding * 2)*factor } : overlay.selection;
  const selection = map(physicalSelection), screen = map(selectedScreen({ ...overlay, selection: physicalSelection }));
  const frame = { x: selection.x - padding * scale.x, y: selection.y - padding * scale.y, width: output.width * scale.x, height: output.height * scale.y };
  const margin = Math.min(12, screen.width / 4, screen.height / 4);
  if(![tools.width,tools.height].every(n=>Number.isFinite(n)&&n>0)||!Number.isFinite(tools.statusHeight??0)||(tools.statusHeight??0)<0)throw new Error('工具尺寸无效。');
  const safe={x:screen.x+margin,y:screen.y+margin,width:screen.width-margin*2,height:screen.height-margin*2};
  const right=safe.x+safe.width,bottom=safe.y+safe.height;
  const statusHeight=Math.min(tools.statusHeight??0,Math.max(0,safe.height-34-8));
  const minimumPanel=Math.min(144,safe.height*.5);
  const reservedPanel=tools.panelOpen?minimumPanel+8:0;
  const toolWidth=Math.min(tools.width,safe.width),toolHeight=Math.min(tools.height,Math.max(1,safe.height-statusHeight-(statusHeight?8:0)-reservedPanel));
  const groupHeight=toolHeight+(statusHeight?statusHeight+8:0);
  const area=(a:PixelRect,b:PixelRect)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
  const x=clamp(selection.x+selection.width-toolWidth,safe.x,right-toolWidth);
  // 工具和保存状态作为整体优先放在图外；任何停靠都不移动实际选区画布。
  const positions=[frame.y+frame.height+12,frame.y-groupHeight-12,selection.y+selection.height+12,selection.y-groupHeight-12,safe.y,bottom-groupHeight];
  const candidates=positions.map((value,index)=>({x,y:clamp(value,safe.y,bottom-groupHeight),width:toolWidth,height:groupHeight,index}));
  const lacksPanelSpace=(g:PixelRect)=>{
    if(!tools.panelOpen)return 0;
    const sideWidth=Math.min(292,safe.width),minimumWidth=Math.min(180,sideWidth);
    const sides=[{x:frame.x+frame.width+8,width:right-frame.x-frame.width-8},{x:safe.x,width:frame.x-safe.x-8}];
    const freeSide=sides.some(s=>s.width>=minimumWidth&&(s.x+s.width<=g.x||s.x>=g.x+g.width));
    return !freeSide&&Math.max(g.y-safe.y-8,bottom-g.y-g.height-8)<minimumPanel-.01?1:0;
  };
  candidates.sort((a,b)=>lacksPanelSpace(a)-lacksPanelSpace(b)||area(a,frame)-area(b,frame)||a.index-b.index);
  const group=candidates[0],toolbar={x,y:group.y,width:toolWidth,height:toolHeight};
  const status={x,y:toolbar.y+toolHeight+(statusHeight?8:0),width:toolWidth,height:statusHeight};
  const panelWidth=Math.min(292,safe.width),panels:(PixelRect&{placement:string})[]=[];
  const add=(px:number,py:number,width:number,height:number,placement:string)=>{
    if(width<Math.min(180,panelWidth)||height<minimumPanel-.01)return;
    const panel={x:px,y:py,width,height,placement};
    if(px<safe.x-.01||py<safe.y-.01||px+width>right+.01||py+height>bottom+.01||area(panel,group)>.01)return;
    panels.push(panel);
  };
  // 侧边停靠优先利用空白，垂直候选同时避让工具/状态条，空间不足则可滚动。
  const aboveHeight=Math.min(490,Math.max(0,group.y-safe.y-8)),belowY=group.y+group.height+8,belowHeight=Math.min(490,Math.max(0,bottom-belowY));
  for(const side of ['right','left']){
    const available=side==='right'?right-frame.x-frame.width-8:frame.x-safe.x-8,width=Math.min(panelWidth,available);
    const px=side==='right'?frame.x+frame.width+8:frame.x-width-8;
    const height=Math.min(490,safe.height);
    add(px,clamp(frame.y,safe.y,bottom-height),width,height,side);
    add(px,group.y-aboveHeight-8,width,aboveHeight,side+'-above');
    add(px,belowY,width,belowHeight,side+'-below');
  }
  const panelX=clamp(toolbar.x+toolbar.width-panelWidth,safe.x,right-panelWidth);
  add(panelX,group.y-aboveHeight-8,panelWidth,aboveHeight,'above');add(panelX,belowY,panelWidth,belowHeight,'below');
  panels.sort((a,b)=>area(a,frame)/(a.width*a.height)-area(b,frame)/(b.width*b.height)||b.width*b.height-a.width*a.height||Math.abs(a.y-frame.y)-Math.abs(b.y-frame.y));
  const chosen=panels[0]||{x:panelX,y:safe.y,width:panelWidth,height:Math.max(0,group.y-safe.y-8),placement:'bounded-fallback'};
  const panel={x:chosen.x,y:chosen.y,width:chosen.width,maxHeight:chosen.height,placement:chosen.placement};
  return { scale, selection, frame, screen, toolbar, status, panel };

}

/** 替换原位图片只改变显示映射，不给文档写resize，不重采样导出像素。 */
export function overlayForImportedImage(overlay:OverlayMetadata,image:{width:number;height:number}):OverlayMetadata {
  if(![image.width,image.height].every(n=>Number.isInteger(n)&&n>0&&n<=16000))throw new Error('导入图片尺寸无效。');
  const screen=selectedScreen(overlay),margin=Math.min(24,screen.width/8,screen.height/8);
  const factor=Math.min(1,Math.max(1,screen.width-margin*2)/image.width,Math.max(1,screen.height-margin*2-100)/image.height);
  const width=Math.ceil(image.width*factor),height=Math.ceil(image.height*factor);
  return {...overlay,contentScale:factor,selection:{x:Math.round(clamp(overlay.selection.x,screen.x+margin,screen.x+screen.width-margin-width)),y:Math.round(clamp(overlay.selection.y,screen.y+margin,screen.y+screen.height-margin-height)),width,height}};
}
