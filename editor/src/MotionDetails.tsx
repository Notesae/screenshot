import { Children, useId, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react';
import { MotionClock, motionTokens } from './motion';
import { presentationMotion } from './LiquidMotion';
import { motionSuspended, observeMotionScope } from './motionScope';

/** 原生 details 语义与即时字段保持，只有容器高度做可重定向过渡。 */
export function MotionDetails({ children, open = false, ...props }: ComponentPropsWithoutRef<'details'>) {
  const parts = Children.toArray(children), [expanded, setExpanded] = useState(open);
  const element = useRef<HTMLDetailsElement>(null), clock = useRef<MotionClock | null>(null);
  const changing = useRef(false), schedulerRef = useRef<MotionClock | null>(null), version = useRef(0), logical = useRef(open);
  const key = 'details:' + useId();
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => clock.current?.setReduced(media.matches);
    const stopScope = observeMotionScope(element.current, suspended => {
      clock.current?.setSuspended(suspended);
      if (suspended) schedulerRef.current?.finish(key);
    });
    if (element.current) element.current.open = open;
    media.addEventListener('change', update);
    return () => { version.current++; stopScope(); media.removeEventListener('change', update); schedulerRef.current?.cancel(key); clock.current?.dispose(); };
  }, []);
  // 以当前实测高度重定向，关闭结束后释放固定高度，避免嵌套折叠被裁掉。
  function toggle() {
    const node = element.current;
    if (!node) return;
    const scheduler = presentationMotion(node)?.clock ?? (clock.current ??= new MotionClock());
    if (clock.current && scheduler !== clock.current) { clock.current.dispose(); clock.current = null; }
    if (scheduler === clock.current) { scheduler.setSuspended(motionSuspended(node)); scheduler.setReduced(matchMedia('(prefers-reduced-motion: reduce)').matches); }
    if (schedulerRef.current !== scheduler) schedulerRef.current?.cancel(key);
    schedulerRef.current = scheduler;
    const next = logical.current = !logical.current, from = node.getBoundingClientRect().height, current = ++version.current;
    scheduler.cancel(key); changing.current = true; node.open = true;
    node.style.height = 'auto';
    const style = getComputedStyle(node), summary = node.querySelector('summary')!;
    const target = next ? node.getBoundingClientRect().height : summary.getBoundingClientRect().height + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    setExpanded(next);
    // clip 不创建可滚动容器，展开期间聚焦字段不会产生伪滚动并误关外置弹层。
    // 裁切方式整段过渡固定，只写一次，避免每帧重复触发样式观察。
    node.style.overflow = 'clip';
    const paint = (progress: number) => { node.style.height = from + (target - from) * progress + 'px'; };
    const motion = motionSuspended(node) ? (paint(1), Promise.resolve(true)) : scheduler.tween(key, motionTokens.duration.disclosure, paint);
    void motion.then(completed => {
      if (!completed || current !== version.current) return;
      node.open = next; changing.current = false;
      node.style.removeProperty('height'); node.style.removeProperty('overflow');
    });
  }
  return <details {...props} ref={element} onToggle={() => { if (!changing.current && element.current) { logical.current = element.current.open; setExpanded(element.current.open); } }} onClick={event => {
    if ((event.target as Element).closest('summary')?.parentElement === element.current) { event.preventDefault(); toggle(); }
  }}><summary aria-expanded={expanded}>{(parts[0] as { props?: { children?: React.ReactNode } })?.props?.children}</summary><div className="liquid-details-content" inert={!expanded}>{parts.slice(1)}</div></details>;
}
