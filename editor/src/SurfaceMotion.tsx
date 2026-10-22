import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { presentationMotion } from './LiquidMotion';
import { clamp, MotionClock, type MotionRect } from './motion';

/** 小弹层保留到退场结束；只形变材质，正文和交互矩形始终使用最终布局。 */
export function useSurfaceMotion(open: boolean, element: RefObject<HTMLElement | null>, origin: HTMLElement | null = null, geometry = '') {
  const [mounted, setMounted] = useState(open), id = useId();
  const state = useRef<{ box: MotionRect | null; alpha: number; material: number; open: boolean }>({ box: null, alpha: 0, material: 0, open: false });
  const owned = useRef<MotionClock | null>(null), scheduler = useRef<MotionClock | null>(null);
  const key = 'surface:' + id;
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => owned.current?.setReduced(media.matches);
    const hidden = () => { if (document.hidden) { owned.current?.finish(); owned.current?.stop(); } };
    media.addEventListener('change', update); document.addEventListener('visibilitychange', hidden);
    return () => { media.removeEventListener('change', update); document.removeEventListener('visibilitychange', hidden); scheduler.current?.cancel(key); owned.current?.dispose(); };
  }, []);
  useLayoutEffect(() => { if (open) setMounted(true); }, [open]);
  useLayoutEffect(() => {
    const node = element.current;
    if (!mounted) return;
    // 文档切换或撤销可能先移除宿主节点；清空保留状态，避免重做时闪现旧阅读层。
    if (!node) {
      scheduler.current?.cancel(key); state.current = { box: null, alpha: 0, material: 0, open: false };
      if (!open) setMounted(false);
      return;
    }
    const clock = scheduler.current = presentationMotion()?.clock ?? (owned.current ??= new MotionClock());
    if (clock === owned.current) clock.setReduced(matchMedia('(prefers-reduced-motion: reduce)').matches);
    const skin = node.querySelector<HTMLElement>(':scope > .liquid-surface-skin');
    const content = node.querySelector<HTMLElement>(':scope > .liquid-surface-content');
    if (!skin || !content) return;
    let cancelled = false;
    const box = (): MotionRect => {
      const rect = node.getBoundingClientRect();
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    };
    const target = box(), wasOpen = state.current.open;
    state.current.open = open;
    const anchor = origin?.getBoundingClientRect();
    const first = anchor ? { x: anchor.left, y: anchor.top, width: anchor.width, height: anchor.height } : { ...target, y: target.y - 6, width: target.width * .96, height: target.height * .94 };
    const start = state.current.box ?? first, alpha = state.current.alpha, material = state.current.material;
    const destination = open ? target : { ...target, y: target.y + (anchor && anchor.top < target.y ? -6 : 6), width: target.width * .98, height: target.height * .97 };
    /** 仅给材质写 transform/opacity，内容独立淡入，不缩放输入或长文字。 */
    const paint = (progress: number) => {
      const goal = open ? box() : destination;
      const p = clamp(progress, -.05, 1.05), current = {
        x: start.x + (goal.x - start.x) * p, y: start.y + (goal.y - start.y) * p,
        width: start.width + (goal.width - start.width) * p, height: start.height + (goal.height - start.height) * p,
      };
      const actual = box();
      state.current.box = current;
      state.current.alpha = open ? alpha + (1 - alpha) * clamp((p - .25) / .75) : alpha * (1 - p);
      skin.style.transform = 'translate(' + (current.x - actual.x) + 'px,' + (current.y - actual.y) + 'px) scale(' + Math.max(.01, current.width / Math.max(1, actual.width)) + ',' + Math.max(.01, current.height / Math.max(1, actual.height)) + ')';
      state.current.material = open ? material + (1-material)*clamp(p*4) : material*(1-clamp(p));
      skin.style.opacity = String(state.current.material);
      content.style.opacity = String(state.current.alpha);
    };
    /** 手动移动或展开内容时随真实矩形更新，不能从形变后的材质反推布局。 */
    const settled = () => {
      state.current.box = box(); state.current.alpha = state.current.material = open ? 1 : 0;
      skin.style.transform = 'none'; skin.style.opacity = content.style.opacity = open ? '1' : '0';
    };
    if (open && wasOpen && !clock.has(key) && alpha === 1) {
      settled(); node.dataset.motionPhase = 'open';
    } else {
      clock.cancel(key); node.dataset.motionPhase = open ? 'entering' : 'closing';
      const motion = open ? clock.spring(key, paint, 0, 1, 'panel') : clock.tween(key, 170, paint);
      void motion.then(() => {
        if (cancelled) return;
        settled(); node.dataset.motionPhase = open ? 'open' : 'closed';
        if (!open) { state.current.box = null; setMounted(false); }
      });
    }
    // 手动拖动/键盘调整先结束材质过渡，随后几何变化直接跟随真实槽位。
    const manual = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null, handle = target?.closest('[data-surface-drag]');
      const control = target?.closest('button,input,select,textarea');
      if (!open || !handle || control && control !== handle) return;
      if (event instanceof KeyboardEvent && !event.key.startsWith('Arrow') || event instanceof PointerEvent && event.button !== 0) return;
      clock.cancel(key); settled(); node.dataset.motionPhase = 'open';
    };
    node.addEventListener('pointerdown', manual, true); node.addEventListener('keydown', manual, true);
    const observer = new ResizeObserver(() => { if (!clock.has(key) && open) settled(); });
    observer.observe(node);
    return () => { cancelled = true; observer.disconnect(); node.removeEventListener('pointerdown', manual, true); node.removeEventListener('keydown', manual, true); };
  }, [open, mounted, origin, geometry]);
  return mounted;
}
