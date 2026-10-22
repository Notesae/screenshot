import type { MotionRect } from './motion';

/** 材质与正文共用可见位置；只缩放材质，文字保持字号并裁切在当前表面内。 */
export function paintSurface(skin:HTMLElement,content:HTMLElement,current:MotionRect,actual:MotionRect,alpha:number,material:number){
  const translation=`translate(${current.x-actual.x}px,${current.y-actual.y}px)`;
  skin.style.transform=translation+` scale(${Math.max(.01,current.width/Math.max(1,actual.width))},${Math.max(.01,current.height/Math.max(1,actual.height))})`;
  skin.style.opacity=String(material);
  content.style.transform=translation;content.style.opacity=String(alpha);
  const right=Math.max(0,actual.width-current.width),bottom=Math.max(0,actual.height-current.height);
  content.style.clipPath=right>.01||bottom>.01?`inset(0 ${right}px ${bottom}px 0 round 12px)`:'none';
}
