import { clamp, MotionSpring, motionTokens as T, type MotionRect } from './motion';

/** 四条边保存边框本体的有符号滞后；逻辑矩形始终保持精确，不用于反推截图坐标。 */
export class SelectionJelly {
  // 左、上、右、下分别保留速度，前缘更跟手、后缘拖出伸长量。
  private edges = [new MotionSpring(), new MotionSpring(), new MotionSpring(), new MotionSpring()];
  private pulse = new MotionSpring();
  private box: MotionRect | null = null;

  /** 拉伸与反向都续接已有速度；小框按边长限制形变，避免相对两边交叉。 */
  update(box: MotionRect | null, reduced: boolean) {
    if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) { this.reset(); return; }
    if (reduced) this.snap();
    else if (!this.box) { this.pulse.snap(T.selection.pulse); this.pulse.to = 0; }
    else {
      const before = [this.box.x, this.box.y, this.box.x + this.box.width, this.box.y + this.box.height];
      const next = [box.x, box.y, box.x + box.width, box.y + box.height];
      const limit = Math.min(T.selection.maxLag, Math.min(box.width, box.height) * .12);
      this.edges.forEach((edge, index) => {
        const delta = before[index] - next[index], trailing = index < 2 ? delta < 0 : delta > 0;
        edge.x = clamp(edge.x + delta * T.selection.gain * (trailing ? 1 : T.selection.leading), -limit, limit);
      });
    }
    this.box = { ...box };
  }

  /** 主时钟推进边框；减少动态时同一路径立即恢复准确直角矩形。 */
  step(elapsed: number, reduced: boolean) {
    if (reduced) { this.snap(); return false; }
    if (!this.box) return false;
    this.pulse.step(elapsed, 'selection');
    let moving = this.pulse.moving;
    for (const edge of this.edges) { edge.step(elapsed, 'selection'); moving = edge.moving || moving; }
    return moving;
  }

  /** 唯一可见边框、遮罩开口与八个控制点共用本帧轮廓，停稳后路径仍持续显示。 */
  get frame() {
    if (!this.box) return { outline: '', offsets: [] as number[][] };
    // 缩到小选区时也约束续接中的速度产生的外冲，防止四边在下一帧交叉。
    const box = this.box, limit = Math.min(T.selection.maxLag, Math.min(box.width, box.height) * .12);
    const values = this.edges.map(edge => clamp(edge.x, -limit, limit));
    const energy = clamp(Math.max(...values.map(Math.abs)) / T.selection.maxLag + Math.abs(this.pulse.x));
    const breath = this.pulse.x * Math.min(T.selection.bend, Math.min(box.width, box.height) * .12);
    const l = box.x + values[0] - breath, t = box.y + values[1] - breath;
    const r = box.x + box.width + values[2] + breath, b = box.y + box.height + values[3] + breath;
    const w = r - l, h = b - t, radius = Math.min(T.selection.radius, Math.min(w, h) * .18) * energy, c = radius * .45;
    const bendL = values[0] * .35 - breath * .5, bendT = values[1] * .35 - breath * .5;
    const bendR = values[2] * .35 + breath * .5, bendB = values[3] * .35 + breath * .5;
    const outline = 'M' + (l + radius) + ' ' + t +
      'C' + (l + w / 3) + ' ' + (t + bendT) + ' ' + (l + w * 2 / 3) + ' ' + (t + bendT) + ' ' + (r - radius) + ' ' + t +
      'C' + (r - c) + ' ' + t + ' ' + r + ' ' + (t + c) + ' ' + r + ' ' + (t + radius) +
      'C' + (r + bendR) + ' ' + (t + h / 3) + ' ' + (r + bendR) + ' ' + (t + h * 2 / 3) + ' ' + r + ' ' + (b - radius) +
      'C' + r + ' ' + (b - c) + ' ' + (r - c) + ' ' + b + ' ' + (r - radius) + ' ' + b +
      'C' + (l + w * 2 / 3) + ' ' + (b + bendB) + ' ' + (l + w / 3) + ' ' + (b + bendB) + ' ' + (l + radius) + ' ' + b +
      'C' + (l + c) + ' ' + b + ' ' + l + ' ' + (b - c) + ' ' + l + ' ' + (b - radius) +
      'C' + (l + bendL) + ' ' + (t + h * 2 / 3) + ' ' + (l + bendL) + ' ' + (t + h / 3) + ' ' + l + ' ' + (t + radius) +
      'C' + l + ' ' + (t + c) + ' ' + (l + c) + ' ' + t + ' ' + (l + radius) + ' ' + t + 'Z';
    // 按既有 DOM 的 nw/n/ne/e/se/s/sw/w 顺序取曲线上点，移动命中按钮本身而非只移动圆点。
    const k = radius * .125 + c * .375, mx = (l + r) / 2, my = (t + b) / 2;
    const points = [[l + k, t + k], [mx, t + bendT * .75], [r - k, t + k], [r + bendR * .75, my],
      [r - k, b - k], [mx, b + bendB * .75], [l + k, b - k], [l + bendL * .75, my]];
    const anchors = [[box.x, box.y], [box.x + box.width / 2, box.y], [box.x + box.width, box.y], [box.x + box.width, box.y + box.height / 2],
      [box.x + box.width, box.y + box.height], [box.x + box.width / 2, box.y + box.height], [box.x, box.y + box.height], [box.x, box.y + box.height / 2]];
    return { outline, offsets: points.map((point, index) => [point[0] - anchors[index][0], point[1] - anchors[index][1]]) };
  }

  /** 隐藏、取消或替换会话时清掉旧轮廓；减少动态只归零显示惯性。 */
  reset() { this.box = null; this.snap(); }
  private snap() { for (const edge of this.edges) edge.snap(0); this.pulse.snap(0); }
}
