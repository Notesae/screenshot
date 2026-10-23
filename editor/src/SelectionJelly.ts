import { clamp, MotionSpring, motionTokens as T, type MotionRect } from './motion';
import type { CaptureHandle } from './selectionGeometry';

/** 抓点只提供手柄语义和按下位置；像素选区仍由原有手势模型计算。 */
export type SelectionGrip = { handle: CaptureHandle; point?: { x: number; y: number } };
/** 曲线的坐标均为 CSS 像素，与原生 DIP 轮廓采用相同的向量运算。 */
type Point = [number, number];
/** nw/n/ne/e/se/s/sw/w 顺序同时对应 DOM 手柄、曲线取样点和显现次序。 */
const handles: readonly CaptureHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
/** 固定归一化槽位只作为命中与曲线取样的基准，受力不会修改这组坐标。 */
const slots: Point[] = [[0, 0], [.5, 0], [1, 0], [1, .5], [1, 1], [.5, 1], [0, 1], [0, .5]];

/** 统一初始框选与落位调整的受力规则；轮廓、遮罩和控制点不反写物理像素选区。 */
export class SelectionJelly {
  // 左、上、右、下及 nw/ne/se/sw 四角分别保留速度，改变方向时连续续接。
  private edges = [new MotionSpring(), new MotionSpring(), new MotionSpring(), new MotionSpring()];
  private corners = [new MotionSpring(), new MotionSpring(), new MotionSpring(), new MotionSpring()];
  private ripple = [new MotionSpring(), new MotionSpring()];
  private squash = [new MotionSpring(), new MotionSpring()];
  private pulse = new MotionSpring();
  private box: MotionRect | null = null;
  // 与原生首次成形共用牵引、展开和两轴惯性；落位后的选区保持完整尺寸。
  private formation = new MotionSpring();
  private unfold = new MotionSpring(1);
  private pull = [new MotionSpring(), new MotionSpring()];
  private grip: { handle: CaptureHandle; u: number; v: number; index: number; x: number; y: number } | null = null;
  // 最后一次坐标更新先于下一帧释放冲量；取消和原地点击不注入额外回弹。
  private held = false;
  private released = false;

  /** 输入只读取准确矩形；抓点随逻辑槽位更新，手柄自身的形变不会积成坐标漂移。 */
  update(box: MotionRect | null, reduced: boolean) {
    if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) { this.reset(); return; }
    if (reduced) this.snap();
    else {
      if (this.grip) {
        const x = box.x + this.grip.u * box.width, y = box.y + this.grip.v * box.height, C = T.selection.creation;
        if (this.held || this.released) {
          this.pull[0].x = clamp(this.pull[0].x + (x - this.grip.x) * C.gain, -C.lag, C.lag);
          this.pull[1].x = clamp(this.pull[1].x + (y - this.grip.y) * C.gain, -C.lag, C.lag);
        }
        this.grip.x = x; this.grip.y = y;
      }
      if (!this.box) {
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
    }
    this.box = { ...box };
  }

  /** 拖角固定对角，拖边固定对边，整体移动按实际抓点分配受力；键盘采用对应逻辑槽位。 */
  gesture(held: boolean, cancelled = false, input?: SelectionGrip) {
    if (held && this.box) {
      const handle = input?.handle ?? 'move', box = this.box;
      let index = handles.indexOf(handle), u = .5, v = .5;
      if (handle === 'move') {
        if (input?.point && [input.point.x, input.point.y].every(Number.isFinite)) {
          u = clamp((input.point.x - box.x) / box.width); v = clamp((input.point.y - box.y) / box.height);
        }
        let distance = Infinity;
        slots.forEach((point, slot) => { const next = Math.hypot(point[0] - u, point[1] - v); if (next < distance) { distance = next; index = slot; } });
      } else if (index >= 0) [u, v] = slots[index];
      this.grip = { handle, u, v, index: Math.max(0, index), x: box.x + u * box.width, y: box.y + v * box.height };
      // 既有选区从轻按开始受力，避免把完整区域收回首次按下的小软团。
      this.formation.x = Math.max(this.formation.x, .18); this.formation.to = 1;
      this.unfold.snap(0); this.unfold.to = 1;
    }
    this.released = !held && this.held && !cancelled; this.held = held;
    if (!held) this.formation.to = 0;
  }

  /** 同一时钟推进原生同款牵引、角点接力和松手挤压；减少动态直接显示精确矩形。 */
  step(elapsed: number, reduced: boolean) {
    if (reduced) { this.snap(); return false; }
    if (!this.box) return false;
    if (this.released) {
      const x = (Math.abs(this.edges[0].x) + Math.abs(this.edges[2].x)) / 2 + (this.grip ? Math.abs(this.pull[0].x) * .3 : 0);
      const y = (Math.abs(this.edges[1].x) + Math.abs(this.edges[3].x)) / 2 + (this.grip ? Math.abs(this.pull[1].x) * .3 : 0);
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
    this.formation.step(elapsed, 'entry'); this.unfold.step(elapsed, 'selectionCreate');
    for (const spring of this.pull) { spring.step(elapsed, 'selectionCreate'); moving = spring.moving || moving; }
    moving = this.formation.moving || this.unfold.moving || moving;
    const previous = this.corners.map(corner => corner.x), grip = this.grip, C = T.selection.creation;
    const compact = 1 - clamp(Math.min(this.box.width, this.box.height) / C.compactAt);
    const hold = grip ? clamp(this.formation.x) * (C.held + (1 - C.held) * compact) : 0;
    // 各角同时读取上一帧压力，传播速度不依赖循环顺序。
    this.corners.forEach((corner, index) => {
      const x = index === 0 || index === 3 ? 0 : 2, y = index < 2 ? 1 : 3;
      let weight = 0;
      if (grip) {
        if (grip.handle === 'move') weight = .35 + .65 * (1 - Math.hypot(slots[index * 2][0] - grip.u, slots[index * 2][1] - grip.v) / Math.SQRT2);
        else if (grip.index % 2 === 0) weight = index === grip.index / 2 ? 1 : index === (grip.index / 2 ^ 2) ? .35 : .75;
        else weight = index === Math.floor(grip.index / 2) || index === (Math.floor(grip.index / 2) + 1) % 4 ? 1 : .35;
      }
      const strain = (Math.abs(this.edges[x].x) + Math.abs(this.edges[y].x)) / (2 * T.selection.maxLag) + Math.abs(this.pulse.x)
        + (Math.abs(this.squash[0].x) + Math.abs(this.squash[1].x)) / (T.selection.squash * 4) + hold * weight;
      corner.to = clamp(strain * (1 - T.selection.cornerCarry) + previous[(index + 3) % 4] * T.selection.cornerCarry);
      corner.step(elapsed, 'selectionCorner'); moving = corner.moving || moving;
    });
    if (!moving && !this.held) { for (const corner of this.corners) corner.snap(0); this.grip = null; }
    return moving;
  }

  /** 四顶点、软角与八段曲线和原生共用参数及构造规则；遮罩、描边、控制点只取同一份轮廓。 */
  get frame() {
    if (!this.box) return { outline: '', offsets: [] as Point[], reveals: [] as number[] };
    const box = this.box, side = Math.min(box.width, box.height), limit = Math.min(T.selection.maxLag, side * .12), C = T.selection.creation;
    const values = this.edges.map(edge => clamp(edge.x, -limit, limit));
    const breath = this.pulse.x * Math.min(T.selection.bend, side * .12), squashLimit = Math.min(T.selection.squash, side * .05);
    const sx = clamp(this.squash[0].x, -squashLimit, squashLimit), sy = clamp(this.squash[1].x, -squashLimit, squashLimit);
    const l = box.x + values[0] - breath - sx, t = box.y + values[1] - breath - sy;
    const r = box.x + box.width + values[2] + breath + sx, b = box.y + box.height + values[3] + breath + sy;
    const grip = this.grip, pin = grip ? clamp(this.formation.x) : 0, compact = 1 - clamp(side / C.compactAt);
    const radius = Math.min(T.selection.radius * (1 - pin) + C.radius * pin, Math.min(r - l, b - t) * (.18 + (C.roundness - .18) * compact * pin));
    const logical: Point[] = [[box.x, box.y], [box.x + box.width, box.y], [box.x + box.width, box.y + box.height], [box.x, box.y + box.height]];
    const vertices: Point[] = [[l, t], [r, t], [r, b], [l, b]];
    const px = clamp(this.pull[0].x, -C.lag, C.lag), py = clamp(this.pull[1].x, -C.lag, C.lag);
    if (grip && pin > 0) {
      const neck = Math.min(C.neck, side * .16) * (compact * .55 + (1 - clamp(this.unfold.x)) * .45 + clamp((Math.abs(px) + Math.abs(py)) / (C.lag * 2)) * .35) * pin;
      vertices.forEach((vertex, index) => {
        const bx = vertex[0] - logical[index][0], by = vertex[1] - logical[index][1], unit = slots[index * 2];
        let x = bx, y = by;
        if (grip.handle === 'move') {
          const lag = C.gripLag + (C.sideLag - C.gripLag) * Math.hypot(unit[0] - grip.u, unit[1] - grip.v) / Math.SQRT2;
          x += -px * lag * pin + (grip.u - unit[0]) * neck; y += -py * lag * pin + (grip.v - unit[1]) * neck;
        } else if (grip.index % 2 === 0) {
          const corner = grip.index / 2;
          if (index === (corner ^ 2)) { x *= 1 - pin; y *= 1 - pin; }
          else if (index === corner) { x = bx * (1 - pin) - px * C.gripLag * pin; y = by * (1 - pin) - py * C.gripLag * pin; }
          else if (index === (corner ^ 3)) { x -= px * C.sideLag * pin; y += (grip.v === 1 ? 1 : -1) * neck; }
          else { x += (grip.u === 1 ? 1 : -1) * neck; y -= py * C.sideLag * pin; }
        } else {
          const edge = Math.floor(grip.index / 2), active = index === edge || index === (edge + 1) % 4;
          if (!active) { x *= 1 - pin; y *= 1 - pin; }
          else if (edge % 2 === 0) { x += (grip.u - unit[0]) * neck * 2; y -= py * C.sideLag * pin; }
          else { x -= px * C.sideLag * pin; y += (grip.v - unit[1]) * neck * 2; }
        }
        vertex[0] = logical[index][0] + clamp(x, -Math.min(C.lag, box.width * .16), Math.min(C.lag, box.width * .16));
        vertex[1] = logical[index][1] + clamp(y, -Math.min(C.lag, box.height * .16), Math.min(C.lag, box.height * .16));
      });
    }
    const lengths: number[] = [], directions: Point[] = [];
    vertices.forEach((vertex, index) => {
      const next = vertices[(index + 1) % 4], dx = next[0] - vertex[0], dy = next[1] - vertex[1], length = Math.hypot(dx, dy);
      lengths.push(length); directions.push(length > 0 ? [dx / length, dy / length] : [0, 0]);
    });
    // 圆角沿实际边方向转动，长度限制与原生一致，窄小选区不会互相穿过。
    const incoming: Point[] = [], outgoing: Point[] = [];
    vertices.forEach((vertex, index) => {
      const before = (index + 3) % 4, cut = Math.min(radius * clamp(this.corners[index].x), lengths[before] / 2, lengths[index] / 2);
      incoming.push([vertex[0] - directions[before][0] * cut, vertex[1] - directions[before][1] * cut]);
      outgoing.push([vertex[0] + directions[index][0] * cut, vertex[1] + directions[index][1] * cut]);
    });
    const bends = [values[1] * .35 - breath * .5, values[2] * .35 + breath * .5, values[3] * .35 + breath * .5, values[0] * .35 - breath * .5];
    const waveLimit = Math.min(T.selection.ripple, side * .05), wx = clamp(this.ripple[0].x, -waveLimit, waveLimit), wy = clamp(this.ripple[1].x, -waveLimit, waveLimit);
    const waves = [wx, wy, -wx, -wy], points: Point[] = [];
    let outline = 'M' + outgoing[0].join(' ');
    for (let index = 0; index < 4; index++) {
      const next = (index + 1) % 4, start = outgoing[index], end = incoming[next], axis = index % 2 === 0 ? 1 : 0;
      let bend = bends[index];
      if (grip && grip.handle !== 'move' && grip.index === index * 2 + 1) {
        // 拖边中点跟住逻辑抓点，两端角保留延迟，避免把整条边当作刚体平移。
        const desired = (axis === 1 ? grip.y - py * C.gripLag : grip.x - px * C.gripLag);
        const bound = Math.min(C.lag, (axis === 1 ? box.height : box.width) * .16);
        bend = bend * (1 - pin) + clamp((desired - (start[axis] + end[axis]) / 2) / .75, -bound, bound) * pin;
      }
      const c1: Point = [start[0] + (end[0] - start[0]) / 3, start[1] + (end[1] - start[1]) / 3];
      const c2: Point = [start[0] + (end[0] - start[0]) * 2 / 3, start[1] + (end[1] - start[1]) * 2 / 3];
      c1[axis] += bend - waves[index]; c2[axis] += bend + waves[index];
      outline += 'C' + c1.join(' ') + ' ' + c2.join(' ') + ' ' + end.join(' ');
      points[index * 2 + 1] = [(start[0] + end[0]) * .125 + (c1[0] + c2[0]) * .375, (start[1] + end[1]) * .125 + (c1[1] + c2[1]) * .375];
      const arcEnd = outgoing[next], vertex = vertices[next];
      const a1: Point = [vertex[0] + (end[0] - vertex[0]) * .45, vertex[1] + (end[1] - vertex[1]) * .45];
      const a2: Point = [vertex[0] + (arcEnd[0] - vertex[0]) * .45, vertex[1] + (arcEnd[1] - vertex[1]) * .45];
      outline += 'C' + a1.join(' ') + ' ' + a2.join(' ') + ' ' + arcEnd.join(' ');
      points[next * 2] = [(end[0] + arcEnd[0]) * .125 + (a1[0] + a2[0]) * .375, (end[1] + arcEnd[1]) * .125 + (a1[1] + a2[1]) * .375];
    }
    const reveals = slots.map((_, index) => {
      if (!grip) return 1;
      const distance = Math.abs(index - grip.index), delay = Math.min(distance, 8 - distance) * .0875;
      return 1 - pin + pin * clamp((clamp(this.unfold.x + .25) - delay) / (1 - delay));
    });
    return { outline: outline + 'Z', offsets: points.map((point, index): Point => [point[0] - box.x - slots[index][0] * box.width, point[1] - box.y - slots[index][1] * box.height]), reveals };
  }

  reset() { this.box = null; this.snap(); }
  /** 隐藏、会话替换和减少动态清掉完整受力链，旧抓点和释放冲量不能复活。 */
  private snap() {
    for (const spring of [...this.edges, ...this.corners, ...this.ripple, ...this.squash, ...this.pull, this.formation, this.unfold]) spring.snap(0);
    this.unfold.snap(1); this.pulse.snap(0); this.held = this.released = false; this.grip = null;
  }
}
