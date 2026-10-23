import { clamp } from './motion';

/** 38×36 的图片工具共用 6px 间距；拉开时临时让位，布局不跟随余振反复伸缩。 */
export const splitGeometry = { width: 38, height: 36, gap: 6, distance: 44 };
type Pose = { distance: number; layout: number; strain: number; childStrain: number; mass: number; size: number; glyph: number; joined: boolean; neck: number };
type Phase = 'closed' | 'pull' | 'recoil' | 'open' | 'return' | 'absorb' | 'settle';
const closed = (): Pose => ({ distance: 0, layout: 0, strain: 0, childStrain: 0, mass: 0, size: 0, glyph: 0, joined: true, neck: 10 });
const opened = (): Pose => ({ ...closed(), distance: 44, layout: 44, size: 1, glyph: 1, joined: false, neck: 0 });
const pulled = (): Pose => ({ ...opened(), distance: 74, layout: 62, strain: 1, childStrain: 1, joined: true, neck: .3 });
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
// 阻尼振子的初速度为零；末尾再收敛到精确静止，避免切回控件皮肤时抖一下。
const wave = (time: number, damping: number, frequency: number) => Math.exp(-damping * time) * (Math.cos(frequency * time) + damping / frequency * Math.sin(frequency * time));

/** 鼓出、拉细、断开、余振独立成段；反向收回从当前姿态续接，不跳回起点。 */
export class SlimeSplit {
  pose = closed();
  private from = closed();
  private phase: Phase = 'closed';
  private elapsed = 0;
  get moving() { return this.phase !== 'closed' && this.phase !== 'open'; }
  /** 停稳前短暂交还原皮肤，避免渐变、内高光和悬停材质突然切换。 */
  get material() {
    if (this.phase === 'recoil') return 1 - smooth((this.elapsed - .8) / .1);
    if (this.phase === 'settle') return 1 - smooth((this.elapsed - .28) / .08);
    return this.moving ? 1 : 0;
  }
  aim(open: boolean) {
    const closing = this.phase === 'return' || this.phase === 'absorb' || this.phase === 'settle';
    if ((open && !closing && this.phase !== 'closed') || (!open && (closing || this.phase === 'closed'))) return;
    this.begin(open ? 'pull' : 'return');
  }
  private begin(phase: Phase) { this.from = { ...this.pose }; this.elapsed = 0; this.phase = phase; }
  finish(open: boolean) { this.pose = open ? opened() : closed(); this.phase = open ? 'open' : 'closed'; this.elapsed = 0; }
  step(dt: number) {
    if (!this.moving) return;
    this.elapsed += clamp(dt, 0, .064);
    if (this.phase === 'recoil') {
      // 两侧分别保留弹性形变，右团向内的行程较短，防止断开后重新碰粘。
      const t = this.elapsed, tail = 1 - smooth((t - .72) / .18);
      const source = wave(t, 4.8, 27) * tail, child = wave(t, 5.4, 27) * tail;
      this.pose = { ...opened(), distance: 44 + 14 * child + 16 * child * child, layout: 44 + 18 * (1 - smooth(t / .32)), strain: source, childStrain: child };
      if (t >= .9) this.finish(true);
      return;
    }
    if (this.phase === 'settle') {
      // 吸收完毕后只有母体轻颤；子按钮已缩入，不能在收尾时闪回一块独立皮肤。
      const t = this.elapsed, recoil = wave(t, 8, 34) * (1 - smooth((t - .22) / .14));
      this.pose = { ...closed(), strain: this.from.strain * recoil, mass: this.from.mass * recoil };
      if (t >= .36) this.finish(false);
      return;
    }
    const opening = this.phase === 'pull', returning = this.phase === 'return';
    const duration = opening ? .56 : returning ? .18 : .2;
    const t = clamp(this.elapsed / duration), blend = smooth(t);
    // 回收先牵出连接，再缩小吸入；尚未分出的按钮不会被反向拉到更远处。
    const strength = clamp(this.from.layout / 44);
    const target: Pose = opening ? pulled() : returning
      ? { ...this.from, distance: Math.min(30, this.from.distance), strain: .45 * strength, childStrain: .65 * strength, size: Math.min(.82, this.from.size), neck: 7, glyph: this.from.glyph * .8, joined: true }
      : { ...closed(), strain: -.28 * strength, mass: .1 * strength };
    const mix = (key: Exclude<keyof Pose, 'joined'>) => this.from[key] + (target[key] - this.from[key]) * blend;
    const distance = mix('distance'), stretch = clamp((distance - 34) / 40);
    this.pose = {
      distance, layout: mix('layout'), strain: mix('strain'), childStrain: mix('childStrain'), mass: mix('mass'), size: mix('size'),
      glyph: opening ? this.from.glyph + (1 - this.from.glyph) * smooth((t - .18) / .55) : mix('glyph'),
      joined: opening || this.from.joined || t > .05,
      // 距离越大，细颈越薄；最后保留亚像素细丝再断开，不用透明度代替拉扯。
      neck: opening ? this.from.neck + (.3 + 8 * Math.pow(1 - stretch, 1.8) - this.from.neck) * smooth(t / .2) : mix('neck')
    };
    if (t === 1) {
      if (opening) { this.pose = { ...pulled(), joined: false }; this.begin('recoil'); }
      else this.begin(returning ? 'absorb' : 'settle');
    }
  }
}

type Shoulder = { x: number; y: number; slope: number };
/** 牵引分散到整个圆角侧面，避免把数像素位移挤进短侧边而形成尖刺。 */
function lobe(cx: number, cy: number, rx: number, ry: number, radius: number, leftPull: number, rightPull: number) {
  const r = Math.min(radius, rx, ry * .9), k = .55228475, left = cx - rx, right = cx + rx, top = cy - ry, bottom = cy + ry;
  const leftWidth = Math.max(.01, r + leftPull), rightWidth = Math.max(.01, r + rightPull);
  const xLeft = left + r - leftWidth, xRight = right - r + rightWidth;
  const path = `M${left + r} ${top}H${right - r}`
    + `C${right - r + rightWidth * k} ${top} ${xRight} ${top + r - r * k} ${xRight} ${top + r}`
    + `V${bottom - r}C${xRight} ${bottom - r + r * k} ${right - r + rightWidth * k} ${bottom} ${right - r} ${bottom}H${left + r}`
    + `C${left + r - leftWidth * k} ${bottom} ${xLeft} ${bottom - r + r * k} ${xLeft} ${bottom - r}`
    + `V${top + r}C${xLeft} ${top + r - r * k} ${left + r - leftWidth * k} ${top} ${left + r} ${top}Z`;
  // 从实际三次贝塞尔取接点和导数，细颈与外壳精确共切线，消除拼接肩部的折痕。
  const t = .58, u = 1 - t;
  const x = 3 * u * u * t * k + 3 * u * t * t + t * t * t;
  const y = 3 * u * t * t * (1 - k) + t * t * t;
  const dx = 3 * u * u * k + 6 * u * t * (1 - k);
  const dy = 6 * u * t * (1 - k) + 3 * t * t * k;
  return {
    path,
    left: { x: left + r - leftWidth * x, y: top + r * y, slope: -r * dy / (leftWidth * dx) },
    right: { x: right - r + rightWidth * x, y: top + r * y, slope: r * dy / (rightWidth * dx) }
  };
}

/** 上下对称的细颈沿真实肩部切线接入；约束控制臂，避免腰部曲线越界或反折。 */
function neckPath(a: Shoulder, b: Shoulder, halfHeight: number) {
  const span = b.x - a.x;
  if (span <= .01) return '';
  const middle = (a.x + b.x) / 2, neck = Math.min(halfHeight, (18 - a.y) * .98, (18 - b.y) * .98);
  const top = 18 - Math.max(0, neck), bottom = 36 - top;
  const leftArm = Math.min(span * .23, (top - a.y) * .65 / a.slope);
  const rightArm = Math.min(span * .23, (top - b.y) * .65 / -b.slope), waistArm = span * .14;
  return `M${a.x} ${a.y}C${a.x + leftArm} ${a.y + leftArm * a.slope} ${middle - waistArm} ${top} ${middle} ${top}`
    + `C${middle + waistArm} ${top} ${b.x - rightArm} ${b.y - rightArm * b.slope} ${b.x} ${b.y}V${36 - b.y}`
    + `C${b.x - rightArm} ${36 - b.y + rightArm * b.slope} ${middle + waistArm} ${bottom} ${middle} ${bottom}`
    + `C${middle - waistArm} ${bottom} ${a.x + leftArm} ${36 - a.y - leftArm * a.slope} ${a.x} ${36 - a.y}Z`;
}

/** 两个软团和细颈用同一条非零填充路径绘制，重叠处不叠阴影、不出现接缝。 */
export function splitOutline(pose: Pose, radius: number) {
  const { strain: s, childStrain: c, size, mass } = pose, ax = 19 + 3.4 * s, bx = 19 + pose.distance;
  const aw = 19 * (1 + .18 * s) * (1 + mass), ah = 18 * (1 + mass) / (1 + .2 * s);
  const bw = 19 * size * (1 + .22 * c), bh = 18 * size / (1 + .28 * c);
  const a = lobe(ax, 18, aw, ah, radius + Math.max(0, s) * 3, 0, 7 * s);
  if (size <= .001) return a.path;
  const b = lobe(bx, 18, bw, bh, (radius + Math.max(0, c) * 3) * size, 6 * c * size, 0);
  let path = a.path + b.path;
  if (pose.joined && pose.distance > 12) path += neckPath(a.right, b.left, pose.neck);
  return path;
}
