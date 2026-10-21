import { useEffect, useRef, useState, type ReactNode, type RefObject, type PointerEvent, type KeyboardEvent, type CSSProperties } from 'react';
import { ArrowDownToLine, ArrowUpRight, Copy, FolderOpen, Frame, GripVertical, Highlighter, ImagePlus, MoreHorizontal, RotateCcw, ScanText, Settings2, Shield, Sparkles, Trash2, Type, X } from 'lucide-react';
import { RecoveryStatus, type RecoveryView } from './RecoveryPanel';
import { StyleTools } from './StyleTools';
import { TextTools, CaptureBackendSelector, type TextToolsProps } from './TextTools';
import { CaptureControls } from './CaptureControls';
import { EditorCanvas, type CanvasHandle, type CanvasRenderStatus, type CanvasSelection } from './EditorCanvas';
import { outputSize, type ContentResize, type SourceCrop, type EditorState, type ProjectDocument } from './document';
import { native, type Settings, type PresentationResult } from './bridge';
import { overlayLayout, type OverlayMetadata } from './overlay';
import { overlayKeyAction } from './keyboard';
import { AnnotationPalette, HistoryButtons, TransformPanel } from './EditControls';
import { boundTool, placeTools, type ToolPositions, type Point } from './toolPlacement';
import tokens from '../../design/soft-clay.tokens.json';
import { CaptureSelection } from './CaptureSelection';
import type { PixelRect } from './overlay';
import clayCopy from './assets/soft-clay/copy.svg';
import clayBeauty from './assets/soft-clay/beauty.svg';
import clayText from './assets/soft-clay/text.svg';
import clayMore from './assets/soft-clay/more.svg';
import clayClose from './assets/soft-clay/close.svg';

type Panel = 'raw'|'beauty'|'text'|'more'|'properties'|'recovery'|'settings';
type Props = {
  selection:CanvasSelection|null;onSelection:(selection:CanvasSelection|null)=>void;
  recoveryState:RecoveryView;recoveryPanel:ReactNode;textTools:TextToolsProps;
  renderStatus:CanvasRenderStatus;onRenderStatus:(status:CanvasRenderStatus)=>void;
  skipReady:boolean;onFiles:(files:FileList|null)=>Promise<void>;onCapture:(method:string,payload?:object)=>void;
  captureBackend:'wgc'|'gdi'|null;onCaptureBackend:(backend:'wgc'|'gdi')=>void;
  document:ProjectDocument;metadata:OverlayMetadata|null;canvasRef:RefObject<CanvasHandle|null>;
  update:(change:Partial<EditorState>,group?:string)=>void;onExport:(copy?:boolean)=>void;
  canUndo:boolean;canRedo:boolean;undo:()=>void;redo:()=>void;onTransform:(crop:SourceCrop|null,resize:ContentResize|null)=>void;
  onAi:(kind:'ocr'|'translate')=>void;onPresentation:(mode:'workbench'|'hidden')=>void;
  onConfigure:()=>void;onSaveProject:()=>void;onError:(error:unknown)=>void;
  busy:string;aiBusy:string;settings:Settings;providerId:string;setProviderId:(id:string)=>void;
  targetLanguage:string;setTargetLanguage:(language:string)=>void;scale:number;setScale:(scale:number)=>void;
  notice:{text:string;error?:boolean}|null;clearNotice:()=>void;onReadyResult:(captureId:string,result:PresentationResult)=>void;
  onOpenImage:()=>void;onOpenProject:()=>void;onPaste:()=>void;locked:boolean;
  onAdjustCapture:(area:PixelRect)=>Promise<boolean>;
  requestedPanel:{kind:'more'|'recovery'|'settings';sequence:number}|null;
};

/** 冻结选区与无冻结文件共用外壳；路径、工具位置和浮卡始终不写入项目模型。 */
export function CompactOverlay(props:Props) {
  const {document:doc,metadata,canvasRef,update,busy,aiBusy}=props,editor=doc.editor;
  const [panel,setPanel]=useState<Panel|null>(metadata?'raw':null),[positions,setPositions]=useState<ToolPositions>({});
  // 保留关闭中的浮卡直到退出动画结束；减弱动态效果时立即移除。
  const [visiblePanel,setVisiblePanel]=useState<Panel|null>(panel);
  useEffect(()=>{if(panel){setVisiblePanel(panel);return;}if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){setVisiblePanel(null);return;}const timer=setTimeout(()=>setVisiblePanel(null),tokens.motion.close);return()=>clearTimeout(timer);},[panel]);
  // 拖动只预览工具避让，松手才请求裁剪，避免逐帧传输截图。
  const [selectionPreview,setSelectionPreview]=useState<PixelRect|null>(null);
  const selectionDragging=useRef(false);
  useEffect(()=>setPositions({}),[metadata?.selection.x,metadata?.selection.y,metadata?.selection.width,metadata?.selection.height]);
  const [chromeVisible,setChromeVisible]=useState(!metadata||props.skipReady);
  useEffect(()=>{if(!metadata||props.skipReady)setChromeVisible(true);},[Boolean(metadata),props.skipReady]);
  const [paintedImage,setPaintedImage]=useState<ProjectDocument["image"]>(null);
  const [viewport,setViewport]=useState({width:window.innerWidth,height:window.innerHeight});
  const [railSize,setRailSize]=useState({width:800,height:52}),[canvasReady,setCanvasReady]=useState(false);
  const trigger=useRef<HTMLButtonElement|null>(null),railRef=useRef<HTMLDivElement>(null),readySent=useRef(false),composing=useRef(false);
  const drag=useRef<{kind:'rail'|'card';pointer:number;start:Point;origin:Point}|null>(null);
  const cardContent=useRef<HTMLDivElement>(null);
  const latest=useRef({props,panel});latest.current={props,panel};
  const hasContent=Boolean(doc.image)||editor.mode==='reflow';
  let output={width:doc.image?.width||1,height:doc.image?.height||1};
  try{output=outputSize(doc.image,editor);}catch{/* 画布报告尺寸错误，工具仍允许修正文字。 */}
  const padding=editor.mode==='beauty'?editor.padding:0;
  const previewOutput=selectionPreview&&editor.mode!=='reflow'?{width:selectionPreview.width+padding*2,height:selectionPreview.height+padding*2}:output;
  const adjusting=busy==='调整截图选区',canvasSettled=props.renderStatus==='ready'&&paintedImage===doc.image;
  const mapped=metadata?overlayLayout(selectionPreview?{...metadata,selection:selectionPreview}:metadata,viewport,previewOutput,editor.mode==='beauty'?editor.padding:0,{...railSize,statusHeight:0},selectionPreview||editor.mode==='reflow'?undefined:editor.crop||(editor.resize?{x:0,y:0}:undefined)):null;
  const screen=mapped?.screen??{x:0,y:0,...viewport};
  const tools=placeTools(screen,mapped?.frame??null,railSize,{width:panel==='text'?420:panel==='beauty'?360:320,height:panel==='properties'?300:500},selectionPreview?{}:positions);
  function closePanel(){setPanel(null);trigger.current?.focus();}
  function openPanel(next:Panel,button?:HTMLButtonElement){if(button)trigger.current=button;setPanel(current=>current===next?null:next);}
  useEffect(()=>{if(props.requestedPanel)setPanel(props.requestedPanel.kind);},[props.requestedPanel]);
  useEffect(()=>{if(cardContent.current)cardContent.current.scrollTop=0;},[panel]);
  useEffect(()=>{if(props.selection)setPanel('properties');},[props.selection?.id]);
  useEffect(()=>{
    const resize=()=>setViewport({width:window.innerWidth,height:window.innerHeight});window.addEventListener('resize',resize);
    const observer=new ResizeObserver(()=>{if(railRef.current)setRailSize({width:Math.min(800,window.innerWidth-32),height:railRef.current.getBoundingClientRect().height});});
    if(railRef.current)observer.observe(railRef.current);
    return()=>{window.removeEventListener('resize',resize);observer.disconnect();};
  },[]);
  useEffect(()=>{
    if(props.skipReady||!canvasReady||!canvasSettled||readySent.current||!metadata?.captureId)return;
    let cancelled=false;const id=metadata.captureId;
    const timer=setTimeout(()=>{readySent.current=true;void native.request<PresentationResult>('presentation.ready',{captureId:id}).then(result=>{if(!cancelled){if(result.accepted!==false)setChromeVisible(true);props.onReadyResult(id,result);}}).catch(props.onError);},0);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[canvasReady,canvasSettled,metadata?.captureId,props.skipReady]);
  useEffect(()=>{
    const start=()=>{composing.current=true;},end=()=>{composing.current=false;};
    const keydown=(event:globalThis.KeyboardEvent)=>{
      if(event.defaultPrevented||event.repeat||latest.current.props.locked||selectionDragging.current)return;
      const {props:current,panel:currentPanel}=latest.current,interaction=current.canvasRef.current?.interactionState();
      const target=event.target instanceof Element?event.target:null;
      const action=overlayKeyAction({key:event.key,ctrl:event.ctrlKey,meta:event.metaKey,alt:event.altKey,shift:event.shiftKey,composing:event.isComposing||composing.current,textInput:Boolean(target?.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]')),fabricEditing:interaction?.editing||false,selectedObject:interaction?.selected||false,panelOpen:Boolean(currentPanel),textSelection:Boolean(window.getSelection()?.toString())});
      if(action==='ignore')return;event.preventDefault();event.stopPropagation();
      if(action==='exit-object')current.canvasRef.current?.exitSelection();else if(action==='close-panel')closePanel();else if(action==='copy-image')current.onExport(true);else current.onPresentation('hidden');
    };
    window.addEventListener('compositionstart',start);window.addEventListener('compositionend',end);window.addEventListener('keydown',keydown);
    return()=>{window.removeEventListener('compositionstart',start);window.removeEventListener('compositionend',end);window.removeEventListener('keydown',keydown);};
  },[]);
  function beginDrag(kind:'rail'|'card',event:PointerEvent<HTMLElement>){
    if(event.button!==0||(event.target as Element).closest('button,input,select,textarea'))return;
    const origin=kind==='rail'?tools.rail:tools.card;drag.current={kind,pointer:event.pointerId,start:{x:event.clientX,y:event.clientY},origin};event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();
  }
  function moveDrag(event:PointerEvent<HTMLElement>){const current=drag.current;if(!current||current.pointer!==event.pointerId)return;const size=current.kind==='rail'?tools.rail:tools.card;const point=boundTool({x:current.origin.x+event.clientX-current.start.x,y:current.origin.y+event.clientY-current.start.y},size,tools.area);setPositions(value=>({...value,[current.kind]:point}));}
  function endDrag(){drag.current=null;}
  function moveByKey(kind:'rail'|'card',event:KeyboardEvent<HTMLElement>){
    const delta=event.shiftKey?24:8,directions:Record<string,Point>={ArrowLeft:{x:-delta,y:0},ArrowRight:{x:delta,y:0},ArrowUp:{x:0,y:-delta},ArrowDown:{x:0,y:delta}};
    const direction=directions[event.key];if(!direction)return;event.preventDefault();const current=tools[kind];setPositions(value=>({...value,[kind]:boundTool({x:current.x+direction.x,y:current.y+direction.y},current,tools.area)}));
  }
  const title=visiblePanel==='raw'?'原样截图':visiblePanel==='beauty'?'美化截图':visiblePanel==='text'?'识别与校对':visiblePanel==='properties'?'标注属性':visiblePanel==='recovery'?'历史与恢复':visiblePanel==='settings'?'设置':'更多操作';
  return <div data-editor-root className={'clay-editor '+(metadata?'is-overlay':'is-neutral')+(chromeVisible?' is-presented':' is-awaiting')} inert={props.locked} onKeyDownCapture={event=>{const target=event.target;if(event.key==='Escape'&&!event.nativeEvent.isComposing&&!composing.current&&target instanceof HTMLElement&&target.matches('input,textarea,select')){event.preventDefault();event.stopPropagation();target.blur();}}} onDragOver={event=>{if(Array.from(event.dataTransfer.types).includes('Files'))event.preventDefault();}} onDrop={event=>{event.preventDefault();void props.onFiles(event.dataTransfer.files);}}>
    <CaptureSelection metadata={metadata} disabled={!!busy||!!aiBusy||props.locked||!canvasSettled} settled={canvasSettled&&!busy} onAdjust={props.onAdjustCapture} onPreview={setSelectionPreview} onDragging={active=>{selectionDragging.current=active;}} hitAnnotation={event=>canvasRef.current?.hasAnnotationAt(event)??false} onBegin={()=>canvasRef.current?.exitSelection()}>
    <div className={metadata?'clay-canvas-fixed':'clay-canvas-stage'} inert={!!busy} style={mapped?{visibility:selectionPreview?'hidden':undefined,left:mapped.frame.x,top:mapped.frame.y,width:mapped.frame.width,height:mapped.frame.height}:undefined}>
      {hasContent?<EditorCanvas ref={canvasRef} document={doc} onSelection={props.onSelection} onRenderStatus={props.onRenderStatus} fixedDisplayScale={mapped?.scale} onReady={()=>{setCanvasReady(true);setPaintedImage(doc.image);}} onAnnotations={(annotations,group)=>update({annotations},group)} onError={props.onError}/>:<div className="clay-launcher"><Frame size={32} aria-hidden="true"/><h1>截图，接着编辑。</h1><p>从托盘或快捷键开始，也可以打开本机文件。</p><button className="clay-primary" disabled={!!busy} onClick={()=>props.onCapture('capture.region')}>区域截图</button><button disabled={!!busy} onClick={props.onOpenImage}>打开图片</button><button disabled={!!busy} onClick={props.onOpenProject}>打开项目</button></div>}
    </div>
    </CaptureSelection>
    <fieldset className="clay-chrome" disabled={!!busy&&!adjusting} inert={adjusting||Boolean(selectionPreview&&!selectionDragging.current)}>
      <div className="clay-rail" ref={railRef} role="toolbar" aria-label="截图编辑工具" style={{left:tools.rail.x,top:tools.rail.y,width:tools.rail.width,maxHeight:tools.area.height}}>
        <span className="clay-grip" role="button" tabIndex={0} aria-label="移动动作轨，方向键微调" onPointerDown={event=>beginDrag('rail',event)} onPointerMove={moveDrag} onPointerUp={endDrag} onLostPointerCapture={endDrag} onKeyDown={event=>moveByKey('rail',event)}><GripVertical aria-hidden="true"/></span>
        <div className="clay-paths" role="group" aria-label="编辑路径"><button aria-pressed={editor.mode==='raw'&&panel!=='text'} disabled={!hasContent} onClick={()=>{update({mode:'raw'});openPanel('raw');}}>原样</button><button aria-pressed={editor.mode==='beauty'&&panel!=='text'} disabled={!hasContent} onClick={event=>{update({mode:'beauty'});openPanel('beauty',event.currentTarget);}}><img src={clayBeauty} width={20} height={20} alt="" aria-hidden="true"/>美化</button><button aria-pressed={panel==='text'} disabled={!hasContent} onClick={event=>openPanel('text',event.currentTarget)}><img src={clayText} width={20} height={20} alt="" aria-hidden="true"/>文字</button></div>
        <HistoryButtons canUndo={props.canUndo} canRedo={props.canRedo} undo={props.undo} redo={props.redo}/>
        {([{kind:'text',label:'文字标注',icon:Type},{kind:'rect',label:'矩形标注',icon:Frame},{kind:'arrow',label:'箭头标注',icon:ArrowUpRight},{kind:'highlight',label:'高亮标注',icon:Highlighter},{kind:'cover',label:'实色遮盖',icon:Shield}] as const).map(item=><button key={item.kind} title={item.label} aria-label={item.label} disabled={!hasContent||props.renderStatus!=='ready'} onClick={()=>canvasRef.current?.add(item.kind)}><item.icon aria-hidden="true"/></button>)}
        <button className="clay-primary" disabled={!hasContent||props.renderStatus!=='ready'} onClick={()=>props.onExport(true)}><img src={clayCopy} width={20} height={20} alt="" aria-hidden="true"/>复制 PNG</button><button aria-label="保存 PNG" title="保存 PNG" disabled={!hasContent||props.renderStatus!=='ready'} onClick={()=>props.onExport()}><ArrowDownToLine aria-hidden="true"/></button>
        <button aria-label="更多操作" aria-expanded={panel==='more'} onClick={event=>openPanel('more',event.currentTarget)}><img src={clayMore} width={20} height={20} alt="" aria-hidden="true"/></button><button aria-label="收起编辑，保留文档" title="收起编辑" onClick={()=>props.onPresentation('hidden')}><img src={clayClose} width={18} height={18} alt="" aria-hidden="true"/></button>
      </div>
      {visiblePanel&&<section aria-hidden={!panel} className={'clay-card '+(visiblePanel==='more'?'clay-drawer ':'')+(!panel?'is-closing':'')} role="region" aria-label={title} style={{left:tools.card.x,top:tools.card.y,width:tools.card.width,maxHeight:tools.card.height}}>
        <header className="clay-card-heading" tabIndex={0} aria-label={'移动'+title+'，方向键微调'} onPointerDown={event=>beginDrag('card',event)} onPointerMove={moveDrag} onPointerUp={endDrag} onLostPointerCapture={endDrag} onKeyDown={event=>{if(event.target===event.currentTarget)moveByKey('card',event);}}><h2>{title}</h2><button aria-label="关闭浮卡" onClick={closePanel}><img src={clayClose} width={18} height={18} alt="" aria-hidden="true"/></button></header>
        <div className="clay-card-content" ref={cardContent}>
          {visiblePanel==='raw'&&<><p className="clay-hint">保留原始像素。拖动圆形手柄调整选区，在框内空白处按住拖动；方向键微调，Shift 调整尺寸。</p><button className="clay-primary" disabled={props.renderStatus!=='ready'} onClick={()=>props.onExport(true)}>复制原样 PNG</button><button onClick={()=>props.onCapture('capture.region')}>重新框选</button></>}
          {visiblePanel==='beauty'&&<><StyleTools editor={editor} update={update} onError={props.onError}/><button className="clay-primary" disabled={props.renderStatus!=='ready'} onClick={()=>props.onExport(true)}>应用并复制 PNG</button><details><summary>细调外观</summary><label>背景颜色<input type="color" aria-label="背景颜色" value={editor.background} onChange={event=>update({background:event.target.value})}/></label><Range label="留白" value={editor.padding} max={200} onChange={padding=>update({padding})}/><Range label="圆角" value={editor.radius} max={100} onChange={radius=>update({radius})}/><label className="checkbox-row"><input type="checkbox" checked={editor.shadow} onChange={event=>update({shadow:event.target.checked})}/>柔和阴影</label></details><button onClick={()=>{update({mode:'raw'});setPanel(null);}}>恢复原样</button></>}
          {visiblePanel==='text'&&<TextTools {...props.textTools} compact/>}
          {visiblePanel==='properties'&&<><AnnotationPalette selection={props.selection} disabled={props.renderStatus!=='ready'} canvasRef={canvasRef} onError={props.onError}/><button disabled={!props.selection} onClick={()=>canvasRef.current?.remove()}><Trash2 aria-hidden="true"/>删除选中标注</button></>}
          {visiblePanel==='recovery'&&props.recoveryPanel}
          {visiblePanel==='settings'&&<><button onClick={props.onConfigure}><Settings2 aria-hidden="true"/>服务设置与应用更新</button><button onClick={()=>{void native.request('app.terms').catch(props.onError);}}>使用条款</button><CaptureControls onStart={props.clearNotice} backend={props.captureBackend} disabled={!!busy} onCapture={props.onCapture} onError={props.onError}/><CaptureBackendSelector backend={props.captureBackend} disabled={!!busy} onChange={props.onCaptureBackend}/></>}
          {visiblePanel==='more'&&<><div className="clay-action-list"><button onClick={()=>props.onCapture('capture.region')}>重新框选</button><button onClick={props.onOpenImage}><ImagePlus aria-hidden="true"/>打开图片</button><button onClick={props.onOpenProject}><FolderOpen aria-hidden="true"/>打开项目</button><button onClick={props.onPaste}>粘贴图片</button><button disabled={!hasContent} onClick={props.onSaveProject}>保存可编辑项目</button><button onClick={()=>setPanel('recovery')}>历史与恢复</button><button onClick={()=>setPanel('settings')}>设置、更新与条款</button></div><details><summary>裁剪、尺寸与导出</summary><TransformPanel document={doc} onTransform={props.onTransform}/><label>导出倍率<select aria-label="导出倍率" value={props.scale} onChange={event=>props.setScale(Number(event.target.value))}><option value={1}>1× 当前尺寸</option><option value={2}>2× 尺寸</option></select></label></details><button onClick={()=>setPositions({})}><RotateCcw aria-hidden="true"/>重置工具位置</button><p className="clay-hint">拖动把手或卡片标题移动，也可聚焦后用方向键微调。位置仅在本次编辑中保留。</p></>}
        </div>
      </section>}
    </fieldset>
    <div className="clay-status" style={{left:screen.x+16,top:screen.y+12,maxWidth:screen.width-32}}><RecoveryStatus state={props.recoveryState}/>{(!adjusting&&busy||aiBusy||hasContent&&props.renderStatus==='loading')&&<div role="status" className="clay-task"><span className="spinner"/>{busy||aiBusy||'画布更新中'}…{aiBusy&&<button onClick={props.textTools.onCancelOcr}>取消任务</button>}</div>}</div>
    {props.notice&&<div className={'clay-notice '+(props.notice.error?'is-error':'')} role={props.notice.error?'alert':'status'}><span>{props.notice.text}</span><button aria-label="关闭提示" onClick={props.clearNotice}><img src={clayClose} width={18} height={18} alt="" aria-hidden="true"/></button></div>}
  </div>;
}
function Range({label,value,max,onChange}:{label:string;value:number;max:number;onChange:(value:number)=>void}){return <label className="clay-range"><span>{label}<output>{value} px</output></span><input aria-label={label} type="range" style={{'--range-progress':`${value/max*100}%`} as CSSProperties} min={0} max={max} value={value} onChange={event=>onChange(Number(event.target.value))}/></label>;}
