import { Ellipse, FabricObject, Path, Point, Rect, util, type TSimplePathData } from 'fabric';
import { presentationMotion } from './LiquidMotion';
import { clamp, MotionClock, MotionSpring } from './motion';
import { motionSuspended, observeMotionScope } from './motionScope';
import { paintSolidStroke } from './InkPath';

type Material = {
  x: MotionSpring; y: MotionSpring; gripX: MotionSpring; gripY: MotionSpring; moving: MotionSpring;
  held: boolean; previous: Point; drive: Point; inputTime: number; display: number; caching: boolean;
};
// 仅编辑画布的绘制阶段读取受力，模型、控制点、像素命中和导出仍使用精确几何。
const materials = new WeakMap<FabricObject, Material>();

/** 弯曲分布到边和曲线内部；抓点及对侧支点固定，中段滞后后收细、回鼓。 */
function renderElastic(object: FabricObject, ctx: CanvasRenderingContext2D, commands: TSimplePathData, offset = new Point()) {
  const material = materials.get(object);
  if (!material || ctx !== object.canvas?.getContext()) return false;
  const w = Math.max(1, object.width), h = Math.max(1, object.height);
  const arrow = object instanceof ElasticArrow;
  // 压力保存在画布坐标，箭头快速转向时投影到新局部轴，受力方向不会跟着突翻。
  const local = new Point(material.x.x, material.y.x).transform(util.invertTransform(object.calcTransformMatrix()), true);
  const limitX = Math.max(.01, Math.min(24 / Math.max(.01, material.display * object.scaleX), w * .18));
  const limitY = Math.max(.01, Math.min(24 / Math.max(.01, material.display * object.scaleY), (arrow ? w : h) * .18));
  const pullX = limitX * Math.tanh(local.x / limitX), pullY = limitY * Math.tanh(local.y / limitY);
  const grip = { x: clamp(material.gripX.x, -1, 1), y: clamp(material.gripY.x, -1, 1), moving: clamp(material.moving.x) };
  const warp = (px: number, py: number): [number, number] => {
    px -= offset.x; py -= offset.y;
    const u = clamp(px * 2 / w, -1, 1), v = clamp(py * 2 / h, -1, 1);
    const distance = Math.hypot((u - grip.x) / 2, (v - grip.y) / 2);
    const span = Math.max(.5, Math.hypot(1 + Math.abs(grip.x), 1 + Math.abs(grip.y)) / 2);
    const belly = Math.sin(Math.PI * clamp((u + 1) / 2));
    const pinned = arrow ? belly : Math.sin(Math.PI * clamp(distance / span));
    const weight = pinned + (.12 + .88 * clamp(distance / span) - pinned) * grip.moving;
    const stretch = arrow ? clamp(pullX * grip.x / w * 2.2, -.28, .38) * belly * (1 - grip.moving) : 0;
    return [px - pullX * weight * (arrow ? .55 : 1), py * (1 - stretch) - pullY * weight];
  };
  const warped:TSimplePathData=commands.map(command=>{
    switch (command[0]) {
      case 'M': case 'L': return [command[0],...warp(command[1],command[2])];
      case 'Q': return ['Q',...warp(command[1],command[2]),...warp(command[3],command[4])];
      case 'C': return ['C',...warp(command[1],command[2]),...warp(command[3],command[4]),...warp(command[5],command[6])];
      case 'Z': return ['Z'];
    }
  });
  paintOutline(object,ctx,warped);
  return true;
}

/** 精确轮廓与临时形变走同一绘制入口，避免松手恢复缓存时又切回产生空洞的描边。 */
function paintOutline(object:FabricObject,ctx:CanvasRenderingContext2D,path:TSimplePathData) {
  ctx.beginPath();
  for(const c of path){
    switch(c[0]){
      case 'M':ctx.moveTo(c[1],c[2]);break;
      case 'L':ctx.lineTo(c[1],c[2]);break;
      case 'Q':ctx.quadraticCurveTo(c[1],c[2],c[3],c[4]);break;
      case 'C':ctx.bezierCurveTo(c[1],c[2],c[3],c[4],c[5],c[6]);break;
      case 'Z':ctx.closePath();break;
    }
  }
  if(object instanceof ElasticRect||object instanceof ElasticEllipse){
    object._renderFill(ctx);paintSolidStroke(object,ctx,path);
  }else object._renderPaintInOrder(ctx);
}

/** 直边也分配贝塞尔控制点，拉扯时弯在边中部，不只变成斜四边形。 */
export class ElasticRect extends Rect {
  override _render(ctx: CanvasRenderingContext2D) {
    const x = -this.width / 2, y = -this.height / 2, r = Math.min(this.rx, this.width / 2, this.height / 2);
    const right = -x, bottom = -y, dx = (this.width - r * 2) / 3, dy = (this.height - r * 2) / 3;
    const path: TSimplePathData = [
      ['M', x + r, y], ['C', x + r + dx, y, right - r - dx, y, right - r, y], ['Q', right, y, right, y + r],
      ['C', right, y + r + dy, right, bottom - r - dy, right, bottom - r], ['Q', right, bottom, right - r, bottom],
      ['C', right - r - dx, bottom, x + r + dx, bottom, x + r, bottom], ['Q', x, bottom, x, bottom - r],
      ['C', x, bottom - r - dy, x, y + r + dy, x, y + r], ['Q', x, y, x + r, y], ['Z'],
    ];
    if (!renderElastic(this, ctx, path)) paintOutline(this,ctx,path);
  }
}

export class ElasticEllipse extends Ellipse {
  override _render(ctx: CanvasRenderingContext2D) {
    // 八段圆弧降低大尺寸椭圆的曲线近似误差，也为软体边缘提供均匀控制点。
    const x=this.rx,y=this.ry,step=Math.PI/4,k=4/3*Math.tan(step/4);
    const path:TSimplePathData=[['M',x,0]];
    for(let i=0;i<8;i++){
      const a=i*step,b=(i+1)*step;
      path.push(['C',x*(Math.cos(a)-k*Math.sin(a)),y*(Math.sin(a)+k*Math.cos(a)),x*(Math.cos(b)+k*Math.sin(b)),y*(Math.sin(b)-k*Math.cos(b)),x*Math.cos(b),y*Math.sin(b)]);
    }
    path.push(['Z']);
    if (!renderElastic(this, ctx, path)) paintOutline(this,ctx,path);
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
  private states = new Map<FabricObject, Material>();
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
  active(object: FabricObject) { return this.states.has(object); }
  begin(object: FabricObject, pointer: Point, moving = false) {
    if (this.object !== object) this.release();
    if (!(object instanceof ElasticRect || object instanceof ElasticEllipse || object instanceof ElasticArrow)) return;
    if (motionSuspended(this.host) || this.media.matches) { this.clear(); return; }
    const point = pointer.transform(util.invertTransform(object.calcTransformMatrix()));
    const gx = clamp(point.x * 2 / Math.max(1, object.width), -1, 1), gy = clamp(point.y * 2 / Math.max(1, object.height), -1, 1);
    let material = this.states.get(object);
    if (!material) {
      material = { x: new MotionSpring(), y: new MotionSpring(), gripX: new MotionSpring(gx), gripY: new MotionSpring(gy), moving: new MotionSpring(Number(moving)), held: true, previous: pointer, drive: new Point(), inputTime: performance.now(), display: 1, caching: object.objectCaching };
      // 形变可能越过原缓存边缘；直接绘制以免软边被截，结束立即恢复原缓存策略。
      object.objectCaching = false;
      this.states.set(object, material); materials.set(object, material);
    }
    this.object = object;
    material.gripX.to = gx; material.gripY.to = gy; material.moving.to = Number(moving);
    material.held = true; material.previous = pointer; material.inputTime = performance.now(); material.drive = new Point();
    this.clock = presentationMotion(this.host)?.clock ?? (this.owned ??= new MotionClock());
    this.owned?.setReduced(this.media.matches);
    this.unlisten ??= this.clock.listen((elapsed, time) => this.step(elapsed, time));
    this.clock.wake();
  }
  /** 输入只改变受力目标，绝不直接改弹簧位置；反向拖动沿用当前位移和速度。 */
  update(object: FabricObject, pointer: Point, drawing = false) {
    const material = this.states.get(object);
    if (this.object !== object || !material?.held) return;
    const now = performance.now(), elapsed = clamp((now - material.inputTime) / 1000, .004, .05);
    const delta = pointer.subtract(material.previous), blend = 1 - Math.exp(-elapsed / .035);
    material.drive = material.drive.add(delta.scalarDivide(elapsed).subtract(material.drive).scalarMultiply(blend));
    material.previous = pointer; material.inputTime = now;
    if (drawing) {
      const local = pointer.transform(util.invertTransform(object.calcTransformMatrix()));
      material.gripX.to = clamp(local.x * 2 / Math.max(1, object.width), -1, 1);
      material.gripY.to = clamp(local.y * 2 / Math.max(1, object.height), -1, 1);
    }
    const canvas = object.canvas, bounds = canvas?.upperCanvasEl?.getBoundingClientRect();
    material.display = bounds && canvas ? bounds.width / canvas.width : 1;
    this.clock?.wake();
  }
  release() {
    const material = this.object && this.states.get(this.object);
    if (!material?.held) return;
    material.held = false; material.drive = new Point(); material.x.to = material.y.to = 0;
    // 松手只卸载外力，现有速度自然产生余振，不额外施加突兀的释放冲量。
    this.object = null;
    this.clock?.wake();
  }
  private step(elapsed: number, time: number) {
    if (this.clock?.reduced || motionSuspended(this.host)) { this.clear(); return false; }
    let running = false;
    for (const [object, material] of this.states) {
      if (!object.canvas) { this.cancel(object); continue; }
      if (material.held && time - material.inputTime > 32) material.drive = material.drive.scalarMultiply(Math.exp(-elapsed / .055));
      if (material.drive.distanceFrom(new Point()) < .1) material.drive = new Point();
      const limit = 30 / Math.max(.01, material.display);
      material.x.to = material.held ? limit * Math.tanh(material.drive.x * .12 / limit) : 0;
      material.y.to = material.held ? limit * Math.tanh(material.drive.y * .12 / limit) : 0;
      const springs = [material.x, material.y, material.gripX, material.gripY, material.moving];
      if (springs.some(spring => spring.moving)) {
        material.x.step(elapsed, 'selection'); material.y.step(elapsed, 'selection');
        for (const spring of springs.slice(2)) spring.step(elapsed, 'selectionCorner');
        object.dirty = true; object.canvas.requestRenderAll();
      }
      const moving = springs.some(spring => spring.moving) || material.drive.x !== 0 || material.drive.y !== 0;
      if (!moving && !material.held) this.cancel(object);
      running = moving || running;
    }
    return running;
  }
  cancel(object: FabricObject) {
    const material = this.states.get(object); if (!material) return;
    materials.delete(object); this.states.delete(object); object.objectCaching = material.caching;
    object.dirty = true; object.canvas?.requestRenderAll();
    if (this.object === object) this.object = null;
    if (!this.states.size) { this.unlisten?.(); this.unlisten = undefined; }
  }
  clear() { for (const object of this.states.keys()) this.cancel(object); }
  dispose() { this.clear(); this.stopScope(); this.media.removeEventListener('change', this.preference); window.removeEventListener('blur', this.blur); this.owned?.dispose(); }
}
