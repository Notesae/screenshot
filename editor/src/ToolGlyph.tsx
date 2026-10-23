import { useLayoutEffect, useRef } from 'react';
import type { AnnotationKind } from './document';
import { presentationMotion } from './LiquidMotion';
import { motionSuspended, observeMotionScope } from './motionScope';
import type { MotionClock } from './motion';

const outlines: Record<AnnotationKind, string[]> = {
  text: ['M5 6V4H19V6M12 4V20M8 20H16'],
  rect: ['M7 4H17Q20 4 20 7V17Q20 20 17 20H7Q4 20 4 17V7Q4 4 7 4Z'],
  ellipse: ['M20 12A8 8 0 1 1 4 12A8 8 0 1 1 20 12'],
  arrow: ['M4 20L17 7', 'M10 5L20 4L19 14L16 8Z'],
  brush: ['M4 19Q4 15 7 15Q10 15 9 18Q8 21 3 21Z', 'M8 15L17 4Q19 2 21 4Q22 5 20 7L10 17'],
  highlight: ['M5 14L13 4L20 9L12 19Z', 'M5 14L4 19L8 21L12 19', 'M3 22H14'],
  mosaic: ['M4 4H10V10H4ZM14 4H20V10H14Z', 'M4 14H10V20H4Z', 'M14 14H20V20H14Z'],
  cover: ['M4 5H20V19H4Z', 'M7 9H17M7 12H17M7 15H17']
};

/** 固定图标保留识别轮廓，前景按真实笔顺描画一次；复用主时钟，不持续闪烁。 */
export function ToolGlyph({ kind, animated = false }: { kind: AnnotationKind; animated?: boolean }) {
  const root = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    const svg = root.current, button = svg?.closest('button');
    if (!svg || !button || !animated) return;
    const key = 'tool-glyph:' + kind;
    let clock: MotionClock | undefined;
    const finish = () => { clock?.cancel(key); svg.style.removeProperty('--tool-draw'); };
    const play = (event:Event) => {
      const motion=presentationMotion(button);clock=motion?.clock;
      if (!clock || motion?.toolsTransitioning || clock.reduced || motionSuspended(button) || button.matches(':disabled') || button.closest('[inert]') || event.type==='focus'&&!button.matches(':focus-visible')) return;
      if(clock.has(key))return;
      void clock.tween(key, 380, progress => {
        svg.style.setProperty('--tool-draw', String(1 - Math.pow(1 - progress, 3)));
      });
    };
    // 点击的受力由整颗按钮负责；图标只在真实悬停/键盘焦点时描画，不独立上下摆动。
    button.addEventListener('pointerenter', play); button.addEventListener('focus', play);
    const stop = observeMotionScope(button, hidden => { if (hidden) finish(); });
    return () => { finish(); stop(); button.removeEventListener('pointerenter', play); button.removeEventListener('focus', play); };
  }, [kind, animated]);
  return <svg ref={root} className="annotation-tool-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <g opacity=".22">{outlines[kind].map((d, i) => <path key={i} d={d}/>)}</g>
    <g className="annotation-tool-ink">{outlines[kind].map((d, i) => <path key={i} d={d} pathLength="1"/>)}</g>
  </svg>;
}
