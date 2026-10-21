import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { adjustSelection, type CaptureHandle } from './selectionGeometry';
import type { OverlayMetadata, PixelRect } from './overlay';

/** 选区内空白直接拖动；标注命中交还画布。裁剪及绘制完成前保留落点，避免旧帧闪回。 */
export function CaptureSelection({ viewport, metadata, disabled, settled, onAdjust, onPreview, onDragging, hitAnnotation, onBegin, children }: {
  viewport:{width:number;height:number};metadata: OverlayMetadata|null; disabled: boolean; settled: boolean; onAdjust: (area: PixelRect) => Promise<boolean>;
  onPreview: (area: PixelRect|null) => void; onDragging: (active: boolean) => void;
  hitAnnotation: (event: globalThis.PointerEvent) => boolean; onBegin: () => void; children: ReactNode;
}) {
  const [preview, setPreview] = useState<PixelRect|null>(null), [pending,setPending]=useState(false);
  const frame=useRef<HTMLDivElement>(null),sequence=useRef(0);
  // 手势与异步提交分开：浏览器自动释放指针捕获不能清除正在等待绘制的落点。
  const drag = useRef<{ id: number; x: number; y: number; handle: CaptureHandle; area: PixelRect; next: PixelRect; element: HTMLElement }|null>(null);
  const active=Boolean(metadata?.captureId&&!metadata.contentScale);
  function reset(){setPreview(null);setPending(false);onPreview(null);}
  useEffect(()=>()=>{sequence.current++;},[]);
  useLayoutEffect(()=>{
    if(pending&&settled&&preview&&metadata&&sameArea(preview,metadata.selection))reset();
  },[pending,settled,metadata?.selection,preview]);
  function cancel() {
    const current=drag.current;if(!current)return;
    drag.current=null;reset();onDragging(false);
    if(current.element.hasPointerCapture(current.id))current.element.releasePointerCapture(current.id);
  }
  // 捕获阶段区分手柄、背景与标注，只有前两者接管选区手势。
  function begin(event: PointerEvent<HTMLDivElement>) {
    if(!active||!metadata||disabled||pending||event.button!==0)return;
    const target=event.target as Element,handleButton=target.closest<HTMLButtonElement>('[data-selection-handle]');
    const handle=(handleButton?.dataset.selectionHandle??'move') as CaptureHandle;
    if(!handleButton){
      const r=frame.current?.getBoundingClientRect();
      if(!r||event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom||target.closest('button,input,textarea,select,[contenteditable="true"]')||hitAnnotation(event.nativeEvent))return;
    }
    event.preventDefault();event.stopPropagation();onBegin();
    (handleButton??frame.current)?.focus({preventScroll:true});event.currentTarget.setPointerCapture(event.pointerId);
    drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,handle,area:metadata.selection,next:metadata.selection,element:event.currentTarget};
    onDragging(true);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current=drag.current;if(!current||!metadata||event.pointerId!==current.id)return;
    current.next=adjustSelection(current.area,current.handle,(event.clientX-current.x)*metadata.desktopBounds.width/viewport.width,(event.clientY-current.y)*metadata.desktopBounds.height/viewport.height,metadata.desktopBounds);
    setPreview(current.next);onPreview(current.next);
  }
  // 松手只结束指针手势；成功后由同一图片的绘制完成信号清除预览，失败才回滚。
  async function end(event: PointerEvent<HTMLDivElement>) {
    const current=drag.current;if(!current||!metadata||event.pointerId!==current.id)return;
    move(event);drag.current=null;onDragging(false);
    if(current.element.hasPointerCapture(current.id))current.element.releasePointerCapture(current.id);
    if(sameArea(current.next,metadata.selection)){reset();return;}
    setPending(true);const request=++sequence.current;
    try{if(!await onAdjust(current.next)&&request===sequence.current)reset();}catch{if(request===sequence.current)reset();}
  }
  // Esc 先撤销手势；方向键以物理像素调整，且不会变成工具或标注快捷键。
  function key(event: KeyboardEvent<HTMLDivElement>) {
    if(event.key==='Escape'&&drag.current){event.preventDefault();event.stopPropagation();cancel();return;}
    const target=event.target as HTMLElement,handle=target.dataset.selectionHandle as CaptureHandle|undefined;
    if(!metadata||!active||disabled||pending||drag.current||event.altKey||event.metaKey||event.nativeEvent.isComposing||target!==frame.current&&!handle)return;
    const step=event.ctrlKey?10:1,delta:Record<string,[number,number]>={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]};
    if(!delta[event.key])return;event.preventDefault();event.stopPropagation();
    const [dx,dy]=delta[event.key],next=adjustSelection(metadata.selection,event.shiftKey?'se':handle??'move',dx,dy,metadata.desktopBounds);
    if(sameArea(next,metadata.selection))return;
    setPreview(next);onPreview(next);setPending(true);const request=++sequence.current;
    void onAdjust(next).then(ok=>{if(!ok&&request===sequence.current)reset();}).catch(()=>{if(request===sequence.current)reset();});
  }
  const area=preview??metadata?.selection,desktop=metadata?.desktopBounds;
  const scale=desktop?{x:viewport.width/desktop.width,y:viewport.height/desktop.height}:{x:1,y:1};
  return <div className="clay-capture-layer" onPointerDownCapture={begin} onPointerMoveCapture={move} onPointerUpCapture={event=>{void end(event);}} onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDownCapture={key}>
    {children}
    {active&&area&&desktop&&<svg className="clay-selection-mask" width={viewport.width} height={viewport.height} aria-hidden="true"><path fillRule="evenodd" d={`M0 0H${viewport.width}V${viewport.height}H0Z M${(area.x-desktop.x)*scale.x} ${(area.y-desktop.y)*scale.y}h${area.width*scale.x}v${area.height*scale.y}h${-area.width*scale.x}Z`}/></svg>}
    {active&&area&&desktop&&<div ref={frame} className="clay-capture-selection" role="group" tabIndex={0} aria-label="截图选区" aria-disabled={disabled||pending} style={{left:(area.x-desktop.x)*scale.x,top:(area.y-desktop.y)*scale.y,width:area.width*scale.x,height:area.height*scale.y}}>
      <span className="clay-selection-size" aria-live="polite" style={{top:(area.y-desktop.y)*scale.y<38?6:undefined}}>{area.width} × {area.height} px</span>
      {(['nw','n','ne','e','se','s','sw','w'] as const).map(handle=><button key={handle} data-selection-handle={handle} className={'clay-selection-handle is-'+handle} aria-label={'调整截图选区 '+handle} title="拖动调整选区，方向键微调" disabled={disabled||pending}/>)}
    </div>}
  </div>;
}
function sameArea(a:PixelRect,b:PixelRect){return a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height;}
