import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { BookOpen, Languages, X } from 'lucide-react';
import { MotionButton, presentationMotion } from './LiquidMotion';
import { motionSuspended, observeMotionScope } from './motionScope';
import { SlimeSplit, splitGeometry, splitOutline } from './slimeSplit';

type Action = 'cancel' | 'read' | null;
type Props = {
  translating: boolean; translateDisabled: boolean; canRead: boolean; readDisabled: boolean; reading: boolean;
  readerTrigger: RefObject<HTMLButtonElement | null>; onTranslate: () => void; onCancel: () => void; onRead: () => void;
};

/** 翻译、取消和阅读归在同一工具组；换用途先融回，再从同一来源分裂。 */
export function TranslationTools(props: Props) {
  const desired: Action = props.translating ? 'cancel' : props.canRead ? 'read' : null;
  const [shown, setShown] = useState<Action>(desired), root = useRef<HTMLSpanElement>(null);
  const slot = useRef<HTMLSpanElement>(null), outline = useRef<SVGPathElement>(null);
  const motion = useRef(new SlimeSplit()), current = useRef(desired); current.current = desired;
  const id = useId().replace(/:/g, ''), key = 'translation-split:' + id;
  const active = shown !== null && desired === shown;
  useLayoutEffect(() => { if (desired && !shown) setShown(desired); }, [desired, shown]);
  useLayoutEffect(() => {
    const node = root.current, path = outline.current;
    if (!node || !path) return;
    const clock = presentationMotion(node)?.clock, open = shown !== null && shown === desired;
    const radius = parseFloat(getComputedStyle(node.querySelector('button')!).borderTopLeftRadius) || 12;
    let cancelled = false;
    motion.current.aim(open);
    const paint = () => {
      const state = motion.current, pose = state.pose;
      path.setAttribute('d', splitOutline(pose, radius));
      node.dataset.splitActive = String(state.moving);
      node.style.setProperty('--split-material', String(state.material));
      node.style.setProperty('--split-source-shift', `${3.4 * pose.strain}px`);
      node.style.setProperty('--split-offset', `${pose.distance - splitGeometry.distance}px`);
      node.style.setProperty('--split-alpha', String(pose.glyph));
      if (slot.current) {
        // 占位宽度只在阶段切换时变化一次；邻近按钮由轨道的同一弹簧补偿滑到新槽位，
        // 不再逐帧改布局而触发整条轨道同步测量与 React 重排。
        const width = state.layoutTarget;
        if (width !== null && slot.current.style.width !== width + 'px') {
          const rail = node.closest<HTMLElement>('.liquid-rail');
          if (rail) rail.dataset.layoutMotion = String(Number(rail.dataset.layoutMotion ?? 0) + 1);
          slot.current.style.width = width + 'px';
        }
        // 吸收后仍保留槽位到母体停稳，隐藏子控件，防止材质交还时再次露出底色。
        slot.current.style.visibility = pose.size > .001 ? 'visible' : 'hidden';
      }
    };
    const advance = (elapsed: number, finish: boolean) => {
      if (finish) motion.current.finish(open); else motion.current.step(elapsed);
      paint(); return motion.current.moving;
    };
    const animation = !clock || motionSuspended(node)
      ? (advance(0, true), Promise.resolve(true)) : clock.animate(key, advance);
    const stop = observeMotionScope(node, suspended => { if (suspended) clock?.finish(key); });
    void animation.then(finished => {
      if (finished && !cancelled && !open) setShown(current.current);
    });
    return () => { cancelled = true; stop(); };
  }, [desired, shown]);
  useLayoutEffect(() => () => { presentationMotion()?.clock.cancel(key); }, []);
  return <span ref={root} className="clay-translation-tools">
    <svg className="clay-translation-material" viewBox="-14 -12 140 60" aria-hidden="true">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="36" gradientUnits="userSpaceOnUse">
        <stop stopColor="var(--clay-raisedTop)"/><stop offset=".5" stopColor="var(--clay-raisedMid)"/><stop offset="1" stopColor="var(--clay-raisedBottom)"/>
      </linearGradient>
        {/* 对整片轮廓统一加内高光和底部暗部，连接处不叠加两套阴影。 */}
        <filter id={id + '-clay'} x="-14" y="-12" width="140" height="60" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceAlpha" stdDeviation="1.1" result="softEdge"/>
          <feOffset in="softEdge" dy="1.2" result="lowerEdge"/>
          <feComposite in="SourceAlpha" in2="lowerEdge" operator="out" result="topRim"/>
          <feFlood floodColor="var(--clay-raisedHighlight)" result="light"/>
          <feComposite in="light" in2="topRim" operator="in" result="highlight"/>
          <feOffset in="softEdge" dy="-1.8" result="upperEdge"/>
          <feComposite in="SourceAlpha" in2="upperEdge" operator="out" result="bottomRim"/>
          <feFlood floodColor="var(--clay-raisedShade)" result="shade"/>
          <feComposite in="shade" in2="bottomRim" operator="in" result="shadow"/>
          <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="shadow"/><feMergeNode in="highlight"/></feMerge>
        </filter>
      </defs><path ref={outline} fill={`url(#${id})`} filter={`url(#${id}-clay)`}/>
    </svg>
    <MotionButton group="image" data-icon-motion="translate" data-tooltip="翻译图片：将选区外语替换为中文" aria-label="翻译图片为中文" aria-busy={props.translating} disabled={props.translateDisabled} onClick={props.onTranslate}>
      <span className="clay-translation-source-glyph"><Languages aria-hidden="true"/></span>
    </MotionButton>
    {shown && <span ref={slot} className="clay-translation-split-slot" inert={!active} aria-hidden={!active}>
      <span className="clay-translation-split-face">
        <MotionButton group="image" data-icon-motion={shown} ref={shown === 'read' ? props.readerTrigger : undefined}
          disabled={!active || shown === 'read' && props.readDisabled} aria-label={shown === 'cancel' ? '取消图片翻译' : '阅读完整译文'}
          data-tooltip={shown === 'cancel' ? '取消图片翻译' : '阅读译文：放大查看完整译文'}
          aria-expanded={shown === 'read' ? props.reading : undefined} onClick={shown === 'cancel' ? props.onCancel : props.onRead}>
          {shown === 'cancel' ? <X aria-hidden="true"/> : <BookOpen aria-hidden="true"/>}
        </MotionButton>
      </span>
    </span>}
  </span>;
}
