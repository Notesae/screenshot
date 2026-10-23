import { Ellipse, FabricObject, Path, Point, Rect, util, type TSimplePathData } from 'fabric';
import { presentationMotion } from './LiquidMotion';
import { clamp, MotionClock, MotionSpring } from './motion';
import { motionSuspended, observeMotionScope } from './motionScope';

type Grip = { x: number; y: number; moving: boolean };
type Material = { x: MotionSpring; y: MotionSpring; grip: Grip };
// 仅编辑画布的绘制阶段读取受力，模型、控制点、像素命中和导出仍使用精确几何。
const materials = new WeakMap<FabricObject, Material>();

/** 弯曲分布到边和曲线内部；抓点及对侧支点固定，中段滞后后收细、回鼓。 */
function renderElastic(object: FabricObject, ctx: CanvasRenderingContext2D, commands: TSimplePathData, offset = new Point()) {
  const material = materials.get(object);
  if (!material || ctx !== object.canvas?.getContext()) return false;
  const { x, y, grip } = material, w = Math.max(1, object.width), h = Math.max(1, object.height);
  const arrow = object instanceof ElasticArrow;
  const warp = (px: number, py: number): [number, number] => {
    px -= offset.x; py -= offset.y;
    const u = clamp(px * 2 / w, -1, 1), v = clamp(py * 2 / h, -1, 1);
    const distance = Math.hypot((u - grip.x) / 2, (v - grip.y) / 2);
    const span = Math.max(.5, Math.hypot(1 + Math.abs(grip.x), 1 + Math.abs(grip.y)) / 2);
    const belly = Math.sin(Math.PI * clamp((u + 1) / 2));
    const weight = grip.moving ? .12 + .88 * clamp(distance / span)
      : arrow ? belly : Math.sin(Math.PI * clamp(distance / span));
    const stretch = arrow && !grip.moving ? clamp(x.x * grip.x / w * 2.2, -.28, .38) * belly : 0;
    return [px - x.x * weight * (arrow ? .55 : 1), py * (1 - stretch) - y.x * weight];
  };
  ctx.beginPath();
  for (const command of commands) {
    switch (command[0]) {
      case 'M': ctx.moveTo(...warp(command[1], command[2])); break;
      case 'L': ctx.lineTo(...warp(command[1], command[2])); break;
      case 'Q': ctx.quadraticCurveTo(...warp(command[1], command[2]), ...warp(command[3], command[4])); break;
      case 'C': ctx.bezierCurveTo(...warp(command[1], command[2]), ...warp(command[3], command[4]), ...warp(command[5], command[6])); break;
      case 'Z': ctx.closePath(); break;
    }
  }
  object._renderPaintInOrder(ctx);
  return true;
}

/** 直边也分配贝塞尔控制点，拉扯时弯在边中部，不只变成斜四边形。 */
export class ElasticRect extends Rect {
  override _render(ctx: CanvasRenderingContext2D) {
    if (!materials.has(this)) { super._render(ctx); return; }
    const x = -this.width / 2, y = -this.height / 2, r = Math.min(this.rx, this.width / 2, this.height / 2);
    const right = -x, bottom = -y, dx = (this.width - r * 2) / 3, dy = (this.height - r * 2) / 3;
    const path: TSimplePathData = [
      ['M', x + r, y], ['C', x + r + dx, y, right - r - dx, y, right - r, y], ['Q', right, y, right, y + r],
      ['C', right, y + r + dy, right, bottom - r - dy, right, bottom - r], ['Q', right, bottom, right - r, bottom],
      ['C', right - r - dx, bottom, x + r + dx, bottom, x + r, bottom], ['Q', x, bottom, x, bottom - r],
      ['C', x, bottom - r - dy, x, y + r + dy, x, y + r], ['Q', x, y, x + r, y], ['Z'],
    ];
    if (!renderElastic(this, ctx, path)) super._render(ctx);
  }
}

export class ElasticEllipse extends Ellipse {
  override _render(ctx: CanvasRenderingContext2D) {
    if (!materials.has(this)) { super._render(ctx); return; }
    const x = this.rx, y = this.ry, k = .5522847498;
    const path: TSimplePathData = [
      ['M', x, 0], ['C', x, y * k, x * k, y, 0, y], ['C', -x * k, y, -x, y * k, -x, 0],
      ['C', -x, -y * k, -x * k, -y, 0, -y], ['C', x * k, -y, x, -y * k, x, 0], ['Z'],
    ];
    if (!renderElastic(this, ctx, path)) super._render(ctx);
  }
}

export class ElasticArrow extends Path {
  override _render(ctx: CanvasRenderingContext2D) {
    if (!renderElastic(this, ctx, this.path, this.pathOffset)) super._render(ctx);
  }
}

/** 一次手势保留双轴速度；松手继续同一条弹簧，下一次抓取可直接接住余振。 */
export class AnnotationElasticity {
  private object: FabricObject | null = null;
  private material: Material | null = null;
  private previous = new Point();
  private held = false;
  private caching = true;
  private clock?: MotionClock;
  private owned?: MotionClock;
  private unlisten?: () => void;
  private stopScope: () => void;
  private media = matchMedia('(prefers-reduced-motion: reduce)');
  private preference = () => { this.owned?.setReduced(this.media.matches); if (this.media.matches) this.clear(); };
  private blur = () => this.clear();

  constructor(private host: HTMLElement) {
    this.stopScope = observeMotionScope(host, suspended => { if (suspended) this.clear(); });
    this.media.addEventListener('change', this.preference);
    window.addEventListener('blur', this.blur);
  }
  active(object: FabricObject) { return this.object === object; }
  begin(object: FabricObject, pointer: Point, moving = false) {
    if (!(object instanceof ElasticRect || object instanceof ElasticEllipse || object instanceof ElasticArrow)) { this.clear(); return; }
    if (motionSuspended(this.host) || this.media.matches) { this.clear(); return; }
    if (this.object !== object) {
      this.clear(); this.object = object; this.caching = object.objectCaching;
      // 形变可能越过原缓存边缘；直接绘制以免软边被截，结束立即恢复原缓存策略。
      object.objectCaching = false;
      this.material = { x: new MotionSpring(), y: new MotionSpring(), grip: { x: 1, y: 1, moving } };
      materials.set(object, this.material);
    }
    const point = pointer.transform(util.invertTransform(object.calcTransformMatrix()));
    this.material!.grip = { x: clamp(point.x * 2 / Math.max(1, object.width), -1, 1), y: clamp(point.y * 2 / Math.max(1, object.height), -1, 1), moving };
    this.held = true; this.previous = pointer;
    this.clock = presentationMotion(this.host)?.clock ?? (this.owned ??= new MotionClock());
    this.owned?.setReduced(this.media.matches);
    this.unlisten ??= this.clock.listen(elapsed => this.step(elapsed));
  }
  /** 输入位移换算回当前局部坐标；显示缩放只决定形变上限，不参与标注坐标。 */
  update(object: FabricObject, pointer: Point, drawing = false) {
    if (this.object !== object || !this.material || !this.held) return;
    const matrix = util.invertTransform(object.calcTransformMatrix()), local = pointer.transform(matrix);
    const delta = pointer.subtract(this.previous).transform(matrix, true); this.previous = pointer;
    if (drawing) this.material.grip = { x: clamp(local.x * 2 / Math.max(1, object.width), -1, 1), y: clamp(local.y * 2 / Math.max(1, object.height), -1, 1), moving: false };
    const canvas = object.canvas, bounds = canvas?.upperCanvasEl?.getBoundingClientRect();
    const display = bounds && canvas ? bounds.width / canvas.width : 1;
    const limitX = Math.min(24 / Math.max(.01, display * object.scaleX), object.width * .18);
    const limitY = Math.min(24 / Math.max(.01, display * object.scaleY), (object instanceof ElasticArrow ? object.width : object.height) * .18);
    this.material.x.x = clamp(this.material.x.x + delta.x * .82, -limitX, limitX);
    this.material.y.x = clamp(this.material.y.x + delta.y * .82, -limitY, limitY);
    this.clock?.wake();
  }
  release() {
    if (!this.held || !this.material) return;
    this.held = false;
    // 已累积的压力变成回缩速度，禁止凭空给原地点击注入弹跳。
    for (const spring of [this.material.x, this.material.y]) spring.v -= spring.x * 5;
    this.clock?.wake();
  }
  private step(elapsed: number) {
    const object = this.object, material = this.material;
    if (!object || !material) return false;
    if (this.clock?.reduced || motionSuspended(this.host)) { this.clear(); return false; }
    if (!material.x.moving && !material.y.moving) { if (!this.held) this.clear(); return false; }
    material.x.step(elapsed, 'selection'); material.y.step(elapsed, 'selection');
    object.dirty = true; object.canvas?.requestRenderAll();
    const moving = material.x.moving || material.y.moving;
    if (!moving && !this.held) this.clear();
    return moving;
  }
  clear() {
    this.unlisten?.(); this.unlisten = undefined;
    if (this.object) {
      materials.delete(this.object); this.object.objectCaching = this.caching;
      this.object.dirty = true; this.object.canvas?.requestRenderAll();
    }
    this.object = null; this.material = null; this.held = false;
  }
  dispose() { this.clear(); this.stopScope(); this.media.removeEventListener('change', this.preference); window.removeEventListener('blur', this.blur); this.owned?.dispose(); }
}
