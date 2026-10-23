import { clamp } from './motion';

/** 38×36 的图片工具共用 6px 间距；布局与材质分开，回弹不会挤动整条导轨。 */
export const splitGeometry = { width: 38, height: 36, gap: 6, distance: 44 };
type Pose = { distance: number; layout: number; strain: number; size: number; glyph: number; joined: boolean; neck: number };
const closed = (): Pose => ({ distance: 0, layout: 0, strain: 0, size: .08, glyph: 0, joined: true, neck: 10 });
const opened = (): Pose => ({ distance: 44, layout: 44, strain: 0, size: 1, glyph: 1, joined: false, neck: 0 });
const pulled = (): Pose => ({ distance: 62, layout: 44, strain: 1, size: 1, glyph: 1, joined: true, neck: .45 });
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };

/** 鼓出、拉细、断开、余振独立成段；反向收回从当前姿态续接，不跳回起点。 */
export class SlimeSplit {
  pose = closed();
  private from = closed();
  private phase: 'closed' | 'pull' | 'recoil' | 'open' | 'merge' = 'closed';
  private elapsed = 0;
  get moving() { return this.phase === 'pull' || this.phase === 'recoil' || this.phase === 'merge'; }
  aim(open: boolean) {
    if ((open && this.phase !== 'merge' && this.phase !== 'closed') || (!open && (this.phase === 'closed' || this.phase === 'merge'))) return;
    this.from = { ...this.pose }; this.elapsed = 0; this.phase = open ? 'pull' : 'merge';
  }
  finish(open: boolean) { this.pose = open ? opened() : closed(); this.phase = open ? 'open' : 'closed'; this.elapsed = 0; }
  step(dt: number) {
    if (!this.moving) return;
    this.elapsed += clamp(dt, 0, .04);
    if (this.phase === 'recoil') {
      // 约三次逐渐减弱的余振；断点初速度为零，与拉扯末帧连续。
      const t = this.elapsed, wave = Math.exp(-5.8 * t) * (Math.cos(30 * t) + 5.8 / 30 * Math.sin(30 * t));
      // 向内回摆的行程更短，断开的两团保持空隙，不在第一次回弹时重新粘合。
      this.pose = { ...opened(), distance: 44 + 12 * wave + 6 * wave * wave, strain: wave };
      if (t >= .78) this.finish(true);
      return;
    }
    const opening = this.phase === 'pull', duration = opening ? .38 : .22;
    const t = clamp(this.elapsed / duration), blend = smooth(t), target = opening ? pulled() : closed();
    const mix = (key: Exclude<keyof Pose, 'joined'>) => this.from[key] + (target[key] - this.from[key]) * blend;
    this.pose = {
      distance: mix('distance'), layout: mix('layout'), strain: mix('strain'), size: mix('size'),
      glyph: opening ? this.from.glyph + (1 - this.from.glyph) * smooth((t - .18) / .55) : mix('glyph'),
      joined: opening || mix('distance') < 56, neck: mix('neck')
    };
    if (t === 1) {
      if (opening) { this.pose = { ...pulled(), joined: false }; this.phase = 'recoil'; this.elapsed = 0; }
      else this.finish(false);
    }
  }
}

/** 一侧受牵引的圆角软团；中段贝塞尔鼓包让断开的细颈缩回本体。 */
function lobe(cx: number, cy: number, rx: number, ry: number, radius: number, leftPull: number, rightPull: number) {
  const r = Math.min(radius, rx, ry * .9), k = .55228475, left = cx - rx, right = cx + rx, top = cy - ry, bottom = cy + ry;
  const side = ry - r;
  return `M${left + r} ${top}H${right - r}`
    + `C${right - r + r * k} ${top} ${right} ${top + r - r * k} ${right} ${top + r}`
    + `C${right} ${cy - side * .3} ${right + rightPull} ${cy - side * .3} ${right + rightPull} ${cy}`
    + `C${right + rightPull} ${cy + side * .3} ${right} ${cy + side * .3} ${right} ${bottom - r}`
    + `C${right} ${bottom - r + r * k} ${right - r + r * k} ${bottom} ${right - r} ${bottom}H${left + r}`
    + `C${left + r - r * k} ${bottom} ${left} ${bottom - r + r * k} ${left} ${bottom - r}`
    + `C${left} ${cy + side * .3} ${left - leftPull} ${cy + side * .3} ${left - leftPull} ${cy}`
    + `C${left - leftPull} ${cy - side * .3} ${left} ${cy - side * .3} ${left} ${top + r}`
    + `C${left} ${top + r - r * k} ${left + r - r * k} ${top} ${left + r} ${top}Z`;
}

/** 两个软团和细颈用同一条非零填充路径绘制，重叠处不叠阴影、不出现接缝。 */
export function splitOutline(pose: Pose, radius: number) {
  const { strain: s, size } = pose, ax = 19 - 3 * s, bx = 19 + pose.distance;
  const aw = 19 * (1 + .07 * s), ah = 18 / (1 + .1 * s);
  const bw = 19 * size * (1 + .12 * s), bh = 18 * size / (1 + .2 * s);
  let path = lobe(ax, 18, aw, ah, radius + Math.max(0, s) * 3, 0, 6 * s)
    + lobe(bx, 18, bw, bh, (radius + Math.max(0, s) * 3) * size, 5 * s * size, 0);
  // 接点埋入两侧外壳，中央收成细丝；断开后仅保留两侧带惯性的牵引尖端。
  const x1 = ax + aw - 7, x2 = bx - bw + 7, middle = (x1 + x2) / 2;
  if (pose.joined && x2 > x1 && pose.distance > 12) {
    const shoulder = Math.min(11, bh * .7), neck = Math.min(shoulder, pose.neck), arm = (x2 - x1) * .32;
    path += `M${x1} ${18 - shoulder}C${x1 + arm} ${18 - shoulder} ${middle - arm * .45} ${18 - neck} ${middle} ${18 - neck}`
      + `C${middle + arm * .45} ${18 - neck} ${x2 - arm} ${18 - shoulder} ${x2} ${18 - shoulder}V${18 + shoulder}`
      + `C${x2 - arm} ${18 + shoulder} ${middle + arm * .45} ${18 + neck} ${middle} ${18 + neck}`
      + `C${middle - arm * .45} ${18 + neck} ${x1 + arm} ${18 + shoulder} ${x1} ${18 + shoulder}Z`;
  }
  return path;
}
