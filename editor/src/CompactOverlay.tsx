import { Select } from './Select';
import { flushSync } from 'react-dom';
import { matchesPresentationViewport, readPresentationViewport } from './presentationViewport';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject, type PointerEvent, type KeyboardEvent, type CSSProperties } from 'react';
import { ArrowUpRight, Check, Copy, FolderOpen, Frame, GripVertical, Highlighter, ImagePlus, Languages, MoreHorizontal, RotateCcw, ScanText, Settings2, Shield, Sparkles, Trash2, Type, X } from 'lucide-react';
import { StyleTools } from './StyleTools';
import { TextTools, type TextToolsProps } from './TextTools';
import { CaptureControls } from './CaptureControls';
import { EditorCanvas, type CanvasHandle, type CanvasRenderStatus, type CanvasSelection } from './EditorCanvas';
import { outputSize, type AnnotationKind, type ContentResize, type SourceCrop, type EditorState, type ProjectDocument } from './document';
import { native, type Settings, type PresentationResult } from './bridge';
import { overlayLayout, type OverlayMetadata } from './overlay';
import { overlayKeyAction } from './keyboard';
import { AnnotationPalette, HistoryButtons, TransformPanel } from './EditControls';
import { placeTools, type ToolPositions, type Point } from './toolPlacement';
import tokens from '../../design/soft-clay.tokens.json';
import { CaptureSelection } from './CaptureSelection';
import type { PixelRect } from './overlay';
import clayMore from './assets/soft-clay/more.svg';
import clayClose from './assets/soft-clay/close.svg';

type Panel = 'beauty'|'text'|'more'|'properties'|'recovery';
type Props = {
  suspended?:boolean;
  selection:CanvasSelection|null;onSelection:(selection:CanvasSelection|null)=>void;
  recoveryPanel:ReactNode;textTools:TextToolsProps;
  renderStatus:CanvasRenderStatus;onRenderStatus:(status:CanvasRenderStatus)=>void;
  skipReady:boolean;onFiles:(files:FileList|null)=>Promise<void>;onCapture:(method:string,payload?:object)=>void;
  captureBackend:'wgc'|'gdi'|null;
  document:ProjectDocument;metadata:OverlayMetadata|null;canvasRef:RefObject<CanvasHandle|null>;
  update:(change:Partial<EditorState>,group?:string)=>void;onComplete:()=>void;
  canUndo:boolean;canRedo:boolean;undo:()=>void;redo:()=>void;onTransform:(crop:SourceCrop|null,resize:ContentResize|null)=>void;
  onAi:(kind:'ocr'|'translate')=>void;onPresentation:(mode:'workbench'|'hidden')=>void;
  onTranslateImage:()=>void;onCancelAi:()=>void;
  onConfigure:()=>void;onSaveProject:()=>void;onError:(error:unknown)=>void;
  busy:string;aiBusy:string;settings:Settings;providerId:string;setProviderId:(id:string)=>void;
  targetLanguage:string;setTargetLanguage:(language:string)=>void;scale:number;setScale:(scale:number)=>void;
  notice:{text:string;error?:boolean}|null;clearNotice:()=>void;onReadyResult:(captureId:string,result:PresentationResult)=>void;
  onOpenImage:()=>void;onOpenProject:()=>void;onPaste:()=>void;locked:boolean;
  onAdjustCapture:(area:PixelRect)=>Promise<boolean>;
  requestedPanel:{kind:'more'|'recovery';sequence:number}|null;
};

/** 冻结选区与无冻结文件共用外壳；路径、工具位置和浮卡始终不写入项目模型。 */
export function CompactOverlay(props:Props) {
  const {document:doc,metadata,canvasRef,update,busy,aiBusy}=props,editor=doc.editor;
  const [panel,setPanel]=useState<Panel|null>(null),[positions,setPositions]=useState<ToolPositions>({});
  // 保留关闭中的浮卡直到退出动画结束；减弱动态效果时立即移除。
  const [visiblePanel,setVisiblePanel]=useState<Panel|null>(panel);
  useEffect(()=>{if(panel){setVisiblePanel(panel);return;}if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){setVisiblePanel(null);return;}const timer=setTimeout(()=>setVisiblePanel(null),tokens.motion.close);return()=>clearTimeout(timer);},[panel]);
  // 拖动只预览工具避让，松手才请求裁剪，避免逐帧传输截图。
  const [selectionPreview,setSelectionPreview]=useState<PixelRect|null>(null);
  const selectionDragging=useRef(false);
  // 只在新的截图会话重置位置，选区移动或缩放不覆盖用户的手动摆放。
  useEffect(()=>setPositions({}),[metadata?.captureId]);
  const [chromeVisible,setChromeVisible]=useState(!metadata||props.skipReady);
  useEffect(()=>{if(!metadata||props.skipReady)setChromeVisible(true);},[Boolean(metadata),props.skipReady]);
  const [preparing,setPreparing]=useState(false),[drawingTool,setDrawingTool]=useState<AnnotationKind|null>(null);
  const [paintedImage,setPaintedImage]=useState<ProjectDocument["image"]>(null);
  const [viewport,setViewport]=useState(readPresentationViewport);
  const renderedViewport=useRef(viewport);renderedViewport.current=viewport;
  // 首次渲染必须给选区映射有效尺寸，随后由内容实测替换；CSS 仍按内容收缩。
  const [railSize,setRailSize]=useState({width:1,height:52}),[canvasReady,setCanvasReady]=useState(false);
  const trigger=useRef<HTMLButtonElement|null>(null),railRef=useRef<HTMLDivElement>(null),readySent=useRef(false),composing=useRef(false);
  const drag=useRef<{kind:'rail'|'card';pointer:number;start:Point;origin:Point}|null>(null);
  const cardContent=useRef<HTMLDivElement>(null);
  const latest=useRef({props,panel});latest.current={props,panel};
  const hasContent=Boolean(doc.image)||editor.mode==='reflow';
  const canTransform=Boolean(doc.image)&&editor.mode!=='reflow'; // 图片裁剪不适用于空文档或生成的文字卡片。
  let output={width:doc.image?.width||1,height:doc.image?.height||1};
  try{output=outputSize(doc.image,editor);}catch{/* 画布报告尺寸错误，工具仍允许修正文字。 */}
  const padding=editor.mode==='beauty'?editor.padding:0;
  const previewOutput=selectionPreview&&editor.mode!=='reflow'?{width:selectionPreview.width+padding*2,height:selectionPreview.height+padding*2}:output;
  const adjusting=busy==='调整截图选区',canvasSettled=props.renderStatus==='ready'&&paintedImage===doc.image;
  const mapped=metadata?overlayLayout(selectionPreview?{...metadata,selection:selectionPreview}:metadata,viewport,previewOutput,editor.mode==='beauty'?editor.padding:0,{...railSize,statusHeight:0},selectionPreview||editor.mode==='reflow'?undefined:editor.crop||(editor.resize?{x:0,y:0}:undefined)):null;
  const screen=mapped?.screen??{x:0,y:0,...viewport};
  const tools=placeTools(screen,mapped?.frame??null,railSize,{width:visiblePanel==='text'?420:360,height:visiblePanel==='properties'?400:620},positions);
  function closePanel(){setPanel(null);trigger.current?.focus();}
  function openPanel(next:Panel,button?:HTMLButtonElement){if(button)trigger.current=button;setPanel(current=>current===next?null:next);}
  useEffect(()=>{if(props.requestedPanel)setPanel(props.requestedPanel.kind);},[props.requestedPanel]);
  useEffect(()=>{if(cardContent.current)cardContent.current.scrollTop=0;},[panel]);
  useEffect(()=>{if(props.selection)setPanel('properties');},[props.selection?.id]);
  // resize 回调同步提交整组布局；选区、画布和工具不能各使用不同一帧的视口。
  useLayoutEffect(()=>{
    const resize=()=>flushSync(()=>setViewport(readPresentationViewport()));
    // 宿主隐藏或布局尚未建立时可能测到零，保留上一次有效尺寸，不能破坏选区首帧。
    const measure=()=>{if(railRef.current){const size={width:railRef.current.offsetWidth,height:railRef.current.offsetHeight};if(size.width<=0||size.height<=0)return;setRailSize(current=>current.width===size.width&&current.height===size.height?current:size);}};
    measure();window.addEventListener('resize',resize);
    const observer=new ResizeObserver(()=>flushSync(measure));if(railRef.current)observer.observe(railRef.current);
    return()=>{window.removeEventListener('resize',resize);observer.disconnect();};
  },[]);
  // 只有当前捕获能让静态选区进入宿主合成；迟到的旧回调不能解开新截图的遮挡。
  useLayoutEffect(()=>{
    window.screenshotPresentCapture=id=>{if(id!==metadata?.captureId)return false;flushSync(()=>setPreparing(true));return true;};
    return()=>{delete window.screenshotPresentCapture;};
  },[metadata?.captureId]);
  useEffect(()=>{
    if(props.skipReady||!canvasReady||!canvasSettled||readySent.current||!metadata?.captureId)return;
    let cancelled=false;const id=metadata.captureId;
    // 先在原生遮挡后展示 WebView；视口与工具布局连续稳定且宿主核对通过才交接。
    const timer=setTimeout(()=>{readySent.current=true;void (async()=>{
      let result=await native.request<PresentationResult>('presentation.ready',{captureId:id});
      if(cancelled)return;
      if(result.accepted!==false&&result.awaitingPaint){
        if(!result.hostFrameGate)flushSync(()=>setPreparing(true));
        const deadline=performance.now()+12000;let previous='';
        // 等待宿主目标视口与实际 DOM 一致，而不是把任意两帧误当作 DPI 已稳定。
        while(result.awaitingPaint){
          // 宿主在原生选区下方显示时动画帧可能被延后；定时器只推进几何核对，真正揭示仍由原生验帧决定。
          await new Promise<void>(resolve=>{
            let finished=false;
            const done=()=>{if(finished)return;finished=true;clearTimeout(timer);cancelAnimationFrame(frame);resolve();};
            const timer=setTimeout(done,32),frame=requestAnimationFrame(done);
          });if(cancelled)return;
          if(performance.now()>deadline)throw new Error('截图布局未能及时稳定，请重新截图。');
          const actual=readPresentationViewport(),rail=railRef.current;
          const signature=JSON.stringify([actual,rail?.offsetLeft,rail?.offsetTop,rail?.offsetWidth,rail?.offsetHeight]);
          if(!matchesPresentationViewport(actual,result.viewport)||!matchesPresentationViewport(actual,renderedViewport.current)||signature!==previous){previous=signature;continue;}
          result=await native.request<PresentationResult>('presentation.painted',{captureId:id,viewport:actual});previous='';
        }
      }
      if(!cancelled){if(result.accepted!==false)setChromeVisible(true);props.onReadyResult(id,result);}
    })().catch(props.onError);},0);
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
      if(action==='exit-object')current.canvasRef.current?.exitSelection();else if(action==='close-panel')closePanel();else if(action==='copy-image')current.onComplete();else current.onPresentation('hidden');
    };
    window.addEventListener('compositionstart',start);window.addEventListener('compositionend',end);window.addEventListener('keydown',keydown);
    return()=>{window.removeEventListener('compositionstart',start);window.removeEventListener('compositionend',end);window.removeEventListener('keydown',keydown);};
  },[]);
  function beginDrag(kind:'rail'|'card',event:PointerEvent<HTMLElement>){
    if(event.button!==0||(event.target as Element).closest('button,input,select,textarea'))return;
    // 开始手动操作即固定两组当前位置，关闭自动避让；拖动允许跨屏和与其他面板重叠。
    setPositions({rail:{x:tools.rail.x,y:tools.rail.y},card:{x:tools.card.x,y:tools.card.y}});
    const origin=kind==='rail'?tools.rail:tools.card;drag.current={kind,pointer:event.pointerId,start:{x:event.clientX,y:event.clientY},origin};event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();
  }
  function moveDrag(event:PointerEvent<HTMLElement>){const current=drag.current;if(!current||current.pointer!==event.pointerId)return;const point={x:current.origin.x+event.clientX-current.start.x,y:current.origin.y+event.clientY-current.start.y};setPositions(value=>({...value,[current.kind]:point}));}
  function endDrag(){drag.current=null;}
  function moveByKey(kind:'rail'|'card',event:KeyboardEvent<HTMLElement>){
    const delta=event.shiftKey?24:8,directions:Record<string,Point>={ArrowLeft:{x:-delta,y:0},ArrowRight:{x:delta,y:0},ArrowUp:{x:0,y:-delta},ArrowDown:{x:0,y:delta}};
    const direction=directions[event.key];if(!direction)return;event.preventDefault();const current=tools[kind];setPositions(value=>({...value,rail:value.rail??{x:tools.rail.x,y:tools.rail.y},card:value.card??{x:tools.card.x,y:tools.card.y},[kind]:{x:current.x+direction.x,y:current.y+direction.y}}));
  }
  const title=visiblePanel==='beauty'?'美化截图':visiblePanel==='text'?'识别与校对':visiblePanel==='properties'?'标注属性':visiblePanel==='recovery'?'历史与恢复':'更多操作';
  return <div data-editor-root className={'clay-editor '+(metadata?'is-overlay':'is-neutral')+(chromeVisible?' is-presented':' is-awaiting')+(preparing?' is-preparing':'')+(props.suspended?' is-suspended':'')} inert={props.locked} onKeyDownCapture={event=>{const target=event.target;if(event.key==='Escape'&&!event.nativeEvent.isComposing&&!composing.current&&target instanceof HTMLElement&&target.matches('input,textarea,select')){event.preventDefault();event.stopPropagation();target.blur();}}} onDragOver={event=>{if(Array.from(event.dataTransfer.types).includes('Files'))event.preventDefault();}} onDrop={event=>{event.preventDefault();void props.onFiles(event.dataTransfer.files);}}>
    <CaptureSelection viewport={viewport} metadata={metadata} disabled={!!busy||!!aiBusy||props.locked||!canvasSettled} settled={canvasSettled&&!busy} onAdjust={props.onAdjustCapture} onPreview={setSelectionPreview} onDragging={active=>{selectionDragging.current=active;}} hitAnnotation={event=>canvasRef.current?.hasAnnotationAt(event)??false} onBegin={()=>canvasRef.current?.exitSelection()}>
    <div className={metadata?'clay-canvas-fixed':'clay-canvas-stage'} inert={!!busy} style={mapped?{visibility:selectionPreview?'hidden':undefined,left:mapped.frame.x,top:mapped.frame.y,width:mapped.frame.width,height:mapped.frame.height}:undefined}>
      {hasContent?<EditorCanvas ref={canvasRef} showViewControls={visiblePanel!=='recovery'} document={doc} onDrawingToolChange={setDrawingTool} onSelection={props.onSelection} onRenderStatus={props.onRenderStatus} fixedDisplayScale={mapped?.scale} onReady={()=>{setCanvasReady(true);setPaintedImage(doc.image);}} onAnnotations={(annotations,group)=>update({annotations},group)} onError={props.onError}/>:<div className="clay-launcher"><Frame size={32} aria-hidden="true"/><h1>截图，接着编辑。</h1><p>从托盘或快捷键开始，也可以打开本机文件。</p><button className="clay-primary" disabled={!!busy} onClick={()=>props.onCapture('capture.region')}>区域截图</button><button disabled={!!busy} onClick={props.onOpenImage}>打开图片</button><button disabled={!!busy} onClick={props.onOpenProject}>打开项目</button></div>}
    </div>
    </CaptureSelection>
    <fieldset className="clay-chrome" disabled={!!busy&&!adjusting} inert={adjusting||Boolean(selectionPreview&&!selectionDragging.current)}>
      <div className="clay-rail" ref={railRef} role="toolbar" aria-label="截图编辑工具" style={{left:tools.rail.x,top:tools.rail.y,maxWidth:tools.area.width,maxHeight:tools.area.height}}>
        <span className="clay-grip" role="button" tabIndex={0} aria-label="移动动作轨，方向键微调" onPointerDown={event=>beginDrag('rail',event)} onPointerMove={moveDrag} onPointerUp={endDrag} onLostPointerCapture={endDrag} onKeyDown={event=>moveByKey('rail',event)}><GripVertical aria-hidden="true"/></span>
        {/* 美化、提取文字只打开面板；图片翻译是明确的网络动作，直接替换选区外语。 */}
        <div className="clay-image-tools" role="group" aria-label="图片工具">
          <button title="美化图片" aria-label="美化图片" aria-expanded={panel==='beauty'} aria-controls={panel==='beauty'?'clay-active-panel':undefined} disabled={!hasContent} onClick={event=>openPanel('beauty',event.currentTarget)}><ImageAppearanceIcon/></button>
          <button title="提取文字（OCR）" aria-label="提取文字" aria-expanded={panel==='text'} aria-controls={panel==='text'?'clay-active-panel':undefined} disabled={!hasContent} onClick={event=>openPanel('text',event.currentTarget)}><ScanText aria-hidden="true"/></button>
          <button title="翻译图片：将选区外语替换为中文" aria-label="翻译图片为中文" aria-busy={aiBusy==='翻译图片'} disabled={!doc.image||editor.mode==='reflow'||!!aiBusy||props.renderStatus!=='ready'} onClick={()=>{setPanel(null);canvasRef.current?.exitSelection();props.onTranslateImage();}}><Languages aria-hidden="true"/></button>
          {aiBusy==='翻译图片'&&<button title="取消图片翻译" aria-label="取消图片翻译" onClick={props.onCancelAi}><X aria-hidden="true"/></button>}
        </div>
        <HistoryButtons canUndo={props.canUndo} canRedo={props.canRedo} undo={props.undo} redo={props.redo}/>
        {([{kind:'text',label:'文字标注',icon:Type},{kind:'rect',label:'矩形标注',icon:Frame},{kind:'arrow',label:'箭头标注',icon:ArrowUpRight},{kind:'highlight',label:'高亮标注',icon:Highlighter},{kind:'cover',label:'实色遮盖',icon:Shield}] as const).map(item=><button key={item.kind} title={item.label} aria-label={item.label} aria-pressed={drawingTool===item.kind} disabled={!hasContent||props.renderStatus!=='ready'} onClick={()=>{setPanel(null);canvasRef.current?.add(item.kind);}}><item.icon aria-hidden="true"/></button>)}
        <button className="clay-primary" aria-label="完成" title="完成并复制到剪贴板" disabled={!hasContent||props.renderStatus!=='ready'} onClick={props.onComplete}><Check aria-hidden="true"/>完成</button>
        <button aria-label="更多操作" aria-expanded={panel==='more'} onClick={event=>openPanel('more',event.currentTarget)}><img src={clayMore} width={20} height={20} alt="" aria-hidden="true"/></button><button aria-label="收起编辑，保留文档" title="收起编辑" onClick={()=>props.onPresentation('hidden')}><img src={clayClose} width={18} height={18} alt="" aria-hidden="true"/></button>
      </div>
      {visiblePanel&&<section id="clay-active-panel" aria-hidden={!panel} className={'clay-card '+(visiblePanel==='more'?'clay-drawer ':'')+(!panel?'is-closing':'')} role="region" aria-label={title} style={{left:tools.card.x,top:tools.card.y,width:tools.card.width,maxHeight:tools.card.height}}>
        <header className="clay-card-heading" tabIndex={0} aria-label={'移动'+title+'，方向键微调'} onPointerDown={event=>beginDrag('card',event)} onPointerMove={moveDrag} onPointerUp={endDrag} onLostPointerCapture={endDrag} onKeyDown={event=>{if(event.target===event.currentTarget)moveByKey('card',event);}}><h2>{title}</h2><button aria-label="关闭浮卡" onClick={closePanel}><img src={clayClose} width={18} height={18} alt="" aria-hidden="true"/></button></header>
        <div className="clay-card-content" ref={cardContent}>
          {visiblePanel==='beauty'&&<><StyleTools editor={editor} update={update} onError={props.onError}/><details><summary>细调外观</summary><label>背景颜色<input type="color" aria-label="背景颜色" value={editor.background} onChange={event=>update({background:event.target.value,mode:'beauty'})}/></label><Range label="留白" value={editor.padding} max={200} onChange={padding=>update({padding,mode:'beauty'})}/><Range label="圆角" value={editor.radius} max={100} onChange={radius=>update({radius,mode:'beauty'})}/><label className="checkbox-row"><input type="checkbox" checked={editor.shadow} onChange={event=>update({shadow:event.target.checked,mode:'beauty'})}/>柔和阴影</label></details><button onClick={()=>{update({mode:'raw'});setPanel(null);}}>恢复原样</button></>}
          {visiblePanel==='text'&&<TextTools {...props.textTools} compact/>}
          {visiblePanel==='properties'&&<><AnnotationPalette selection={props.selection} disabled={props.renderStatus!=='ready'} canvasRef={canvasRef} onError={props.onError}/><button className="clay-danger" disabled={!props.selection} onClick={()=>canvasRef.current?.remove()}><Trash2 aria-hidden="true"/>删除选中标注</button></>}
          {visiblePanel==='recovery'&&props.recoveryPanel}
          {visiblePanel==='more'&&<>
            <section className="clay-section"><h3>截图与文件</h3><div className="clay-action-grid"><button onClick={()=>props.onCapture('capture.region')}>重新框选</button><button onClick={props.onOpenImage}><ImagePlus aria-hidden="true"/>打开图片</button><button onClick={props.onOpenProject}><FolderOpen aria-hidden="true"/>打开项目</button><button onClick={props.onPaste}>粘贴图片</button></div></section>
            <CaptureControls onStart={props.clearNotice} backend={props.captureBackend} disabled={!!busy} onCapture={props.onCapture} onError={props.onError}/>
            <section className="clay-section"><h3>项目与记录</h3><div className="clay-action-grid"><button disabled={!hasContent} onClick={props.onSaveProject}>保存项目</button><button onClick={()=>setPanel('recovery')}>以前的记录</button></div></section>
            <section className="clay-section"><h3>输出设置</h3>
              <label>复制图片的尺寸<Select aria-label="导出倍率" value={props.scale} disabled={!hasContent} onChange={value=>props.setScale(Number(value))}><option value={1}>1× 当前尺寸</option><option value={2}>2× 尺寸</option></Select></label>
              {canTransform?<details><summary>裁剪与缩放</summary><TransformPanel document={doc} onTransform={props.onTransform}/></details>:<div className="clay-unavailable-tool"><span>裁剪与缩放</span><p>{editor.mode==='reflow'?'文字卡片不支持图片裁剪。':'截图或打开图片后可用。'}</p></div>}
            </section>
            <div className="clay-action-grid"><button onClick={()=>{setPanel(null);props.onConfigure();}}><Settings2 aria-hidden="true"/>设置</button><button onClick={()=>setPositions({})}><RotateCcw aria-hidden="true"/>重置工具位置</button></div>
          </>}
        </div>
      </section>}
    </fieldset>
    {(!adjusting&&busy||aiBusy||hasContent&&props.renderStatus==='loading')&&<div className="clay-status" style={{left:screen.x+16,top:screen.y+12,maxWidth:screen.width-32}}><div role="status" className="clay-task"><span className="spinner"/>{busy||aiBusy||'画布更新中'}…{aiBusy&&<button onClick={props.textTools.onCancelOcr}>取消任务</button>}</div></div>}
    {props.notice&&<div className={'clay-notice '+(props.notice.error?'is-error':'')} role={props.notice.error?'alert':'status'}><span>{props.notice.text}</span><button aria-label="关闭提示" onClick={props.clearNotice}><img src={clayClose} width={18} height={18} alt="" aria-hidden="true"/></button></div>}
  </div>;
}
function Range({label,value,max,onChange}:{label:string;value:number;max:number;onChange:(value:number)=>void}){return <label className="clay-range"><span>{label}<output>{value} px</output></span><input aria-label={label} type="range" style={{'--range-progress':`${value/max*100}%`} as CSSProperties} min={0} max={max} value={value} onChange={event=>onChange(Number(event.target.value))}/></label>;}

/** 图片边框与星芒表示外观美化，避免和用于绘制标注的文字 T 图标混淆。 */
function ImageAppearanceIcon(){
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>
    <circle cx="8" cy="9" r="1.2"/>
    <path d="m3 17 5-5 4 4 3-3 6 6M18 2l1.2 3.8L23 7l-3.8 1.2L18 12l-1.2-3.8L13 7l3.8-1.2Z"/>
  </svg>;
}
