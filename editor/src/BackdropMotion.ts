import { useLayoutEffect, type RefObject } from 'react';
import { native } from './bridge';
import { motionSuspended, observeMotionScope } from './motionScope';

let sequence = 0;

/** 仅在状态变化时通知宿主；不发送指针、整屏像素或动画帧。 */
export function useBackdropMotion(root: RefObject<HTMLElement | null>, captureId: string | undefined, enabled: boolean) {
  useLayoutEffect(() => {
    if (!captureId || !native.available) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)'), fine = matchMedia('(hover: hover) and (pointer: fine)');
    let last: boolean | undefined;
    const send = (allow: boolean) => {
      if (last === allow) return;
      last = allow;
      // 老宿主拒绝新表现消息时仍保持截图可用，不把失败冒充业务错误。
      void native.request('presentation.background', { captureId, sequence: ++sequence, enabled: allow }).catch(() => {});
    };
    const refresh = () => send(enabled && !motionSuspended(root.current) && !reduced.matches && fine.matches
      && !(navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 2) && !root.current?.dataset.motionExit);
    const scope = observeMotionScope(root.current, refresh);
    const exit = new MutationObserver(refresh);
    if (root.current) exit.observe(root.current, { attributes: true, attributeFilter: ['data-motion-exit'] });
    reduced.addEventListener('change', refresh); fine.addEventListener('change', refresh);
    return () => {
      scope(); exit.disconnect(); reduced.removeEventListener('change', refresh); fine.removeEventListener('change', refresh); send(false);
    };
  }, [root, captureId, enabled]);
}
