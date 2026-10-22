import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSurfaceMotion } from './SurfaceMotion';
import { motionTokens } from './motion';

/** 统一鼠标与键盘提示；关闭立即解除说明关系，材质保留到退场结束。 */
export function TooltipLayer() {
  const anchor = useRef<HTMLSpanElement>(null), popup = useRef<HTMLDivElement>(null), id = useId();
  const [target, setTarget] = useState<HTMLElement | null>(null), [position, setPosition] = useState({ left: 0, top: 0 });
  // 只为退场保留最后一条提示，不继续追踪已离开的按钮。
  const retained = useRef<HTMLElement | null>(null), shown = target ?? retained.current;
  const mounted = useSurfaceMotion(!!target, popup, shown, position.left + ':' + position.top);
  useLayoutEffect(() => { if (target) retained.current = target; }, [target]);
  useEffect(() => { if (target && !target.isConnected) setTarget(null); });
  useEffect(() => {
    const root = anchor.current?.parentElement;
    if (!root) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let keyboard = false; // 键盘焦点提示不被无关表面的 pointerout 清除。
    const clear = () => { clearTimeout(timer); keyboard = false; setTarget(null); };
    const show = (event: Event) => {
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tooltip]') : null;
      if (!element || !root.contains(element)) return;
      keyboard = event.type === 'focusin';
      clearTimeout(timer); timer = setTimeout(() => setTarget(element), event.type === 'focusin' ? 0 : motionTokens.duration.tooltip);
    };
    const leave = (event: Event) => {
      if (event.type === 'pointerout' && keyboard) return;
      if (event.type === 'pointerout' && event.target instanceof Element && event.target.closest('[data-tooltip]')?.contains((event as PointerEvent).relatedTarget as Node | null)) return;
      clear();
    };
    root.addEventListener('pointerover', show); root.addEventListener('focusin', show);
    root.addEventListener('pointerout', leave); root.addEventListener('focusout', leave); root.addEventListener('pointerdown', clear); root.addEventListener('keydown', clear);
    window.addEventListener('resize', clear); window.addEventListener('scroll', clear, true);
    return () => { clearTimeout(timer); root.removeEventListener('pointerover', show); root.removeEventListener('focusin', show); root.removeEventListener('pointerout', leave); root.removeEventListener('focusout', leave); root.removeEventListener('pointerdown', clear); root.removeEventListener('keydown', clear); window.removeEventListener('resize', clear); window.removeEventListener('scroll', clear, true); };
  }, []);
  useLayoutEffect(() => {
    if (!target || !popup.current) return;
    const rect = target.getBoundingClientRect(), panel = popup.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(rect.left + (rect.width - panel.width) / 2, window.innerWidth - panel.width - 8)), top: Math.max(8, rect.bottom + panel.height + 14 < window.innerHeight ? rect.bottom + 6 : rect.top - panel.height - 6) });
  }, [target, mounted]);
  useLayoutEffect(() => {
    if (!target) return;
    const original = target.getAttribute('aria-describedby');
    target.setAttribute('aria-describedby', [original, id].filter(Boolean).join(' '));
    return () => { if (original) target.setAttribute('aria-describedby', original); else target.removeAttribute('aria-describedby'); };
  }, [target, id]);
  return <><span ref={anchor} hidden/>{mounted && shown && createPortal(<div ref={popup} id={id} role="tooltip" aria-hidden={!target} className="clay-tooltip" style={position}><div className="liquid-surface-skin" aria-hidden="true"/><div className="liquid-surface-content">{shown.dataset.tooltip}</div></div>, anchor.current?.parentElement ?? document.body)}</>;
}
