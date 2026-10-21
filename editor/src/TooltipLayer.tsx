import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** 统一鼠标与键盘提示，不使用浏览器无法换肤的 title 弹层。 */
export function TooltipLayer() {
  const anchor = useRef<HTMLSpanElement>(null), popup = useRef<HTMLDivElement>(null), id = useId();
  const [target, setTarget] = useState<HTMLElement | null>(null), [position, setPosition] = useState({ left: 0, top: 0 });
  useEffect(() => { if (target && !target.isConnected) setTarget(null); });
  useEffect(() => {
    const root = anchor.current?.parentElement;
    if (!root) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => { clearTimeout(timer); setTarget(null); };
    const show = (event: Event) => {
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tooltip]') : null;
      if (!element || !root.contains(element)) return;
      clearTimeout(timer); timer = setTimeout(() => setTarget(element), event.type === 'focusin' ? 0 : 500);
    };
    const leave = (event: Event) => {
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
    const original = target.getAttribute('aria-describedby');
    target.setAttribute('aria-describedby', [original, id].filter(Boolean).join(' '));
    return () => { if (original) target.setAttribute('aria-describedby', original); else target.removeAttribute('aria-describedby'); };
  }, [target, id]);
  return <><span ref={anchor} hidden/>{target && createPortal(<div ref={popup} id={id} role="tooltip" className="clay-tooltip" style={position}>{target.dataset.tooltip}</div>, anchor.current?.parentElement ?? document.body)}</>;
}
