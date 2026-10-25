import { clamp, MotionClock, MotionSpring } from './motion';

/** 参与材质点亮的控件：按钮、折叠标题、选区手柄、勾选框、滑杆与文本字段。 */
const lit = '[data-control-button],[data-motion-button],[data-selection-handle],summary,input,textarea,select';
/** 文本类字段以普通 :focus 点亮（输入时始终显示），其它控件只在键盘焦点可见时点亮。 */
const fields = 'input:not([type=checkbox]):not([type=range]):not([type=button]):not([type=submit]),textarea,select';
/** 写入 CSS 的通道：hover 悬停、focus 焦点、active 当前项（菜单高亮、aria-selected）、open 展开；turn 为未截断的展开进度，供箭头保留回弹。 */
type Light = { element: HTMLElement; target: HTMLElement; hover: MotionSpring; focus: MotionSpring; active: MotionSpring; open: MotionSpring; painted: string };

/**
 * 悬停、焦点、当前项与展开的材质变化统一由弹簧连续混合，不再由 :hover/:focus 规则或 CSS 过渡硬切。
 * 颜色与亮度通道用近临界阻尼的 body 弹簧并截断到 0..1，避免颜色越界；展开箭头另取未截断的 panel 弹簧。
 */
export class MaterialLight {
  private lights = new WeakMap<HTMLElement, Light>();
  private active = new Set<Light>();
  private hovered: Light | null = null;
  private cleanup: (() => void)[] = [];
  private observer: MutationObserver;

  constructor(private root: HTMLElement, private clock: MotionClock) {
    this.cleanup.push(clock.listen(dt => this.step(dt)));
    const listen = (target: EventTarget, name: string, handler: EventListener) => {
      target.addEventListener(name, handler, true); this.cleanup.push(() => target.removeEventListener(name, handler, true));
    };
    const owner = (event: Event) => event.target instanceof Element ? event.target.closest<HTMLElement>(lit) : null;
    listen(root, 'pointerover', event => {
      // 触摸没有悬停语义，抬起后不能留下点亮的材质。
      if ((event as PointerEvent).pointerType === 'touch') return;
      const element = owner(event), next = element && this.usable(element) ? this.light(element) : null;
      if (next === this.hovered) return;
      if (this.hovered) { this.hovered.hover.to = 0; this.wake(this.hovered); }
      this.hovered = next;
      if (next) { next.hover.to = 1; this.wake(next); }
    });
    listen(root, 'pointerleave', () => { if (this.hovered) { this.hovered.hover.to = 0; this.wake(this.hovered); } this.hovered = null; });
    listen(root, 'focusin', event => {
      const element = owner(event);
      if (element && (element.matches(':focus-visible') || element.matches(fields))) { const light = this.light(element); light.focus.to = 1; this.wake(light); }
    });
    listen(root, 'focusout', event => {
      const element = owner(event), light = element && this.lights.get(element);
      if (light) { light.focus.to = 0; this.wake(light); }
    });
    // 窗口失焦不保留悬停；焦点交由 focusout 处理。
    const blur = (event: Event) => { if (event.target === window && this.hovered) { this.hovered.hover.to = 0; this.wake(this.hovered); this.hovered = null; } };
    window.addEventListener('blur', blur); this.cleanup.push(() => window.removeEventListener('blur', blur));
    this.observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes' && record.target instanceof HTMLElement && record.target.matches(lit)) {
          const light = this.light(record.target); this.aim(light); this.wake(light);
          // 禁用时卸下悬停与焦点，不保留点亮的旧材质。
          if (!this.usable(record.target)) { light.hover.to = light.focus.to = 0; if (this.hovered === light) this.hovered = null; }
        } else if (record.type === 'childList') {
          // 新出现的控件按当前属性直接落在对应材质，不从熄灭状态补播入场。
          for (const node of record.addedNodes) if (node instanceof HTMLElement) this.prime(node);
        }
      }
    });
    this.observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-selected', 'aria-expanded', 'disabled'] });
    this.prime(root);
  }

  private usable(element: HTMLElement) { return element.isConnected && !element.matches(':disabled') && !element.closest('[inert]'); }
  /** 范围滑杆的可见拇指与真实 input 是兄弟节点，变量写在外层 .clay-slider 上共享。 */
  private light(element: HTMLElement) {
    let light = this.lights.get(element);
    if (!light) {
      light = { element, target: element.closest<HTMLElement>('.clay-slider') ?? element, hover: new MotionSpring(), focus: new MotionSpring(), active: new MotionSpring(), open: new MotionSpring(), painted: '0,0,0,0,0' };
      this.aim(light); light.active.snap(light.active.to); light.open.snap(light.open.to);
      this.lights.set(element, light);
    }
    return light;
  }
  /** 当前项（菜单高亮、aria-selected）与展开状态由属性给出目标；按下态选择沿用各自的选中材质。 */
  private aim(light: Light) {
    const element = light.element;
    light.active.to = Number(element.classList.contains('is-active') || element.getAttribute('aria-selected') === 'true');
    light.open.to = Number(element.getAttribute('aria-expanded') === 'true');
  }
  /** 控件一出现就按当前属性建立静止状态，之后的属性变化才能从旧值连续过渡，而不是首次变化时直接跳到新值。 */
  private prime(scope: HTMLElement) {
    const nodes = scope.matches(lit) ? [scope] : [];
    nodes.push(...scope.querySelectorAll<HTMLElement>(lit));
    for (const node of nodes) this.paint(this.light(node));
  }
  private wake(light: Light) { this.active.add(light); this.clock.wake(); }
  private paint(light: Light) {
    const values = [clamp(light.hover.x), clamp(light.focus.x), clamp(light.active.x), clamp(light.open.x), light.open.x];
    const painted = values.join(',');
    if (painted === light.painted) return;
    light.painted = painted;
    const style = light.target.style;
    ['--lit-hover', '--lit-focus', '--lit-active', '--lit-open', '--lit-turn'].forEach((name, index) => style.setProperty(name, String(values[index])));
  }
  private step(dt: number) {
    for (const light of this.active) {
      if (!light.element.isConnected) { this.active.delete(light); continue; }
      const reduced = this.clock.reduced;
      for (const spring of [light.hover, light.focus, light.active]) { if (reduced) spring.snap(spring.to); else spring.step(dt, 'body'); }
      if (reduced) light.open.snap(light.open.to); else light.open.step(dt, 'panel');
      this.paint(light);
      if (!light.hover.moving && !light.focus.moving && !light.active.moving && !light.open.moving) this.active.delete(light);
    }
    return this.active.size > 0;
  }
  /** 隐藏、减少动态时直接到达当前语义终态，不留半亮材质。 */
  settle() {
    for (const light of this.active) { for (const spring of [light.hover, light.focus, light.active, light.open]) spring.snap(spring.to); this.paint(light); }
    this.active.clear();
  }
  destroy() { this.settle(); this.observer.disconnect(); this.cleanup.forEach(clean => clean()); }
}
