import { Ellipse, FabricObject, Path, Textbox } from 'fabric';
import { presentationMotion } from './LiquidMotion';
import { motionSuspended, observeMotionScope } from './motionScope';
import type { MotionClock } from './motion';

const ns = 'http://www.w3.org/2000/svg';
/** 独立 SVG 只画短暂反馈，真实 Fabric 对象、命中和导出不参与弹性缩放。 */
export class AnnotationMotion {
  private key = 'annotation-feedback:' + crypto.randomUUID();
  private clock?: MotionClock;
  private stop: () => void;
  constructor(private root: SVGSVGElement, private host: HTMLElement) {
    this.stop = observeMotionScope(host, suspended => { if (suspended) this.clear(); });
  }
  clear() { this.clock?.cancel(this.key); this.root.replaceChildren(); }
  dispose() { this.clear(); this.stop(); }
  /** 落笔一圈收紧、落定短回弹、删除向中心收束；每次新操作覆盖旧反馈。 */
  contact(x: number, y: number) {
    this.play(`M${x - 7} ${y}a7 7 0 1 0 14 0a7 7 0 1 0-14 0`, [1, 0, 0, 1, 0, 0], { x, y }, 'contact');
  }
  pulse(object: FabricObject, mode: 'commit' | 'select' | 'remove' = 'commit') {
    // Fabric 返回的矩阵可能来自缓存；表现副本必须拷贝，不能改写对象变换。
    const w = object.width, h = object.height, matrix = [...object.calcTransformMatrix()];
    let path: string;
    if (object instanceof Path) {
      path = object.path.map(segment => segment.join(' ')).join(' ');
      matrix[4] -= matrix[0] * object.pathOffset.x + matrix[2] * object.pathOffset.y;
      matrix[5] -= matrix[1] * object.pathOffset.x + matrix[3] * object.pathOffset.y;
    } else if (object instanceof Ellipse) path = `M${-w / 2} 0a${w / 2} ${h / 2} 0 1 0 ${w} 0a${w / 2} ${h / 2} 0 1 0 ${-w} 0`;
    else if (object instanceof Textbox) path = `M${-w / 2} ${h / 2 + 3}H${w / 2}`;
    else {
      const r = Math.min(6, w / 4, h / 4), x = -w / 2, y = -h / 2;
      path = `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;
    }
    const center = object.getCenterPoint();
    this.play(path, matrix, center, mode, Math.min(.025, 6 / Math.max(1, object.getScaledWidth(), object.getScaledHeight())));
  }
  private play(d: string, matrix: number[], center: { x: number; y: number }, mode: 'contact' | 'commit' | 'select' | 'remove', amplitude = .025) {
    this.clear(); this.clock = presentationMotion(this.host)?.clock;
    if (!this.clock || this.clock.reduced || motionSuspended(this.host)) return;
    const group = document.createElementNS(ns, 'g'), path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d); path.setAttribute('transform', `matrix(${matrix.join(' ')})`);
    path.setAttribute('pathLength', '1'); path.setAttribute('vector-effect', 'non-scaling-stroke');
    group.append(path); this.root.append(group);
    // 反馈与其它表面同用弹簧：落笔圈按 press 收紧并轻微越位，删除按 exit 收束；
    // 提交/选中由 selection 弹簧的速度带出一次鼓起与回缩，不再用正弦时长曲线。
    const ring = mode === 'contact', removing = mode === 'remove', preset = removing ? 'exit' : ring ? 'press' : 'selection';
    // selection 弹簧 0→1 的峰值速度约 9/s，用于把速度归一成 ±1 的鼓起量。
    const peak = 9;
    path.style.strokeDasharray = '1';
    void this.clock.spring(this.key, (value, velocity) => {
      const p = Math.max(0, value), fade = Math.min(1, p);
      const scale = removing ? 1 - .08 * p : ring ? 1.45 - .45 * p : 1 + amplitude * 2 * velocity / peak;
      group.setAttribute('transform', `translate(${center.x} ${center.y}) scale(${scale}) translate(${-center.x} ${-center.y})`);
      // 可见度跟随弹簧剩余能量（离终点距离 + 归一速度）衰减：余振在时可见，停稳时恰好淡尽，不硬切移除。
      const energy = Math.min(1, Math.abs(1 - value) + Math.abs(velocity) / peak);
      group.style.opacity = String(energy * (mode === 'select' ? .45 : .8));
      path.style.strokeDashoffset = String(removing ? fade : ring ? 0 : Math.max(0, 1 - fade * 3));
    }, 0, 1, preset).then(completed => { if (completed) group.remove(); });
  }
}
