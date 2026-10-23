import { clamp, MotionClock, MotionSpring } from './motion';

type State={element:HTMLButtonElement;box:DOMRect;mode:string;width:MotionSpring;draw:MotionSpring;edit:MotionSpring;x:MotionSpring;y:MotionSpring};

/** 三态在同一块材质中拉长/合并；布局一次到位，邻居用保留速度的 FLIP 续接。 */
export class ToolStateMotion {
  private states=new Map<HTMLButtonElement,State>();
  private observer:MutationObserver;
  private resize:ResizeObserver;
  private unlisten:()=>void;
  private queued=false;
  constructor(private rail:HTMLElement,private clock:MotionClock){
    this.measure(false);
    this.observer=new MutationObserver(()=>this.schedule());
    this.observer.observe(rail,{subtree:true,childList:true,attributes:true,attributeFilter:['data-tool-state']});
    this.resize=new ResizeObserver(()=>this.schedule());this.resize.observe(rail);
    this.unlisten=clock.listen(dt=>this.step(dt));
  }
  private schedule(){
    if(this.queued)return;this.queued=true;
    queueMicrotask(()=>{if(!this.queued)return;this.queued=false;this.measure(true);});
  }
  private measure(animate:boolean){
    const buttons=[...this.rail.querySelectorAll<HTMLButtonElement>('[data-motion-button]')];
    const changing=buttons.some(el=>this.states.get(el)?.mode!==(el.dataset.toolState??''));
    const running=[...this.states.values()].some(s=>s.width.moving||s.draw.moving||s.edit.moving||s.x.moving||s.y.moving);
    const allow=animate&&(changing||running)&&!this.clock.reduced&&!this.rail.closest('[data-motion-dragging],[data-motion-hidden=true],.is-suspended,.is-awaiting');
    for(const element of buttons){
      const box=element.getBoundingClientRect(),mode=element.dataset.toolState??'';
      let s=this.states.get(element);
      if(!s){s={element,box,mode,width:new MotionSpring(box.width),draw:new MotionSpring(Number(mode==='drawing')),edit:new MotionSpring(Number(mode==='editing')),x:new MotionSpring(),y:new MotionSpring()};this.states.set(element,s);}
      else if(allow){s.x.x+=s.box.x-box.x;s.y.x+=s.box.y-box.y;}
      s.box=box;s.mode=mode;s.width.to=box.width;s.draw.to=Number(mode==='drawing');s.edit.to=Number(mode==='editing');
      if(!allow){s.width.snap(box.width);s.x.snap(0);s.y.snap(0);s.draw.snap(s.draw.to);s.edit.snap(s.edit.to);}
      this.paint(s);
    }
    for(const [element] of this.states)if(!element.isConnected)this.states.delete(element);
    this.clock.wake();
  }
  private paint(s:State){
    if(!s.mode)return;
    const reveal=(s.width.x-39)/36;
    s.element.style.setProperty('--tool-reveal',String(reveal));
    s.element.style.setProperty('--tool-draw-state',String(clamp(s.draw.x)));
    s.element.style.setProperty('--tool-edit-state',String(clamp(s.edit.x)));
  }
  /** 数值直接供主轨绘制读取，避免逐帧读取样式或尺寸导致同步布局。 */
  pose(element:HTMLButtonElement){
    const s=this.states.get(element);
    // 调整与绘制同宽，也要由材质交接速度驱动横向拉扯及纵向回弹。
    return s?{x:s.x.x,y:s.y.x,width:s.width.x,strain:s.mode?clamp(s.width.v/1200+(s.draw.v-s.edit.v)*.014,-.13,.13):0}:null;
  }
  private step(dt:number){
    let moving=false;
    for(const s of this.states.values()){
      const springs=[s.width,s.draw,s.edit,s.x,s.y];
      if(!springs.some(spring=>spring.moving))continue;
      if(this.clock.reduced)for(const spring of springs)spring.snap(spring.to);
      else for(const spring of springs)spring.step(dt,'selection');
      this.paint(s);moving=springs.some(spring=>spring.moving)||moving;
    }
    return moving;
  }
  reset(){for(const s of this.states.values()){s.width.snap(s.width.to);s.draw.snap(s.draw.to);s.edit.snap(s.edit.to);s.x.snap(0);s.y.snap(0);this.paint(s);}}
  destroy(){this.queued=false;this.observer.disconnect();this.resize.disconnect();this.unlisten();this.states.clear();}
}
