import candidate from '../../docs/motion/liquid-symbiosis/v2/tokens.json';

/** 仅消费 v2 动效参数，生产主题、控件尺寸和文档格式继续沿用原配置。 */
export const motionTokens = candidate.motion;
/** 弹簧的语义预设由 WPF 与网页读取同一份 JSON。 */
export type SpringPreset = keyof typeof motionTokens.spring;
/** 动效只消费 CSS/DIP 矩形，不参与原生物理像素坐标计算。 */
export type MotionRect = { x: number; y: number; width: number; height: number };
export const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

/** 有界半隐式欧拉积分；改目标不重置位置或速度，长帧不会积成大幅弹跳。 */
export class MotionSpring {
  x: number;
  v = 0;
  to: number;
  constructor(value = 0) { this.x = this.to = value; }
  snap(value: number) { this.x = this.to = value; this.v = 0; }
  get moving() { return this.x !== this.to || this.v !== 0; }
  /** 分割长帧后积分，达到统一位置/速度阈值才精确归位。 */
  step(elapsed: number, preset: SpringPreset) {
    const dt = clamp(elapsed, 0, motionTokens.solver.maxElapsed);
    const steps = Math.max(1, Math.ceil(dt / motionTokens.solver.maxStep)), h = dt / steps;
    const { k, c } = motionTokens.spring[preset];
    for (let i = 0; i < steps; i++) {
      this.v += (-k * (this.x - this.to) - c * this.v) * h;
      this.x += this.v * h;
    }
    if (Math.abs(this.x - this.to) < motionTokens.solver.positionEpsilon && Math.abs(this.v) < motionTokens.solver.velocityEpsilon) {
      this.x = this.to; this.v = 0;
    }
    return this.x;
  }
}

/** 可注入帧源，便于用确定时钟验证中断和休眠，不依赖真实桌面。 */
export type MotionFrames = { now: () => number; request: (frame: (time: number) => void) => number; cancel: (id: number) => void };
/** 命名时间线的取消返回 false；调用者据此阻止迟到退出或关闭新浮卡。 */
type Track = { paint: (value: number, velocity: number) => void; resolve: (completed: boolean) => void; start: number; duration: number; spring?: MotionSpring; preset: SpringPreset };

/** 同一个外壳共用帧循环；连续五帧静止后休眠，输入或布局变化才唤醒。 */
export class MotionClock {
  private tracks = new Map<string, Track>();
  private listeners = new Set<(elapsed: number, time: number) => boolean>();
  private frame = 0;
  private last = 0;
  private quiet = 0;
  frames = 0;
  reduced = false;
  onIdle?: () => void;
  constructor(private source: MotionFrames = { now: () => performance.now(), request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id) }) {}
  has(key:string){return this.tracks.has(key);}
  get activeTracks() { return this.tracks.size; }
  listen(listener: (elapsed: number, time: number) => boolean) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  wake() {
    this.quiet = 0;
    if (!this.frame) { this.last = this.source.now(); this.frame = this.source.request(time => this.tick(time)); }
  }
  cancel(key: string) {
    const track = this.tracks.get(key);
    if (track) { this.tracks.delete(key); track.resolve(false); }
  }
  /** 同名弹簧从旧轨道的当前 x/v 续接，而不是从初始姿态重播。 */
  spring(key: string, paint: Track['paint'], from = 0, to = 1, preset: SpringPreset = 'panel') {
    const previous = this.tracks.get(key)?.spring;
    const spring = new MotionSpring(previous?.x ?? from); spring.v = previous?.v ?? 0; spring.to = to;
    this.cancel(key);
    return new Promise<boolean>(resolve => {
      if (this.reduced) { paint(to, 0); resolve(true); return; }
      this.tracks.set(key, { paint, resolve, spring, preset, start: this.source.now(), duration: 1600 });
      paint(spring.x, spring.v); this.wake();
    });
  }
  /** 同名缓动取消旧回调；减少动态直接提交业务对应的终态。 */
  tween(key: string, duration: number, paint: Track['paint']) {
    this.cancel(key);
    return new Promise<boolean>(resolve => {
      if (this.reduced) { paint(1, 0); resolve(true); return; }
      this.tracks.set(key, { paint, resolve, start: this.source.now(), duration, preset: 'exit' });
      paint(0, 0); this.wake();
    });
  }
  /** 系统偏好变化时立刻归到终态，不能留下半透明弹层或继续退出的旧计时器。 */
  setReduced(reduced: boolean) {
    this.reduced = reduced;
    if (reduced) {
      for (const [key, track] of [...this.tracks]) {
        this.tracks.delete(key); track.paint(track.spring?.to ?? 1, 0); track.resolve(true);
      }
    }
    this.wake();
  }
  stop() {
    if (this.frame) this.source.cancel(this.frame);
    this.frame = 0;
    for (const key of [...this.tracks.keys()]) this.cancel(key);
    this.onIdle?.();
  }
  dispose() { this.stop(); this.listeners.clear(); }
  /** 帧内先更新连续场，再推进命名时间线；完成后不再调度空帧。 */
  private tick(time: number) {
    this.frame = 0; this.frames++;
    const elapsed = clamp((time - this.last) / 1000, 0, motionTokens.solver.maxElapsed); this.last = time;
    let moving = false;
    for (const listener of this.listeners) moving = listener(elapsed, time) || moving;
    for (const [key, track] of [...this.tracks]) {
      if (this.tracks.get(key) !== track) continue;
      let done = false;
      if (track.spring) {
        track.spring.step(elapsed, track.preset);
        done = !track.spring.moving || time - track.start >= track.duration;
        if (done) track.spring.snap(track.spring.to);
        track.paint(track.spring.x, track.spring.v);
      } else {
        const progress = clamp((time - track.start) / track.duration);
        track.paint(1 - Math.pow(1 - progress, 3), 0); done = progress === 1;
      }
      if (done && this.tracks.get(key) === track) { this.tracks.delete(key); track.resolve(true); }
      else moving = true;
    }
    this.quiet = moving ? 0 : this.quiet + 1;
    if (this.quiet < motionTokens.solver.sleepFrames) this.frame = this.source.request(next => this.tick(next));
    else this.onIdle?.();
  }
}

/** 单次液桥只连接同一排的近邻，路径完全属于装饰层。 */
export function liquidBridge(a: MotionRect, b: MotionRect, neck = motionTokens.bridge.neck) {
  if (a.x > b.x) [a, b] = [b, a];
  const x1 = a.x + a.width - 2, x2 = b.x + 2, y1 = a.y + a.height / 2, y2 = b.y + b.height / 2;
  if (x2 - x1 < -8 || x2 - x1 > motionTokens.bridge.maxGap || Math.abs(y1 - y2) > Math.min(a.height, b.height) / 2) return '';
  const middle = (x1 + x2) / 2, radius = Math.min(12, a.height / 3, b.height / 3);
  return 'M' + x1 + ' ' + (y1 - radius) + 'C' + middle + ' ' + (y1 + neck) + ' ' + middle + ' ' + (y2 + neck) + ' ' + x2 + ' ' + (y2 - radius) +
    'L' + x2 + ' ' + (y2 + radius) + 'C' + middle + ' ' + (y2 - neck) + ' ' + middle + ' ' + (y1 - neck) + ' ' + x1 + ' ' + (y1 + radius) + 'Z';
}
