import { clamp, MotionClock, MotionSpring, type MotionRect } from './motion';

type Slot={element:HTMLElement;box:MotionRect};
type Geometry={x:MotionSpring;y:MotionSpring;width:MotionSpring;height:MotionSpring};
type State=Geometry&{element:HTMLElement;box:MotionRect;mode:string;draw:MotionSpring;edit:MotionSpring;recoil:MotionSpring;landing:{direction:number;age:number}|null;painted:{reveal:number;draw:number;edit:number}};
const geometry=(box:MotionRect):Geometry=>({x:new MotionSpring(box.x),y:new MotionSpring(box.y),width:new MotionSpring(box.width),height:new MotionSpring(box.height)});
const axes=['x','y','width','height'] as const;
// 槽位弹簧顺序固定，逐帧复用键名，避免每个按钮反复分配临时数组。
const stateAxes=[...axes,'draw','edit'] as const;
const stateMoving=(s:State)=>stateAxes.some(axis=>s[axis].moving)||s.recoil.moving||s.landing!==null;
const stateIconForce=(s:State)=>clamp(s.width.v/440+(s.draw.v-s.edit.v)/30+s.recoil.x/12,-1,1);
// 柔性限幅：强受力逐渐趋近上限，不在峰值截出停顿的平台。
const soft=(value:number,limit:number)=>limit*Math.tanh(value/limit);
// 一次落位释放的冲量（px/s），按钮与整条软体共用。
const landingImpulse=230;

/** 底座和局部槽位共用同一弹簧参数；只有工具三态重排保留速度，整体搬动重建坐标基准。 */
export class ToolStateMotion {
  private states=new Map<HTMLElement,State>();
  private frame:Geometry|null=null;
  private bounds:MotionRect|null=null;
  private rebase=true;
  // 整条轨道的落位余振：底座伸缩，全部按钮与拖动柄随同一形变场移动。
  private recoil=new MotionSpring();
  // 只保留最新一次三态重排的释放，旧过渡不能延迟补弹。
  private landing:{direction:number;age:number}|null=null;
  constructor(private rail:HTMLElement,private clock:MotionClock){}
  /** 由主轨唯一的布局读取阶段喂入，避免独立观察器用两次测量重复补偿位置。 */
  layout(bounds:MotionRect,slots:Slot[]){
    const changing=slots.some(({element})=>this.states.has(element)&&this.states.get(element)!.mode!==(element.dataset.toolState??''));
    const animate=!this.rebase&&!this.clock.reduced&&!this.rail.closest('[inert],[data-motion-dragging],[data-motion-hidden=true],.is-suspended,.is-awaiting')&&(changing||this.moving);
    this.frame??=geometry(bounds);
    // 轨道变宽先向外伸、变窄先向内收；宽度不变的换位仍释放一次外伸力。
    if(animate&&changing)this.landing={direction:Math.sign(bounds.width-this.frame.width.x)||1,age:0};
    else if(!animate){this.recoil.snap(0);this.landing=null;}
    this.bounds=bounds;
    for(const axis of axes){this.frame[axis].to=bounds[axis];if(!animate)this.frame[axis].snap(bounds[axis]);}
    const present=new Set<HTMLElement>();
    for(const {element,box} of slots){
      present.add(element);const mode=element.dataset.toolState??'';
      let s=this.states.get(element);
      if(!s){s={element,box,mode,...geometry(box),draw:new MotionSpring(Number(mode==='drawing')),edit:new MotionSpring(Number(mode==='editing')),recoil:new MotionSpring(),landing:null,painted:{reveal:NaN,draw:NaN,edit:NaN}};this.states.set(element,s);}
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
    const reveal=(s.width.x-39)/36,draw=clamp(s.draw.x),edit=clamp(s.edit.x),last=s.painted;
    // 精确相等才省略写入，保留全部形变精度，也不让纯余振反复更新静止材质。
    if(last.reveal!==reveal){s.element.style.setProperty('--tool-reveal',String(reveal));last.reveal=reveal;}
    if(last.draw!==draw){s.element.style.setProperty('--tool-draw-state',String(draw));last.draw=draw;}
    if(last.edit!==edit){s.element.style.setProperty('--tool-edit-state',String(edit));last.edit=edit;}
  }
  get pending(){for(const s of this.states.values())if(s.mode!==(s.element.dataset.toolState??''))return true;return false;}
  get moving(){
    if(this.recoil.moving||this.landing||this.frame&&axes.some(axis=>this.frame![axis].moving))return true;
    for(const s of this.states.values())if(stateMoving(s))return true;
    return false;
  }
  get body(){
    const b=this.bounds,f=this.frame;
    // strain 为底座以自身中心的横向伸缩比例（纵向反比），lift 为整体上浮像素。
    return b&&f?{x:f.x.x-b.x,y:f.y.x-b.y,width:f.width.x,height:f.height.x,strain:soft(this.recoil.x/300,.05),lift:-this.recoil.x*.12}:null;
  }
  /** 图标只消费这一轴外力，避免为每个 SVG 另建底座与完整姿态对象。 */
  iconForce(element:HTMLElement){
    const s=this.states.get(element);
    return s&&this.bounds&&this.frame?stateIconForce(s):0;
  }
  /** 所有坐标相对当前轨道；宽度补偿与底座同相，不能把上次截图的屏幕坐标带进来。 */
  pose(element:HTMLElement){
    const s=this.states.get(element),body=this.body;
    if(!s||!body)return null;
    // 槽位中心按底座的伸缩场位移，整条软体一起拉伸与回缩，按钮本身不额外变形。
    const dx=(s.x.x+s.width.x/2-body.width/2)*body.strain,dy=(s.y.x+s.height.x/2-body.height/2)*(1/(1+body.strain)-1)+body.lift;
    return {x:s.x.x-s.box.x+body.x+dx,y:s.y.x-s.box.y+body.y+dy,width:s.width.x,height:s.height.x,
      strain:soft(s.recoil.x/100,.1),lift:-s.recoil.x*.12,
      iconForce:stateIconForce(s)};
  }
  step(dt:number){
    if(this.frame)for(const axis of axes){const spring=this.frame[axis];if(this.clock.reduced)spring.snap(spring.to);else spring.step(dt,'toolLayout');}
    for(const s of this.states.values()){
      if(!stateMoving(s))continue;
      for(const axis of stateAxes){const spring=s[axis];if(this.clock.reduced)spring.snap(spring.to);else spring.step(dt,'toolLayout');}
      if(this.clock.reduced){s.recoil.snap(0);s.landing=null;}
      else {
        s.recoil.step(dt,'toolRecoil');
        if(s.landing){
          s.landing.age+=dt;
          // 先抵达新轮廓，再释放一次弹性力；只改变速度，不跳改当前形状。
          if(s.landing.age>=.1&&Math.abs(s.width.to-s.width.x)<.65&&Math.abs(s.draw.to-s.draw.x)+Math.abs(s.edit.to-s.edit.x)<.04){
            s.recoil.v=soft(s.recoil.v+s.landing.direction*landingImpulse,300);s.landing=null;
          }
        }
      }
      this.paint(s);
    }
    if(this.clock.reduced){this.recoil.snap(0);this.landing=null;}
    else{
      this.recoil.step(dt,'toolRecoil');
      if(this.landing){
        this.landing.age+=dt;
        // 底座和所有槽位都抵达新轮廓后，才把同一次释放传给整条软体。
        const f=this.frame;let arrived=!f||Math.abs(f.width.to-f.width.x)<.65&&Math.abs(f.height.to-f.height.x)<.65;
        for(const s of this.states.values())if(s.landing){arrived=false;break;}
        if(this.landing.age>=.1&&arrived){this.recoil.v=soft(this.recoil.v+this.landing.direction*landingImpulse,300);this.landing=null;}
      }
    }
    return this.moving;
  }
  /** 选区移动、重入及手动搬动不是三态过渡：清掉旧速度，下一次布局以当前位置初始化。 */
  reset(){
    this.rebase=true;this.recoil.snap(0);this.landing=null;
    if(this.frame)for(const axis of axes)this.frame[axis].snap(this.frame[axis].to);
    for(const s of this.states.values()){for(const axis of axes)s[axis].snap(s[axis].to);s.draw.snap(s.draw.to);s.edit.snap(s.edit.to);s.recoil.snap(0);s.landing=null;this.paint(s);}
  }
  destroy(){this.states.clear();this.frame=this.bounds=null;}
}
