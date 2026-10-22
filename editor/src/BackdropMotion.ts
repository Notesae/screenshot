import { useLayoutEffect, useRef, type RefObject } from 'react';
import { native } from './bridge';
import { motionSuspended, observeMotionScope } from './motionScope';

let sequence = 0;

/** 仅在状态变化时通知宿主；不发送指针、整屏像素或动画帧。 */
export function useBackdropMotion(root: RefObject<HTMLElement | null>, captureId: string | undefined, enabled: boolean, holding = false) {
  const policy=useRef({enabled,holding}),refreshPolicy=useRef(()=>{});
  policy.current={enabled,holding};
  useLayoutEffect(() => {
    if (!captureId || !native.available) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)'), fine = matchMedia('(hover: hover) and (pointer: fine)');
    let last = '';
    const send = (allow: boolean, hold: boolean) => {
      const state=allow+':'+hold;
      if (last === state) return;
      last = state;
      // 老宿主拒绝新表现消息时仍保持截图可用，不把失败冒充业务错误。
      void native.request('presentation.background', { captureId, sequence: ++sequence, enabled: allow, holding: hold }).catch(() => {});
    };
    const refresh = () => {
      const active=!motionSuspended(root.current)&&!reduced.matches&&fine.matches
        &&!(navigator.hardwareConcurrency>0&&navigator.hardwareConcurrency<=2)&&!root.current?.dataset.motionExit;
      send(active&&policy.current.enabled,active&&policy.current.holding);
    };
    refreshPolicy.current=refresh;
    const scope = observeMotionScope(root.current, refresh);
    const exit = new MutationObserver(refresh);
    if (root.current) exit.observe(root.current, { attributes: true, attributeFilter: ['data-motion-exit'] });
    reduced.addEventListener('change', refresh); fine.addEventListener('change', refresh);
    return () => {
      scope(); exit.disconnect(); reduced.removeEventListener('change', refresh); fine.removeEventListener('change', refresh); refreshPolicy.current=()=>{}; send(false,false);
    };
  }, [root, captureId]);
  // 状态切换不销毁订阅，避免先发解除保持、再发保持导致中间一帧回正。
  useLayoutEffect(()=>refreshPolicy.current(),[enabled,holding]);
}
