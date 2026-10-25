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
    // 显示位置 = 数值落点 target + 余量 residual。拖动时余量不再累积，拇指直接压在指针下；
    // 键盘或点轨道的跳变把位移差交给余量弹簧，显示位置连续并带回弹。
    const residual=new MotionSpring(),pressure=new MotionSpring(),pull=new MotionSpring();
    let travel=Math.max(1,node.clientWidth-18),disposed=false,target=desired.current*travel;
    // drift 为拖动速度（px/s，平滑后），只驱动形变；inputAt 为最近一次数值变化时刻。
    let drift=0,inputAt=0,pressing=false,dragging=false;
    // 仅跳过完全相同的表现值；弹簧仍逐帧积分，反向和余振不做量化或节流。
    let paintedX=NaN,paintedTravel=NaN,paintedStrain=NaN,paintedPressure=NaN;
    const media=matchMedia('(prefers-reduced-motion: reduce)');
    const preference=()=>{if(!shared)clock.setReduced(media.matches);};preference();
    const paint=()=>{
      const x=clamp(target+residual.x,0,travel),strain=pull.x,p=pressure.x;
      const moved=x!==paintedX,strained=strain!==paintedStrain;
      if(moved||travel!==paintedTravel)fill.style.transform=`scaleX(${x/travel})`;
      if(moved||strained||p!==paintedPressure){
        const wide=1+Math.abs(strain)*.65+p*.12;
        thumb.style.transform=`translate3d(${x}px,0,0) scale(${wide},${1/wide}) rotate(${strain*9}deg)`;
      }
      if(strained)thumb.style.borderRadius=`${50-strain*18}% ${50+strain*18}% ${50+strain*18}% ${50-strain*18}%`;
      paintedX=x;paintedTravel=travel;paintedStrain=strain;paintedPressure=p;
    };
    const run=()=>{
      if(disposed)return;
      const next=desired.current*travel,delta=next-target,now=performance.now();
      if(delta!==0){
        if(dragging){
          // 按输入间隔估算拖动速度并做 35ms 平滑，偶发的密集事件不会放大形变。
          const elapsed=clamp((now-inputAt)/1000,.004,.05);
          drift+=(delta/elapsed-drift)*(1-Math.exp(-elapsed/.035));
        }else residual.x-=delta;
        target=next;inputAt=now;
      }
      void clock.animate(key,(dt,finish)=>{
        if(finish){residual.snap(0);pressure.snap(pressure.to);pull.snap(0);drift=0;}
        else{
          // 指针停住 32ms 后拖动速度自然衰减，形变随之回弹，不需要松手。
          if(drift!==0&&performance.now()-inputAt>32){drift*=Math.exp(-dt/.055);if(Math.abs(drift)<1)drift=0;}
          residual.step(dt,'attention');pressure.step(dt,'selection');
          // 柔性限幅：大跳跃时形变趋近上限，不长时间卡在平顶。
          pull.to=.48*Math.tanh((drift+residual.v)/700/.48);pull.step(dt,'selection');
        }
        paint();return residual.moving||pressure.moving||pull.moving||drift!==0;
      });
    };
    redirect.current=run;
    const down=(event:PointerEvent)=>{if(event.button===0){pressing=true;dragging=false;pressure.to=1;run();}};
    // 按下后真正移动才算拖动；按下那一刻点轨道产生的跳变仍走弹簧过渡。
    const move=(event:PointerEvent)=>{if(pressing&&event.buttons&1)dragging=true;};
    const up=()=>{pressing=dragging=false;if(pressure.to!==0){pressure.to=0;run();}};
    // 键盘松开不结束正在进行的鼠标拖动。
    const keyup=()=>{if(!pressing&&pressure.to!==0){pressure.to=0;run();}};
    const keydown=(event:KeyboardEvent)=>{if(/^(Arrow|Home|End|Page)/.test(event.key)){pressure.to=.65;run();}};
    field.addEventListener('pointerdown',down);field.addEventListener('keydown',keydown);field.addEventListener('blur',up);
    window.addEventListener('pointermove',move,{capture:true,passive:true});
    window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',up,true);window.addEventListener('keyup',keyup,true);window.addEventListener('blur',up);
    const resize=new ResizeObserver(entries=>{
      const next=Math.max(1,entries[0].contentRect.width-18);
      if(Math.abs(next-travel)<.1)return;
      // 只在真实布局变化时换算像素，不用正在缩放的浮卡矩形反推滑块位置。
      const scale=next/travel;residual.x*=scale;residual.v*=scale;drift*=scale;travel=next;target=desired.current*travel;run();
    });resize.observe(node);
    const stop=observeMotionScope(node,hidden=>{if(!shared)clock.setSuspended(hidden);if(hidden){pressure.to=0;clock.finish(key);pressure.snap(0);pull.snap(0);residual.snap(0);drift=0;pressing=dragging=false;target=desired.current*travel;paint();}});
    media.addEventListener('change',preference);
    if(!shared)clock.setSuspended(motionSuspended(node));paint();
    return()=>{
      disposed=true;redirect.current=()=>{};stop();resize.disconnect();clock.cancel(key);if(!shared)clock.dispose();
      field.removeEventListener('pointerdown',down);field.removeEventListener('keydown',keydown);field.removeEventListener('blur',up);
      window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',up,true);window.removeEventListener('keyup',keyup,true);window.removeEventListener('blur',up);media.removeEventListener('change',preference);
    };
  },[id]);
  useLayoutEffect(()=>redirect.current(),[ratio]);
  return <span ref={root} className="clay-slider" data-disabled={Boolean(props.disabled)}>
    <span className="clay-slider-track" aria-hidden="true"><span className="clay-slider-fill"/></span><span className="clay-slider-thumb" aria-hidden="true"/>
    <input {...props} type="range" ref={input}/>
  </span>;
}
