import candidate from '../../design/motion.tokens.json';

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
    // 共享时钟仍会访问已停稳的轴；目标和速度都未变化时无需重复积分。
    if (!this.moving) return this.x;
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
type Track = { paint: (value: number, velocity: number) => void; resolve: (completed: boolean) => void; start: number; duration: number; spring?: MotionSpring; preset: SpringPreset; advance?: (elapsed: number, finish: boolean) => boolean };

/** 同一个外壳共用帧循环；连续五帧静止后休眠，输入或布局变化才唤醒。 */
export class MotionClock {
  private tracks = new Map<string, Track>();
  private listeners = new Set<(elapsed: number, time: number) => boolean>();
  private frame = 0;
  private last = 0;
  private quiet = 0;
  private ticking = false;
  private version = 0;
  private disposed = false;
  frames = 0;
  reduced = false;
  private suspended = false;
  onIdle?: () => void;
  constructor(private source: MotionFrames = { now: () => performance.now(), request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id) }) {}
  has(key:string){return this.tracks.has(key);}
  get activeTracks() { return this.tracks.size; }
  listen(listener: (elapsed: number, time: number) => boolean) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  wake() {
    if (this.disposed || this.suspended) return;
    this.quiet = 0;
    if (!this.frame) {
      if (!this.ticking) this.last = this.source.now();
      this.frame = this.source.request(time => this.tick(time));
    }
  }
  cancel(key: string) {
    const track = this.tracks.get(key);
    if (track) { this.tracks.delete(key); track.resolve(false); }
  }
  /** 同名弹簧从旧轨道的当前 x/v 续接，而不是从初始姿态重播。 */
  spring(key: string, paint: Track['paint'], from = 0, to = 1, preset: SpringPreset = 'panel') {
    if (this.disposed) return Promise.resolve(false);
    const previous = this.tracks.get(key)?.spring;
    const spring = new MotionSpring(previous?.x ?? from); spring.v = previous?.v ?? 0; spring.to = to;
    this.cancel(key);
    return new Promise<boolean>(resolve => {
      if (this.reduced || this.suspended) { paint(to, 0); resolve(true); return; }
      const track = { paint, resolve, spring, preset, start: this.source.now(), duration: 1600 };
      this.tracks.set(key, track); paint(spring.x, spring.v);
      if (this.tracks.get(key) === track) this.wake();
    });
  }
  /** 同名缓动取消旧回调；减少动态直接提交业务对应的终态。 */
  tween(key: string, duration: number, paint: Track['paint']) {
    if (this.disposed) return Promise.resolve(false);
    this.cancel(key);
    return new Promise<boolean>(resolve => {
      if (this.reduced || this.suspended) { paint(1, 0); resolve(true); return; }
      const track: Track = { paint, resolve, start: this.source.now(), duration, preset: 'exit' };
      this.tracks.set(key, track); paint(0, 0);
      if (this.tracks.get(key) === track) this.wake();
    });
  }
  /** 多轴表面沿用同一命名轨道；每帧一次绘制，状态由调用者保留以连续重定向。 */
  animate(key: string, advance: (elapsed: number, finish: boolean) => boolean) {
    if (this.disposed) return Promise.resolve(false);
    this.cancel(key);
    return new Promise<boolean>(resolve => {
      if (this.reduced || this.suspended) { advance(0, true); resolve(true); return; }
      const track: Track = { paint: () => {}, advance, resolve, start: this.source.now(), duration: 1600, preset: 'panel' };
      this.tracks.set(key, track);
      const moving = advance(0, false);
      if (this.tracks.get(key) !== track) return;
      if (!moving) { this.tracks.delete(key); resolve(true); } else this.wake();
    });
  }
  /** 挂起后到达的异步更新也直接到语义终态，不能在不可见页面重新排帧。 */
  setSuspended(suspended: boolean) {
    if (this.suspended === suspended) return;
    this.suspended = suspended;
    if (suspended) { this.finish(); this.stop(); } else this.wake();
  }
  /** 系统偏好变化时立刻归到终态，不能留下半透明弹层或继续退出的旧计时器。 */
  setReduced(reduced: boolean) {
    this.reduced = reduced;
    if (reduced) this.finish();
    this.wake();
  }
  /** 隐藏时结束表现过渡并保留成功回调；业务退出须由调用者先取消。 */
  finish(only?: string) {
    for (const [key, track] of [...this.tracks]) {
      if (only !== undefined && key !== only) continue;
      if (this.tracks.get(key) !== track) continue;
      this.tracks.delete(key);
      if (track.advance) track.advance(0, true); else track.paint(track.spring?.to ?? 1, 0);
      track.resolve(true);
    }
  }
  stop() {
    this.version++;
    if (this.frame) this.source.cancel(this.frame);
    this.frame = 0;
    for (const key of [...this.tracks.keys()]) this.cancel(key);
    this.onIdle?.();
  }
  dispose() { this.disposed = true; this.stop(); this.listeners.clear(); }
  /** 帧内先更新连续场，再推进命名时间线；完成后不再调度空帧。 */
  private tick(time: number) {
    this.frame = 0; this.frames++;
    const version = this.version;
    const elapsed = clamp((time - this.last) / 1000, 0, motionTokens.solver.maxElapsed); this.last = time;
    let moving = false;
    this.ticking = true;
    try {
      for (const listener of this.listeners) {
        moving = listener(elapsed, time) || moving;
        if (version !== this.version) return;
      }
      for (const [key, track] of [...this.tracks]) {
        if (this.tracks.get(key) !== track) continue;
        let done = false;
        if (track.advance) done = !track.advance(elapsed, time - track.start >= track.duration);
        else if (track.spring) {
          track.spring.step(elapsed, track.preset);
          done = !track.spring.moving || time - track.start >= track.duration;
          if (done) track.spring.snap(track.spring.to);
          track.paint(track.spring.x, track.spring.v);
        } else {
          const progress = clamp((time - track.start) / track.duration);
          track.paint(1 - Math.pow(1 - progress, 3), 0); done = progress === 1;
        }
        if (version !== this.version) return;
        if (done && this.tracks.get(key) === track) { this.tracks.delete(key); track.resolve(true); }
        else moving = true;
      }
    } finally {
      this.ticking = false;
    }
    this.quiet = moving ? 0 : this.quiet + 1;
    // 绘制可同步启动新过渡；复用它已排队的帧，避免并行 RAF 链无法休眠。
    if (this.quiet < motionTokens.solver.sleepFrames) { if (!this.frame) this.frame = this.source.request(next => this.tick(next)); }
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

/** 主浮卡的近邻连接支持上下左右，只跨空隙，不穿过按钮或卡片正文。 */
export function panelBridge(source:MotionRect,box:MotionRect,attachment=1){
  const candidates:{x1:number;y1:number;x2:number;y2:number}[]=[];
  const sx=source.x+source.width/2,sy=source.y+source.height/2;
  const bx=clamp(sx,box.x+Math.min(12,box.width/2),box.x+box.width-Math.min(12,box.width/2));
  const by=clamp(sy,box.y+Math.min(12,box.height/2),box.y+box.height-Math.min(12,box.height/2));
  if(source.y+source.height<=box.y)candidates.push({x1:sx,y1:source.y+source.height,x2:bx,y2:box.y});
  if(box.y+box.height<=source.y)candidates.push({x1:sx,y1:source.y,x2:bx,y2:box.y+box.height});
  if(source.x+source.width<=box.x)candidates.push({x1:source.x+source.width,y1:sy,x2:box.x,y2:by});
  if(box.x+box.width<=source.x)candidates.push({x1:source.x,y1:sy,x2:box.x+box.width,y2:by});
  const gap=(p:typeof candidates[number])=>Math.hypot(p.x2-p.x1,p.y2-p.y1);
  const p=candidates.sort((a,b)=>gap(a)-gap(b))[0];if(!p)return '';
  const length=gap(p);if(length<1||length>motionTokens.bridge.panelMaxGap)return '';
  const nx=-(p.y2-p.y1)/length,ny=(p.x2-p.x1)/length;
  // 距离和材质交接共同收细连接颈；收回时反向长回，不在固定毫秒数切掉液桥。
  const r=Math.min(9,source.width/4,source.height/4,box.width/4,box.height/4)*Math.sqrt(clamp(attachment))*clamp((motionTokens.bridge.panelMaxGap-length)/12);
  if(r<.15)return '';
  const neck=Math.max(.05,r*.55*Math.pow(1-length/motionTokens.bridge.panelMaxGap,2)*attachment);
  const at=(t:number,side:number)=>`${p.x1+(p.x2-p.x1)*t+nx*side} ${p.y1+(p.y2-p.y1)*t+ny*side}`;
  return `M${at(0,r)}C${at(.14,r)} ${at(.32,neck)} ${at(.5,neck)}C${at(.68,neck)} ${at(.86,r)} ${at(1,r)}`
    +`L${at(1,-r)}C${at(.86,-r)} ${at(.68,-neck)} ${at(.5,-neck)}C${at(.32,-neck)} ${at(.14,-r)} ${at(0,-r)}Z`;
}
