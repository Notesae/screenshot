import type { PixelRect } from './overlay';
export type Point = { x:number; y:number };
export type ToolPositions = { rail?:Point; card?:Point };
const clamp = (n:number,min:number,max:number) => Math.min(Math.max(n,min),Math.max(min,max));
export function boundTool(point:Point,size:{width:number;height:number},area:PixelRect):Point {
  return {x:clamp(point.x,area.x,area.x+area.width-size.width),y:clamp(point.y,area.y,area.y+area.height-size.height)};
}
const overlap=(a:PixelRect,b:PixelRect)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
/** 自动摆放只用于尚未手动定位的工具；手动坐标不钳制、不参与避让重排。 */
export function placeTools(screen:PixelRect,frame:PixelRect|null,railSize:{width:number;height:number},cardSize:{width:number;height:number},manual:ToolPositions={}) {
  const margin=Math.min(16,screen.width/8,screen.height/8),area={x:screen.x+margin,y:screen.y+margin,width:Math.max(1,screen.width-margin*2),height:Math.max(1,screen.height-margin*2)};
  const rail={width:Math.min(railSize.width,area.width),height:Math.min(railSize.height,area.height)};
  const origin=frame?{x:frame.x+(frame.width-rail.width)/2,y:frame.y+frame.height+16}:{x:area.x+(area.width-rail.width)/2,y:area.y+area.height-rail.height};
  if(frame&&origin.y+rail.height>area.y+area.height)origin.y=frame.y-rail.height-16;
  const railBox={...(manual.rail??boundTool(origin,rail,area)),...rail};
  const card={width:Math.min(cardSize.width,area.width),height:Math.min(cardSize.height,area.height)};
  const anchor=frame??{x:area.x,y:area.y,width:area.width,height:area.height};
  const candidates=[{x:anchor.x+anchor.width+16,y:anchor.y},{x:anchor.x-card.width-16,y:anchor.y},{x:anchor.x,y:anchor.y-card.height-16},{x:area.x+area.width-card.width,y:area.y},{x:railBox.x,y:railBox.y-card.height-48},{x:railBox.x,y:railBox.y+rail.height+48},{x:railBox.x-card.width-48,y:railBox.y},{x:railBox.x+rail.width+48,y:railBox.y}].map(p=>({...boundTool(p,card,area),...card}));
  const apart=(r:PixelRect)=>r.x+r.width+48<=railBox.x||railBox.x+railBox.width+48<=r.x||r.y+r.height+48<=railBox.y||railBox.y+railBox.height+48<=r.y;
  candidates.sort((a,b)=>Number(!apart(a))-Number(!apart(b))||overlap(a,railBox)-overlap(b,railBox)||(frame?overlap(a,frame)-overlap(b,frame):0));
  let automatic=candidates[0];
  if(!manual.card&&overlap(automatic,railBox)>0){
    // 窄显示器放不下整张浮卡时缩短可滚动内容区，不能用卡片盖住“完成”等导轨操作。
    const gap=16,spaces=[
      {x:area.x,y:area.y,width:railBox.x-area.x-gap,height:area.height},
      {x:railBox.x+railBox.width+gap,y:area.y,width:area.x+area.width-railBox.x-railBox.width-gap,height:area.height},
      {x:area.x,y:area.y,width:area.width,height:railBox.y-area.y-gap},
      {x:area.x,y:railBox.y+railBox.height+gap,width:area.width,height:area.y+area.height-railBox.y-railBox.height-gap},
    ];
    const fitting=spaces.filter(space=>space.width>=Math.min(240,card.width)&&space.height>=Math.min(80,card.height))
      .map(space=>{const size={width:Math.min(card.width,space.width),height:Math.min(card.height,space.height)};return {...boundTool(automatic,size,space),...size};})
      .filter(box=>box.x>=area.x&&box.y>=area.y&&box.x+box.width<=area.x+area.width&&box.y+box.height<=area.y+area.height)
      .sort((a,b)=>b.width*b.height-a.width*a.height||(frame?overlap(a,frame)-overlap(b,frame):0));
    if(fitting[0])automatic=fitting[0];
  }
  return {rail:railBox,card:manual.card?{...manual.card,...card}:automatic,area};
}
