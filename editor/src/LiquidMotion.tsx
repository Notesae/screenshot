import { useLayoutEffect, useRef, type ComponentPropsWithRef, type RefObject } from 'react';
import { clamp, panelBridge, motionTokens as T, MotionClock, MotionSpring, type MotionRect } from './motion';
import { ControlFeedback } from './ControlMotion';
import { SurfaceTransition } from './surfaceTransition';
import { paintSurface } from './surfacePaint';
import { SelectionJelly, type SelectionGrip } from './SelectionJelly';
import { RailToss } from './RailToss';

/** 固定语义槽位承接输入，材质与图文各自变形，避免按钮追着光标改变命中区。 */
export function MotionButton({ children, group = 'end', ...props }: ComponentPropsWithRef<'button'> & { group?: string }) {
  return <button {...props} data-motion-button="" data-motion-group={group}><span className="liquid-skin" aria-hidden="true"/><span className="liquid-glyph">{children}</span></button>;
}

/** 固定槽位保存运动状态；contact 为接触压缩，contactSide 为受压侧，contactShift 为本帧牵引目标。 */
type Surface = { el: HTMLButtonElement; skin: HTMLElement; glyph: HTMLElement; group: string; rect: MotionRect; x: MotionSpring; y: MotionSpring; attention: MotionSpring; press: MotionSpring; contact: MotionSpring; contactSide: number; contactShift: number; faceX: number; faceY: number; radius: number };
/** 仅指向当前挂载的编辑外壳；卸载会使旧完成链取消，不接触文档或系统能力。 */
let currentMotion: LiquidMotion | null = null;
export function presentationMotion(node?: Node | null) { return currentMotion && (!node || currentMotion.owns(node)) ? currentMotion : null; }
const rect = (box: DOMRect): MotionRect => ({ x: box.left, y: box.top, width: box.width, height: box.height });

/** v2 的局部表现控制器：共享帧循环、稳定命中、软体邻接和可中断退场。 */
export class LiquidMotion {
  readonly clock = new MotionClock();
  private nodes: Surface[] = [];
  private dirty = true;
  private active = false;
  private destroyed = false;
  private pointer = { x: 0, y: 0, inside: false };
  private pressed: Surface | null = null;
  private nearest: Surface | null = null;
  // 同时只保留一对牵引表面；一次接触只传递一次冲量，压缩由各自弹簧续接。
  private contact: { a: Surface; b: Surface; start: number; struck: boolean } | null = null;
  // 整条轨道只保留一份抛出/回摆姿态，底座和全部控件共同跟随。
  private entrance = new RailToss();
  // 拖动柄只移动内部图标，语义命中槽位保持固定。
  private grip: { icon: SVGElement; rect: MotionRect } | null = null;
  private bulge = new MotionSpring();
  // 底座沿注意力中心接收光与曲率，基础圆角仍由生产主题测量。
  private bodyLight = new MotionSpring();
  private railRadius = 0;
  private indicator = { x: new MotionSpring(), y: new MotionSpring(), width: new MotionSpring(), opacity: new MotionSpring() };
  // 逻辑取消后继续持有材质来源，直到颜色与按压都收敛再交还普通皮肤。
  private indicatorSource: Surface | null = null;
  private panelRect: MotionRect | null = null;
  // 布局阶段统一读取真实槽位和来源；浮卡逐帧绘制只消费缓存，避免样式写入后再强制测量。
  private panelLayout: { actual: MotionRect; anchor: MotionRect | null } | null = null;
  private panelOpacity = 0;
  private panelMaterial = 0;
  private panelTransition: SurfaceTransition | null = null;
  private panelSource: HTMLElement | null = null;
  private panelElement: HTMLElement | null = null;
  private panelVersion = 0;
  private panelContent = '';
  private manualPanel = false;
  private controls: ControlFeedback;
  // 尺寸读数即时变化，只有胶囊外壳保留 5/4px 以内的短惯性。
  private sizePosition: MotionRect | null = null;
  // 选区软边只消费真实显示矩形，与尺寸胶囊共用主时钟。
  private selectionJelly = new SelectionJelly();
  private sizeX = new MotionSpring();
  private sizeY = new MotionSpring();
  private animations = new Set<Animation>();
  private clone: HTMLCanvasElement | null = null;
  private exitSequence = 0;
  private rr: MotionRect = { x: 0, y: 0, width: 1, height: 1 };
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private fine = matchMedia('(hover: hover) and (pointer: fine)');
  private economy = navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 2;
  private resize: ResizeObserver;
  private mutation: MutationObserver;
  private cleanup: (() => void)[] = [];

  /** 将局部输入与系统偏好接入同一调度器，卸载时成组释放订阅。 */
  constructor(private root: HTMLElement, private rail: HTMLElement) {
    root.classList.add('liquid-motion');
    root.dataset.motionEconomy = String(this.economy);
    root.dataset.motionHidden = String(document.hidden); this.clock.setSuspended(true);
    this.clock.onIdle = () => { root.dataset.motionState = 'sleep'; };
    this.clock.listen((dt, time) => this.paint(dt, time));
    this.controls = new ControlFeedback(root, this.clock);
    const invalidate = () => { this.dirty = true; this.wake(); };
    this.resize = new ResizeObserver(entries => {
      // 同一布局帧内补偿材质比例，内容展开时不能先按新尺寸拉伸一帧再追赶。
      if (this.panelElement && !this.panelElement.classList.contains('is-closing') && entries.some(entry => entry.target === this.panelElement)) {
        const target = rect(this.panelElement.getBoundingClientRect()), previous = this.panelLayout?.actual;
        // 首次观察通常仍是已测量的尺寸；只有几何真的变化才续接，避免重复启动同一入场。
        if (!previous || target.x !== previous.x || target.y !== previous.y || target.width !== previous.width || target.height !== previous.height) {
          void this.panel(this.panelElement, this.panelSource, true, this.panelContent);
        }
      }
      invalidate();
    }); this.resize.observe(rail); this.resize.observe(root);
    this.mutation = new MutationObserver(invalidate);
    this.mutation.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'inert', 'aria-pressed', 'aria-expanded'] });
    const listen = (target: EventTarget, name: string, fn: EventListener, capture = false) => {
      target.addEventListener(name, fn, capture); this.cleanup.push(() => target.removeEventListener(name, fn, capture));
    };
    listen(root, 'pointermove', ((event: PointerEvent) => {
      if (!this.active || document.hidden) return;
      this.pointer = { x: event.clientX, y: event.clientY, inside: event.pointerType === 'mouse' && !(event.target as Element).closest('.clay-card,.clay-reader,.clay-select-menu,.clay-color-popover') };
      this.wake();
    }) as EventListener);
    listen(root, 'pointerleave', () => { this.pointer.inside = false; this.wake(); });
    // 鼠标与键盘走同一按压反馈；冻结迎向目标，不移动语义命中槽位。
    const press = (button: Element | null) => {
      const node = this.nodes.find(n => n.el === button);
      if (!this.active || document.hidden || !node || !this.usable(node)) return;
      this.pressed = node; node.press.to = 1;
      node.x.to = node.x.x; node.y.to = node.y.x; node.x.v = node.y.v = 0;
      const index = this.nodes.indexOf(node);
      for (const offset of [-1, 1]) {
        const neighbor = this.nodes[index + offset];
        if (!this.clock.reduced && neighbor && node.group !== 'end' && neighbor.group === node.group && this.usable(neighbor)) neighbor.y.v += T.press.neighborImpulse;
      }
      this.wake();
    };
    // 按下、键盘或滚轮输入立即接管落位，用户操作不必等待抛出动画结束。
    const settleEntrance = () => {
      if (!this.active || !this.entrance.moving) return;
      this.entrance.finish(); this.paint(0, performance.now()); this.wake();
    };
    listen(rail, 'pointerdown', settleEntrance, true); listen(rail, 'keydown', settleEntrance, true); listen(rail, 'wheel', settleEntrance, true);
    listen(rail, 'pointerdown', ((event: PointerEvent) => { if (event.button === 0) press((event.target as Element).closest('[data-motion-button]')); }) as EventListener);
    listen(rail, 'keydown', ((event: KeyboardEvent) => { if (!event.repeat && (event.key === ' ' || event.key === 'Enter')) press((event.target as Element).closest('[data-motion-button]')); }) as EventListener);
    listen(rail, 'click', event => {
      // 槽位在宿主揭示后立即响应；入场进度只控制表面，不吞掉用户点击。
      if (root.dataset.motionExit) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    const release = () => { if (this.pressed) this.pressed.press.to = 0; this.pressed = null; this.wake(); };
    listen(window, 'keyup', ((event: KeyboardEvent) => { if (event.key === ' ' || event.key === 'Enter') release(); }) as EventListener);
    listen(window, 'pointerup', release); listen(window, 'pointercancel', release);
    listen(window, 'blur', () => { this.pointer.inside = false; release(); });
    listen(window, 'resize', invalidate); listen(root, 'scroll', invalidate, true);
    listen(document, 'visibilitychange', () => {
      root.dataset.motionHidden = String(document.hidden);
      if (document.hidden) {
        // 先取消业务退出，再结束表现过渡，避免隐藏时误发完成或留下半张浮卡。
        this.restore(); this.controls.present(false); this.clock.setSuspended(true); this.resetField();
      } else { this.clock.setSuspended(!this.active); this.controls.present(this.active); invalidate(); }
    });
    listen(root, 'keydown', ((event: KeyboardEvent) => {
      if (event.key === 'Escape' && root.dataset.motionExit) { event.preventDefault(); event.stopImmediatePropagation(); this.restore(); }
    }) as EventListener, true);
    const updateReduced = () => {
      root.dataset.motionReduced = String(this.reduced.matches);
      if (this.reduced.matches) { this.controls.reset(); for (const animation of this.animations) animation.finish(); this.contact = null; }
      this.clock.setReduced(this.reduced.matches); this.wake();
    };
    this.reduced.addEventListener('change', updateReduced);
    this.cleanup.push(() => this.reduced.removeEventListener('change', updateReduced));
    updateReduced();
  }
  invalidate(){this.dirty=true;this.wake();}
  owns(node: Node) { return this.root.contains(node); }
  /** 只结束浮卡轨道；键盘的下一次位置提交需即时，拖动由手势作用域接管。 */
  placePanel(immediate = false) {
    const panel = this.root.querySelector<HTMLElement>('.clay-card:not(.is-closing)');
    if (!panel) return;
    this.clock.finish('panel'); this.panelRect = rect(panel.getBoundingClientRect()); this.manualPanel = immediate;
    if (this.panelLayout) this.panelLayout.actual = this.panelRect;
    this.panelTransition?.snap(this.panelRect, true);
  }
  private wake() { if (!this.destroyed && this.active && !document.hidden) { this.root.dataset.motionState = 'awake'; this.clock.wake(); } }
  /** 只在宿主真正撤挡后入场；挂起旧截图时取消时间线，不提前消费动画。 */
  present(presented: boolean) {
    if (this.active === presented) return;
    this.active = presented;
    this.controls.present(presented && !document.hidden);
    if (!presented) { this.restore(); this.clock.setSuspended(true); this.resetField(); return; }
    this.clock.setSuspended(document.hidden);
    this.measure();
    if (document.hidden) { this.resetField(); return; }
    const done = this.nodes.find(node => node.el.dataset.motionAction === 'done');
    this.entrance.begin(this.rr, done?.rect, this.clock.reduced);
    this.paint(0, performance.now());
    this.wake();
  }
  /** 旧会话的迎向、按压、接触压力和尺寸惯性不能带到下一次揭示。 */
  private resetField() {
    this.pointer.inside = false; this.pressed = this.nearest = null; this.contact = null;
    this.indicatorSource = null;
    for (const node of this.nodes) {
      for (const spring of [node.x, node.y, node.attention, node.press, node.contact]) spring.snap(0);
      node.faceX = node.faceY = node.contactShift = node.contactSide = 0;
      delete node.el.dataset.motionMaterial;
      node.skin.style.transform = node.glyph.style.transform = 'none';
      node.skin.style.opacity = node.glyph.style.opacity = '1';
      node.skin.style.borderRadius = node.radius + 'px'; node.skin.style.setProperty('--liquid-light', '0');
    }
    this.entrance.finish(); this.rail.style.removeProperty('overflow');
    if (this.grip) { this.grip.icon.style.transform = 'none'; this.grip.icon.style.opacity = '1'; }
    this.bulge.snap(0); this.bodyLight.snap(this.rr.width / 2);
    const body = this.rail.querySelector<HTMLElement>('.liquid-rail-body');
    if (body) { body.style.transform = 'none'; body.style.opacity = '1'; body.style.borderRadius = this.railRadius + 'px'; body.style.setProperty('--liquid-body-light', '0'); }
    for (const spring of Object.values(this.indicator)) spring.snap(0);
    const indicator = this.rail.querySelector<HTMLElement>('.liquid-active'); if (indicator) indicator.style.opacity = '0';
    this.sizePosition = null; this.sizeX.snap(0); this.sizeY.snap(0); this.selectionJelly.reset();
    this.paintSelection();
    const size = this.root.querySelector<HTMLElement>('.clay-selection-size'); if (size) size.style.transform = 'none';
    this.animations.forEach(animation => animation.cancel()); this.animations.clear();
  }
  /** 缓存固定槽位，滚动和布局变化才重新测量；绝不测量变形后的材质作新目标。 */
  private measure() {
    const previous = this.rr;
    this.rr = rect(this.rail.getBoundingClientRect());
    // 重排或手动移动交还精确槽位，旧抛出轨迹不能继续追逐新的布局。
    if (previous.x !== this.rr.x || previous.y !== this.rr.y || previous.width !== this.rr.width || previous.height !== this.rr.height) this.entrance.finish();
    const grip = this.rail.querySelector<HTMLElement>('.clay-grip'), icon = grip?.querySelector<SVGElement>('svg');
    if (grip && icon) {
      const box = grip.getBoundingClientRect();
      this.grip = { icon, rect: { x: box.x - this.rr.x, y: box.y - this.rr.y, width: box.width, height: box.height } };
    } else this.grip = null;
    this.railRadius = parseFloat(getComputedStyle(this.rail).borderTopLeftRadius) || 0;
    const existing = new Map(this.nodes.map(node => [node.el, node]));
    this.nodes = [...this.rail.querySelectorAll<HTMLButtonElement>('[data-motion-button]')].map(el => {
      const box = el.getBoundingClientRect();
      const node = existing.get(el) ?? { el, skin: el.querySelector<HTMLElement>('.liquid-skin')!, glyph: el.querySelector<HTMLElement>('.liquid-glyph')!, group: el.dataset.motionGroup || 'end', x: new MotionSpring(), y: new MotionSpring(), attention: new MotionSpring(), press: new MotionSpring(), contact: new MotionSpring(), contactSide: 0, contactShift: 0, faceX: 0, faceY: 0, radius: 0, rect: rect(box) };
      node.radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      node.rect = { x: box.left - this.rr.x, y: box.top - this.rr.y, width: box.width, height: box.height };
      return node;
    });
    if (this.panelElement?.isConnected) {
      this.panelLayout = { actual: rect(this.panelElement.getBoundingClientRect()), anchor: this.panelSource?.isConnected ? rect(this.panelSource.getBoundingClientRect()) : null };
    }
    this.dirty = false;
  }
  selection(box: MotionRect | null) {
    if (box && this.sizePosition && !this.clock.reduced) {
      this.sizeX.x = clamp(this.sizeX.x + this.sizePosition.x - box.x, -5, 5);
      this.sizeY.x = clamp(this.sizeY.x + this.sizePosition.y - box.y, -4, 4);
    }
    this.sizePosition = box; this.wake();
  }
  /** 输入为精确选区的 CSS 矩形；不读取变形后的边缘作为新目标。 */
  selectionSkin(box: MotionRect | null) { this.selectionJelly.update(box, this.clock.reduced); this.paintSelection(); this.wake(); }
  /** 抓点只驱动统一软体轮廓；松手不阻塞裁剪提交，取消和隐藏不生成释放冲量。 */
  selectionGesture(held: boolean, cancelled = false, grip?: SelectionGrip) {
    if (!this.active || document.hidden || this.root.dataset.motionExit || this.clock.reduced) return;
    this.selectionJelly.gesture(held, cancelled, grip); this.paintSelection(); this.wake();
  }
  /** 用同一轮廓同步边框、遮罩与手柄；真实矩形只作为截图和手势的坐标模型。 */
  private paintSelection() {
    const shape = this.selectionJelly.frame;
    const visible = this.active && !document.hidden && !this.root.dataset.motionExit && Boolean(shape.outline);
    const rim = this.root.querySelector<SVGSVGElement>('.clay-selection-jelly');
    if (rim) { rim.style.opacity = visible ? '1' : '0'; rim.querySelector('.selection-jelly-border')?.setAttribute('d', shape.outline); }
    const frame = this.root.querySelector<HTMLElement>('.clay-capture-selection');
    if (frame) {
      frame.dataset.elasticBorder = String(visible);
      frame.querySelectorAll<HTMLButtonElement>('[data-selection-handle]').forEach((button, index) => {
        const offset = visible ? shape.offsets[index] : undefined;
        button.style.setProperty('--selection-offset-x', (offset?.[0] ?? 0) + 'px');
        button.style.setProperty('--selection-offset-y', (offset?.[1] ?? 0) + 'px');
        button.style.setProperty('--selection-reveal', String(visible ? shape.reveals[index] ?? 1 : 1));
      });
    }
    const mask = this.root.querySelector<SVGPathElement>('.clay-selection-mask path'), viewport = mask?.ownerSVGElement;
    if (mask && viewport) {
      const outer = 'M0 0H' + viewport.getAttribute('width') + 'V' + viewport.getAttribute('height') + 'H0Z ';
      mask.setAttribute('d', visible ? outer + shape.outline : mask.getAttribute('data-exact-path') ?? '');
    }
  }
  private usable(node: Surface) {
    const r = node.rect;
    return node.el.isConnected && !node.el.matches(':disabled') && !node.el.closest('[inert]') && r.width > 0 && r.height > 0 && r.x >= -1 && r.y >= -1 && r.x + r.width <= this.rr.width + 1 && r.y + r.height <= this.rr.height + 1
      && this.rr.x + r.x >= -1 && this.rr.y + r.y >= -1 && this.rr.x + r.x + r.width <= innerWidth + 1 && this.rr.y + r.y + r.height <= innerHeight + 1;
  }
  /** 相邻表面先后被牵引，接触后传递一次动量并压缩；只改原弹簧目标，保留反向时的速度。 */
  private followContact(time: number, near: Surface | undefined) {
    for (const node of this.nodes) { node.contactShift = 0; node.contact.to = 0; }
    const contact = this.contact;
    if (!contact) return;
    const { a, b } = contact, age = time - contact.start;
    if (!near || near.group !== a.group || this.clock.reduced || this.economy || !this.usable(a) || !this.usable(b) || age >= T.contact.duration) { this.contact = null; return; }
    const direction = Math.sign(b.rect.x - a.rect.x);
    // 以前一帧未压缩的材质边缘估算压力，避免挤压后缩小的轮廓反复打开、闭合接触。
    const widthA = a.rect.width * (1 + T.field.stretch * a.attention.x * .6 + (T.press.x - 1) * a.press.x);
    const widthB = b.rect.width * (1 + T.field.stretch * b.attention.x * .6 + (T.press.x - 1) * b.press.x);
    const gap = direction * (b.rect.x + b.rect.width / 2 + b.faceX - a.rect.x - a.rect.width / 2 - a.faceX) - (widthA + widthB) / 2;
    const pressure = clamp((1.5 - gap) / 5);
    const lead = Math.sin(Math.PI * clamp(age / T.contact.duration));
    const follow = Math.sin(Math.PI * clamp((age - T.contact.delay) / (T.contact.duration - T.contact.delay)));
    a.contactSide = direction; b.contactSide = -direction;
    a.contactShift = direction * (T.contact.lead * lead - pressure * T.contact.yield);
    b.contactShift = direction * (-T.contact.follow * follow + pressure * T.contact.yield * 1.4);
    a.contact.to = b.contact.to = pressure;
    // 只有相向靠近到接触区才传递冲量；同一对表面快速反向不会重复注入能量。
    if (!contact.struck && gap <= 1.2 && (a.x.v - b.x.v) * direction > 2) {
      a.x.v -= direction * T.contact.impulse * .6; b.x.v += direction * T.contact.impulse;
      contact.struck = true;
    }
  }
  /** 主轨、图标与接触形变共用一帧；蓝色选中面复用按钮材质几何，静止后休眠。 */
  private paint(dt: number, time: number) {
    if (!this.active || this.root.dataset.motionExit) return false;
    if (this.dirty) this.measure();
    if (this.pressed && !this.usable(this.pressed)) { this.pressed.press.snap(0); this.pressed = null; }
    this.root.dataset.motionFrames = String(this.clock.frames); this.root.dataset.motionState = 'awake';
    const reduced = this.clock.reduced, pointer = this.pointer;
    if (this.root.dataset.motionDragging) this.entrance.finish();
    this.entrance.step(dt, reduced);
    const toss = this.entrance.frame, shear = Math.tan(toss.shear * Math.PI / 180);
    // 抛出时允许软体越过最终槽位；结束后恢复原有横向裁切与纵向滚动策略。
    const overflow = this.entrance.moving ? 'visible' : '';
    if (this.rail.style.overflow !== overflow) this.rail.style.overflow = overflow;
    const reacting = !this.entrance.moving && !reduced && pointer.inside && !this.pressed && this.fine.matches && !this.root.inert && !this.root.dataset.motionDragging;
    const radius = T.field.radius;
    const distance = (node: Surface) => Math.hypot(pointer.x - this.rr.x - node.rect.x - node.rect.width / 2, pointer.y - this.rr.y - node.rect.y - node.rect.height / 2);
    const near = reacting ? this.nodes.filter(node => this.usable(node) && distance(node) < radius).sort((a, b) => distance(a) - distance(b))[0] : undefined;
    if (near && near !== this.nearest) {
      const previous = this.nearest;
      if (previous && this.usable(previous) && previous.group === near.group && near.group !== 'end' && Math.abs(this.nodes.indexOf(previous) - this.nodes.indexOf(near)) === 1 && !this.economy) {
        const gap = Math.abs(near.rect.x + near.rect.width / 2 - previous.rect.x - previous.rect.width / 2) - (near.rect.width + previous.rect.width) / 2;
        const aligned = Math.abs(near.rect.y + near.rect.height / 2 - previous.rect.y - previous.rect.height / 2) <= Math.min(near.rect.height, previous.rect.height) / 4;
        if (aligned && gap >= 0 && gap <= T.contact.maxGap) {
          const samePair = this.contact && (this.contact.a === previous && this.contact.b === near || this.contact.a === near && this.contact.b === previous);
          this.contact = { a: previous, b: near, start: time, struck: Boolean(samePair && this.contact?.struck) };
        }
      }
    }
    this.nearest = near ?? null;
    this.followContact(time, near);
    // 牵引目标仍随时间变化，整段接触结束前不能因某一帧恰好静止而提前休眠。
    let moving = this.entrance.moving || Boolean(this.contact), sum = 0, center = 0;
    for (const [index, node] of this.nodes.entries()) {
      let attention = 0, dx = 0, dy = 0;
      if (near && this.usable(node)) {
        attention = Math.pow(clamp(1 - distance(node) / radius), 2);
        const delta = Math.abs(index - this.nodes.indexOf(near));
        if (node.group === near.group && node.group !== 'end') attention = Math.max(attention, Math.pow(1 - distance(near) / radius, 2) * (delta === 1 ? T.field.neighbor1 : delta === 2 ? T.field.neighbor2 : 0));
        dx = clamp((pointer.x - this.rr.x - node.rect.x - node.rect.width / 2) / (node.rect.width * .7), -1, 1);
        dy = clamp((pointer.y - this.rr.y - node.rect.y - node.rect.height / 2) / (node.rect.height * .7), -1, 1);
      }
      if (this.pressed !== node) { node.attention.to = attention; node.x.to = clamp(dx * attention * T.field.shiftX + node.contactShift, -T.field.maxShift, T.field.maxShift); node.y.to = dy * attention * T.field.shiftY; }
      const preset = near === node ? 'attention' : 'neighbor';
      if (reduced) { node.x.snap(0); node.y.snap(0); node.attention.snap(0); node.press.snap(0); node.contact.snap(0); }
      else {
        node.x.step(dt, preset); node.y.step(dt, preset); node.attention.step(dt, preset); node.press.step(dt, 'press'); node.contact.step(dt, 'press');
      }
      const a = node.attention.x, p = node.press.x, contact = clamp(node.contact.x);
      const limit = Math.min(1, T.field.maxShift / (Math.hypot(node.x.x, node.y.x) || 1));
      const x = node.faceX = node.x.x * limit, y = node.faceY = node.y.x * limit;
      // 所有按钮按同一个软体坐标映射移动；材质参与拉伸，图文只平移，避免各自飞行和字号变化。
      const localX = node.rect.x + node.rect.width / 2 - this.rr.width / 2, localY = node.rect.y + node.rect.height / 2 - this.rr.height / 2;
      const entryX = toss.x + localX * (toss.scaleX - 1) + shear * localY * toss.scaleY, entryY = toss.y + localY * (toss.scaleY - 1);
      node.skin.style.transform = 'translate(' + (x + entryX) + 'px,' + (y + entryY) + 'px) skewX(' + toss.shear + 'deg) scale(' + (toss.scaleX * (1 + T.field.stretch * a * .6 + (T.press.x - 1) * p - T.contact.squash * contact)) + ',' + (toss.scaleY * (1 + T.field.stretch * a * (Math.abs(dy) - .3) + (T.press.y - 1) * p + T.contact.bulge * contact)) + ')';
      node.glyph.style.transform = 'translate(' + (x * T.field.iconRatio + entryX) + 'px,' + (y * T.field.iconRatio + entryY + p * 1.2) + 'px)';
      node.skin.style.opacity = String(toss.skin); node.glyph.style.opacity = String(toss.content);
      // 受压侧略变平、外侧鼓起；图文只跟随平移，始终不参与软体挤压。
      node.skin.style.borderRadius = [node.radius + dx*a*3,node.radius - dx*a*2,node.radius + dx*a*2,node.radius - dx*a*3].map((value, corner) => Math.max(0, value + contact * T.contact.flatten * ((corner === 1 || corner === 2 ? 1 : -1) === node.contactSide ? -1 : .35)) + 'px').join(' ');
      node.skin.style.setProperty('--liquid-light', String(this.economy ? 0 : clamp(a * .95, 0, .8)));
      node.skin.style.setProperty('--liquid-light-y', clamp((pointer.y - this.rr.y - node.rect.y) / node.rect.height * 100, 0, 100) + '%');
      node.skin.style.setProperty('--liquid-light-x', clamp((pointer.x - this.rr.x - node.rect.x) / node.rect.width * 100, 0, 100) + '%');
      node.el.dataset.motionReady = String(toss.content >= .95);
      for (const spring of [node.x, node.y, node.attention, node.press, node.contact]) moving = spring.moving || moving;
      sum += a; center += (node.rect.x + node.rect.width/2)*a;
    }
    this.bulge.to = near ? clamp((pointer.y - this.rr.y - this.rr.height / 2) / this.rr.height, -1, 1) * T.field.bodyBulge * Math.min(sum, 1.2) : 0;
    this.bodyLight.to = sum ? center/sum : this.rr.width/2;
    if (reduced) { this.bulge.snap(0); this.bodyLight.snap(this.rr.width/2); } else { this.bulge.step(dt, 'body'); this.bodyLight.step(dt, 'body'); }
    const body = this.rail.querySelector<HTMLElement>('.liquid-rail-body')!;
    body.style.transformOrigin = 'center'; body.style.opacity = '1';
    body.style.transform = 'translate(' + toss.x + 'px,' + toss.y + 'px) skewX(' + (toss.shear + this.bulge.x * .35) + 'deg) scale(' + toss.scaleX + ',' + toss.scaleY + ')';
    // 圆角抵消整体缩放，小团才是圆润软泥；前后端的曲率随错开的受力回摆。
    const radii = [this.railRadius+Math.max(0,-this.bulge.x),this.railRadius+Math.max(0,this.bulge.x),this.railRadius,this.railRadius].map((value, corner) => Math.max(4, value + (1 - toss.unfold) * 18 + (((corner === 0 || corner === 3 ? -1 : 1) === toss.direction) ? toss.lead : toss.tail) * 9));
    body.style.borderRadius = radii.map(value => value / toss.scaleX + 'px').join(' ') + ' / ' + radii.map(value => value / toss.scaleY + 'px').join(' ');
    if (this.grip) {
      const localX = this.grip.rect.x + this.grip.rect.width / 2 - this.rr.width / 2, localY = this.grip.rect.y + this.grip.rect.height / 2 - this.rr.height / 2;
      this.grip.icon.style.transform = 'translate(' + (toss.x + localX * (toss.scaleX - 1) + shear * localY * toss.scaleY) + 'px,' + (toss.y + localY * (toss.scaleY - 1)) + 'px)';
      this.grip.icon.style.opacity = String(toss.content);
    }
    body.style.setProperty('--liquid-body-light-x',this.bodyLight.x+'px');
    body.style.setProperty('--liquid-body-light',String(reduced||this.economy?0:Math.min(1,sum)));
    moving = this.bulge.moving || this.bodyLight.moving || moving;
    const selected = this.nodes.find(node => node.el.getAttribute('aria-pressed') === 'true' && this.usable(node));
    const ind = this.indicator;
    ind.opacity.to = selected ? 1 : 0;
    // 只有首次取得材质时才对齐初始槽位，淡回灰色不能重置位置速度。
    const previousSource = this.indicatorSource;
    if (selected) this.indicatorSource = selected;
    else if (this.indicatorSource && !this.usable(this.indicatorSource)) this.indicatorSource = null;
    let source = this.indicatorSource;
    if (source) {
      // 迁移只追固定槽位；取消选中仍沿用最后来源的完整按压、迎向与入场姿态。
      ind.x.to = source.rect.x; ind.y.to = source.rect.y; ind.width.to = source.rect.width;
      if (!previousSource || reduced) { ind.x.snap(ind.x.to); ind.y.snap(ind.y.to); ind.width.snap(ind.width.to); }
    }
    for (const spring of Object.values(ind)) { if (reduced) spring.snap(spring.to); else spring.step(dt, 'indicator'); moving = spring.moving || moving; }
    // 颜色、迁移和按压都落定才交回普通皮肤，避免旧轮廓仍在退场就提前换面。
    if (!selected && source && !ind.opacity.moving && ind.opacity.x === 0 && !ind.x.moving && !ind.y.moving && !ind.width.moving && !source.press.moving && this.pressed !== source) this.indicatorSource = source = null;
    for (const node of this.nodes) node.el.dataset.motionMaterial = String(node === source);
    const blob = this.rail.querySelector<HTMLElement>('.liquid-active')!;
    const skin = source?.skin;
    Object.assign(blob.style, {
      width: ind.width.x + 'px', height: (source?.rect.height ?? 36) + 'px',
      opacity: source ? skin?.style.opacity || '1' : '0', borderRadius: skin?.style.borderRadius ?? '',
      transform: 'translate(' + ind.x.x + 'px,' + ind.y.x + 'px) ' + (skin?.style.transform ?? '') + ' scale(' + (1 + Math.min(.24, Math.abs(ind.x.v) / 1800)) + ',' + (1 - Math.min(.13, Math.abs(ind.x.v) / 3300)) + ')'
    });
    // 同一连续进度只改变涂层与阴影权重，不再按 pointerup 或 aria-pressed 瞬间换面。
    blob.style.setProperty('--liquid-selection', String(clamp(ind.opacity.x)));
    blob.style.setProperty('--liquid-press', String(reduced ? Number(Boolean(source && this.pressed === source)) : clamp(source?.press.x ?? 0)));
    for (const name of ['--liquid-light', '--liquid-light-x', '--liquid-light-y']) blob.style.setProperty(name, skin?.style.getPropertyValue(name) || '0');
    const panel = this.panelElement, layout = this.panelLayout;
    if (panel?.isConnected && layout && !panel.classList.contains('is-closing') && !this.clock.has('panel')) {
      this.panelRect = layout.actual;
      if(this.panelTransition) {
        this.panelTransition.redirect(this.panelRect);
        if(this.panelTransition.moving)void this.panel(panel,this.panelSource,true,this.panelContent);
      }
    }
    const size = this.root.querySelector<HTMLElement>('.clay-selection-size');
    for (const spring of [this.sizeX,this.sizeY]) { if(reduced)spring.snap(0);else spring.step(dt,'neighbor');moving=spring.moving||moving; }
    if(size)size.style.transform='translate('+this.sizeX.x+'px,'+this.sizeY.x+'px)';
    moving = this.selectionJelly.step(dt, reduced) || moving;
    this.paintSelection();
    return moving;
  }
  /** 浮卡仅缩放材质，正文单独淡入；快速切换从正在显示的矩形续接。 */
  panel(element: HTMLElement, source: HTMLElement | null, open: boolean, contentKey: string) {
    // 点击另一种工具可能先关闭旧卡；旧卡仍回到自己的按钮，新卡再接入新来源。
    if(!open&&this.panelSource?.isConnected)source=this.panelSource;
    this.panelSource = source;
    if (this.panelElement !== element) {
      if (this.panelElement) this.resize.unobserve(this.panelElement);
      this.panelElement = element; this.resize.observe(element);
    }
    const version=++this.panelVersion,started=performance.now();
    const link=this.root.querySelector<SVGPathElement>('.liquid-panel-bridge path');
    const sourceRect=source?rect(source.getBoundingClientRect()):null;
    const target = rect(element.getBoundingClientRect()), skin = element.querySelector<HTMLElement>('.liquid-panel-skin')!;
    const content = element.querySelector<HTMLElement>('.liquid-panel-content')!;
    this.panelLayout = { actual: target, anchor: sourceRect };
    const origin = this.panelRect ?? sourceRect ?? target;
    // 主浮卡的正文更早融入外壳，材质也逐渐显现，避免先出现实心卡片再分段揭开内容。
    const surface = this.panelTransition ??= new SurfaceTransition(origin, this.panelOpacity, this.panelMaterial, .08, 1.5);
    if (open) surface.open(target, this.panelContent !== contentKey);
    else if(sourceRect)surface.closeTo(sourceRect);
    else surface.close();
    if (open) this.panelContent = contentKey;
    const advance = (elapsed: number, finish: boolean) => {
      const { actual, anchor } = this.panelLayout ?? { actual: target, anchor: sourceRect };
      if (open) surface.redirect(actual);
      else if(anchor)surface.redirect(anchor);
      if (finish) surface.finish(); else surface.step(elapsed);
      const box = this.panelRect = surface.box; this.panelOpacity = surface.alpha;
      // 材质和正文各自续接，提前关闭或切换不会跳亮或重新从透明开始。
      this.panelMaterial = surface.material;
      paintSurface(skin,content,box,actual,this.panelOpacity,this.panelMaterial);
      // 连接只短暂存在于按钮与浮卡的近邻间隙，不跨过正文或远距离拖动。
      if(link){
        let d='';
        if(anchor&&!this.clock.reduced&&!this.economy&&!this.root.dataset.motionDragging&&performance.now()-started<T.duration.bridge){
          d=panelBridge(anchor,box);
        }
        link.setAttribute('d',d);
        link.style.opacity=String(this.panelMaterial);
      }
      return surface.moving;
    };
    const settled = (completed: boolean) => {
      if (version !== this.panelVersion) return;
      link?.setAttribute('d', '');
      if (completed && !open) {
        this.panelRect = null; this.panelTransition = null; this.panelOpacity = this.panelMaterial = 0;
        this.resize.unobserve(element); this.panelElement = null; this.panelLayout = null;
      }
    };
    if(this.root.dataset.motionDragging || this.manualPanel){this.manualPanel=false;surface.snap(target,open);advance(0,true);settled(true);return Promise.resolve(true);}
    const result = this.clock.animate('panel', advance);
    void result.then(settled);
    return result;
  }
  /** 只有已确认业务成功的调用者才能请求成功收束；副本来自现有画布，绝不改写导出。 */
  async exit(kind: 'complete' | 'dismiss') {
    // 迟到的复制确认不能在不可见/尚未揭示时借“立即归位”提交成功隐藏。
    if (this.destroyed || !this.active || document.hidden) return false;
    // 快捷键提前完成时从准确轨道收束，不能把抛出途中姿态叠到退出变换上。
    if (this.entrance.moving) { this.entrance.finish(); this.paint(0, performance.now()); }
    this.restore();
    const sequence = ++this.exitSequence;
    this.root.dataset.motionExit = kind;
    this.paintSelection();
    this.root.querySelectorAll('.clay-notice,.clay-status').forEach(el => (el as HTMLElement).style.opacity = '0');
    const canvas = this.root.querySelector<HTMLCanvasElement>('canvas.lower-canvas');
    const frame = canvas ? rect(canvas.getBoundingClientRect()) : null;
    const done = this.rail.querySelector<HTMLElement>('[data-motion-action="done"]');
    const end = done ? rect(done.getBoundingClientRect()) : this.rr;
    if (kind === 'complete' && canvas && frame && frame.width>0 && frame.height>0 && !this.clock.reduced) {
      this.clone = document.createElement('canvas'); this.clone.className = 'liquid-image-copy';
      const ratio = Math.min(1, 2048 / Math.max(canvas.width, canvas.height));
      this.clone.width = Math.max(1, Math.round(canvas.width * ratio)); this.clone.height = Math.max(1, Math.round(canvas.height * ratio));
      this.clone.getContext('2d')?.drawImage(canvas, 0, 0, this.clone.width, this.clone.height);
      Object.assign(this.clone.style, { left: frame.x + 'px', top: frame.y + 'px', width: frame.width + 'px', height: frame.height + 'px' });
      this.root.append(this.clone);
    }
    const visual = this.root.querySelector<HTMLElement>('.clay-canvas-fixed,.clay-canvas-stage');
    const selection = this.root.querySelector<HTMLElement>('.clay-capture-selection');
    const mask = this.root.querySelector<SVGElement>('.clay-selection-mask');
    const panels = [...this.root.querySelectorAll<HTMLElement>('.clay-card,.clay-reader')];
    if(kind==='dismiss'&&selection&&!this.clock.reduced&&!this.economy){
      const box=selection.getBoundingClientRect();
      for(let index=0;index<6;index++){
        const crumb=document.createElement('i');crumb.className='liquid-crumb';
        Object.assign(crumb.style,{left:box.left+box.width*index/5+'px',top:box.bottom+'px'});this.root.append(crumb);
        const animation=crumb.animate([{opacity:.55,transform:'translateY(0) scale(1)'},{opacity:0,transform:'translateY(36px) scale(.4)'}],{duration:240,easing:'ease-in'});
        this.animations.add(animation);void animation.finished.catch(()=>{}).finally(()=>{crumb.remove();this.animations.delete(animation);});
      }
    }
    const completed = await this.clock.tween('exit', kind === 'complete' ? T.duration.confirmExit : 270, p => {
      const reduced = this.clock.reduced;
      if (this.clone && frame) {
        const scaleX = 1 + (28 / frame.width - 1) * p, scaleY = 1 + (28 / frame.height - 1) * p;
        this.clone.style.transform = 'translate(' + (end.x + end.width / 2 - frame.x - frame.width / 2) * p + 'px,' + (end.y + end.height / 2 - frame.y - frame.height / 2) * p + 'px) scale(' + scaleX + ',' + scaleY + ')';
        this.clone.style.opacity = String(1 - clamp((p - .7) / .3)); this.clone.style.borderRadius = p * 24 + 'px';
      }
      if (visual) { visual.style.opacity = this.clone ? '0' : String(1 - p); if (!reduced && kind === 'dismiss') visual.style.transform = 'translateY(' + 12 * p * p + 'px)'; }
      if (selection) selection.style.opacity = String(1 - p);
      if (mask) mask.style.opacity = String(1 - p);
      this.rail.style.opacity = String(1 - p);
      if (!reduced) this.rail.style.transform = kind === 'complete' ? 'translate(' + (end.x + end.width / 2 - this.rr.x - this.rr.width / 2) * p + 'px,0) scale(' + (1 - .86 * p) + ',' + (1 - .1 * p) + ')' : 'translateY(' + 18 * p * p + 'px) scaleY(' + (1 - .08 * p) + ')';
      for (const panel of panels) { panel.style.opacity = String(1 - p); if (!reduced) panel.style.transform = 'translateY(' + (kind === 'complete' ? -6 : 12) * p + 'px)'; }
    });
    return completed && !this.destroyed && this.exitSequence === sequence;
  }
  /** 失败、取消或旧文档失效时恢复可编辑现场；不会恢复已卸载的新会话。 */
  restore() {
    this.exitSequence++; this.clock.cancel('exit'); this.clone?.remove(); this.clone = null;
    this.root.querySelectorAll('.liquid-crumb').forEach(el=>el.remove());
    delete this.root.dataset.motionExit;
    this.root.querySelector<SVGPathElement>('.liquid-panel-bridge path')?.setAttribute('d','');
    this.rail.style.removeProperty('opacity'); this.rail.style.removeProperty('transform');
    this.root.querySelectorAll<HTMLElement>('.clay-canvas-fixed,.clay-canvas-stage,.clay-capture-selection,.clay-selection-mask,.clay-card,.clay-reader,.clay-notice,.clay-status').forEach(el => { el.style.removeProperty('opacity'); el.style.removeProperty('transform'); });
    this.paintSelection();
  }
  destroy() {
    this.restore(); this.destroyed = true; this.controls.destroy(); this.clock.dispose(); this.resize.disconnect(); this.mutation.disconnect();
    this.cleanup.forEach(clean => clean()); this.animations.forEach(animation => animation.cancel());
  }
}

/** 动效控制器随外壳卸载，宿主验帧完成后才启用；关闭版本由 React effect 清理保护。 */
export function useLiquidMotion(root: RefObject<HTMLDivElement | null>, rail: RefObject<HTMLDivElement | null>, presented: boolean, panel: string | null, visiblePanel: string | null, source: RefObject<HTMLButtonElement | null>, position: { x: number; y: number; width: number }, railPosition: {x:number;y:number}, selection: MotionRect | null, capture: MotionRect | null, onClosed: () => void) {
  const controller = useRef<LiquidMotion | null>(null);
  useLayoutEffect(() => {
    if (!root.current || !rail.current) return;
    const motion = controller.current = new LiquidMotion(root.current, rail.current); currentMotion = motion;
    return () => { if (currentMotion === motion) currentMotion = null; motion.destroy(); controller.current = null; };
  }, []);
  useLayoutEffect(() => { controller.current?.present(presented); }, [presented]);
  useLayoutEffect(()=>controller.current?.invalidate(),[railPosition.x,railPosition.y,position.x,position.y]);
  useLayoutEffect(()=>{controller.current?.selection(selection);},[selection?.x,selection?.y,selection?.width,selection?.height]);
  useLayoutEffect(()=>{controller.current?.selectionSkin(capture);},[capture?.x,capture?.y,capture?.width,capture?.height,presented]);
  useLayoutEffect(() => {
    if(!presented&&panel)return;
    const element = root.current?.querySelector<HTMLElement>('.clay-card');
    if (!element || !controller.current || panel && panel !== visiblePanel) return;
    let cancelled = false;
    void controller.current.panel(element, source.current, Boolean(panel), visiblePanel ?? '').then(completed => { if (completed && !cancelled && !panel) onClosed(); });
    return () => { cancelled = true; controller.current?.clock.cancel('panel'); };
  }, [panel, visiblePanel, source.current, position.x, position.y, position.width, presented]);
}
