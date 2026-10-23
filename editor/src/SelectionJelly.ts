import { clamp, MotionSpring, motionTokens as T, type MotionRect } from './motion';

/** 边缘、角和表面波动共用真实矩形目标；全部状态仅用于轮廓，不写入截图坐标。 */
export class SelectionJelly {
  // 左、上、右、下保留方向惯性；四角按 nw/ne/se/sw 传递受力。
  private edges = [new MotionSpring(), new MotionSpring(), new MotionSpring(), new MotionSpring()];
  private corners = [new MotionSpring(), new MotionSpring(), new MotionSpring(), new MotionSpring()];
  // 两轴的切向波动与松手挤压分开求解，快速反向时保留各自速度。
  private ripple = [new MotionSpring(), new MotionSpring()];
  private squash = [new MotionSpring(), new MotionSpring()];
  private pulse = new MotionSpring();
  private box: MotionRect | null = null;
  // 松手仅排队一次冲量，等本帧最后的精确矩形更新后再计算；取消不触发。
  private held = false;
  private released = false;

  /** 拉伸与反向续接已有速度；切向波动由真实位移驱动，不在静止时循环播放。 */
  update(box: MotionRect | null, reduced: boolean) {
    if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) { this.reset(); return; }
    if (reduced) this.snap();
    else if (!this.box) {
      this.pulse.snap(T.selection.pulse); this.pulse.to = 0;
      for (const corner of this.corners) corner.snap(T.selection.pulse);
    } else {
      const before = [this.box.x, this.box.y, this.box.x + this.box.width, this.box.y + this.box.height];
      const next = [box.x, box.y, box.x + box.width, box.y + box.height];
      const limit = Math.min(T.selection.maxLag, Math.min(box.width, box.height) * .12);
      this.edges.forEach((edge, index) => {
        const delta = before[index] - next[index], trailing = index < 2 ? delta < 0 : delta > 0;
        edge.x = clamp(edge.x + delta * T.selection.gain * (trailing ? 1 : T.selection.leading), -limit, limit);
      });
      const displacement = [(next[0] + next[2] - before[0] - before[2]) / 2, (next[1] + next[3] - before[1] - before[3]) / 2];
      this.ripple.forEach((wave, index) => { wave.x = clamp(wave.x + displacement[index] * T.selection.rippleGain, -T.selection.ripple, T.selection.ripple); });
    }
    this.box = { ...box };
  }

  gesture(held: boolean, cancelled = false) {
    this.released = !held && this.held && !cancelled;
    this.held = held;
  }

  /** 主时钟先释放受力，再让相邻角延迟接力；系统减少动态时所有状态直接落定。 */
  step(elapsed: number, reduced: boolean) {
    if (reduced) { this.snap(); return false; }
    if (!this.box) return false;
    if (this.released) {
      const x = (Math.abs(this.edges[0].x) + Math.abs(this.edges[2].x)) / 2;
      const y = (Math.abs(this.edges[1].x) + Math.abs(this.edges[3].x)) / 2;
      const force = clamp((x + y) / T.selection.maxLag) * T.selection.releaseImpulse, sum = x + y || 1;
      this.squash[0].v = clamp(this.squash[0].v + (y * .6 - x) / sum * force, -T.selection.releaseImpulse, T.selection.releaseImpulse);
      this.squash[1].v = clamp(this.squash[1].v + (x * .6 - y) / sum * force, -T.selection.releaseImpulse, T.selection.releaseImpulse);
      this.released = false;
    }
    this.pulse.step(elapsed, 'selection');
    let moving = this.pulse.moving;
    for (const edge of this.edges) { edge.step(elapsed, 'selection'); moving = edge.moving || moving; }
    for (const wave of this.ripple) { wave.step(elapsed, 'selectionRipple'); moving = wave.moving || moving; }
    for (const mass of this.squash) { mass.step(elapsed, 'selectionRelease'); moving = mass.moving || moving; }
    // 同时读取上一帧的角，避免数组遍历顺序改变传播速度；压力消失后所有目标仍回零。
    const previous = this.corners.map(corner => corner.x);
    this.corners.forEach((corner, index) => {
      const x = index === 0 || index === 3 ? 0 : 2, y = index < 2 ? 1 : 3;
      const strain = (Math.abs(this.edges[x].x) + Math.abs(this.edges[y].x)) / (2 * T.selection.maxLag) + Math.abs(this.pulse.x)
        + (Math.abs(this.squash[0].x) + Math.abs(this.squash[1].x)) / (T.selection.squash * 4);
      corner.to = clamp(strain * (1 - T.selection.cornerCarry) + previous[(index + 3) % 4] * T.selection.cornerCarry);
      corner.step(elapsed, 'selectionCorner'); moving = corner.moving || moving;
    });
    // 接力的微小残值不能成为下一轮目标；整条受力链休眠时恢复精确直角。
    if (!moving) for (const corner of this.corners) corner.snap(0);
    return moving;
  }

  /** 单条边框、遮罩与八个控制点共用轮廓；波动只改变曲线控制点，不扭曲冻结图。 */
  get frame() {
    if (!this.box) return { outline: '', offsets: [] as number[][] };
    // 输出仍按当前边长限幅，缩成小框时残留的角和波动不能令边界交叉。
    const box = this.box, side = Math.min(box.width, box.height), limit = Math.min(T.selection.maxLag, side * .12);
    const values = this.edges.map(edge => clamp(edge.x, -limit, limit));
    const breath = this.pulse.x * Math.min(T.selection.bend, side * .12), squashLimit = Math.min(T.selection.squash, side * .05);
    const sx = clamp(this.squash[0].x, -squashLimit, squashLimit), sy = clamp(this.squash[1].x, -squashLimit, squashLimit);
    const l = box.x + values[0] - breath - sx, t = box.y + values[1] - breath - sy;
    const r = box.x + box.width + values[2] + breath + sx, b = box.y + box.height + values[3] + breath + sy;
    const w = r - l, h = b - t, radius = Math.min(T.selection.radius, Math.min(w, h) * .18);
    const [nw, ne, se, sw] = this.corners.map(corner => radius * clamp(corner.x));
    const bendL = values[0] * .35 - breath * .5, bendT = values[1] * .35 - breath * .5;
    const bendR = values[2] * .35 + breath * .5, bendB = values[3] * .35 + breath * .5;
    const waveLimit = Math.min(T.selection.ripple, side * .05);
    const wx = clamp(this.ripple[0].x, -waveLimit, waveLimit), wy = clamp(this.ripple[1].x, -waveLimit, waveLimit);
    const outline = 'M' + (l + nw) + ' ' + t +
      'C' + (l + w / 3) + ' ' + (t + bendT - wx) + ' ' + (l + w * 2 / 3) + ' ' + (t + bendT + wx) + ' ' + (r - ne) + ' ' + t +
      'C' + (r - ne * .45) + ' ' + t + ' ' + r + ' ' + (t + ne * .45) + ' ' + r + ' ' + (t + ne) +
      'C' + (r + bendR - wy) + ' ' + (t + h / 3) + ' ' + (r + bendR + wy) + ' ' + (t + h * 2 / 3) + ' ' + r + ' ' + (b - se) +
      'C' + r + ' ' + (b - se * .45) + ' ' + (r - se * .45) + ' ' + b + ' ' + (r - se) + ' ' + b +
      'C' + (l + w * 2 / 3) + ' ' + (b + bendB + wx) + ' ' + (l + w / 3) + ' ' + (b + bendB - wx) + ' ' + (l + sw) + ' ' + b +
      'C' + (l + sw * .45) + ' ' + b + ' ' + l + ' ' + (b - sw * .45) + ' ' + l + ' ' + (b - sw) +
      'C' + (l + bendL + wy) + ' ' + (t + h * 2 / 3) + ' ' + (l + bendL - wy) + ' ' + (t + h / 3) + ' ' + l + ' ' + (t + nw) +
      'C' + l + ' ' + (t + nw * .45) + ' ' + (l + nw * .45) + ' ' + t + ' ' + (l + nw) + ' ' + t + 'Z';
    // 不等圆角会改变边的参数中点；手柄使用真实三次曲线中点，继续和边框贴合。
    const [knw, kne, kse, ksw] = [nw, ne, se, sw].map(value => value * (.125 + .45 * .375)), mx = (l + r) / 2, my = (t + b) / 2;
    const points = [[l + knw, t + knw], [mx + (nw - ne) / 8, t + bendT * .75], [r - kne, t + kne], [r + bendR * .75, my + (ne - se) / 8],
      [r - kse, b - kse], [mx + (sw - se) / 8, b + bendB * .75], [l + ksw, b - ksw], [l + bendL * .75, my + (nw - sw) / 8]];
    const anchors = [[box.x, box.y], [box.x + box.width / 2, box.y], [box.x + box.width, box.y], [box.x + box.width, box.y + box.height / 2],
      [box.x + box.width, box.y + box.height], [box.x + box.width / 2, box.y + box.height], [box.x, box.y + box.height], [box.x, box.y + box.height / 2]];
    return { outline, offsets: points.map((point, index) => [point[0] - anchors[index][0], point[1] - anchors[index][1]]) };
  }

  reset() { this.box = null; this.snap(); }
  /** 清掉整个受力链；隐藏、会话替换与减少动态后都不能复活旧的释放冲量。 */
  private snap() {
    for (const spring of [...this.edges, ...this.corners, ...this.ripple, ...this.squash]) spring.snap(0);
    this.pulse.snap(0); this.held = this.released = false;
  }
}
