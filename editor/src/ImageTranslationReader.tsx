import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { GripVertical, Minus, Plus, RotateCcw, X } from 'lucide-react';
import type { ImageTranslationDocument } from './imageTranslationLayout';
import type { PixelRect } from './overlay';

/** 阅读卡只放在截图外；没有足够空白时进入临时阅读视图，关闭后恢复同一画布。 */
export function translationReaderPlacement(screen:PixelRect,frame:PixelRect|null,rail:PixelRect) {
  const area={x:screen.x+16,y:screen.y+16,width:Math.max(1,screen.width-32),height:Math.max(1,screen.height-32)};
  const candidates:PixelRect[]=[];
  if(frame){
    const spaces=[
      {x:area.x,y:area.y,width:frame.x-area.x-16,height:area.height},
      {x:frame.x+frame.width+16,y:area.y,width:area.x+area.width-frame.x-frame.width-16,height:area.height},
      {x:area.x,y:area.y,width:area.width,height:frame.y-area.y-16},
      {x:area.x,y:frame.y+frame.height+16,width:area.width,height:area.y+area.height-frame.y-frame.height-16},
    ];
    for(const space of spaces){
      const overlap=space.x<rail.x+rail.width+12&&space.x+space.width>rail.x-12&&space.y<rail.y+rail.height+12&&space.y+space.height>rail.y-12;
      if(!overlap)candidates.push(space);
      else candidates.push(
        {...space,width:rail.x-space.x-12},
        {...space,x:rail.x+rail.width+12,width:space.x+space.width-rail.x-rail.width-12},
        {...space,height:rail.y-space.y-12},
        {...space,y:rail.y+rail.height+12,height:space.y+space.height-rail.y-rail.height-12},
      );
    }
  }
  const available=candidates.filter(rect=>rect.width>=300&&rect.height>=200&&rect.x>=area.x&&rect.y>=area.y&&rect.x+rect.width<=area.x+area.width+.01&&rect.y+rect.height<=area.y+area.height+.01)
    .sort((a,b)=>Math.min(b.width,680)*Math.min(b.height,720)-Math.min(a.width,680)*Math.min(a.height,720))[0];
  const width=Math.min(860,area.width),height=Math.min(720,area.height);
  return available?{box:{...available,width:Math.min(680,available.width),height:Math.min(720,available.height)},full:false}
    :{box:{x:area.x+(area.width-width)/2,y:area.y+(area.height-height)/2,width,height},full:true};
}

type ReaderProps={rootRef:RefObject<HTMLElement|null>;open:boolean;data:ImageTranslationDocument;box:PixelRect;screen:PixelRect;full:boolean;onClose:()=>void;onBoundsChange:(box:PixelRect)=>void;onReset:()=>void};

/** 阅读偏好和手势只影响当前窗口，不修改图片、历史、导出或服务请求。 */
export function ImageTranslationReader({rootRef,open,data,box,screen,full,onClose,onBoundsChange,onReset}:ReaderProps) {
  const [fontSize,setFontSize]=useState(18),[comparison,setComparison]=useState(false),close=useRef<HTMLButtonElement>(null);
  const gesture=useRef<{kind:'move'|'resize';pointer:number;x:number;y:number;origin:PixelRect;moved:boolean}|null>(null);
  const narrow=box.width<Math.max(640,fontSize*34);
  useEffect(()=>{if(open)close.current?.focus({preventScroll:true});},[open]);
  function begin(kind:'move'|'resize',event:PointerEvent<HTMLElement>){
    if(event.button!==0||kind==='move'&&(event.target as Element).closest('button,input,select,textarea'))return;
    gesture.current={kind,pointer:event.pointerId,x:event.clientX,y:event.clientY,origin:{...box},moved:false};
    event.currentTarget.setPointerCapture(event.pointerId);event.currentTarget.focus({preventScroll:true});event.preventDefault();
  }
  // 手动位置不参与自动避让或边界回弹；尺寸则保留足以操作标题与阅读的最小范围。
  function changed(origin:PixelRect,kind:'move'|'resize',dx:number,dy:number){
    if(kind==='move')return {...origin,x:origin.x+dx,y:origin.y+dy};
    const minWidth=Math.min(320,Math.max(160,screen.width-32)),minHeight=Math.min(240,Math.max(160,screen.height-32));
    const maxWidth=Math.max(minWidth,Math.min(1280,screen.width-32)),maxHeight=Math.max(minHeight,screen.height-32);
    return {...origin,width:Math.max(minWidth,Math.min(maxWidth,origin.width+dx)),height:Math.max(minHeight,Math.min(maxHeight,origin.height+dy))};
  }
  function move(event:PointerEvent<HTMLElement>){
    const current=gesture.current;if(!current||current.pointer!==event.pointerId)return;
    const dx=event.clientX-current.x,dy=event.clientY-current.y;
    if(!current.moved&&!dx&&!dy)return;
    current.moved=true;onBoundsChange(changed(current.origin,current.kind,dx,dy));
  }
  function end(event:PointerEvent<HTMLElement>){
    if(gesture.current?.pointer!==event.pointerId)return;
    move(event);gesture.current=null;
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function key(kind:'move'|'resize',event:KeyboardEvent<HTMLElement>){
    if(event.target!==event.currentTarget||event.ctrlKey||event.altKey||event.metaKey||event.nativeEvent.isComposing)return;
    const step=event.shiftKey?24:8,directions:Record<string,[number,number]>={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]};
    const delta=directions[event.key];if(!delta)return;event.preventDefault();event.stopPropagation();
    onBoundsChange(changed(box,kind,...delta));
  }
  return <section ref={rootRef} inert={!open} aria-hidden={!open} className={'clay-reader'+(full?' is-full':'')+(comparison?' is-comparing':'')+(narrow?' is-narrow':'')} role={full?'dialog':'region'} aria-modal={full||undefined} aria-label="阅读译文"
    style={{left:box.x,top:box.y,width:box.width,height:box.height}}
    onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'&&!event.nativeEvent.isComposing){event.preventDefault();onClose();}}}>
    <div className="liquid-surface-skin" aria-hidden="true"/><div className="liquid-surface-content">
    <header data-surface-drag className="clay-reader-heading" tabIndex={0} aria-label="移动阅读窗口，拖动标题栏或使用方向键" onPointerDown={event=>begin('move',event)} onPointerMove={move} onPointerUp={end} onPointerCancel={()=>{gesture.current=null;}} onLostPointerCapture={()=>{gesture.current=null;}} onKeyDown={event=>key('move',event)}>
      <GripVertical className="clay-reader-grip" size={18} aria-hidden="true"/><h2>阅读译文</h2><span className="clay-reader-count">{data.blocks.length} 处</span>
      <div className="clay-reader-actions"><button data-tooltip="恢复阅读窗口默认位置和大小" aria-label="恢复阅读窗口默认位置和大小" onClick={onReset}><RotateCcw size={16} aria-hidden="true"/></button><button ref={close} aria-label="关闭阅读，返回截图" onClick={onClose}><X aria-hidden="true"/></button></div>
    </header>
    <div className="clay-reader-toolbar">
      <div className="clay-reader-mode" role="group" aria-label="阅读方式"><button aria-pressed={!comparison} onClick={()=>setComparison(false)}>译文</button><button aria-pressed={comparison} onClick={()=>setComparison(true)}>对照</button></div>
      <div className="clay-reader-type" role="group" aria-label="阅读字号"><button aria-label="缩小阅读文字" disabled={fontSize<=16} onClick={()=>setFontSize(value=>Math.max(16,value-2))}><Minus size={16}/></button><output aria-label="阅读字号">{fontSize}</output><button aria-label="放大阅读文字" disabled={fontSize>=28} onClick={()=>setFontSize(value=>Math.min(28,value+2))}><Plus size={16}/></button></div>
    </div>
    <div className="clay-reader-content" tabIndex={0} aria-label="完整译文" style={{fontSize}}>
      <div className="clay-reader-article">
        {comparison&&!narrow&&<div className="clay-reader-columns" aria-hidden="true"><span>原文</span><span>译文</span></div>}
        {data.blocks.map((block,index)=><article key={index} aria-label={'译文 '+(index+1)} className={block.text.length>54||block.text.includes('\n')?'is-paragraph':undefined}>
          {comparison&&<div className="clay-reader-source-cell">{narrow&&<span className="clay-reader-column-label">原文</span>}<p className="clay-reader-source">{block.source}</p></div>}
          <div className="clay-reader-target-cell">{comparison&&narrow&&<span className="clay-reader-column-label">译文</span>}<p className="clay-reader-text">{block.text}</p></div>
        </article>)}
      </div>
    </div>
    <button data-surface-drag className="clay-reader-resize" aria-label="调整阅读窗口大小，拖动或使用方向键" data-tooltip="拖动调整阅读窗口大小" onPointerDown={event=>begin('resize',event)} onPointerMove={move} onPointerUp={end} onPointerCancel={()=>{gesture.current=null;}} onLostPointerCapture={()=>{gesture.current=null;}} onKeyDown={event=>key('resize',event)}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 13 13 5M10 13l3-3"/></svg></button>
    </div>
  </section>;
}
