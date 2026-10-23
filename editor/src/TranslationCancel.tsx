import { useId, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { MotionButton, presentationMotion } from './LiquidMotion';
import { clamp } from './motion';
import { motionSuspended, observeMotionScope } from './motionScope';

/** 取消按钮从翻译按钮右侧分出；收回期间只保留材质，立即停止接收输入。 */
export function TranslationCancel({ open, onCancel }: { open: boolean; onCancel: () => void }) {
  const [mounted, setMounted] = useState(open), slot = useRef<HTMLSpanElement>(null);
  const position = useRef(0), key = 'translation-cancel:' + useId();
  useLayoutEffect(() => { if (open) setMounted(true); }, [open]);
  useLayoutEffect(() => {
    const node = slot.current;
    if (!node || !mounted) return;
    const clock = presentationMotion(node)?.clock;
    let cancelled = false;
    const paint = (value: number) => {
      const progress = clamp(value); position.current = progress;
      node.style.width = `${44 * progress}px`;
      node.style.setProperty('--split-offset', `${-44 * (1 - progress)}px`);
      node.style.setProperty('--split-alpha', String(clamp(progress * 2.5)));
      node.style.setProperty('--split-neck', String(Math.sin(Math.PI * progress)));
    };
    const target = open ? 1 : 0;
    // 共用导轨时钟与系统减少动态偏好，隐藏时直接归位，不另开帧循环。
    const animation = !clock || motionSuspended(node)
      ? (paint(target), Promise.resolve(true))
      : clock.spring(key, paint, position.current, target, 'panel');
    const stop = observeMotionScope(node, suspended => { if (suspended) clock?.finish(key); });
    void animation.then(finished => { if (finished && !cancelled && !open) setMounted(false); });
    return () => { cancelled = true; stop(); };
  }, [open, mounted]);
  useLayoutEffect(() => () => { presentationMotion()?.clock.cancel(key); }, []);
  if (!mounted) return null;
  return <span ref={slot} className="clay-translation-cancel" inert={!open} aria-hidden={!open}>
    <svg className="clay-translation-neck" viewBox="0 0 28 20" aria-hidden="true"><path d="M0 0C8 0 8 7 14 7S20 0 28 0V20C20 20 20 13 14 13S8 20 0 20Z"/></svg>
    <span className="clay-translation-cancel-face"><MotionButton group="image" disabled={!open} data-tooltip="取消图片翻译" aria-label="取消图片翻译" onClick={onCancel}><X aria-hidden="true"/></MotionButton></span>
  </span>;
}
