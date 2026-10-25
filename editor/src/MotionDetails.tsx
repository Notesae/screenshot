import { Children, useId, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react';
import { MotionClock, MotionSpring } from './motion';
import { presentationMotion } from './LiquidMotion';
import { motionSuspended, observeMotionScope } from './motionScope';

/** 原生 details 语义与即时字段保持，只有容器高度做可重定向过渡。 */
export function MotionDetails({ children, open = false, ...props }: ComponentPropsWithoutRef<'details'>) {
  const parts = Children.toArray(children), [expanded, setExpanded] = useState(open);
  const element = useRef<HTMLDetailsElement>(null), clock = useRef<MotionClock | null>(null);
  const changing = useRef(false), schedulerRef = useRef<MotionClock | null>(null), version = useRef(0), logical = useRef(open);
  const key = 'details:' + useId();
  // 高度（px）与箭头翻转（0 收起、1 展开）各保留位置与速度，快速反向从当前状态续接。
  const height = useRef(new MotionSpring()), turn = useRef(new MotionSpring(Number(open)));
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => clock.current?.setReduced(media.matches);
    const stopScope = observeMotionScope(element.current, suspended => {
      clock.current?.setSuspended(suspended);
      if (suspended) schedulerRef.current?.finish(key);
    });
    if (element.current) { element.current.open = open; element.current.querySelector('summary')?.style.setProperty('--details-turn', String(Number(open))); }
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
    const next = logical.current = !logical.current, current = ++version.current;
    // 过渡中反向时沿用弹簧当前高度与速度；静止时才以实测高度为起点。
    const spring = height.current, turning = turn.current;
    if (!scheduler.has(key)) spring.snap(node.getBoundingClientRect().height);
    scheduler.cancel(key); changing.current = true; node.open = true;
    node.style.height = 'auto';
    const style = getComputedStyle(node), summary = node.querySelector('summary')!;
    const closed = summary.getBoundingClientRect().height + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    spring.to = next ? node.getBoundingClientRect().height : closed; turning.to = Number(next);
    setExpanded(next);
    // clip 不创建可滚动容器，展开期间聚焦字段不会产生伪滚动并误关外置弹层。
    // 裁切方式整段过渡固定，只写一次，避免每帧重复触发样式观察。
    node.style.overflow = 'clip'; node.dataset.motionRunning = 'true';
    // 高度用近临界阻尼，不撑出空白也不抖动下方内容；箭头单独带回弹。收起不低于标题行，避免把摘要裁掉。
    const paint = () => { node.style.height = Math.max(closed, spring.x) + 'px'; summary.style.setProperty('--details-turn', String(turning.x)); };
    const advance = (elapsed: number, finish: boolean) => {
      if (finish) { spring.snap(spring.to); turning.snap(turning.to); }
      else { spring.step(elapsed, 'toolLayout'); turning.step(elapsed, 'panel'); }
      paint(); return spring.moving || turning.moving;
    };
    const motion = motionSuspended(node) ? (advance(0, true), Promise.resolve(true)) : scheduler.animate(key, advance);
    void motion.then(completed => {
      if (!completed || current !== version.current) return;
      node.open = next; changing.current = false;
      node.style.removeProperty('height'); node.style.removeProperty('overflow'); delete node.dataset.motionRunning;
    });
  }
  return <details {...props} ref={element} onToggle={() => {
    if (!changing.current && element.current) {
      // 非点击触发的开合（脚本或查找跳转）直接落到对应终态，箭头与高度不残留过渡。
      logical.current = element.current.open; setExpanded(element.current.open);
      turn.current.snap(Number(element.current.open)); element.current.querySelector('summary')?.style.setProperty('--details-turn', String(turn.current.x));
    }
  }} onClick={event => {
    if ((event.target as Element).closest('summary')?.parentElement === element.current) { event.preventDefault(); toggle(); }
  }}><summary aria-expanded={expanded}>{(parts[0] as { props?: { children?: React.ReactNode } })?.props?.children}</summary><div className="liquid-details-content" inert={!expanded}>{parts.slice(1)}</div></details>;
}
