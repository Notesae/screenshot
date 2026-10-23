import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { presentationMotion } from './LiquidMotion';
import { motionSuspended, observeMotionScope } from './motionScope';

/** 外壳持续运动，旧正文先淡出再交接；快速切换只保留最新请求和当前透明度。 */
export function usePanelPage<T extends { key: string }>(requested: T | null, root: RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState<T | null>(null), page = useRef<HTMLDivElement>(null);
  const latest = useRef(requested), retained = useRef(visible), alpha = useRef(1), shift = useRef(0);
  latest.current = requested;
  if (visible && requested?.key === visible.key) retained.current = requested;
  const shown = visible ? retained.current ?? visible : null;
  const switching = !!requested && requested.key !== visible?.key;

  useLayoutEffect(() => {
    const node = page.current, clock = presentationMotion(root.current)?.clock;
    const key = 'panel-page', desired = latest.current;
    if (!desired) { clock?.cancel(key); return; }
    if (!visible) { retained.current = desired; alpha.current = 1; shift.current = 0; setVisible(desired); return; }
    const change = desired.key !== visible.key;
    let cancelled = false;
    const paint = (value: number, offset: number) => {
      alpha.current = value; shift.current = offset;
      if (node) { node.style.opacity = String(value); node.style.transform = `translateY(${offset}px)`; }
    };
    const commit = () => {
      if (cancelled || !latest.current || !change) return;
      retained.current = latest.current; setVisible(latest.current);
    };
    if (!node || !clock || motionSuspended(root.current)) { paint(change ? 0 : 1, 0); commit(); return; }
    const from = alpha.current, to = change ? 0 : 1, start = shift.current, end = change ? -4 : 0;
    const run = clock.tween(key, change ? 90 : 170, p => paint(from + (to - from) * p, start + (end - start) * p));
    const stop = observeMotionScope(root.current, hidden => { if (hidden) clock.finish(key); });
    void run.then(completed => { if (completed) commit(); });
    return () => { cancelled = true; stop(); clock.cancel(key); };
  }, [requested?.key, visible?.key, root]);

  const closed = () => {
    if (latest.current) return;
    setVisible(null); retained.current = null; alpha.current = 1;
  };
  return { shown, switching, page, closed };
}
