import { clamp, MotionClock, MotionSpring, type MotionRect } from './motion';

type Slot={element:HTMLElement;box:MotionRect};
type Geometry={x:MotionSpring;y:MotionSpring;width:MotionSpring;height:MotionSpring};
type State=Geometry&{element:HTMLElement;box:MotionRect;mode:string;draw:MotionSpring;edit:MotionSpring;recoil:MotionSpring;landing:{direction:number;age:number}|null};
const geometry=(box:MotionRect):Geometry=>({x:new MotionSpring(box.x),y:new MotionSpring(box.y),width:new MotionSpring(box.width),height:new MotionSpring(box.height)});
const axes=['x','y','width','height'] as const;

/** 底座和局部槽位共用同一弹簧参数；只有工具三态重排保留速度，整体搬动重建坐标基准。 */
export class ToolStateMotion {
  private states=new Map<HTMLElement,State>();
  private frame:Geometry|null=null;
  private bounds:MotionRect|null=null;
  private rebase=true;
  constructor(private rail:HTMLElement,private clock:MotionClock){}
  /** 由主轨唯一的布局读取阶段喂入，避免独立观察器用两次测量重复补偿位置。 */
  layout(bounds:MotionRect,slots:Slot[]){
    const changing=slots.some(({element})=>this.states.has(element)&&this.states.get(element)!.mode!==(element.dataset.toolState??''));
    const animate=!this.rebase&&!this.clock.reduced&&!this.rail.closest('[inert],[data-motion-dragging],[data-motion-hidden=true],.is-suspended,.is-awaiting')&&(changing||this.moving);
    this.frame??=geometry(bounds);this.bounds=bounds;
    for(const axis of axes){this.frame[axis].to=bounds[axis];if(!animate)this.frame[axis].snap(bounds[axis]);}
    const present=new Set<HTMLElement>();
    for(const {element,box} of slots){
      present.add(element);const mode=element.dataset.toolState??'';
      let s=this.states.get(element);
      if(!s){s={element,box,mode,...geometry(box),draw:new MotionSpring(Number(mode==='drawing')),edit:new MotionSpring(Number(mode==='editing')),recoil:new MotionSpring(),landing:null};this.states.set(element,s);}
      // 仅记录最新目标，不能用定时回调给已经反向的旧状态补上一记冲量。
      if(animate&&s.mode!==mode)s.landing={direction:Math.sign(box.width-s.width.x)||(mode==='drawing'?1:-1),age:0};
      s.box=box;s.mode=mode;
      for(const axis of axes){s[axis].to=box[axis];if(!animate)s[axis].snap(box[axis]);}
      s.draw.to=Number(mode==='drawing');s.edit.to=Number(mode==='editing');
      if(!animate){s.draw.snap(s.draw.to);s.edit.snap(s.edit.to);s.recoil.snap(0);s.landing=null;}
      this.paint(s);
    }
    for(const element of this.states.keys())if(!present.has(element))this.states.delete(element);
    this.rebase=false;
  }
  private paint(s:State){
    if(!s.mode)return;
    s.element.style.setProperty('--tool-reveal',String((s.width.x-39)/36));
    s.element.style.setProperty('--tool-draw-state',String(clamp(s.draw.x)));
    s.element.style.setProperty('--tool-edit-state',String(clamp(s.edit.x)));
  }
  get pending(){return [...this.states.values()].some(s=>s.mode!==(s.element.dataset.toolState??''));}
  get moving(){return !!this.frame&&axes.some(axis=>this.frame![axis].moving)||[...this.states.values()].some(s=>axes.some(axis=>s[axis].moving)||s.draw.moving||s.edit.moving||s.recoil.moving||s.landing!==null);}
  get body(){
    const b=this.bounds,f=this.frame;
    return b&&f?{x:f.x.x-b.x,y:f.y.x-b.y,width:f.width.x,height:f.height.x}:null;
  }
  /** 所有坐标相对当前轨道；宽度补偿与底座同相，不能把上次截图的屏幕坐标带进来。 */
  pose(element:HTMLElement){
    const s=this.states.get(element),body=this.body;
    if(!s||!body)return null;
    return {x:s.x.x-s.box.x+body.x,y:s.y.x-s.box.y+body.y,width:s.width.x,height:s.height.x,
      strain:clamp(s.recoil.x/100,-.1,.1),lift:-s.recoil.x*.12};
  }
  step(dt:number){
    if(this.frame)for(const axis of axes){const spring=this.frame[axis];if(this.clock.reduced)spring.snap(spring.to);else spring.step(dt,'toolLayout');}
    for(const s of this.states.values()){
      const springs=[...axes.map(axis=>s[axis]),s.draw,s.edit];
      if(!springs.some(spring=>spring.moving)&&!s.recoil.moving&&!s.landing)continue;
      for(const spring of springs){if(this.clock.reduced)spring.snap(spring.to);else spring.step(dt,'toolLayout');}
      if(this.clock.reduced){s.recoil.snap(0);s.landing=null;}
      else {
        s.recoil.step(dt,'toolRecoil');
        if(s.landing){
          s.landing.age+=dt;
          // 先抵达新轮廓，再释放一次弹性力；只改变速度，不跳改当前形状。
          if(s.landing.age>=.1&&Math.abs(s.width.to-s.width.x)<.65&&Math.abs(s.draw.to-s.draw.x)+Math.abs(s.edit.to-s.edit.x)<.04){
            s.recoil.v=clamp(s.recoil.v+s.landing.direction*230,-300,300);s.landing=null;
          }
        }
      }
      this.paint(s);
    }
    return this.moving;
  }
  /** 选区移动、重入及手动搬动不是三态过渡：清掉旧速度，下一次布局以当前位置初始化。 */
  reset(){
    this.rebase=true;
    if(this.frame)for(const axis of axes)this.frame[axis].snap(this.frame[axis].to);
    for(const s of this.states.values()){for(const axis of axes)s[axis].snap(s[axis].to);s.draw.snap(s.draw.to);s.edit.snap(s.edit.to);s.recoil.snap(0);s.landing=null;this.paint(s);}
  }
  destroy(){this.states.clear();this.frame=this.bounds=null;}
}
