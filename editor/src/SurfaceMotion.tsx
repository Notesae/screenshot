import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { presentationMotion } from './LiquidMotion';
import { MotionClock, type MotionRect } from './motion';
import { SurfaceTransition } from './surfaceTransition';
import { paintSurface } from './surfacePaint';
import { motionSuspended, observeMotionScope } from './motionScope';

/** 小弹层保留到退场结束；正文随材质平移，但不拉伸文字或控件。 */
export function useSurfaceMotion(open: boolean, element: RefObject<HTMLElement | null>, origin: HTMLElement | null = null, geometry = '') {
  const [mounted, setMounted] = useState(open), id = useId();
  const transition = useRef<SurfaceTransition | null>(null), wasOpen = useRef(false), manualPlacement = useRef(false);
  const owned = useRef<MotionClock | null>(null), scheduler = useRef<MotionClock | null>(null);
  const key = 'surface:' + id;
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => owned.current?.setReduced(media.matches);
    media.addEventListener('change', update);
    return () => { media.removeEventListener('change', update); scheduler.current?.cancel(key); owned.current?.dispose(); };
  }, []);
  useLayoutEffect(() => { if (open) setMounted(true); }, [open]);
  useLayoutEffect(() => {
    const node = element.current;
    if (!mounted) return;
    // 文档切换或撤销可能先移除宿主节点；清空保留状态，避免重做时闪现旧阅读层。
    if (!node) {
      scheduler.current?.cancel(key); transition.current = null; wasOpen.current = false;
      if (!open) setMounted(false);
      return;
    }
    const clock = presentationMotion(node)?.clock ?? (owned.current ??= new MotionClock());
    if (scheduler.current !== clock) scheduler.current?.cancel(key);
    scheduler.current = clock;
    if (owned.current && clock !== owned.current) { owned.current.dispose(); owned.current = null; }
    if (clock === owned.current) { clock.setSuspended(motionSuspended(node)); clock.setReduced(matchMedia('(prefers-reduced-motion: reduce)').matches); }
    const skin = node.querySelector<HTMLElement>(':scope > .liquid-surface-skin');
    const content = node.querySelector<HTMLElement>(':scope > .liquid-surface-content');
    if (!skin || !content) return;
    const stopScope = observeMotionScope(node, suspended => {
      if (clock === owned.current) clock.setSuspended(suspended);
      else if (suspended) clock.finish(key);
    });
    let cancelled = false;
    const box = (): MotionRect => {
      const rect = node.getBoundingClientRect();
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    };
    const target = box();
    if (wasOpen.current !== open) manualPlacement.current = false;
    wasOpen.current = open;
    // 已有表面展开后只消费目标几何；初始化和收回仍实时测量来源。
    const anchor = !open || !transition.current ? origin?.getBoundingClientRect() : undefined;
    const first = anchor ? { x: anchor.left, y: anchor.top, width: anchor.width, height: anchor.height } : { ...target, y: target.y - 6, width: target.width * .96, height: target.height * .94 };
    const surface = transition.current ??= new SurfaceTransition(first);
    if (open) surface.open(target);
    else if(anchor)surface.closeTo({x:anchor.left,y:anchor.top,width:anchor.width,height:anchor.height});
    else surface.close();
    /** 正文随材质平移但不缩放，动态尺寸和切换不会先跳到最终位置。 */
    const paint = (actual: MotionRect) => {
      const current = surface.box;
      paintSurface(skin,content,current,actual,surface.alpha,surface.material);
    };
    /** 手动移动或展开内容时随真实矩形更新，不能从形变后的材质反推布局。 */
    const settled = () => {
      surface.snap(box(), open);
      skin.style.transform = 'none'; skin.style.opacity = content.style.opacity = open ? '1' : '0';
      content.style.transform='none';content.style.clipPath='none';
    };
    const run = () => {
      node.dataset.motionPhase = open ? 'entering' : 'closing';
      const advance = (elapsed: number, finish: boolean) => {
        const actual = box();
        if (open) surface.redirect(actual);
        else if(origin?.isConnected){const anchor=origin.getBoundingClientRect();surface.redirect({x:anchor.x,y:anchor.y,width:anchor.width,height:anchor.height});}
        if (finish) surface.finish(); else surface.step(elapsed);
        paint(actual); return surface.moving;
      };
      clock.cancel(key);
      const motion = motionSuspended(node) ? (advance(0, true), Promise.resolve(true)) : clock.animate(key, advance);
      void motion.then(completed => {
        if (!completed || cancelled) return;
        settled(); node.dataset.motionPhase = open ? 'open' : 'closed';
        if (!open) { transition.current = null; setMounted(false); }
      });
    };
    if (open && manualPlacement.current) { settled(); node.dataset.motionPhase = 'open'; } else run();
    // 手动拖动/键盘调整先结束材质过渡，随后几何变化直接跟随真实槽位。
    const manual = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null, handle = target?.closest('[data-surface-drag]');
      const control = target?.closest('button,input,select,textarea');
      if (!open || !handle || control && control !== handle) return;
      if (event instanceof KeyboardEvent && !event.key.startsWith('Arrow') || event instanceof PointerEvent && event.button !== 0) return;
      manualPlacement.current = true; clock.cancel(key); settled(); node.dataset.motionPhase = 'open';
    };
    node.addEventListener('pointerdown', manual, true); node.addEventListener('keydown', manual, true);
    const observer = new ResizeObserver(() => {
      if (!open) return;
      if (manualPlacement.current) settled();
      else {
        const actual = box(); surface.redirect(actual); paint(actual);
        if (!clock.has(key) && surface.moving) run();
      }
    });
    observer.observe(node);
    return () => { cancelled = true; observer.disconnect(); stopScope(); node.removeEventListener('pointerdown', manual, true); node.removeEventListener('keydown', manual, true); };
  }, [open, mounted, origin, geometry]);
  return mounted;
}
