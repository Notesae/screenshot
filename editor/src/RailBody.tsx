import { memo, useId } from 'react';
import tokens from '../../design/soft-clay.tokens.json';

/** 轨道的渐变、追光与投影共用弯曲路径；不叠加硬质描边，不碰按钮或截图纹理。 */
export const RailBody = memo(function RailBody() {
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
        {/* 85×30 的局部追光直接填充实际轮廓，弯曲时不会遗留矩形高光条。 */}
        <radialGradient id={id + '-light'} className="liquid-rail-light" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="85" gradientTransform="scale(1 .3529411765)">
          <stop stopColor="#ffffff" stopOpacity=".145"/><stop offset="1" stopColor="#ffffff" stopOpacity="0"/>
        </radialGradient>
        {/* 固定模糊半径只用于底座投影，不对工具、文字或冻结桌面应用滤镜。 */}
        <filter id={id + '-shadow'} className="liquid-rail-shadow" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feDropShadow in="SourceGraphic" dx="0" dy="24" stdDeviation="24" floodOpacity=".533" result="far"/>
          <feDropShadow in="SourceGraphic" dx="0" dy={tokens.shadow.depth} stdDeviation={tokens.shadow.blur / 2} floodOpacity={tokens.shadow.opacity} result="near"/>
          <feMerge><feMergeNode in="far"/><feMergeNode in="near"/></feMerge>
        </filter>
      </defs>
      <use className="liquid-rail-face" href={'#' + outline} fill={'url(#' + id + '-face)'} filter={'url(#' + id + '-shadow)'}/>
      <use href={'#' + outline} fill={'url(#' + id + '-light)'} style={{opacity:'var(--liquid-body-light,0)'}}/>
    </svg>
  </span>;
});
