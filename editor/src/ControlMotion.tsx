import type { ComponentPropsWithRef } from 'react';
import { clamp, MotionClock, MotionSpring, motionTokens as T } from './motion';

/** 普通控件与主轨一样保留固定槽位；材质形变，正文只平移。 */
export function ControlButton({ children, ...props }: ComponentPropsWithRef<'button'>) {
  return <button {...props} data-control-button=""><span className="control-skin" aria-hidden="true"><span className="control-selection"/></span><span className="control-content">{children}</span></button>;
}

type ControlState = { element: HTMLButtonElement | HTMLInputElement; x: MotionSpring; y: MotionSpring; press: MotionSpring; selected:MotionSpring; down: boolean };

/** 所有面板、菜单和滑杆共用外壳时钟，仅把尚未停稳的控件放进活动列表。 */
export class ControlFeedback {
  private states = new WeakMap<HTMLElement, ControlState>();
  private active = new Set<ControlState>();
  private hovered: ControlState | null = null;
  private held: ControlState | null = null;
  private presented = false;
  private cleanup: (() => void)[] = [];
  private observer: MutationObserver;

  constructor(private root: HTMLElement, private clock: MotionClock) {
    this.cleanup.push(clock.listen(dt => this.paint(dt)));
    const listen = (target: EventTarget, name: string, handler: EventListener) => {
      target.addEventListener(name, handler, true); this.cleanup.push(() => target.removeEventListener(name, handler, true));
    };
    const control = (event: Event) => {
      const element = event.target instanceof Element ? event.target.closest<HTMLButtonElement | HTMLInputElement>('[data-control-button],[data-selection-handle],input[type=range],input[type=checkbox]') : null;
      return this.presented && element && root.contains(element) ? element : null;
    };
    listen(root, 'pointermove', ((event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || this.clock.reduced) return;
      const element = control(event);
      if (!element || !this.usable(element)) { this.leave(); return; }
      const state = this.state(element);
      if (this.hovered !== state) this.leave();
      this.hovered = state;
      if (state.down || element instanceof HTMLInputElement || element.hasAttribute('data-selection-handle')) return;
      const box = element.getBoundingClientRect();
      state.x.to = clamp((event.clientX - box.left - box.width / 2) / Math.max(1, box.width), -1, 1) * 2;
      state.y.to = clamp((event.clientY - box.top - box.height / 2) / Math.max(1, box.height), -1, 1) * 2;
      this.wake(state);
    }) as EventListener);
    listen(root, 'pointerout', event => { const related = (event as PointerEvent).relatedTarget; if (!this.hovered?.element.contains(related as Node | null)) this.leave(); });
    // 选区在 React 捕获阶段接管手势；先观察输入，反馈不拦截业务事件。
    listen(window, 'pointerdown', ((event: PointerEvent) => { if (event.button === 0) this.press(control(event)); }) as EventListener);
    listen(window, 'keydown', ((event: KeyboardEvent) => {
      if (event.repeat || event.isComposing) return;
      const element = control(event), range = element instanceof HTMLInputElement && element.type === 'range';
      const accepted = range || element?.hasAttribute('data-selection-handle') ? /^(Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(event.key) : element instanceof HTMLInputElement ? event.key === ' ' : event.key === ' ' || event.key === 'Enter';
      if (accepted) this.press(element);
    }) as EventListener);
    listen(window, 'pointerup', () => this.release()); listen(window, 'pointercancel', () => this.release());
    listen(window, 'keyup', ((event: KeyboardEvent) => { if (/^( |Enter|Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(event.key)) this.release(); }) as EventListener);
    // 捕获阶段也会看见字段之间的 blur；只有真正离开窗口才取消按压。
    listen(window, 'blur', event => { if (event.target === window) this.reset(); });
    this.observer = new MutationObserver(records => {
      // 滑块到达预设时语义即时选中，材质和标识沿同一弹簧点亮；离开该档也保留退场。
      for(const record of records)if(record.type==='attributes'&&record.attributeName==='aria-pressed'&&record.target instanceof HTMLButtonElement&&record.target.hasAttribute('data-soft-selection')){
        const state=this.state(record.target);state.selected.to=Number(record.target.getAttribute('aria-pressed')==='true');this.wake(state);
      }
      if(records.some(record=>record.type==='childList'))this.prepareSelections();
      for (const state of new Set([...this.active, ...(this.held ? [this.held] : []), ...(this.hovered ? [this.hovered] : [])])) {
        if (!this.usable(state.element)) this.clear(state);
      }
    });
    this.observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'inert','aria-pressed'] });
    this.prepareSelections();
  }
  private usable(element: HTMLElement) { return element.isConnected && !element.matches(':disabled') && !element.closest('[inert]'); }
  private state(element: HTMLButtonElement | HTMLInputElement) {
    let state = this.states.get(element);
    if (!state) { state = { element, x: new MotionSpring(), y: new MotionSpring(), press: new MotionSpring(),selected:new MotionSpring(Number(element.getAttribute('aria-pressed')==='true')), down: false }; this.states.set(element, state); }
    return state;
  }
  private wake(state: ControlState) { this.active.add(state); this.clock.wake(); }
  private prepareSelections(){for(const element of this.root.querySelectorAll<HTMLButtonElement>('[data-soft-selection]'))if(!this.states.has(element))this.draw(this.state(element));}
  private leave() { if (this.hovered && !this.hovered.down) { this.hovered.x.to = this.hovered.y.to = 0; this.wake(this.hovered); } this.hovered = null; }
  private press(element: HTMLButtonElement | HTMLInputElement | null) {
    if (!element || !this.usable(element)) return;
    this.release(); const state = this.held = this.state(element);
    state.down = true; state.press.to = 1; state.x.to = state.x.x; state.y.to = state.y.x; this.wake(state);
  }
  private release() { if (this.held) { this.held.down = false; this.held.press.to = this.held.x.to = this.held.y.to = 0; this.wake(this.held); } this.held = null; }
  private clear(state: ControlState) {
    state.x.snap(0); state.y.snap(0); state.press.snap(0);state.selected.snap(Number(state.element.getAttribute('aria-pressed')==='true')); state.down = false; this.draw(state); this.active.delete(state);
    if (this.held === state) this.held = null; if (this.hovered === state) this.hovered = null;
  }
  /** 系统减少动态、隐藏或控件卸载时立即复位，不能遗留凹下的材质。 */
  reset() { for (const state of new Set([...this.active, ...(this.held ? [this.held] : []), ...(this.hovered ? [this.hovered] : [])])) this.clear(state); }
  present(presented: boolean) { this.presented = presented; if (!presented) this.reset(); }
  private draw(state: ControlState) {
    const x = state.x.x, y = state.y.x, p = state.press.x;
    if(state.element.hasAttribute('data-soft-selection')){
      state.element.style.setProperty('--control-selected',String(clamp(state.selected.x)));
      state.element.style.setProperty('--control-selection-pull',String(clamp(state.selected.v*.018,-.13,.13)));
    }
    if (state.element.hasAttribute('data-selection-handle')) {
      state.element.style.setProperty('--handle-scale-x', String(1 + (T.press.x - 1) * p));
      state.element.style.setProperty('--handle-scale-y', String(1 + (T.press.y - 1) * p)); return;
    }
    if (state.element instanceof HTMLInputElement) {
      const range = state.element.type === 'range', prefix = range ? '--range-scale-' : '--check-scale-';
      state.element.style.setProperty(prefix + 'x', String(1 + (range ? .12 : T.press.x - 1) * p));
      state.element.style.setProperty(prefix + 'y', String(1 + (range ? -.12 : T.press.y - 1) * p)); return;
    }
    const skin = state.element.querySelector<HTMLElement>('.control-skin'), content = state.element.querySelector<HTMLElement>('.control-content');
    if (skin) skin.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + (1 + (T.press.x - 1) * p) + ',' + (1 + (T.press.y - 1) * p) + ')';
    if (content) content.style.transform = 'translate(' + x * T.field.iconRatio + 'px,' + (y * T.field.iconRatio + p * 1.2) + 'px)';
  }
  private paint(dt: number) {
    for (const state of this.active) {
      if (this.clock.reduced || !this.usable(state.element)) { this.clear(state); continue; }
      state.x.step(dt, 'attention'); state.y.step(dt, 'attention'); state.press.step(dt, 'press');state.selected.step(dt,'selection'); this.draw(state);
      if (!state.x.moving && !state.y.moving && !state.press.moving&&!state.selected.moving) this.active.delete(state);
    }
    return this.active.size > 0;
  }
  destroy() { this.reset(); this.observer.disconnect(); this.cleanup.forEach(clean => clean()); }
}
