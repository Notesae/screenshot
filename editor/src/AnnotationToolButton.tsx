import { MotionButton } from './LiquidMotion';
import { ToolGlyph } from './ToolGlyph';
import { annotationNames } from './annotationAppearance';
import type { AnnotationKind } from './document';

/** 绘制待命与调整已有对象采用不同深度、标记和文案，点击的下一步保持可见。 */
export function AnnotationToolButton({kind,state,expanded,disabled,onClick}:{kind:AnnotationKind;state:'idle'|'drawing'|'editing';expanded:boolean;disabled:boolean;onClick:()=>void}) {
  const name=annotationNames[kind],drawing=state==='drawing',editing=state==='editing';
  const action=drawing?'连续绘制中，点击退出':editing?'正在调整已有标注，点击切换为绘制新标注':'点击开始连续绘制';
  return <MotionButton group="draw" data-hover-panel="properties" data-annotation-kind={kind} data-tool-state={state}
    aria-label={`${name}：${action}，悬停设置`} aria-expanded={expanded} aria-pressed={drawing} disabled={disabled} onClick={onClick}>
    <span className="annotation-mode-icon"><ToolGlyph kind={kind} animated/>
      {state!=='idle'&&<svg className="annotation-mode-mark" viewBox="0 0 12 12" aria-hidden="true"><path d={drawing?'M6 2v8M2 6h8':'M1 4V1h3M8 1h3v3M11 8v3H8M4 11H1V8'}/></svg>}
    </span>
    {state!=='idle'&&<span className="annotation-mode-label" aria-hidden="true">{drawing?'绘制':'调整'}</span>}
  </MotionButton>;
}
