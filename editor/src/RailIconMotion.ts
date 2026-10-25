import { clamp, MotionClock, MotionSpring } from './motion';

type Part={element:SVGGraphicsElement;x:number;y:number;index:number;original:[string,string,string]};
type Icon={owner:HTMLElement;kind:string;parts:Part[];force:MotionSpring;tail:MotionSpring;pulse:number;held:boolean;painted:string;paintedForce:number;paintedTail:number};
const ownerSelector='[data-motion-button],.clay-grip';
const shapes='path,rect,line,polyline,polygon,circle,ellipse';
const glyphShapes='.liquid-glyph svg '+shapes.split(',').join(', .liquid-glyph svg '),gripShapes='svg '+shapes.split(',').join(', svg ');
const splitKinds=new Set(['more','mosaic','grip','scan']),pairedKinds=new Set(['translate','read']),bendKinds=new Set(['arrow','brush','highlight','pin']);
const historyKinds=new Set(['undo','redo']),crossKinds=new Set(['close','cancel']),outlineKinds=new Set(['rect','ellipse','text']);

/** 仅形变 SVG 线条和部件；不移动按钮、文案或图标占位，共用主轨时钟并保留中断速度。 */
export class RailIconMotion {
  private icons=new Map<HTMLElement,Icon>();
  private hovered:HTMLElement|null=null;
  private pointer={x:NaN,y:NaN};
  private cleanup:(()=>void)[]=[];
  constructor(private rail:HTMLElement,private clock:MotionClock,private blocked:()=>boolean,private modeForce:(owner:HTMLElement)=>number){
    const listen=(target:EventTarget,name:string,handler:EventListener)=>{target.addEventListener(name,handler);this.cleanup.push(()=>target.removeEventListener(name,handler));};
    const owner=(event:Event)=>event.target instanceof Element?event.target.closest<HTMLElement>(ownerSelector):null;
    listen(rail,'pointermove',((event:PointerEvent)=>{
      if(event.pointerType!=='mouse'||Math.hypot(event.clientX-this.pointer.x,event.clientY-this.pointer.y)<.75)return;
      this.pointer={x:event.clientX,y:event.clientY};
      const target=owner(event);
      if(target!==this.hovered){this.hovered=target;if(!this.blocked())this.pulse(target,.18);}
    }) as EventListener);
    listen(rail,'pointerleave',()=>{this.hovered=null;});
    listen(rail,'focusin',event=>{const target=owner(event);if(target?.matches(':focus-visible')&&!this.blocked())this.pulse(target,.2);});
    const press=(target:HTMLElement|null)=>{if(this.blocked())return;const icon=target&&this.icons.get(target);if(icon&&this.usable(icon)){icon.held=true;this.clock.wake();}};
    const release=()=>{for(const icon of this.icons.values())if(icon.held){icon.held=false;this.clock.wake();}};
    listen(rail,'pointerdown',((event:PointerEvent)=>{if(event.button===0)press(owner(event));}) as EventListener);
    listen(rail,'keydown',((event:KeyboardEvent)=>{if(!event.repeat&&(event.key==='Enter'||event.key===' '||owner(event)?.classList.contains('clay-grip')&&event.key.startsWith('Arrow')))press(owner(event));}) as EventListener);
    // 辅助技术的 click 没有前置按压；同样只改变外力，不重置图标形状。
    listen(rail,'click',event=>{if(!this.blocked())this.pulse(owner(event),.14);});
    listen(window,'pointerup',release);listen(window,'pointercancel',release);listen(window,'keyup',release);listen(window,'blur',()=>this.reset());
  }
  private usable(icon:Icon){return icon.owner.isConnected&&!icon.owner.matches(':disabled')&&!icon.owner.closest('[inert]');}
  private pulse(owner:HTMLElement|null,duration:number){const icon=owner&&this.icons.get(owner);if(icon&&this.usable(icon)){icon.pulse=duration;this.clock.wake();}}
  /** 缓存新出现的矢量部件；所有包围盒只在主轨布局读取阶段测量。 */
  sync(){
    const present=new Set<HTMLElement>();
    for(const owner of this.rail.querySelectorAll<HTMLElement>(ownerSelector)){
      present.add(owner);
      const kind=owner.dataset.iconMotion??owner.dataset.annotationKind??owner.dataset.motionAction??owner.dataset.panelTrigger??'grip';
      const nodes=[...owner.querySelectorAll<SVGGraphicsElement>(glyphShapes)];
      if(owner.classList.contains('clay-grip'))nodes.push(...owner.querySelectorAll<SVGGraphicsElement>(gripShapes));
      const elements=nodes.filter(node=>!node.closest('defs'));
      let icon=this.icons.get(owner);
      // 每次仍确认当前节点；种类与部件顺序完全一致时复用已有状态，避免重建 Map 和数组。
      if(icon&&icon.kind===kind&&elements.length===icon.parts.length&&elements.every((element,index)=>element===icon!.parts[index].element))continue;
      if(!icon){icon={owner,kind,parts:[],force:new MotionSpring(),tail:new MotionSpring(),pulse:0,held:false,painted:'',paintedForce:NaN,paintedTail:NaN};this.icons.set(owner,icon);}
      // 翻译衍生按钮会复用 DOM 切换取消/阅读，不能沿用旧笔画的构造和受力方向。
      if(icon.kind!==kind){for(const part of icon.parts)this.restore(part);icon.kind=kind;icon.parts=[];icon.painted='';}
      const old=new Map(icon.parts.map(part=>[part.element,part]));
      icon.parts=elements.map((element,index)=>{
        const prior=old.get(element);if(prior){old.delete(element);return prior;}
        const box=element.getBBox(),view=element.ownerSVGElement!.viewBox.baseVal;
        const part:Part={element,index,x:clamp((box.x+box.width/2-view.x)/Math.max(1,view.width)*2-1,-1,1),y:clamp((box.y+box.height/2-view.y)/Math.max(1,view.height)*2-1,-1,1),original:[element.style.transform,element.style.transformOrigin,element.style.transformBox]};
        element.dataset.railIconPart='';element.style.transformOrigin='50% 50%';element.style.transformBox='view-box';icon!.painted='';return part;
      });
      for(const part of old.values())this.restore(part);
    }
    for(const [owner,icon] of this.icons)if(!present.has(owner)){for(const part of icon.parts)this.restore(part);this.icons.delete(owner);}
  }
  private restore(part:Part){const style=part.element.style;[style.transform,style.transformOrigin,style.transformBox]=part.original;delete part.element.dataset.railIconPart;}
  private paint(icon:Icon){
    // 共享时钟还在推进其它按钮时，静止图标不重复限幅和格式化；新部件仍强制首绘。
    if(icon.painted&&icon.paintedForce===icon.force.x&&icon.paintedTail===icon.tail.x)return;
    icon.paintedForce=icon.force.x;icon.paintedTail=icon.tail.x;
    // 柔性限幅避免较强受力撞到硬上限后停顿，再反向时仍连续。
    const f=1.45*Math.tanh(icon.force.x/1.45),lag=1.2*Math.tanh((icon.force.x-icon.tail.x)/1.2),pose=f+':'+lag;
    if(icon.painted===pose)return;icon.painted=pose;
    for(const part of icon.parts){
      // 21px 图标需要可辨的横纵形变；面积近似守恒，卸力后按原速度反向回鼓。
      const {x,y,index}=part;let dx=x*lag*2,dy=y*lag*1.4,turn=lag*7,sx=1+f*.22,sy=1/sx,skew=lag*7;
      // 不同构造按部件受力：括角/点阵分开合拢，箭杆/笔尖弯转，书页和译文笔画相向牵拉。
      if(splitKinds.has(icon.kind)){dx+=x*f*3;dy+=y*f*2;turn=lag*3;}
      else if(pairedKinds.has(icon.kind)){dx+=x*f*2.4;turn+=x*f*16;}
      else if(bendKinds.has(icon.kind)){turn+=f*(icon.kind==='pin'?14:-16);dx+=y*lag*1.6;}
      else if(historyKinds.has(icon.kind)){turn+=f*(icon.kind==='undo'?-23:23);skew=0;}
      else if(crossKinds.has(icon.kind)){turn+=(index%2?1:-1)*f*14;sx=1+f*.18;sy=1/sx;}
      else if(icon.kind==='done'){turn-=f*12;skew+=f*8;}
      else if(icon.kind==='appearance'){turn+=x*f*15;dx+=x*f*1.7;}
      else if(outlineKinds.has(icon.kind)){skew+=f*9;}
      part.element.style.transform=f===0&&lag===0?part.original[0]:`translate(${dx}px,${dy}px) rotate(${turn}deg) skewX(${skew}deg) scale(${sx},${sy})`;
    }
  }
  step(dt:number){
    let moving=false;const blocked=this.blocked();
    for(const icon of this.icons.values()){
      if(this.clock.reduced||!this.usable(icon)){this.clear(icon);continue;}
      if(blocked){icon.pulse=0;icon.held=false;}
      else icon.pulse=Math.max(0,icon.pulse-dt);
      icon.force.to=this.modeForce(icon.owner)*1.6+(blocked?0:icon.held?-.9:icon.pulse>0?1:0);
      icon.force.step(dt,icon.held?'press':'toolRecoil');
      icon.tail.to=icon.force.x;icon.tail.step(dt,'selection');
      this.paint(icon);moving=icon.force.moving||icon.tail.moving||icon.pulse>0||moving;
    }
    return moving;
  }
  private clear(icon:Icon){icon.force.snap(0);icon.tail.snap(0);icon.pulse=0;icon.held=false;this.paint(icon);}
  reset(){for(const icon of this.icons.values())this.clear(icon);this.hovered=null;this.pointer={x:NaN,y:NaN};}
  destroy(){this.reset();for(const icon of this.icons.values())for(const part of icon.parts)this.restore(part);this.icons.clear();this.cleanup.forEach(clean=>clean());}
}
