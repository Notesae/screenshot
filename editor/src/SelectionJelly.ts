import { clamp, MotionSpring, motionTokens as T, type MotionRect } from './motion';

/** 四条边只保存显示滞后；输入矩形始终是真实选区，不写回手势或截图。 */
export class SelectionJelly {
  // 左、上、右、下分别积累惯性；圆角与侧面鼓起由同一组边缘压力推导。
  private edges = [new MotionSpring(), new MotionSpring(), new MotionSpring(), new MotionSpring()];
  private pulse = new MotionSpring();
  private box: MotionRect | null = null;

  /** 位置与尺寸立即更新，只有有限的边缘滞后保留原速度；首次显现轻轻鼓起。 */
  update(box: MotionRect | null, reduced: boolean) {
    if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) { this.reset(); return; }
    if (reduced) this.snap();
    else if (!this.box) { this.pulse.snap(T.selection.pulse); this.pulse.to = 0; }
    else {
      const before = [this.box.x, this.box.y, this.box.x + this.box.width, this.box.y + this.box.height];
      const next = [box.x, box.y, box.x + box.width, box.y + box.height];
      const limit = Math.min(T.selection.maxLag, Math.min(box.width, box.height) * .12);
      this.edges.forEach((edge, index) => { edge.x = clamp(edge.x + (before[index] - next[index]) * T.selection.gain, -limit, limit); });
    }
    this.box = { ...box };
  }

  /** 主时钟推进有界弹簧；减少动态立即变回精确直角框。 */
  step(elapsed: number, reduced: boolean) {
    if (reduced) { this.snap(); return false; }
    if (!this.box) return false;
    let moving = this.pulse.moving;
    this.pulse.step(elapsed, 'selection');
    for (const edge of this.edges) { edge.step(elapsed, 'selection'); moving = edge.moving || moving; }
    return this.pulse.moving || moving;
  }

  /** 只让软边向选区外延展，精确矩形完整保留在其中，避免颜色覆盖截图像素。 */
  get frame() {
    if (!this.box) return { outline: '', material: '', energy: 0 };
    const energy = clamp(Math.max(...this.edges.map(edge => Math.abs(edge.x))) / T.selection.maxLag + Math.abs(this.pulse.x));
    if (!energy) return { outline: '', material: '', energy: 0 };
    const box = this.box, radius = Math.min(T.selection.radius, Math.min(box.width, box.height) * .14) * energy;
    const pad = radius * .4, bend = T.selection.bend * energy;
    const l = box.x - pad + Math.min(0, this.edges[0].x), t = box.y - pad + Math.min(0, this.edges[1].x);
    const r = box.x + box.width + pad + Math.max(0, this.edges[2].x), b = box.y + box.height + pad + Math.max(0, this.edges[3].x);
    const w = r - l, h = b - t, c = radius * .45;
    const outline = 'M' + (l + radius) + ' ' + t +
      'C' + (l + w / 3) + ' ' + (t - bend) + ' ' + (l + w * 2 / 3) + ' ' + (t - bend) + ' ' + (r - radius) + ' ' + t +
      'C' + (r - c) + ' ' + t + ' ' + r + ' ' + (t + c) + ' ' + r + ' ' + (t + radius) +
      'C' + (r + bend) + ' ' + (t + h / 3) + ' ' + (r + bend) + ' ' + (t + h * 2 / 3) + ' ' + r + ' ' + (b - radius) +
      'C' + r + ' ' + (b - c) + ' ' + (r - c) + ' ' + b + ' ' + (r - radius) + ' ' + b +
      'C' + (l + w * 2 / 3) + ' ' + (b + bend) + ' ' + (l + w / 3) + ' ' + (b + bend) + ' ' + (l + radius) + ' ' + b +
      'C' + (l + c) + ' ' + b + ' ' + l + ' ' + (b - c) + ' ' + l + ' ' + (b - radius) +
      'C' + (l - bend) + ' ' + (t + h * 2 / 3) + ' ' + (l - bend) + ' ' + (t + h / 3) + ' ' + l + ' ' + (t + radius) +
      'C' + l + ' ' + (t + c) + ' ' + (l + c) + ' ' + t + ' ' + (l + radius) + ' ' + t + 'Z';
    return { outline, material: outline + 'M' + box.x + ' ' + box.y + 'h' + box.width + 'v' + box.height + 'h' + -box.width + 'Z', energy };
  }

  /** 隐藏、取消或替换会话时清掉旧形状；系统减少动态时仅清显示惯性。 */
  reset() { this.box = null; this.snap(); }
  private snap() { for (const edge of this.edges) edge.snap(0); this.pulse.snap(0); }
}
