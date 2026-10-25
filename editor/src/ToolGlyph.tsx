import { memo } from 'react';
import type { AnnotationKind } from './document';

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

/** 图标线条由主轨统一施力；标题中的静态实例不挂载独立动画。 */
export const ToolGlyph = memo(function ToolGlyph({ kind }: { kind: AnnotationKind }) {
  return <svg className="annotation-tool-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {outlines[kind].map((d,i)=><path key={i} d={d}/>)}
  </svg>;
});
