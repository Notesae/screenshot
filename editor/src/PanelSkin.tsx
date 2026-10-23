import { useId } from 'react';
import { clamp } from './motion';
import type { SurfaceStrain } from './surfaceTransition';

/** 只有外壳使用软体轮廓，正文和输入命中区保持原尺寸。高光跟随轮廓，避免矩形残边。 */
export function PanelSkin() {
  const id='panel-'+useId().replace(/:/g,'');
  return <span className="liquid-panel-skin" aria-hidden="true"><svg className="liquid-panel-contour" focusable="false">
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--clay-surfaceTop)"/><stop offset=".45" stopColor="var(--clay-surfaceMid)"/><stop offset="1" stopColor="var(--clay-surfaceBase)"/></linearGradient>
      <filter id={id+'-clay'} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
        <feGaussianBlur in="SourceAlpha" stdDeviation="1.3" result="edge"/>
        <feOffset in="edge" dy="1.8" result="lower"/><feComposite in="SourceAlpha" in2="lower" operator="out" result="rim"/>
        <feFlood floodColor="var(--clay-raisedHighlight)" result="light"/><feComposite in="light" in2="rim" operator="in" result="highlight"/>
        <feOffset in="edge" dy="-2" result="upper"/><feComposite in="SourceAlpha" in2="upper" operator="out" result="base"/>
        <feFlood floodColor="var(--clay-raisedShade)" result="dark"/><feComposite in="dark" in2="base" operator="in" result="shade"/>
        <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="shade"/><feMergeNode in="highlight"/></feMerge>
      </filter>
    </defs><path className="liquid-panel-outline" fill={`url(#${id})`} filter={`url(#${id}-clay)`}/>
  </svg></span>;
}

/** 边中部滞后、两侧随拉伸收腰；实际像素限幅，缩成按钮时不会翻折或产生尖角。 */
export function panelOutline(width:number,height:number,strain:SurfaceStrain) {
  const w=Math.max(1,width),h=Math.max(1,height),r=Math.min(12+Math.abs(strain.stretch)*.45,w*.28,h*.28);
  const x=clamp(strain.x,-Math.min(18,w*.1),Math.min(18,w*.1)),y=clamp(strain.y,-Math.min(18,h*.1),Math.min(18,h*.1));
  const s=clamp(strain.stretch,-Math.min(14,w*.08,h*.08),Math.min(14,w*.08,h*.08));
  const p=(px:number,py:number)=>{
    const u=clamp(px/w),v=clamp(py/h);
    return `${px+Math.sin(Math.PI*v)*(-x+s*(u*2-1))} ${py+Math.sin(Math.PI*u)*(-y-s*(v*2-1))}`;
  };
  const dx=(w-2*r)/3,dy=(h-2*r)/3;
  return `M${p(r,0)}C${p(r+dx,0)} ${p(w-r-dx,0)} ${p(w-r,0)}Q${p(w,0)} ${p(w,r)}`
    +`C${p(w,r+dy)} ${p(w,h-r-dy)} ${p(w,h-r)}Q${p(w,h)} ${p(w-r,h)}`
    +`C${p(w-r-dx,h)} ${p(r+dx,h)} ${p(r,h)}Q${p(0,h)} ${p(0,h-r)}`
    +`C${p(0,h-r-dy)} ${p(0,r+dy)} ${p(0,r)}Q${p(0,0)} ${p(r,0)}Z`;
}
