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
    let candidate: HTMLButtonElement | null = null, pressed = false;
    const trigger = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLButtonElement>('[data-hover-panel]') : null;
    const inCard = (target: EventTarget | null) => target instanceof Element && !!target.closest('.clay-card:not(.is-closing),.clay-color-popover:not([inert]),.clay-select-menu:not([inert]),.clay-scrollbar');
    const clear = () => { clearTimeout(opening); clearTimeout(closing); candidate = null; };
    clearTimers.current = clear;
    const closeSoon = () => {
      clearTimeout(opening); candidate = null; clearTimeout(closing);
      closing = setTimeout(() => {
        // 按住滑杆或正在键盘输入时不自动收回；下一次在画布按下会主动关闭。
        if (pressed || inCard(document.activeElement) && document.activeElement?.matches('input,textarea,[contenteditable=true]')) return;
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
      pressed = true;
      if (inCard(event.target)) { clear(); return; }
      suppress.current = trigger(event.target); dismiss();
    };
    const up = () => { pressed = false; };
    const blur = () => { pressed = false; suppress.current = null; dismiss(); };
    node.addEventListener('pointerover', enter); node.addEventListener('pointerout', leave);
    node.addEventListener('focusin', enter); node.addEventListener('focusout', leave);
    // 画布的 React 捕获处理会停止传播，因此在窗口捕获阶段先收起卡片。
    window.addEventListener('pointerdown', down, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true); window.addEventListener('blur', blur);
    const stop = observeMotionScope(node, hidden => { if (hidden) dismiss(); });
    return () => {
      clear(); stop(); clearTimers.current = () => {};
      node.removeEventListener('pointerover', enter); node.removeEventListener('pointerout', leave);
      node.removeEventListener('focusin', enter); node.removeEventListener('focusout', leave);
      window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true); window.removeEventListener('blur', blur);
    };
  }, [root]);
  useEffect(() => { if (!options.enabled) dismiss(); }, [options.enabled]);
  return { dismiss };
}
