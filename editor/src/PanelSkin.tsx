import { clamp, type MotionRect } from './motion';
import type { SurfaceStrain } from './surfaceTransition';

/** 静态材质跟随整个浮卡一起变形，不再每帧重建大面积 SVG 滤镜。 */
export function PanelSkin() { return <span className="liquid-panel-skin" aria-hidden="true"/>; }

/** 同一合成层承载材质和正文；横向拉伸伴随纵向收缩，剪切继承当前受力。 */
export function paintPanel(body:HTMLElement,current:MotionRect,actual:MotionRect,strain:SurfaceStrain,alpha:number,moving:boolean) {
  const w=Math.max(1,actual.width),h=Math.max(1,actual.height);
  const stretch=clamp(strain.stretch/90,-.12,.12),shear=clamp(strain.x/220,-.065,.065);
  const sx=Math.max(.01,current.width/w)*(1+stretch),sy=Math.max(.01,current.height/h)/(1+stretch);
  const x=current.x-actual.x+(current.width-w*sx)/2-shear*h*sy/2;
  const y=current.y-actual.y+(current.height-h*sy)/2;
  body.style.transform=`matrix(${sx},0,${shear*sy},${sy},${x},${y})`;
  body.style.opacity=String(alpha);
  // 滚动条只需在形变起止时隐藏/恢复，重复写同一状态会重新唤醒它的观察器。
  const motionRunning=String(moving);
  if(body.dataset.motionRunning!==motionRunning){
    body.style.willChange=moving?'transform, opacity':'auto';
    body.dataset.motionRunning=motionRunning;
  }
  // 圆角以显示像素计量，回到按钮大小时仍保持圆润；四角差异表现前后端受力。
  const bend=clamp((strain.x+strain.y)*.16,-5,5),radii=[12+bend,12-bend,12+bend,12-bend];
  body.style.borderRadius=radii.map(r=>r/sx+'px').join(' ')+' / '+radii.map(r=>r/sy+'px').join(' ');
}
