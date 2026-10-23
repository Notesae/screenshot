import { useLayoutEffect, useRef, type RefObject } from 'react';
import { native } from './bridge';
import { motionSuspended, observeMotionScope } from './motionScope';

// 全局递增序号与捕获身份一起拒绝旧外壳迟到的表现更新。
let sequence = 0;

/** 仅转发真正命中选区画布的鼠标坐标；动画仍由宿主弹簧驱动。 */
export function useBackdropMotion(root: RefObject<HTMLElement | null>, captureId: string | undefined, enabled: boolean, holding = false) {
  const policy=useRef({enabled,holding}),refreshPolicy=useRef(()=>{});
  policy.current={enabled,holding};
  useLayoutEffect(() => {
    if (!captureId || !native.available) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)'), fine = matchMedia('(hover: hover) and (pointer: fine)');
    let last = '', active = false, disposed = false;
    // 高频输入只保留最新坐标；宿主未应答时最多保留一个待发送点，不堆积请求。
    let frame = 0, inFlight = false;
    let pending: { clientX: number; clientY: number; canvas: HTMLCanvasElement } | null = null;
    // 清理尚未发送的输入，不因进入遮罩、浮卡或开始拖动而把背景回正。
    const cancelPointer = () => { pending = null; cancelAnimationFrame(frame); frame = 0; };
    const send = (allow: boolean, hold: boolean, pointer?: { x: number; y: number }) => {
      const state=allow+':'+hold;
      if (!pointer && last === state) return Promise.resolve();
      last = state;
      // 老宿主拒绝新表现消息时仍保持截图可用，不把失败冒充业务错误。
      return native.request('presentation.background', { captureId, sequence: ++sequence, enabled: allow, holding: hold, ...(pointer ? {pointer} : {}) }).then(()=>{},()=>{});
    };
    // 合并同帧输入并再次检查真实命中，避免排队期间浮卡展开后仍穿透到画布。
    const flushPointer = () => {
      frame = 0;
      const point = pending; pending = null;
      if (!point || disposed || !active || !policy.current.enabled || policy.current.holding) return;
      const canvas = point.canvas, editor = root.current;
      if (!canvas.isConnected || !editor?.contains(canvas) || document.elementFromPoint(point.clientX,point.clientY) !== canvas) return;
      // 与遮罩镂空使用同一个选区矩形；原位导入没有选区框时才使用自身画布。
      const area = editor.querySelector('.clay-capture-selection')?.getBoundingClientRect() ?? canvas.getBoundingClientRect();
      if (area.width <= 0 || area.height <= 0 || point.clientX < area.left || point.clientX >= area.right || point.clientY < area.top || point.clientY >= area.bottom) return;
      const pointer = { x: (point.clientX-area.left)/area.width*2-1, y: (point.clientY-area.top)/area.height*2-1 };
      inFlight = true;
      void send(true,false,pointer).finally(() => {
        inFlight = false;
        if (pending && !disposed && !frame) frame = requestAnimationFrame(flushPointer);
      });
    };
    // 只接受当前编辑器的截图 canvas；浮卡、轨道、控件、手柄和遮罩均不能提供跟随目标。
    const move = (event: PointerEvent) => {
      const canvas = event.target;
      if (!active || !policy.current.enabled || policy.current.holding || event.pointerType !== 'mouse' || event.buttons !== 0
          || !(canvas instanceof HTMLCanvasElement) || !root.current?.contains(canvas) || !canvas.closest('.clay-canvas-fixed')) { cancelPointer(); return; }
      pending = { clientX: event.clientX, clientY: event.clientY, canvas };
      if (!frame && !inFlight) frame = requestAnimationFrame(flushPointer);
    };
    const refresh = () => {
      active=!motionSuspended(root.current)&&!reduced.matches&&fine.matches
        &&!(navigator.hardwareConcurrency>0&&navigator.hardwareConcurrency<=2)&&!root.current?.dataset.motionExit;
      if (!active || !policy.current.enabled || policy.current.holding) cancelPointer();
      void send(active&&policy.current.enabled,active&&policy.current.holding);
    };
    refreshPolicy.current=refresh;
    const scope = observeMotionScope(root.current, refresh);
    const exit = new MutationObserver(refresh);
    if (root.current) exit.observe(root.current, { attributes: true, attributeFilter: ['data-motion-exit'] });
    // 遮罩设为不拦截命中，事件可能落到 body；在窗口捕获阶段也能及时丢弃这些输入。
    window.addEventListener('pointermove',move,{capture:true,passive:true});
    window.addEventListener('pointerdown',cancelPointer,true); window.addEventListener('blur',cancelPointer);
    reduced.addEventListener('change', refresh); fine.addEventListener('change', refresh);
    return () => {
      disposed = true; cancelPointer(); scope(); exit.disconnect();
      window.removeEventListener('pointermove',move,true); window.removeEventListener('pointerdown',cancelPointer,true); window.removeEventListener('blur',cancelPointer);
      reduced.removeEventListener('change', refresh); fine.removeEventListener('change', refresh); refreshPolicy.current=()=>{}; void send(false,false);
    };
  }, [root, captureId]);
  // 状态切换不销毁订阅，避免先发解除保持、再发保持导致中间一帧回正。
  useLayoutEffect(()=>refreshPolicy.current(),[enabled,holding]);
}
