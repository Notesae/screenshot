import { clamp, motionTokens, type MotionRect } from './motion';

// 主体先飞行 300ms；刹停前接入回摆，尾部晚 40ms 受力，全部收敛后精确还原。
const flight = .3, recoilStart = .264, tailDelay = .04, recoilDuration = .72;
const duration = recoilStart + tailDelay + recoilDuration;
/** 共享姿态：位移与弯曲为 CSS 像素，waist/taper 是中段厚度与前后厚度差的比例。 */
const rest = { x: 0, y: 0, scaleX: 1, scaleY: 1, shear: 0, lead: 0, tail: 0, direction: -1, unfold: 1, skin: 1, content: 1, bend: 0, waist: 0, taper: 0 };

/** 同一纵向形变场供外轮廓、按钮与拖动柄采样；导数用于保持曲线切线和材质倾斜一致。 */
export function railWarp(x: number, y: number, width: number, height: number, pose: typeof rest) {
  const u = clamp(x / Math.max(1, width)), s = (u * 2 - 1) * pose.direction;
  const belly = 1 - s * s, derivative = -4 * s * pose.direction / Math.max(1, width);
  const stretch = 1 + pose.waist * belly + pose.taper * s, localY = y - height / 2;
  return {
    y: height / 2 + localY * stretch + pose.bend * belly,
    stretch, slope: localY * (pose.waist * derivative + pose.taper * 2 * pose.direction / Math.max(1, width)) + pose.bend * derivative
  };
}

/** 圆角矩形的十段曲线直接弯曲；端点和切线同场变换，避免鼓起处拼缝、硬折或边缘自交。 */
export function railOutline(width: number, height: number, radii: number[], pose: typeof rest) {
  // k 是四分之一圆的三次贝塞尔控制臂系数，归位后轮廓与原圆角矩形一致。
  const w = Math.max(1, width), h = Math.max(1, height), k = .5522847498;
  const rx = radii.map(r => r / pose.scaleX), ry = radii.map(r => r / pose.scaleY);
  // 与 CSS 圆角一样按相邻半径总和缩小；初始软团及窄屏多行轨道也不能相互穿过。
  const fit = Math.min(1, w / (rx[0] + rx[1]), w / (rx[2] + rx[3]), h / (ry[0] + ry[3]), h / (ry[1] + ry[2]));
  for (let i = 0; i < 4; i++) { rx[i] *= fit; ry[i] *= fit; }
  // 每段保存终点和两个控制点；长边从中间分段，使鼓起与收腰有足够曲率。
  const top = (rx[0] + w - rx[1]) / 2, bottom = (rx[3] + w - rx[2]) / 2;
  const segments = [
    [top, 0, rx[0] + (top - rx[0]) / 3, 0, top - (top - rx[0]) / 3, 0],
    [w - rx[1], 0, top + (w - rx[1] - top) / 3, 0, w - rx[1] - (w - rx[1] - top) / 3, 0],
    [w, ry[1], w - rx[1] * (1 - k), 0, w, ry[1] * (1 - k)],
    [w, h - ry[2], w, ry[1] + (h - ry[2] - ry[1]) / 3, w, h - ry[2] - (h - ry[2] - ry[1]) / 3],
    [w - rx[2], h, w, h - ry[2] * (1 - k), w - rx[2] * (1 - k), h],
    [bottom, h, w - rx[2] - (w - rx[2] - bottom) / 3, h, bottom + (w - rx[2] - bottom) / 3, h],
    [rx[3], h, bottom - (bottom - rx[3]) / 3, h, rx[3] + (bottom - rx[3]) / 3, h],
    [0, h - ry[3], rx[3] * (1 - k), h, 0, h - ry[3] * (1 - k)],
    [0, ry[0], 0, h - ry[3] - (h - ry[3] - ry[0]) / 3, 0, ry[0] + (h - ry[3] - ry[0]) / 3],
    [rx[0], 0, 0, ry[0] * (1 - k), rx[0] * (1 - k), 0]
  ];
  let x = rx[0], y = 0, start = railWarp(x, y, w, h, pose), path = 'M' + x + ' ' + start.y;
  for (const [endX, endY, c1x, c1y, c2x, c2y] of segments) {
    const end = railWarp(endX, endY, w, h, pose);
    path += 'C' + c1x + ' ' + (start.y + start.slope * (c1x - x) + start.stretch * (c1y - y)) + ' ' + c2x + ' ' + (end.y + end.slope * (c2x - endX) + end.stretch * (c2y - endY)) + ' ' + endX + ' ' + end.y;
    x = endX; y = endY; start = end;
  }
  return path + 'Z';
}

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
    const force = Math.min(48, width * .11), front = this.direction * force * lead, rear = this.direction * force * .45 * tail;
    // 飞行高度受屏幕上边界限制；横向拉长时略压扁，反向收缩时鼓回。
    const arc = Math.min(22, Math.max(0, this.box.y - 8)) * 16 * p * p * (1 - p) * (1 - p);
    const scaleX = (this.seed.width + (width - this.seed.width) * unfold + this.direction * (front - rear)) / width;
    const scaleY = (this.seed.height + (height - this.seed.height) * unfold) / height * (1 - .24 * lead + .11 * tail);
    // 起飞先拉薄中段；刹停时前端鼓起、尾部滞后，反向回摆则收腰与弯曲一起反转。
    const launch = 16 * p * p * (1 - p) * (1 - p);
    const bend = Math.min(12, height * .2) * (-launch + (lead - tail) * 1.25);
    const waist = -.18 * launch - .22 * lead + .12 * tail, taper = .22 * lead - .12 * tail;
    return {
      x: (this.origin.x - width / 2) * (1 - travel) + (front + rear) / 2,
      y: (this.origin.y - height / 2) * (1 - travel) - arc - 2 * lead + tail,
      scaleX, scaleY, bend, waist, taper, shear: this.direction * (lead - tail) * 7, lead, tail, direction: this.direction, unfold,
      // 材质本体始终可见；按钮和文字在软团展开后融入，文字保持原字号。
      skin: clamp((unfold - .35) / .4), content: clamp((unfold - .72) / .24)
    };
  }
}
