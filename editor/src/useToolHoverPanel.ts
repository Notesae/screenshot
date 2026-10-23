import { useEffect, useRef, type RefObject } from 'react';
import { observeMotionScope } from './motionScope';

type Options = { enabled: boolean; open: (button: HTMLButtonElement) => void; close: () => void };
/** 悬停意图和业务点击分离；容许跨过按钮与卡片间隙，也覆盖卡片的取色/下拉浮层。 */
export function useToolHoverPanel(root: RefObject<HTMLElement | null>, options: Options) {
  const latest = useRef(options); latest.current = options;
  const clearTimers = useRef<() => void>(() => {}), suppress = useRef<HTMLButtonElement | null>(null);
  const dismiss = (button?: HTMLButtonElement | null) => { if (button) suppress.current = button; clearTimers.current(); latest.current.close(); };
  useEffect(() => {
    const node = root.current; if (!node) return;
    let opening: ReturnType<typeof setTimeout> | undefined, closing: ReturnType<typeof setTimeout> | undefined;
    let candidate: HTMLButtonElement | null = null, pressed = false, keyboard = false;
    const trigger = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLButtonElement>('[data-hover-panel]') : null;
    const inCard = (target: EventTarget | null) => target instanceof Element && !!target.closest('.clay-card:not(.is-closing),.clay-color-popover:not([inert]),.clay-select-menu:not([inert]),.clay-scrollbar');
    const editingField = () => {
      const focused=document.activeElement;
      // 鼠标调节滑杆留下的焦点不代表输入中；键盘操作的可见焦点仍保留参数入口。
      return inCard(focused)&&(focused?.matches('textarea,[contenteditable=true],input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button])')||keyboard&&focused?.matches(':focus-visible'));
    };
    const clear = () => { clearTimeout(opening); clearTimeout(closing); candidate = null; };
    clearTimers.current = clear;
    const closeSoon = () => {
      clearTimeout(opening); candidate = null; clearTimeout(closing);
      closing = setTimeout(() => {
        // 按住滑杆或正在键盘输入时不自动收回；下一次在画布按下会主动关闭。
        if (pressed || editingField()) return;
        latest.current.close();
      }, 260);
    };
    const enter = (event: Event) => {
      if (event instanceof PointerEvent && (event.pointerType !== 'mouse' || event.buttons)) return;
      const button = trigger(event.target);
      if (inCard(event.target)) { clear(); return; }
      if (!button) return;
      if (event instanceof FocusEvent && !button.matches(':focus-visible')) return;
      if (button === suppress.current || button === candidate || !latest.current.enabled || button.matches(':disabled') || button.closest('[inert]')) return;
      clear(); candidate = button;
      opening = setTimeout(() => {
        candidate = null;
        if (!latest.current.enabled || button === suppress.current || !button.isConnected || button.matches(':disabled') || button.closest('[inert]')) return;
        latest.current.open(button);
      }, event instanceof FocusEvent ? 0 : node.querySelector('.clay-card') ? 120 : 320);
    };
    const leave = (event: Event) => {
      const related = (event as PointerEvent | FocusEvent).relatedTarget;
      const button = trigger(event.target);
      if (button && related instanceof Node && button.contains(related)) return;
      if (suppress.current === button) suppress.current = null;
      if (inCard(related)) { clear(); return; }
      // 转向另一个工具的 pointerover 会替换待展开请求，旧卡继续显示到内容交接。
      if (trigger(related)) { clearTimeout(opening); clearTimeout(closing); candidate = null; return; }
      closeSoon();
    };
    const down = (event: Event) => {
      if (!(event.target instanceof Node) || !node.contains(event.target)) return;
      pressed = true;keyboard=false;
      if (inCard(event.target)) { clear(); return; }
      suppress.current = trigger(event.target); dismiss();
    };
    const up = (event: PointerEvent) => {
      if(!pressed)return;
      pressed=false;
      // 指针捕获期间 target 仍是滑杆；用松手的实际落点恢复跨隙收回计时。
      const target=document.elementFromPoint(event.clientX,event.clientY);
      if(event.type==='pointercancel'||!inCard(target)&&!trigger(target))closeSoon();
    };
    const blur = () => { pressed = false; suppress.current = null; dismiss(); };
    const key = () => { keyboard=true; };
    node.addEventListener('pointerover', enter); node.addEventListener('pointerout', leave);
    node.addEventListener('focusin', enter); node.addEventListener('focusout', leave);
    node.addEventListener('keydown',key);
    // 画布的 React 捕获处理会停止传播，因此在窗口捕获阶段先收起卡片。
    window.addEventListener('pointerdown', down, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true); window.addEventListener('blur', blur);
    const stop = observeMotionScope(node, hidden => { if (hidden) dismiss(); });
    return () => {
      clear(); stop(); clearTimers.current = () => {};
      node.removeEventListener('pointerover', enter); node.removeEventListener('pointerout', leave);
      node.removeEventListener('focusin', enter); node.removeEventListener('focusout', leave);
      node.removeEventListener('keydown',key);
      window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true); window.removeEventListener('blur', blur);
    };
  }, [root]);
  useEffect(() => { if (!options.enabled) dismiss(); }, [options.enabled]);
  return { dismiss };
}
