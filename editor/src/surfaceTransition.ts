import { clamp, MotionSpring, type MotionRect } from './motion';

const axes = ['x', 'y', 'width', 'height'] as const;
export type SurfaceStrain = { x:number; y:number; stretch:number };

/** 剩余时间内从当前 x/v 收束到终点；目标改道时也不重置起始速度。 */
export function settleMotion(spring: MotionSpring, target: number, elapsed: number, remaining: number) {
  // 显示前的零时间步只重算布局，不能经乘除运算扰动继承的速度。
  if (elapsed === 0 && remaining > 0) return;
  if (remaining <= elapsed || remaining <= 0) { spring.snap(target); return; }
  const t = elapsed / remaining, p = t * t * (3 - 2 * t), tangent = t * (1 - t) * (1 - t);
  const distance = target - spring.x, velocity = spring.v * remaining;
  spring.x += distance * p + velocity * tangent;
  spring.v = (distance * 6 * t * (1 - t) + velocity * (1 - 4 * t + 3 * t * t)) / remaining;
  spring.to = target;
}

/** 几何各自保留位置/速度；入场中的尺寸变化不再按旧进度直接放大新目标。 */
export class SurfaceTransition {
  private geometry: Record<keyof MotionRect, MotionSpring>;
  private opacity: MotionSpring;
  private shell: MotionSpring;
  private opening = false;
  private closing = false;
  private elapsed = 0;
  private duration = 170;
  private returning = false;
  private strainX=new MotionSpring();
  private strainY=new MotionSpring();
  private stretch=new MotionSpring();

  // 主浮卡可单独收紧正文延迟与材质领先量；其它弹层继续使用原有入场节奏。
  constructor(box: MotionRect, alpha = 0, material = 0, private contentDelay = .25, private materialLead = 4, private soft = false) {
    this.geometry = { x: new MotionSpring(box.x), y: new MotionSpring(box.y), width: new MotionSpring(box.width), height: new MotionSpring(box.height) };
    this.opacity = new MotionSpring(alpha); this.shell = new MotionSpring(material);
  }
  get alpha() { return clamp(this.opacity.x); }
  get material() { return clamp(this.shell.x); }
  get box(): MotionRect { return { x: this.geometry.x.x, y: this.geometry.y.x, width: this.geometry.width.x, height: this.geometry.height.x }; }
  get velocity(): MotionRect { return { x: this.geometry.x.v, y: this.geometry.y.v, width: this.geometry.width.v, height: this.geometry.height.v }; }
  get strain():SurfaceStrain { return {x:this.strainX.x,y:this.strainY.x,stretch:this.stretch.x}; }
  get moving() { return this.closing || this.opening && (this.opacity.moving || this.shell.moving || axes.some(axis => this.geometry[axis].moving) || this.strainX.moving || this.strainY.moving || this.stretch.moving); }

  open(target: MotionRect, _newContent = false) {
    // 正文换页由独立层交接；外壳与可见度只改目标，重开时保留收回速度。
    this.opacity.to = this.shell.to = 1;
    this.opening = true; this.closing = this.returning = false; this.redirect(target);
  }
  redirect(target: MotionRect) { for (const axis of axes) this.geometry[axis].to = target[axis]; }
  close(directionX = 0, directionY = 1, duration = 170) {
    const box=this.box;
    this.startClose({ ...box, x: box.x + clamp(directionX, -1, 1) * 6, y: box.y + clamp(directionY, -1, 1) * 6, width: box.width * .98, height: box.height * .97 },duration,false);
  }
  /** 主浮卡回收到对应按钮；正文提前淡出，避免缩小时挤压文字。 */
  closeTo(target:MotionRect,duration=this.soft?380:260){this.startClose(target,duration,true);}
  private startClose(target:MotionRect,duration:number,returning:boolean){
    if (this.closing || !this.opening && this.alpha === 0 && this.material === 0) return;
    this.redirect(target);this.returning=returning;
    this.elapsed = 0; this.duration = Math.max(0, duration); this.opening = false; this.closing = true;
  }
  /** 手动布局或系统归位允许清零速度；普通目标变化只改弹簧目标。 */
  snap(box: MotionRect, open: boolean) {
    for (const axis of axes) this.geometry[axis].snap(box[axis]);
    this.opening = open; this.closing = false;
    this.opacity.snap(open ? 1 : 0); this.shell.snap(open ? 1 : 0);
    this.strainX.snap(0);this.strainY.snap(0);this.stretch.snap(0);
  }
  finish() {
    const target = { x: this.geometry.x.to, y: this.geometry.y.to, width: this.geometry.width.to, height: this.geometry.height.to };
    this.snap(target, this.opening);
  }
  step(elapsed: number) {
    if (!this.moving) return;
    if (this.opening) {
      for (const axis of axes) this.geometry[axis].step(elapsed, 'panel');
      this.opacity.step(elapsed * (1 - this.contentDelay * .5), 'panel');
      this.shell.step(elapsed * Math.min(2, this.materialLead), 'panel');
    } else {
      const dt = clamp(elapsed, 0, .05), remaining = Math.max(0, this.duration / 1000 - this.elapsed);
      for (const axis of axes) {
        const spring = this.geometry[axis];
        settleMotion(spring, spring.to, dt, remaining);
        if ((axis === 'width' || axis === 'height') && spring.x < 1) { spring.x = 1; spring.v = Math.max(0, spring.v); }
      }
      settleMotion(this.opacity, 0, dt, Math.max(0, this.duration / 1000 * (this.returning ? .62 : 1) - this.elapsed));
      settleMotion(this.shell, 0, dt, remaining);
      this.elapsed += dt;
      if (dt >= remaining) this.finish();
    }
    // 透明度触及物理边界即卸掉越界速度，反复开合不会积累不可见的超调。
    for (const spring of [this.opacity, this.shell]) if (spring.x < 0 || spring.x > 1) { spring.x = clamp(spring.x); spring.v = 0; }
    if(this.soft&&this.moving){
      // 几何速度只改变外力目标；轮廓独立欠阻尼回弹，重开或改道时不清零当前形变。
      const v=this.velocity,box=this.box;
      this.strainX.to=20*Math.tanh((v.x+v.width/2)*.018/20);
      this.strainY.to=20*Math.tanh((v.y+v.height/2)*.018/20);
      this.stretch.to=16*Math.tanh((v.width/Math.max(40,box.width)-v.height/Math.max(40,box.height))*.2);
      this.strainX.step(elapsed,'selection');this.strainY.step(elapsed,'selection');this.stretch.step(elapsed,'selection');
    }
  }
}
