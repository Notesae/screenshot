import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { presentationMotion } from './LiquidMotion';
import { motionSuspended, observeMotionScope } from './motionScope';
import { clamp, MotionSpring } from './motion';
import { settleMotion } from './surfaceTransition';

/** 外壳持续运动，旧正文先淡出再交接；快速切换只保留最新请求和当前透明度。 */
export function usePanelPage<T extends { key: string }>(requested: T | null, root: RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState<T | null>(null), page = useRef<HTMLDivElement>(null);
  const latest = useRef(requested), retained = useRef(visible);
  const alpha = useRef(new MotionSpring(1)), shift = useRef(new MotionSpring());
  latest.current = requested;
  if (visible && requested?.key === visible.key) retained.current = requested;
  const shown = visible ? retained.current ?? visible : null;
  const switching = !!requested && requested.key !== visible?.key;

  useLayoutEffect(() => {
    const node = page.current, clock = presentationMotion(root.current)?.clock;
    const key = 'panel-page', desired = latest.current;
    if (!desired) { clock?.cancel(key); return; }
    if (!visible) { retained.current = desired; alpha.current.snap(1); shift.current.snap(0); setVisible(desired); return; }
    const change = desired.key !== visible.key;
    let cancelled = false;
    const paint = () => {
      if (node) { node.style.opacity = String(clamp(alpha.current.x)); node.style.transform = `translateY(${shift.current.x}px)`; }
    };
    const commit = () => {
      if (cancelled || !latest.current || !change) return;
      retained.current = latest.current; setVisible(latest.current);
    };
    if (!node || !clock || motionSuspended(root.current)) { alpha.current.snap(change ? 0 : 1); shift.current.snap(0); paint(); commit(); return; }
    const to = change ? 0 : 1, end = change ? -4 : 0, duration = change ? .09 : .17;
    let elapsed = 0;
    const run = clock.animate(key, (dt, finish) => {
      const remaining = duration - elapsed;
      settleMotion(alpha.current, to, finish ? remaining : dt, remaining);
      settleMotion(shift.current, end, finish ? remaining : dt, remaining);
      if (alpha.current.x < 0 || alpha.current.x > 1) { alpha.current.x = clamp(alpha.current.x); alpha.current.v = 0; }
      elapsed += dt; paint(); return !finish && elapsed < duration;
    });
    const stop = observeMotionScope(root.current, hidden => { if (hidden) clock.finish(key); });
    void run.then(completed => { if (completed) commit(); });
    return () => { cancelled = true; stop(); clock.cancel(key); };
  }, [requested?.key, visible?.key, root]);

  const closed = () => {
    if (latest.current) return;
    setVisible(null); retained.current = null; alpha.current.snap(1); shift.current.snap(0);
  };
  return { shown, switching, page, closed };
}
