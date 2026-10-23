import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { ControlButton } from './ControlMotion';
import { ColorField } from './ColorField';
import { annotationHints, annotationStyle, arrowPath, hasStroke } from './annotationAppearance';
import type { AnnotationChange } from './annotations';
import type { AnnotationKind } from './document';
import type { CanvasHandle, CanvasSelection } from './EditorCanvas';
import { presentationMotion } from './LiquidMotion';
import { observeMotionScope } from './motionScope';

const colors = [{ value:'#ef4444',name:'红色' },{ value:'#fbbf24',name:'琥珀色' },{ value:'#22c55e',name:'绿色' },{ value:'#3b82f6',name:'蓝色' },{ value:'#a78bfa',name:'紫色' },{ value:'#ffffff',name:'白色' }];

/** 同一张浮卡承接落笔前设置和选中后的调整，只有修改真实标注才写入文档历史。 */
export function AnnotationPalette({canvasRef,selection,tool,disabled=false,onError}:{canvasRef:RefObject<CanvasHandle|null>;selection:CanvasSelection|null;tool?:AnnotationKind|null;disabled?:boolean;onError:(error:unknown)=>void}) {
  const current=selection??(tool?canvasRef.current?.toolStyle(tool):null);
  const [style,setStyle]=useState<AnnotationChange>(annotationStyle('rect')),sample=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{if(current)setStyle({color:current.color,fontSize:current.fontSize,strokeWidth:current.strokeWidth??3,blockSize:current.blockSize??12});},[current?.id,current?.type,current?.color,current?.fontSize,current?.strokeWidth,current?.blockSize]);
  // 切换工具时仅让样例短距归位，字段和输入焦点保持稳定，拖动参数不反复重播。
  useLayoutEffect(()=>{
    const node=sample.current,clock=presentationMotion(node)?.clock;if(!node||!clock)return;
    const key='annotation-sample';
    void clock.tween(key,180,p=>{node.style.opacity=String(.6+.4*p);node.style.transform=`translateY(${3*Math.pow(1-p,3)}px)`;});
    const stop=observeMotionScope(node,hidden=>{if(hidden)clock.finish(key);});
    return()=>{stop();clock.cancel(key);node.style.removeProperty('opacity');node.style.removeProperty('transform');};
  },[current?.id]);
  if(!current)return <div className="annotation-empty"><p>选择一个工具开始绘制</p><span>也可以点击画面中的标注，调整它的样式。</span></div>;
  const kind=current.type,mosaic=kind==='mosaic',stroked=hasStroke(kind),text=kind==='text';
  const amount=text?style.fontSize:mosaic?style.blockSize??12:style.strokeWidth??3;
  const label=text?'字号':mosaic?'颗粒大小':'线条粗细',min=text?8:mosaic?6:1,max=text?240:mosaic?64:48;
  const sizes=text?[18,26,36,48]:mosaic?[8,12,20,32]:[2,4,8,12];
  function apply(change:Partial<AnnotationChange>,group?:string) {
    const next={...style,...change};
    const accepted=selection?canvasRef.current?.patchSelection(next,group):tool&&canvasRef.current?.patchTool(tool,next);
    if(accepted)setStyle(next);else onError(new Error('当前标注暂时无法修改，请稍后重试。'));
  }
  const setAmount=(value:number,group?:string)=>apply(text?{fontSize:value}:mosaic?{blockSize:value}:{strokeWidth:value},group);
  return <div className="annotation-inspector">
    <div ref={sample} className="annotation-sample"><AnnotationSample kind={kind} style={style}/><span>{selection?'当前标注':'下一次绘制'}{(text||mosaic||stroked)&&<output>{amount} px</output>}</span></div>
    {!mosaic&&<section className="annotation-setting" aria-label="颜色">
      <div className="annotation-setting-heading"><span>颜色</span><span className="annotation-color-code">{style.color.toUpperCase()}</span></div>
      <div className="annotation-swatches" role="group" aria-label="快捷颜色">{colors.map(color=><ControlButton key={color.value} className="annotation-swatch" disabled={disabled} aria-label={color.name} aria-pressed={style.color.toLowerCase()===color.value} style={{'--swatch':color.value} as CSSProperties} onClick={()=>apply({color:color.value})}><span className="annotation-swatch-face">{style.color.toLowerCase()===color.value&&<Check aria-hidden="true"/>}</span></ControlButton>)}</div>
      <ColorField label="自定义标注颜色" disabled={disabled} value={style.color} onChange={color=>apply({color})}/>
    </section>}
    {(text||mosaic||stroked)&&<section className="annotation-setting" aria-label={label}>
      <AnnotationAmount key={current.id+label} label={label} value={amount} min={min} max={max} disabled={disabled} onChange={setAmount}/>
      <div className="annotation-sizes" role="group" aria-label={label+'预设'}>{sizes.map(value=><ControlButton key={value} disabled={disabled} aria-label={`${label} ${value} 像素`} aria-pressed={amount===value} onClick={()=>setAmount(value)}>{stroked?<><span className="annotation-size-line" style={{height:Math.min(value,8)}}/><span>{value}</span></>:<span>{value} px</span>}</ControlButton>)}</div>
    </section>}
    <p className="annotation-instruction">{annotationHints[kind]}</p>
    {!selection&&<p className="clay-hint">选中工具后可连续绘制。再次点击工具或按 Esc 退出。</p>}
    {(mosaic||kind==='cover')&&<p className="compact-privacy">效果应用于导出图片，项目文件仍保留原图。</p>}
    {selection&&<div className="annotation-inspector-footer"><span>修改即时生效 · 可撤销</span><ControlButton className="clay-danger" aria-label="删除选中标注" disabled={disabled} onClick={()=>canvasRef.current?.remove()}><Trash2 aria-hidden="true"/>删除</ControlButton></div>}
  </div>;
}

/** 数字草稿失焦才提交；滑杆与连续方向键各自归并为一次撤销。 */
function AnnotationAmount({label,value,min,max,disabled,onChange}:{label:string;value:number;min:number;max:number;disabled:boolean;onChange:(value:number,group?:string)=>void}) {
  const id=useId(),gesture=useRef<string|undefined>(undefined),[draft,setDraft]=useState(String(value)),[error,setError]=useState('');
  useEffect(()=>{setDraft(String(value));setError('');},[value]);
  const begin=()=>{gesture.current??='annotation-style:'+crypto.randomUUID();},end=()=>{gesture.current=undefined;};
  useEffect(()=>{window.addEventListener('blur',end);return()=>window.removeEventListener('blur',end);},[]);
  function commit(){const next=Number(draft);if(!draft.trim()||!Number.isFinite(next)||next<min||next>max){setDraft(String(value));setError(`请输入 ${min}–${max} 之间的数值。`);return;}setDraft(String(Math.round(next)));setError('');if(Math.round(next)!==value)onChange(Math.round(next));}
  return <div className="annotation-amount"><div className="annotation-setting-heading"><label htmlFor={id}>{label}</label><div className="annotation-number"><input type="number" aria-label={label+'像素'} aria-invalid={Boolean(error)} min={min} max={max} step={1} disabled={disabled} value={draft} onChange={event=>setDraft(event.target.value)} onBlur={commit} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing)event.currentTarget.blur();}}/><span>px</span></div></div>
    <input id={id} type="range" min={min} max={max} step={1} disabled={disabled} value={value} style={{'--range-progress':`${(value-min)/(max-min)*100}%`} as CSSProperties} onPointerDown={event=>{if(event.button===0){begin();event.currentTarget.setPointerCapture(event.pointerId);}}} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onBlur={end} onKeyDown={event=>{if(/^(Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(event.key))begin();}} onKeyUp={end} onChange={event=>onChange(Number(event.target.value),gesture.current)}/>
    {error&&<p className="field-error" role="status">{error}</p>}
  </div>;
}

/** 只展示矢量样式示例，不读取截图；箭头与笔迹示例使用生产轮廓和当前颜色。 */
function AnnotationSample({kind,style}:{kind:AnnotationKind;style:AnnotationChange}) {
  const id=useId().replace(/:/g,''),weight=Math.min(18,style.strokeWidth??3),block=Math.max(4,(style.blockSize??12)*.45);
  return <svg viewBox="0 0 280 82" role="img" aria-label="当前笔触样式预览">
    {kind==='text'?<text x="140" y="52" textAnchor="middle" fill={style.color} fontSize={Math.min(42,Math.max(18,style.fontSize))} fontFamily="var(--clay-font)">让重点更清晰</text>
      :kind==='arrow'?<path d={arrowPath(186,Math.max(20,weight*3),weight)} transform={`translate(47 ${41-Math.max(20,weight*3)/2})`} fill={style.color}/>
      :kind==='brush'?<path d="M38 53Q66 12 96 38T156 38T242 31" fill="none" stroke={style.color} strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round"/>
      :kind==='ellipse'?<ellipse cx="140" cy="41" rx="79" ry="24" fill="none" stroke={style.color} strokeWidth={weight}/>
      :kind==='rect'?<rect x="61" y="17" width="158" height="48" rx="6" fill="none" stroke={style.color} strokeWidth={weight}/>
      :kind==='mosaic'?<><defs><pattern id={id} width={block*3} height={block*2} patternUnits="userSpaceOnUse"><rect width={block*3} height={block*2} fill="#a6a8ae"/><rect width={block} height={block} fill="#737780"/><rect x={block} y={block} width={block} height={block} fill="#d5d6da"/><rect x={block*2} width={block} height={block} fill="#8c909a"/></pattern></defs><rect x="38" y="15" width="204" height="52" rx="4" fill={`url(#${id})`}/></>
      :<><text x="140" y="49" textAnchor="middle" fill="var(--clay-muted)" fontSize="22">标记值得关注的内容</text><rect x="36" y="25" width="208" height="30" rx={kind==='highlight'?5:0} fill={style.color} opacity={kind==='highlight'?.3:1}/></>}
  </svg>;
}
