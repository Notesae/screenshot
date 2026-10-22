import { clamp, MotionSpring, type MotionRect } from './motion';

const axes = ['x', 'y', 'width', 'height'] as const;

/** 几何各自保留位置/速度；入场中的尺寸变化不再按旧进度直接放大新目标。 */
export class SurfaceTransition {
  private geometry: Record<keyof MotionRect, MotionSpring>;
  private progress = new MotionSpring();
  private opening = false;
  private closing = false;
  private elapsed = 0;
  private duration = 170;
  private from!: MotionRect;
  private fromAlpha = 0;
  private fromMaterial = 0;
  alpha: number;
  material: number;

  constructor(box: MotionRect, alpha = 0, material = 0, private contentDelay = .25) {
    this.geometry = { x: new MotionSpring(box.x), y: new MotionSpring(box.y), width: new MotionSpring(box.width), height: new MotionSpring(box.height) };
    this.alpha = alpha; this.material = material;
  }
  get box(): MotionRect { return { x: this.geometry.x.x, y: this.geometry.y.x, width: this.geometry.width.x, height: this.geometry.height.x }; }
  get velocity(): MotionRect { return { x: this.geometry.x.v, y: this.geometry.y.v, width: this.geometry.width.v, height: this.geometry.height.v }; }
  get moving() { return this.closing || this.opening && (this.progress.moving || axes.some(axis => this.geometry[axis].moving)); }

  open(target: MotionRect, newContent = false) {
    if (!this.opening || newContent) {
      this.fromAlpha = newContent ? 0 : this.alpha; this.fromMaterial = this.material;
      this.alpha = this.fromAlpha; this.progress.snap(0); this.progress.to = 1;
    }
    this.opening = true; this.closing = false; this.redirect(target);
  }
  redirect(target: MotionRect) { for (const axis of axes) this.geometry[axis].to = target[axis]; }
  close(directionX = 0, directionY = 1, duration = 170) {
    if (this.closing || !this.opening && this.alpha === 0 && this.material === 0) return;
    this.from = this.box; this.fromAlpha = this.alpha; this.fromMaterial = this.material;
    this.redirect({ ...this.from, x: this.from.x + clamp(directionX, -1, 1) * 6, y: this.from.y + clamp(directionY, -1, 1) * 6, width: this.from.width * .98, height: this.from.height * .97 });
    this.elapsed = 0; this.duration = Math.max(0, duration); this.opening = false; this.closing = true;
  }
  /** 手动布局或系统归位允许清零速度；普通目标变化只改弹簧目标。 */
  snap(box: MotionRect, open: boolean) {
    for (const axis of axes) this.geometry[axis].snap(box[axis]);
    this.opening = open; this.closing = false; this.progress.snap(1);
    this.alpha = this.material = open ? 1 : 0;
  }
  finish() {
    const target = { x: this.geometry.x.to, y: this.geometry.y.to, width: this.geometry.width.to, height: this.geometry.height.to };
    this.snap(target, this.opening);
  }
  step(elapsed: number) {
    if (!this.moving) return;
    if (this.opening) {
      for (const axis of axes) this.geometry[axis].step(elapsed, 'panel');
      this.progress.step(elapsed, 'panel'); const p = clamp(this.progress.x);
      this.alpha = this.fromAlpha + (1 - this.fromAlpha) * clamp((p - this.contentDelay) / (1 - this.contentDelay));
      this.material = this.fromMaterial + (1 - this.fromMaterial) * clamp(p * 4);
    } else {
      this.elapsed += clamp(elapsed, 0, 0.05);
      const t = this.duration ? clamp(this.elapsed * 1000 / this.duration) : 1, p = 1 - Math.pow(1 - t, 3);
      const speed = t < 1 ? 3000 * Math.pow(1 - t, 2) / this.duration : 0;
      for (const axis of axes) {
        const spring = this.geometry[axis], distance = spring.to - this.from[axis];
        spring.x = this.from[axis] + distance * p; spring.v = distance * speed;
      }
      this.alpha = this.fromAlpha * (1 - p); this.material = this.fromMaterial * (1 - p);
      if (t === 1) this.finish();
    }
  }
}
