import type { PixelRect } from './overlay';
export type Point = { x:number; y:number };
export type ToolPositions = { rail?:Point; card?:Point };
const clamp = (n:number,min:number,max:number) => Math.min(Math.max(n,min),Math.max(min,max));
export function boundTool(point:Point,size:{width:number;height:number},area:PixelRect):Point {
  return {x:clamp(point.x,area.x,area.x+area.width-size.width),y:clamp(point.y,area.y,area.y+area.height-size.height)};
}
const overlap=(a:PixelRect,b:PixelRect)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
/** 只计算工具视图坐标，图片选区、文档尺寸及导出像素不写回。 */
export function placeTools(screen:PixelRect,frame:PixelRect|null,railSize:{width:number;height:number},cardSize:{width:number;height:number},manual:ToolPositions={}) {
  const margin=Math.min(16,screen.width/8,screen.height/8),area={x:screen.x+margin,y:screen.y+margin,width:Math.max(1,screen.width-margin*2),height:Math.max(1,screen.height-margin*2)};
  const rail={width:Math.min(railSize.width,area.width),height:Math.min(railSize.height,area.height)};
  const origin=frame?{x:frame.x+(frame.width-rail.width)/2,y:frame.y+frame.height+16}:{x:area.x+(area.width-rail.width)/2,y:area.y+area.height-rail.height};
  if(frame&&origin.y+rail.height>area.y+area.height)origin.y=frame.y-rail.height-16;
  const railBox={...boundTool(manual.rail??origin,rail,area),...rail};
  const card={width:Math.min(cardSize.width,area.width),height:Math.min(cardSize.height,Math.max(40,area.height-rail.height-64))};
  const horizontalSpace=Math.max(railBox.x-area.x-48,area.x+area.width-railBox.x-rail.width-48);
  if(horizontalSpace<card.width){const verticalSpace=Math.max(railBox.y-area.y-48,area.y+area.height-railBox.y-rail.height-48);card.height=Math.min(card.height,Math.max(40,verticalSpace));}
  const anchor=frame??{x:area.x,y:area.y,width:area.width,height:area.height};
  const candidates=[{x:anchor.x+anchor.width+16,y:anchor.y},{x:anchor.x-card.width-16,y:anchor.y},{x:anchor.x,y:anchor.y-card.height-16},{x:area.x+area.width-card.width,y:area.y},{x:railBox.x,y:railBox.y-card.height-48},{x:railBox.x,y:railBox.y+rail.height+48},{x:railBox.x-card.width-48,y:railBox.y},{x:railBox.x+rail.width+48,y:railBox.y}].map(p=>({...boundTool(p,card,area),...card}));
  const apart=(r:PixelRect)=>r.x+r.width+48<=railBox.x||railBox.x+railBox.width+48<=r.x||r.y+r.height+48<=railBox.y||railBox.y+railBox.height+48<=r.y;
  candidates.sort((a,b)=>Number(!apart(a))-Number(!apart(b))||overlap(a,railBox)-overlap(b,railBox)||(frame?overlap(a,frame)-overlap(b,frame):0));
  const preferred=manual.card?{...boundTool(manual.card,card,area),...card}:candidates[0];
  const clear=candidates.filter(apart).sort((a,b)=>Math.hypot(a.x-preferred.x,a.y-preferred.y)-Math.hypot(b.x-preferred.x,b.y-preferred.y));
  return {rail:railBox,card:apart(preferred)?preferred:clear[0]??candidates[0],area};
}
