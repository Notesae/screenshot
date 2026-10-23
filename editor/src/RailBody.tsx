import { useId } from 'react';
import tokens from '../../design/soft-clay.tokens.json';

/** 轨道只有一份可弯曲材质；主题渐变、边缘明暗及投影复用同一条路径，不碰按钮或截图纹理。 */
export function RailBody() {
  // 实例独立的引用避免热更新或多个编辑外壳共用错误的轮廓；几何由共享动效时钟写入。
  const id = 'rail-' + useId().replace(/:/g, ''), outline = id + '-outline';
  return <span className="liquid-rail-body" aria-hidden="true">
    <svg className="liquid-rail-contour" focusable="false">
      <defs>
        <path id={outline} className="liquid-rail-outline"/>
        <linearGradient id={id + '-face'} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="var(--clay-surfaceTop)"/><stop offset=".35" stopColor="var(--clay-surfaceMid)"/>
          <stop offset=".7" stopColor="var(--clay-surfaceLow)"/><stop offset="1" stopColor="var(--clay-surfaceBase)"/>
        </linearGradient>
        <linearGradient id={id + '-rim'} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="var(--clay-highlight)"/><stop offset=".4" stopColor="var(--clay-highlight)" stopOpacity="0"/>
          <stop offset=".65" stopColor="var(--clay-shade)" stopOpacity="0"/><stop offset="1" stopColor="var(--clay-shade)"/>
        </linearGradient>
        <clipPath id={id + '-clip'}><use href={'#' + outline}/></clipPath>
        {/* 固定模糊半径只用于底座投影，不对工具、文字或冻结桌面应用滤镜。 */}
        <filter id={id + '-shadow'} className="liquid-rail-shadow" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feDropShadow in="SourceGraphic" dx="0" dy="24" stdDeviation="24" floodOpacity=".533" result="far"/>
          <feDropShadow in="SourceGraphic" dx="0" dy={tokens.shadow.depth} stdDeviation={tokens.shadow.blur / 2} floodOpacity={tokens.shadow.opacity} result="near"/>
          <feMerge><feMergeNode in="far"/><feMergeNode in="near"/></feMerge>
        </filter>
      </defs>
      <use className="liquid-rail-face" href={'#' + outline} fill={'url(#' + id + '-face)'} filter={'url(#' + id + '-shadow)'}/>
      <use href={'#' + outline} fill="none" stroke={'url(#' + id + '-rim)'} strokeWidth="6" clipPath={'url(#' + id + '-clip)'}/>
    </svg>
  </span>;
}
