import { clamp, motionTokens, type MotionRect } from './motion';

// 主体先飞行 300ms；刹停前接入回摆，尾部晚 40ms 受力，全部收敛后精确还原。
const flight = .3, recoilStart = .264, tailDelay = .04, recoilDuration = .72;
const duration = recoilStart + tailDelay + recoilDuration;
/** 底座、按钮与拖动柄共享的可见姿态；位移为相对最终中心的 CSS 像素。 */
const rest = { x: 0, y: 0, scaleX: 1, scaleY: 1, shear: 0, lead: 0, tail: 0, direction: -1, unfold: 1, skin: 1, content: 1 };

/** 单块软体的短弧抛出与阻尼回摆；按秒采样同一轨迹，不让按钮各自重启入场弹簧。 */
export class RailToss {
  // 时间只在外壳可见时推进，完成或手动接管后直接使用精确终态。
  private elapsed = duration;
  // 布局只在开始时读取；运动期间不测量已变形的表面。
  private box: MotionRect = { x: 0, y: 0, width: 1, height: 1 };
  private origin = { x: 0, y: 0 };
  private seed = { width: 1, height: 1 };
  private direction = -1;

  /** 从完成按钮附近的一团紧实材质抛向轨道中心，窄轨道仍保留可辨认的起点。 */
  begin(box: MotionRect, source: MotionRect | undefined, reduced: boolean) {
    this.box = { ...box, width: Math.max(1, box.width), height: Math.max(1, box.height) };
    const { width, height } = this.box;
    this.seed = { width: Math.min(56, width * .45), height: Math.min(40, height * .8) };
    let x = source ? source.x + source.width / 2 : width - this.seed.width / 2;
    if (Math.abs(x - width / 2) < Math.min(28, width * .15)) x = width - this.seed.width / 2;
    this.origin = { x: clamp(x, this.seed.width / 2, width - this.seed.width / 2), y: clamp(source ? source.y + source.height / 2 : height / 2, this.seed.height / 2, height - this.seed.height / 2) };
    this.direction = this.origin.x > width / 2 ? -1 : 1;
    this.elapsed = reduced ? duration : 0;
  }
  finish() { this.elapsed = duration; }
  step(elapsed: number, reduced: boolean) { this.elapsed = reduced ? duration : Math.min(duration, this.elapsed + clamp(elapsed, 0, motionTokens.solver.maxElapsed)); }
  get moving() { return this.elapsed < duration; }

  /** 正弦阻尼产生前冲、反向拉回和较小的二次回摆；起止包络让接入和归位都保持连续。 */
  get frame() {
    if (!this.moving) return rest;
    const { width, height } = this.box, p = clamp(this.elapsed / flight);
    const travel = 1 - Math.pow(1 - p, 3), unfold = p * p * (3 - 2 * p);
    // 前后端共用同一受力波形；延迟传播表现软体内部的惯性，而非独立按钮跳动。
    const [lead, tail] = [0, tailDelay].map(delay => {
      const t = Math.max(0, this.elapsed - recoilStart - delay), attack = clamp(t / .04), release = clamp((t - .5) / (recoilDuration - .5));
      return Math.exp(-6.5 * t) * Math.sin(19 * t) * attack * attack * (3 - 2 * attack) * (1 - release * release * (3 - 2 * release));
    });
    const force = Math.min(36, width * .08), front = this.direction * force * lead, rear = this.direction * force * .45 * tail;
    // 飞行高度受屏幕上边界限制；横向拉长时略压扁，反向收缩时鼓回。
    const arc = Math.min(22, Math.max(0, this.box.y - 8)) * 16 * p * p * (1 - p) * (1 - p);
    const scaleX = (this.seed.width + (width - this.seed.width) * unfold + this.direction * (front - rear)) / width;
    const scaleY = (this.seed.height + (height - this.seed.height) * unfold) / height * (1 - .16 * lead + .08 * tail);
    return {
      x: (this.origin.x - width / 2) * (1 - travel) + (front + rear) / 2,
      y: (this.origin.y - height / 2) * (1 - travel) - arc - 2 * lead + tail,
      scaleX, scaleY, shear: this.direction * (lead - tail) * 7, lead, tail, direction: this.direction, unfold,
      // 材质本体始终可见；按钮和文字在软团展开后融入，文字保持原字号。
      skin: clamp((unfold - .35) / .4), content: clamp((unfold - .72) / .24)
    };
  }
}
