import { useId, useLayoutEffect, useRef, type ComponentPropsWithoutRef } from 'react';
import { presentationMotion } from './LiquidMotion';
import { clamp, MotionClock, MotionSpring } from './motion';
import { motionSuspended, observeMotionScope } from './motionScope';

/** 原生 range 保留输入/键盘/可访问性；可见的填充和拇指由同一受力状态跟随数值。 */
export function MotionRange(props:Omit<ComponentPropsWithoutRef<'input'>,'type'>) {
  const root=useRef<HTMLSpanElement>(null),input=useRef<HTMLInputElement>(null),id=useId();
  const value=Number(props.value??props.defaultValue??0),min=Number(props.min??0),max=Number(props.max??100);
  const ratio=clamp((value-min)/Math.max(1,max-min)),desired=useRef(ratio);desired.current=ratio;
  const redirect=useRef<()=>void>(()=>{});
  useLayoutEffect(()=>{
    const node=root.current!,field=input.current!,fill=node.querySelector<HTMLElement>('.clay-slider-fill')!,thumb=node.querySelector<HTMLElement>('.clay-slider-thumb')!;
    const shared=presentationMotion(node)?.clock,clock=shared??new MotionClock(),key='slider:'+id;
    const position=new MotionSpring(),pressure=new MotionSpring(),pull=new MotionSpring();
    let travel=Math.max(1,node.clientWidth-18),disposed=false;
    position.snap(desired.current*travel);
    const media=matchMedia('(prefers-reduced-motion: reduce)');
    const preference=()=>{if(!shared)clock.setReduced(media.matches);};preference();
    const paint=()=>{
      const x=clamp(position.x,0,travel),strain=pull.x,p=pressure.x,wide=1+Math.abs(strain)*.65+p*.12;
      fill.style.transform=`scaleX(${x/travel})`;
      thumb.style.transform=`translate3d(${x}px,0,0) scale(${wide},${1/wide}) rotate(${strain*9}deg)`;
      thumb.style.borderRadius=`${50-strain*18}% ${50+strain*18}% ${50+strain*18}% ${50-strain*18}%`;
    };
    const run=()=>{
      if(disposed)return;
      position.to=desired.current*travel;
      void clock.animate(key,(dt,finish)=>{
        if(finish){position.snap(position.to);pressure.snap(pressure.to);pull.snap(0);}
        else{
          position.step(dt,'attention');pressure.step(dt,'selection');
          pull.to=clamp(position.v/700,-.48,.48);pull.step(dt,'selection');
        }
        paint();return position.moving||pressure.moving||pull.moving;
      });
    };
    redirect.current=run;
    const down=(event:PointerEvent)=>{if(event.button===0){pressure.to=1;run();}};
    const up=()=>{if(pressure.to!==0){pressure.to=0;run();}};
    const keydown=(event:KeyboardEvent)=>{if(/^(Arrow|Home|End|Page)/.test(event.key)){pressure.to=.65;run();}};
    field.addEventListener('pointerdown',down);field.addEventListener('keydown',keydown);field.addEventListener('blur',up);
    window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',up,true);window.addEventListener('keyup',up,true);window.addEventListener('blur',up);
    const resize=new ResizeObserver(entries=>{
      const next=Math.max(1,entries[0].contentRect.width-18);
      if(Math.abs(next-travel)<.1)return;
      // 只在真实布局变化时换算像素，不用正在缩放的浮卡矩形反推滑块位置。
      position.x*=next/travel;position.v*=next/travel;travel=next;run();
    });resize.observe(node);
    const stop=observeMotionScope(node,hidden=>{if(!shared)clock.setSuspended(hidden);if(hidden){pressure.to=0;clock.finish(key);pressure.snap(0);pull.snap(0);position.snap(desired.current*travel);paint();}});
    media.addEventListener('change',preference);
    if(!shared)clock.setSuspended(motionSuspended(node));paint();
    return()=>{
      disposed=true;redirect.current=()=>{};stop();resize.disconnect();clock.cancel(key);if(!shared)clock.dispose();
      field.removeEventListener('pointerdown',down);field.removeEventListener('keydown',keydown);field.removeEventListener('blur',up);
      window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',up,true);window.removeEventListener('keyup',up,true);window.removeEventListener('blur',up);media.removeEventListener('change',preference);
    };
  },[id]);
  useLayoutEffect(()=>redirect.current(),[ratio]);
  return <span ref={root} className="clay-slider" data-disabled={Boolean(props.disabled)}>
    <span className="clay-slider-track" aria-hidden="true"><span className="clay-slider-fill"/></span><span className="clay-slider-thumb" aria-hidden="true"/>
    <input {...props} type="range" ref={input}/>
  </span>;
}
