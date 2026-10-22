import { Children, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react';
import { MotionClock, motionTokens } from './motion';

/** 原生 details 语义与即时字段保持，只有容器高度做可重定向过渡。 */
export function MotionDetails({ children, open = false, ...props }: ComponentPropsWithoutRef<'details'>) {
  const parts = Children.toArray(children), [expanded, setExpanded] = useState(open);
  const element = useRef<HTMLDetailsElement>(null), clock = useRef<MotionClock | null>(null);
  const changing = useRef(false);
  useLayoutEffect(() => {
    const scheduler = clock.current = new MotionClock(), media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => scheduler.setReduced(media.matches);
    const hidden = () => { if (document.hidden) { scheduler.finish(); scheduler.stop(); } };
    if (element.current) element.current.open = open;
    update(); media.addEventListener('change', update); document.addEventListener('visibilitychange', hidden);
    return () => { media.removeEventListener('change', update); document.removeEventListener('visibilitychange', hidden); scheduler.dispose(); };
  }, []);
  // 以当前实测高度重定向，关闭结束后释放固定高度，避免嵌套折叠被裁掉。
  function toggle() {
    const node = element.current, scheduler = clock.current;
    if (!node || !scheduler) return;
    const next = !expanded, from = node.getBoundingClientRect().height;
    scheduler.cancel('height'); changing.current = true; node.open = true;
    node.style.height = 'auto';
    const style = getComputedStyle(node), summary = node.querySelector('summary')!;
    const target = next ? node.getBoundingClientRect().height : summary.getBoundingClientRect().height + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    setExpanded(next);
    // clip 不创建可滚动容器，展开期间聚焦字段不会产生伪滚动并误关外置弹层。
    void scheduler.tween('height', motionTokens.duration.disclosure, progress => { node.style.height = from + (target - from) * progress + 'px'; node.style.overflow = 'clip'; }).then(completed => {
      if (!completed) return;
      node.open = next; changing.current = false;
      node.style.removeProperty('height'); node.style.removeProperty('overflow');
    });
  }
  return <details {...props} ref={element} onToggle={() => { if (!changing.current && element.current) setExpanded(element.current.open); }} onClick={event => {
    if ((event.target as Element).closest('summary')?.parentElement === element.current) { event.preventDefault(); toggle(); }
  }}><summary aria-expanded={expanded}>{(parts[0] as { props?: { children?: React.ReactNode } })?.props?.children}</summary><div className="liquid-details-content" inert={!expanded}>{parts.slice(1)}</div></details>;
}
