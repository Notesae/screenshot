import { useLayoutEffect, useRef, type ComponentPropsWithRef, type RefObject } from 'react';
import { clamp, liquidBridge, motionTokens as T, MotionClock, MotionSpring, type MotionRect } from './motion';

/** 固定语义槽位承接输入，材质与图文各自变形，避免按钮追着光标改变命中区。 */
export function MotionButton({ children, group = 'end', ...props }: ComponentPropsWithRef<'button'> & { group?: string }) {
  return <button {...props} data-motion-button="" data-motion-group={group}><span className="liquid-skin" aria-hidden="true"/><span className="liquid-glyph">{children}</span></button>;
}

/** 每个按钮的连续运动状态；矩形只来自未变形的语义槽位。 */
type Surface = { el: HTMLButtonElement; skin: HTMLElement; glyph: HTMLElement; group: string; rect: MotionRect; x: MotionSpring; y: MotionSpring; attention: MotionSpring; press: MotionSpring; birth: MotionSpring; due: number; faceX: number; faceY: number; radius: number };
/** 仅指向当前挂载的编辑外壳；卸载会使旧完成链取消，不接触文档或系统能力。 */
let currentMotion: LiquidMotion | null = null;
export function presentationMotion() { return currentMotion; }
const rect = (box: DOMRect): MotionRect => ({ x: box.left, y: box.top, width: box.width, height: box.height });

/** v2 的局部表现控制器：共享帧循环、稳定命中、短液桥和可中断退场。 */
export class LiquidMotion {
  readonly clock = new MotionClock();
  private nodes: Surface[] = [];
  private dirty = true;
  private active = false;
  private destroyed = false;
  private pointer = { x: 0, y: 0, inside: false };
  private pressed: Surface | null = null;
  private nearest: Surface | null = null;
  private bridge: { a: Surface; b: Surface; start: number } | null = null;
  private bridgeLast = -Infinity;
  private body = new MotionSpring(1);
  private bulge = new MotionSpring();
  // 底座沿注意力中心接收光与曲率，基础圆角仍由生产主题测量。
  private bodyLight = new MotionSpring();
  private railRadius = 0;
  private indicator = { x: new MotionSpring(), y: new MotionSpring(), width: new MotionSpring(), opacity: new MotionSpring() };
  private panelRect: MotionRect | null = null;
  private panelOpacity = 0;
  private panelMaterial = 0;
  private panelElement: HTMLElement | null = null;
  private panelVersion = 0;
  // 尺寸读数即时变化，只有胶囊外壳保留 5/4px 以内的短惯性。
  private sizePosition: MotionRect | null = null;
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
    this.clock.onIdle = () => { root.dataset.motionState = 'sleep'; };
    this.clock.listen((dt, time) => this.paint(dt, time));
    const invalidate = () => { this.dirty = true; this.wake(); };
    this.resize = new ResizeObserver(invalidate); this.resize.observe(rail); this.resize.observe(root);
    this.mutation = new MutationObserver(invalidate);
    this.mutation.observe(rail, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-pressed', 'aria-expanded'] });
    const listen = (target: EventTarget, name: string, fn: EventListener, capture = false) => {
      target.addEventListener(name, fn, capture); this.cleanup.push(() => target.removeEventListener(name, fn, capture));
    };
    listen(root, 'pointermove', ((event: PointerEvent) => {
      this.pointer = { x: event.clientX, y: event.clientY, inside: event.pointerType === 'mouse' && !(event.target as Element).closest('.clay-card,.clay-reader,.clay-select-menu,.clay-color-popover') };
      this.wake();
    }) as EventListener);
    listen(root, 'pointerleave', () => { this.pointer.inside = false; this.wake(); });
    // 鼠标与键盘走同一按压反馈；冻结迎向目标，不移动语义命中槽位。
    const press = (button: Element | null) => {
      const node = this.nodes.find(n => n.el === button);
      if (!node || node.el.matches(':disabled')) return;
      this.pressed = node; node.press.to = 1;
      node.x.to = node.x.x; node.y.to = node.y.x; node.x.v = node.y.v = 0;
      const index = this.nodes.indexOf(node);
      for (const offset of [-1, 1]) {
        const neighbor = this.nodes[index + offset];
        if (!this.clock.reduced && neighbor && node.group !== 'end' && neighbor.group === node.group && !neighbor.el.matches(':disabled')) neighbor.y.v += T.press.neighborImpulse;
      }
      this.wake();
    };
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
      if (document.hidden) {
        this.pointer.inside = false; release();
        // 先取消业务退出，再结束表现过渡，避免隐藏时误发完成或留下半张浮卡。
        this.restore(); this.clock.finish(); this.clock.stop();
        this.animations.forEach(animation => animation.cancel());
      } else invalidate();
    });
    listen(root, 'keydown', ((event: KeyboardEvent) => {
      if (event.key === 'Escape' && root.dataset.motionExit) { event.preventDefault(); event.stopImmediatePropagation(); this.restore(); }
    }) as EventListener, true);
    const updateReduced = () => {
      root.dataset.motionReduced = String(this.reduced.matches);
      if (this.reduced.matches) { for (const animation of this.animations) animation.finish(); this.bridge = null; }
      this.clock.setReduced(this.reduced.matches); this.wake();
    };
    this.reduced.addEventListener('change', updateReduced);
    this.cleanup.push(() => this.reduced.removeEventListener('change', updateReduced));
    updateReduced();
  }
  invalidate(){this.dirty=true;this.wake();}
  private wake() { if (!this.destroyed && !document.hidden) { this.root.dataset.motionState = 'awake'; this.clock.wake(); } }
  /** 只在宿主真正撤挡后入场；挂起旧截图时取消时间线，不提前消费动画。 */
  present(presented: boolean) {
    if (this.active === presented) return;
    this.active = presented;
    if (!presented) { this.restore(); this.clock.finish(); this.clock.stop(); return; }
    this.measure();
    this.body.snap(this.clock.reduced ? 1 : .06); this.body.to = 1;
    const now = performance.now();
    for (const [index, node] of this.nodes.entries()) {
      node.birth.snap(this.clock.reduced ? 1 : 0); node.birth.to = 1;
      node.due = now + (node.el.dataset.motionAction === 'done' ? 0 : (this.nodes.length - index) * T.duration.enterStagger);
    }
    if (!this.clock.reduced) {
      this.decorate(this.rail.querySelector<HTMLElement>('.liquid-sweep'), [{ opacity: 0, transform: 'translateX(-110%)' }, { opacity: .22, offset: .3 }, { opacity: 0, transform: 'translateX(110%)' }], T.duration.sweep);
      this.decorate(this.root.querySelector<HTMLElement>('.clay-capture-selection'), [{ boxShadow: '0 0 0 0 var(--clay-selection)' }, { boxShadow: '0 0 0 12px transparent' }], T.duration.pulse);
    }
    this.wake();
  }
  private decorate(element: HTMLElement | null, keyframes: Keyframe[], duration: number) {
    if (!element || this.economy || this.clock.reduced) return;
    const animation = element.animate(keyframes, { duration, easing: 'ease-out' });
    this.animations.add(animation);
    void animation.finished.catch(() => {}).finally(() => this.animations.delete(animation));
  }
  /** 缓存固定槽位，滚动和布局变化才重新测量；绝不测量变形后的材质作新目标。 */
  private measure() {
    this.rr = rect(this.rail.getBoundingClientRect());
    this.railRadius = parseFloat(getComputedStyle(this.rail).borderTopLeftRadius) || 0;
    const existing = new Map(this.nodes.map(node => [node.el, node]));
    this.nodes = [...this.rail.querySelectorAll<HTMLButtonElement>('[data-motion-button]')].map(el => {
      const box = el.getBoundingClientRect();
      const node = existing.get(el) ?? { el, skin: el.querySelector<HTMLElement>('.liquid-skin')!, glyph: el.querySelector<HTMLElement>('.liquid-glyph')!, group: el.dataset.motionGroup || 'end', x: new MotionSpring(), y: new MotionSpring(), attention: new MotionSpring(), press: new MotionSpring(), birth: new MotionSpring(1), due: 0, faceX: 0, faceY: 0, radius: 0, rect: rect(box) };
      node.radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      node.rect = { x: box.left - this.rr.x, y: box.top - this.rr.y, width: box.width, height: box.height };
      return node;
    });
    this.dirty = false;
  }
  selection(box: MotionRect | null) {
    if (box && this.sizePosition && !this.clock.reduced) {
      this.sizeX.x = clamp(this.sizeX.x + this.sizePosition.x - box.x, -5, 5);
      this.sizeY.x = clamp(this.sizeY.x + this.sizePosition.y - box.y, -4, 4);
    }
    this.sizePosition = box; this.wake();
  }
  private usable(node: Surface) {
    const r = node.rect;
    return !node.el.matches(':disabled') && r.width > 0 && r.height > 0 && r.x >= -1 && r.y >= -1 && r.x + r.width <= this.rr.width + 1 && r.y + r.height <= this.rr.height + 1;
  }
  /** 主轨、图标、蓝色选中面和局部桥共用一帧；静止后不保留后台循环。 */
  private paint(dt: number, time: number) {
    if (!this.active || this.root.dataset.motionExit) return false;
    if (this.dirty) this.measure();
    this.root.dataset.motionFrames = String(this.clock.frames); this.root.dataset.motionState = 'awake';
    const reduced = this.clock.reduced, pointer = this.pointer;
    const reacting = !reduced && pointer.inside && !this.pressed && this.fine.matches && !this.root.inert && !this.root.dataset.motionDragging;
    const radius = T.field.radius;
    const distance = (node: Surface) => Math.hypot(pointer.x - this.rr.x - node.rect.x - node.rect.width / 2, pointer.y - this.rr.y - node.rect.y - node.rect.height / 2);
    const near = reacting ? this.nodes.filter(node => this.usable(node) && distance(node) < radius).sort((a, b) => distance(a) - distance(b))[0] : undefined;
    if (near && near !== this.nearest) {
      const previous = this.nearest;
      if (previous && this.usable(previous) && previous.group === near.group && near.group !== 'end' && Math.abs(this.nodes.indexOf(previous) - this.nodes.indexOf(near)) === 1 && time - this.bridgeLast >= T.duration.bridgeCooldown && !this.economy) {
        this.bridge = { a: previous, b: near, start: time }; this.bridgeLast = time;
      }
    }
    this.nearest = near ?? null;
    let moving = false, sum = 0, center = 0;
    const done = this.nodes.find(node => node.el.dataset.motionAction === 'done');
    const endpoint = done ? done.rect.x + done.rect.width / 2 : this.rr.width - 32;
    for (const [index, node] of this.nodes.entries()) {
      let attention = 0, dx = 0, dy = 0;
      if (near && this.usable(node)) {
        attention = Math.pow(clamp(1 - distance(node) / radius), 2);
        const delta = Math.abs(index - this.nodes.indexOf(near));
        if (node.group === near.group && node.group !== 'end') attention = Math.max(attention, Math.pow(1 - distance(near) / radius, 2) * (delta === 1 ? T.field.neighbor1 : delta === 2 ? T.field.neighbor2 : 0));
        dx = clamp((pointer.x - this.rr.x - node.rect.x - node.rect.width / 2) / (node.rect.width * .7), -1, 1);
        dy = clamp((pointer.y - this.rr.y - node.rect.y - node.rect.height / 2) / (node.rect.height * .7), -1, 1);
      }
      if (this.pressed !== node) { node.attention.to = attention; node.x.to = dx * attention * T.field.shiftX; node.y.to = dy * attention * T.field.shiftY; }
      const preset = near === node ? 'attention' : 'neighbor';
      if (reduced) { node.x.snap(0); node.y.snap(0); node.attention.snap(0); node.press.snap(0); node.birth.snap(1); }
      else {
        node.x.step(dt, preset); node.y.step(dt, preset); node.attention.step(dt, preset); node.press.step(dt, 'press');
        if (time >= node.due) node.birth.step(dt, 'entry');
      }
      const a = node.attention.x, p = node.press.x, birth = node.birth.x;
      const limit = Math.min(1, T.field.maxShift / (Math.hypot(node.x.x, node.y.x) || 1));
      const x = node.faceX = node.x.x * limit, y = node.faceY = node.y.x * limit;
      const entryX = (endpoint - node.rect.x - node.rect.width / 2) * (1 - birth), entryY = -25 * (1 - birth);
      node.skin.style.transform = 'translate(' + (x + entryX) + 'px,' + (y + entryY) + 'px) scale(' + (Math.max(.02, birth) * (1 + T.field.stretch * a * .6 + (T.press.x - 1) * p)) + ',' + (Math.max(.02, birth) * (1 + T.field.stretch * a * (Math.abs(dy) - .3) + (T.press.y - 1) * p)) + ')';
      node.glyph.style.transform = 'translate(' + (x * T.field.iconRatio + entryX) + 'px,' + (y * T.field.iconRatio + entryY + p * 1.2) + 'px) rotate(' + ((1 - birth) * -22) + 'deg)';
      node.skin.style.opacity = node.glyph.style.opacity = String(clamp(birth * 1.7));
      node.skin.style.borderRadius = [node.radius + dx*a*3,node.radius - dx*a*2,node.radius + dx*a*2,node.radius - dx*a*3].map(value => Math.max(0,value)+'px').join(' ');
      node.skin.style.setProperty('--liquid-light', String(this.economy ? 0 : clamp(a * .95, 0, .8)));
      node.skin.style.setProperty('--liquid-light-y', clamp((pointer.y - this.rr.y - node.rect.y) / node.rect.height * 100, 0, 100) + '%');
      node.skin.style.setProperty('--liquid-light-x', clamp((pointer.x - this.rr.x - node.rect.x) / node.rect.width * 100, 0, 100) + '%');
      node.el.dataset.motionReady = String(birth >= .85);
      for (const spring of [node.x, node.y, node.attention, node.press, node.birth]) moving = spring.moving || moving;
      sum += a; center += (node.rect.x + node.rect.width/2)*a;
    }
    this.bulge.to = near ? clamp((pointer.y - this.rr.y - this.rr.height / 2) / this.rr.height, -1, 1) * T.field.bodyBulge * Math.min(sum, 1.2) : 0;
    this.bodyLight.to = sum ? center/sum : this.rr.width/2;
    if (reduced) { this.body.snap(1); this.bulge.snap(0); this.bodyLight.snap(this.rr.width/2); } else { this.body.step(dt, 'entry'); this.bulge.step(dt, 'body'); this.bodyLight.step(dt, 'body'); }
    const body = this.rail.querySelector<HTMLElement>('.liquid-rail-body')!;
    body.style.transform = 'scale(' + this.body.x + ',' + (.92 + .08 * this.body.x) + ') skewX(' + this.bulge.x * .35 + 'deg)';
    body.style.borderRadius = [this.railRadius+Math.max(0,-this.bulge.x),this.railRadius+Math.max(0,this.bulge.x),this.railRadius,this.railRadius].map(value => value+'px').join(' ');
    body.style.setProperty('--liquid-body-light-x',this.bodyLight.x+'px');
    body.style.setProperty('--liquid-body-light',String(reduced||this.economy?0:Math.min(1,sum)));
    moving = this.body.moving || this.bulge.moving || this.bodyLight.moving || moving;
    const selected = this.nodes.find(node => node.el.getAttribute('aria-pressed') === 'true' && this.usable(node));
    const ind = this.indicator;
    ind.opacity.to = selected ? 1 : 0;
    if (selected) {
      ind.x.to = selected.rect.x + selected.faceX; ind.y.to = selected.rect.y + selected.faceY; ind.width.to = selected.rect.width;
      if (!ind.opacity.x || reduced) { ind.x.snap(ind.x.to); ind.y.snap(ind.y.to); ind.width.snap(ind.width.to); }
    }
    for (const spring of Object.values(ind)) { if (reduced) spring.snap(spring.to); else spring.step(dt, 'indicator'); moving = spring.moving || moving; }
    const blob = this.rail.querySelector<HTMLElement>('.liquid-active')!;
    Object.assign(blob.style, { width: ind.width.x + 'px', height: (selected?.rect.height ?? 36) + 'px', opacity: String(ind.opacity.x), transform: 'translate(' + ind.x.x + 'px,' + ind.y.x + 'px) scale(' + (1 + Math.min(.24, Math.abs(ind.x.v) / 1800)) + ',' + (1 - Math.min(.13, Math.abs(ind.x.v) / 3300)) + ')' });
    const path = this.rail.querySelector<SVGPathElement>('.liquid-bridge path')!;
    if (this.bridge && !reduced && !this.economy && this.usable(this.bridge.a) && this.usable(this.bridge.b)) {
      const progress = clamp((time - this.bridge.start) / T.duration.bridge);
      const a = this.bridge.a, b = this.bridge.b;
      path.setAttribute('d', liquidBridge({ ...a.rect, x: a.rect.x + a.faceX, y: a.rect.y + a.faceY }, { ...b.rect, x: b.rect.x + b.faceX, y: b.rect.y + b.faceY }, T.bridge.neck * (1 - progress)));
      path.style.opacity = String(Math.sin(Math.PI * progress) * T.bridge.opacity);
      if (progress === 1) this.bridge = null; else moving = true;
    } else { path.setAttribute('d', ''); this.bridge = null; }
    const panel=this.root.querySelector<HTMLElement>('.clay-card:not(.is-closing)');
    if(panel&&!this.clock.has('panel'))this.panelRect=rect(panel.getBoundingClientRect());
    const size = this.root.querySelector<HTMLElement>('.clay-selection-size');
    for (const spring of [this.sizeX,this.sizeY]) { if(reduced)spring.snap(0);else spring.step(dt,'neighbor');moving=spring.moving||moving; }
    if(size)size.style.transform='translate('+this.sizeX.x+'px,'+this.sizeY.x+'px)';
    return moving;
  }
  /** 浮卡仅缩放材质，正文单独淡入；快速切换从正在显示的矩形续接。 */
  panel(element: HTMLElement, source: HTMLElement | null, open: boolean) {
    if (this.panelElement !== element) {
      if (this.panelElement) this.resize.unobserve(this.panelElement);
      this.panelElement = element; this.resize.observe(element);
    }
    const version=++this.panelVersion,started=performance.now();
    const link=this.root.querySelector<SVGPathElement>('.liquid-panel-bridge path');
    const sourceRect=source?rect(source.getBoundingClientRect()):null;
    const target = rect(element.getBoundingClientRect()), skin = element.querySelector<HTMLElement>('.liquid-panel-skin')!;
    const content = element.querySelector<HTMLElement>('.liquid-panel-content')!;
    const origin = this.panelRect ?? (source ? rect(source.getBoundingClientRect()) : target);
    const destination = open ? target : source ? rect(source.getBoundingClientRect()) : { ...origin, y: origin.y + 8 };
    const alpha = this.panelOpacity, material = this.panelMaterial;
    this.clock.cancel('panel');
    const paint = (value: number) => {
      const p = clamp(value), box = { x: origin.x + (destination.x - origin.x) * p, y: origin.y + (destination.y - origin.y) * p, width: origin.width + (destination.width - origin.width) * p, height: origin.height + (destination.height - origin.height) * p };
      this.panelRect = box; this.panelOpacity = open ? alpha + (1 - alpha) * clamp((p - .35) / .65) : alpha * (1 - p);
      skin.style.transform = 'translate(' + (box.x - target.x) + 'px,' + (box.y - target.y) + 'px) scale(' + Math.max(.01, box.width / target.width) + ',' + Math.max(.01, box.height / target.height) + ')';
      // 材质和正文各自续接，提前关闭或切换不会跳亮或重新从透明开始。
      this.panelMaterial = open ? material + (1 - material) * clamp(p * 4) : material * (1 - p);
      skin.style.opacity = String(this.panelMaterial);
      content.style.opacity = String(this.panelOpacity);
      // 连接只短暂存在于按钮与浮卡的近邻间隙，不跨过正文或远距离拖动。
      if(link){
        let d='';
        if(open&&sourceRect&&!this.clock.reduced&&!this.economy&&!this.root.dataset.motionDragging&&performance.now()-started<T.duration.bridge){
          const above=sourceRect.y>box.y+box.height;
          const gap=above?sourceRect.y-box.y-box.height:box.y-sourceRect.y-sourceRect.height;
          const x1=sourceRect.x+sourceRect.width/2,x2=clamp(x1,box.x+12,box.x+box.width-12);
          const y1=above?sourceRect.y:sourceRect.y+sourceRect.height,y2=above?box.y+box.height:box.y;
          if(gap>=0&&Math.hypot(gap,x1-x2)<=T.bridge.panelMaxGap){const mid=(y1+y2)/2;d='M'+(x1-7)+' '+y1+'C'+(x1-4)+' '+mid+' '+(x2-4)+' '+mid+' '+(x2-9)+' '+y2+'L'+(x2+9)+' '+y2+'C'+(x2+4)+' '+mid+' '+(x1+4)+' '+mid+' '+(x1+7)+' '+y1+'Z';}
        }
        link.setAttribute('d',d);
      }
    };
    if(this.root.dataset.motionDragging){paint(1);return Promise.resolve(true);}
    const result = open ? this.clock.spring('panel', paint, 0, 1, 'panel') : this.clock.tween('panel', 170, paint);
    void result.then(completed => {
      if (version !== this.panelVersion) return;
      link?.setAttribute('d', '');
      if (completed && !open) {
        this.panelRect = null; this.panelOpacity = this.panelMaterial = 0;
        this.resize.unobserve(element); this.panelElement = null;
      }
    });
    return result;
  }
  /** 只有已确认业务成功的调用者才能请求成功收束；副本来自现有画布，绝不改写导出。 */
  async exit(kind: 'complete' | 'dismiss') {
    if (this.destroyed || !this.active) return !this.destroyed;
    this.restore();
    const sequence = ++this.exitSequence;
    this.root.dataset.motionExit = kind;
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
  }
  destroy() {
    this.restore(); this.destroyed = true; this.clock.dispose(); this.resize.disconnect(); this.mutation.disconnect();
    this.cleanup.forEach(clean => clean()); this.animations.forEach(animation => animation.cancel());
  }
}

/** 动效控制器随外壳卸载，宿主验帧完成后才启用；关闭版本由 React effect 清理保护。 */
export function useLiquidMotion(root: RefObject<HTMLDivElement | null>, rail: RefObject<HTMLDivElement | null>, presented: boolean, panel: string | null, visiblePanel: string | null, source: RefObject<HTMLButtonElement | null>, position: { x: number; y: number; width: number }, railPosition: {x:number;y:number}, selection: MotionRect | null, onClosed: () => void) {
  const controller = useRef<LiquidMotion | null>(null);
  useLayoutEffect(() => {
    if (!root.current || !rail.current) return;
    const motion = controller.current = new LiquidMotion(root.current, rail.current); currentMotion = motion;
    return () => { if (currentMotion === motion) currentMotion = null; motion.destroy(); controller.current = null; };
  }, []);
  useLayoutEffect(() => { controller.current?.present(presented); }, [presented]);
  useLayoutEffect(()=>controller.current?.invalidate(),[railPosition.x,railPosition.y,position.x,position.y]);
  useLayoutEffect(()=>{controller.current?.selection(selection);},[selection?.x,selection?.y,selection?.width,selection?.height]);
  useLayoutEffect(() => {
    if(!presented)return;
    const element = root.current?.querySelector<HTMLElement>('.clay-card');
    if (!element || !controller.current || panel && panel !== visiblePanel) return;
    let cancelled = false;
    void controller.current.panel(element, source.current, Boolean(panel)).then(completed => { if (completed && !cancelled && !panel) onClosed(); });
    return () => { cancelled = true; controller.current?.clock.cancel('panel'); };
  }, [panel, visiblePanel, position.x, position.y, position.width, presented]);
}
