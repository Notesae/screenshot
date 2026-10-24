import type { PixelRect } from './overlay';
export type Point = { x:number; y:number };
export type ToolPositions = { rail?:Point; card?:Point };
const clamp = (n:number,min:number,max:number) => Math.min(Math.max(n,min),Math.max(min,max));
export function boundTool(point:Point,size:{width:number;height:number},area:PixelRect):Point {
  return {x:clamp(point.x,area.x,area.x+area.width-size.width),y:clamp(point.y,area.y,area.y+area.height-size.height)};
}
const overlap=(a:PixelRect,b:PixelRect)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
/** 自动摆放只用于尚未手动定位的工具；手动坐标不钳制、不参与避让重排。 */
export function placeTools(screen:PixelRect,frame:PixelRect|null,railSize:{width:number;height:number},cardSize:{width:number;height:number},manual:ToolPositions={},sourceOffset?:Point) {
  // 预留背景整体跟随的最大位移，自动摆放的工具不会随平面移出视口。
  const margin=Math.min(24,screen.width/8,screen.height/8),area={x:screen.x+margin,y:screen.y+margin,width:Math.max(1,screen.width-margin*2),height:Math.max(1,screen.height-margin*2)};
  const rail={width:Math.min(railSize.width,area.width),height:Math.min(railSize.height,area.height)};
  const origin=frame?{x:frame.x+(frame.width-rail.width)/2,y:frame.y+frame.height+16}:{x:area.x+(area.width-rail.width)/2,y:area.y+area.height-rail.height};
  // 下方空间不足时由屏内边界贴住屏幕下沿，避免大选区把轨道翻到顶部。
  const railBox={...(manual.rail??boundTool(origin,rail,area)),...rail};
  const card={width:Math.min(cardSize.width,area.width),height:Math.min(cardSize.height,area.height)};
  const anchor={x:railBox.x+clamp(sourceOffset?.x??rail.width/2,0,rail.width),y:railBox.y+clamp(sourceOffset?.y??rail.height/2,0,rail.height)};
  const gap=16,right=area.x+area.width,bottom=area.y+area.height;
  // 四个候选都紧贴导轨；正文太长时缩短滚动区，不再跳到截图或屏幕右上角。
  const spaces=[
    {x:area.x,y:area.y,width:area.width,height:Math.min(bottom,railBox.y-gap)-area.y},
    {x:area.x,y:Math.max(area.y,railBox.y+rail.height+gap),width:area.width,height:bottom-Math.max(area.y,railBox.y+rail.height+gap)},
    {x:area.x,y:area.y,width:Math.min(right,railBox.x-gap)-area.x,height:area.height},
    {x:Math.max(area.x,railBox.x+rail.width+gap),y:area.y,width:right-Math.max(area.x,railBox.x+rail.width+gap),height:area.height},
  ];
  const candidates=spaces.flatMap((space,side)=>{
    if(space.width<=0||space.height<=0)return [];
    const size={width:Math.min(card.width,space.width),height:Math.min(card.height,space.height)};
    const point=side<2?{x:anchor.x-size.width/2,y:side===0?railBox.y-gap-size.height:railBox.y+rail.height+gap}
      :{x:side===2?railBox.x-gap-size.width:railBox.x+rail.width+gap,y:anchor.y-size.height/2};
    return [{...boundTool(point,size,space),...size}];
  });
  const distance=(box:PixelRect)=>Math.hypot(Math.max(box.x-anchor.x,anchor.x-box.x-box.width,0),Math.max(box.y-anchor.y,anchor.y-box.y-box.height,0));
  // 靠近来源优先；同样近时倾向完整尺寸与较少遮住截图，保留可读的最小窗口。
  const score=(box:PixelRect)=>distance(box)+(card.width-box.width)+(card.height-box.height)*.25+(frame?overlap(box,frame)/(box.width*box.height)*24:0);
  const readable=candidates.filter(box=>box.width>=Math.min(240,card.width)&&box.height>=Math.min(120,card.height));
  const automatic=readable.sort((a,b)=>score(a)-score(b))[0]
    ??candidates.sort((a,b)=>b.width*b.height-a.width*a.height||distance(a)-distance(b))[0]
    ??{...boundTool({x:anchor.x-card.width/2,y:anchor.y-card.height-gap},card,area),...card};
  return {rail:railBox,card:manual.card?{...manual.card,...card}:automatic,area};
}
