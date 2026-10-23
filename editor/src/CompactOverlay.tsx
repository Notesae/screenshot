import { ControlButton } from './ControlMotion';
import { MotionDetails } from './MotionDetails';
import { useSurfaceMotion } from './SurfaceMotion';
import { useBackdropMotion } from './BackdropMotion';
import { MotionButton, presentationMotion, useLiquidMotion } from './LiquidMotion';
import { TranslationTools } from './TranslationTools';
import { ToolGlyph } from './ToolGlyph';
import { AnnotationToolButton } from './AnnotationToolButton';
import { PanelSkin } from './PanelSkin';
import { annotationNames } from './annotationAppearance';
import { usePanelPage } from './usePanelPage';
import { useToolHoverPanel } from './useToolHoverPanel';
import { RailBody } from './RailBody';
import { Select } from './Select';
import { TooltipLayer } from './TooltipLayer';
import { OverlayScrollbars } from './OverlayScrollbars';
import { flushSync } from 'react-dom';
import { matchesPresentationViewport, readPresentationViewport } from './presentationViewport';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject, type PointerEvent, type KeyboardEvent } from 'react';
import { Check, Copy, FolderOpen, Frame, GripVertical, ImagePlus, MoreHorizontal, Pin, RotateCcw, ScanText, Settings2, Sparkles, X } from 'lucide-react';
import { StyleTools } from './StyleTools';
import { TextTools, type TextToolsProps } from './TextTools';
import { CaptureControls } from './CaptureControls';
import { EditorCanvas, type CanvasHandle, type CanvasRenderStatus, type CanvasSelection } from './EditorCanvas';
import { outputSize, type AnnotationKind, type ContentResize, type SourceCrop, type EditorState, type ProjectDocument } from './document';
import { native, type Settings, type PresentationResult } from './bridge';
import { overlayLayout, type OverlayMetadata } from './overlay';
import { overlayKeyAction } from './keyboard';
import { AnnotationPalette, HistoryButtons, TransformPanel } from './EditControls';
import { boundTool, placeTools, type ToolPositions, type Point } from './toolPlacement';
import { CaptureSelection } from './CaptureSelection';
import type { PixelRect } from './overlay';
import { ImageTranslationReader, translationReaderPlacement } from './ImageTranslationReader';



type Panel = 'beauty'|'text'|'more'|'properties'|'recovery';

/** 用未裁切的正文高度贴近导轨；展开折叠区时只重新摆放，不读取动效的缩放矩形。 */
function usePanelHeight(content:RefObject<HTMLDivElement|null>,panel:Panel|null,width:number,maximum:number) {
  const [measured,setMeasured]=useState<{panel:Panel;width:number;height:number}|null>(null);
  useLayoutEffect(()=>{
    const body=content.current,heading=body?.previousElementSibling;
    if(!panel||!body||!(heading instanceof HTMLElement))return;
    const measure=()=>{
      const height=Math.min(maximum,Math.ceil(heading.offsetHeight+body.scrollHeight));
      if(height>0)setMeasured(current=>current?.panel===panel&&current.width===width&&current.height===height?current:{panel,width,height});
    };
    const resize=new ResizeObserver(()=>flushSync(measure));
    const observe=()=>{resize.disconnect();resize.observe(body);resize.observe(heading);for(const child of body.children)resize.observe(child);measure();};
    const changes=new MutationObserver(observe);changes.observe(body,{childList:true,subtree:true,characterData:true});
    observe();return()=>{resize.disconnect();changes.disconnect();};
  },[content,panel,width,maximum]);
  // 切换先沿用当前高度，布局效应实测后再重定向，避免短暂跳到最大高度。
  return measured?.height??maximum;
}

type Props = {
  suspended?:boolean;
  selection:CanvasSelection|null;onSelection:(selection:CanvasSelection|null)=>void;
  recoveryPanel:ReactNode;textTools:TextToolsProps;
  renderStatus:CanvasRenderStatus;onRenderStatus:(status:CanvasRenderStatus)=>void;
  skipReady:boolean;onFiles:(files:FileList|null)=>Promise<void>;onCapture:(method:string,payload?:object)=>void;
  captureBackend:'wgc'|'gdi'|null;
  document:ProjectDocument;metadata:OverlayMetadata|null;canvasRef:RefObject<CanvasHandle|null>;
  update:(change:Partial<EditorState>,group?:string)=>void;onComplete:()=>void;onCancelComplete:()=>void;onPin:()=>void;
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
  const [inspectedTool,setInspectedTool]=useState<AnnotationKind|null>(null);
  // 对比绑定当前不可变文档；任何编辑、关闭、忙状态或隐藏立即回到真实成品。
  const [comparison,setComparison]=useState<ProjectDocument|null>(null);
  const comparing=comparison===doc&&panel==='beauty'&&editor.mode==='beauty'&&!props.suspended&&!props.locked&&!busy&&!aiBusy;
  useEffect(()=>{
    const clear=()=>setComparison(null),hidden=()=>{if(window.document.hidden)clear();};
    window.addEventListener('blur',clear);window.document.addEventListener('visibilitychange',hidden);
    return()=>{window.removeEventListener('blur',clear);window.document.removeEventListener('visibilitychange',hidden);};
  },[]);
  useEffect(()=>{if(!comparing)setComparison(null);},[comparing]);
  const [reading,setReading]=useState(false),readerTrigger=useRef<HTMLButtonElement|null>(null);
  const [readerBounds,setReaderBounds]=useState<PixelRect|null>(null);
  // 退出保留独立材质与最后一条通知，避免立即卸载截断时间线。
  const readerRoot=useRef<HTMLElement>(null),noticeRoot=useRef<HTMLDivElement>(null),statusRoot=useRef<HTMLDivElement>(null),restoreReaderFocus=useRef(false);
  const retainedNotice=useRef(props.notice),notice=props.notice??retainedNotice.current;
  useLayoutEffect(()=>{if(props.notice)retainedNotice.current=props.notice;},[props.notice]);
  useEffect(()=>setReading(false),[doc.image,editor.imageTranslation,editor.mode]);
  // 表现层只持有 DOM，不写入截图、历史或项目。
  const rootRef=useRef<HTMLDivElement>(null);
  // 拖动只预览工具避让，松手才请求裁剪，避免逐帧传输截图。
  const [selectionPreview,setSelectionPreview]=useState<PixelRect|null>(null);
  const selectionDragging=useRef(false);
  const selectionTools=useRef<{area:PixelRect;next:PixelRect;rail:Point;card?:Point;above:boolean}|null>(null);
  // 只在新的截图会话重置位置，选区移动或缩放不覆盖用户的手动摆放。
  useEffect(()=>{setPositions({});setReaderBounds(null);},[metadata?.captureId]);
  const [chromeVisible,setChromeVisible]=useState(!metadata||props.skipReady);
  useEffect(()=>{if(!metadata||props.skipReady)setChromeVisible(true);},[Boolean(metadata),props.skipReady]);
  const [preparing,setPreparing]=useState(false),[drawingTool,setDrawingTool]=useState<AnnotationKind|null>(null);
  // 悬停仅查看该工具；绘制中调下一笔样式，退出工具后才修改匹配的选中对象。
  const requestedSelection=!drawingTool&&props.selection&&(props.selection.type===inspectedTool||props.selection.type==='cover'&&inspectedTool==='mosaic')?props.selection:null;
  const requestedTool=inspectedTool;
  const pageKey=panel==='properties'?panel+':'+(requestedSelection?.type??requestedTool??''):panel;
  const {shown,switching,page,closed}=usePanelPage(panel?{key:pageKey!,panel,selection:requestedSelection,tool:requestedTool}:null,rootRef);
  const visiblePanel=shown?.panel??null,propertySelection=shown?.selection??null,propertyTool=shown?.tool??null;
  const [paintedImage,setPaintedImage]=useState<ProjectDocument["image"]>(null);
  const [viewport,setViewport]=useState(readPresentationViewport);
  const renderedViewport=useRef(viewport);renderedViewport.current=viewport;
  // 首次渲染必须给选区映射有效尺寸，随后由内容实测替换；CSS 仍按内容收缩。
  const [railSize,setRailSize]=useState({width:1,height:52}),[canvasReady,setCanvasReady]=useState(false);
  const trigger=useRef<HTMLButtonElement|null>(null),railRef=useRef<HTMLDivElement>(null),readySent=useRef(false),composing=useRef(false);
  const [,refreshPanelOrigin]=useState(0);
  const drag=useRef<{kind:'rail'|'card';pointer:number;start:Point;origin:Point}|null>(null);
  const cardContent=useRef<HTMLDivElement>(null);
  const latest=useRef({props,panel,reading,readingFull:false,comparing});
  const hasContent=Boolean(doc.image)||editor.mode==='reflow';
  const canTransform=Boolean(doc.image)&&editor.mode!=='reflow'; // 图片裁剪不适用于空文档或生成的文字卡片。
  let output={width:doc.image?.width||1,height:doc.image?.height||1};
  try{output=outputSize(doc.image,editor);}catch{/* 画布报告尺寸错误，工具仍允许修正文字。 */}
  const padding=editor.mode==='beauty'?editor.padding:0;
  const previewOutput=selectionPreview&&editor.mode!=='reflow'?{width:selectionPreview.width+padding*2,height:selectionPreview.height+padding*2}:output;
  const adjusting=busy==='调整截图选区',canvasSettled=props.renderStatus==='ready'&&paintedImage===doc.image;
  const mapped=metadata?overlayLayout(selectionPreview?{...metadata,selection:selectionPreview}:metadata,viewport,previewOutput,editor.mode==='beauty'?editor.padding:0,{...railSize,statusHeight:0},selectionPreview||editor.mode==='reflow'?undefined:editor.crop||(editor.resize?{x:0,y:0}:undefined)):null;
  const screen=mapped?.screen??{x:0,y:0,...viewport};
  const panelWidth=visiblePanel==='text'?420:visiblePanel==='properties'?340:380;
  const panelHeight=usePanelHeight(cardContent,visiblePanel,panelWidth,620);
  const railBounds=railRef.current?.getBoundingClientRect();
  const sourceBounds=trigger.current&&railRef.current?.contains(trigger.current)?trigger.current.getBoundingClientRect():null;
  const sourceOffset=sourceBounds&&railBounds?{x:sourceBounds.x+sourceBounds.width/2-railBounds.x,y:sourceBounds.y+sourceBounds.height/2-railBounds.y}:undefined;
  const following=selectionPreview?followSelection(selectionPreview):null;
  const tools=placeTools(screen,mapped?.frame??null,railSize,{width:panelWidth,height:panelHeight},following??positions,sourceOffset);
  // 胶边使用真实物理选区换算后的矩形，独立于美化留白和画布显示尺寸。
  const captureArea=selectionPreview??metadata?.selection;
  const captureRim=metadata&&captureArea&&!metadata.contentScale?{x:(captureArea.x-metadata.desktopBounds.x)*viewport.width/metadata.desktopBounds.width,y:(captureArea.y-metadata.desktopBounds.y)*viewport.height/metadata.desktopBounds.height,width:captureArea.width*viewport.width/metadata.desktopBounds.width,height:captureArea.height*viewport.height/metadata.desktopBounds.height}:null;
  useLiquidMotion(rootRef,railRef,chromeVisible&&!props.suspended,panel,visiblePanel,trigger,tools.card,tools.rail,mapped?.frame??null,captureRim,closed);
  const automaticReader=editor.imageTranslation&&editor.mode!=='reflow'?translationReaderPlacement(screen,mapped?.frame??null,tools.rail):null;
  // 手动移动/缩放后固定窗口矩形；允许用户移到截图旁边，不因工具避让或重开而跳回。
  const reader=automaticReader?{box:readerBounds??automaticReader.box,full:automaticReader.full&&!readerBounds}:null;
  const readerMounted=useSurfaceMotion(reading&&!!automaticReader,readerRoot,readerTrigger.current,JSON.stringify(reader?.box));
  const noticeTop=tools.rail.y<screen.y+110?screen.y+screen.height-100:screen.y+18;
  const noticeMounted=useSurfaceMotion(!!props.notice,noticeRoot,null,noticeTop+':'+screen.width);
  const currentTask=(!adjusting&&busy||aiBusy||!selectionPreview&&hasContent&&props.renderStatus==='loading')?{text:busy||aiBusy||'画布更新中',cancel:aiBusy?'ocr':busy==='完成截图'?'complete':null}:null;
  const retainedTask=useRef(currentTask),task=currentTask??retainedTask.current;
  useLayoutEffect(()=>{if(currentTask)retainedTask.current=currentTask;},[currentTask]);
  const taskOpen=!!currentTask&&chromeVisible&&!props.suspended;
  const statusMounted=useSurfaceMotion(taskOpen,statusRoot,null,screen.x+':'+screen.y+':'+screen.width);
  const fullReading=Boolean(readerMounted&&reader?.full);
  const hover=useToolHoverPanel(rootRef,{enabled:chromeVisible&&!props.suspended&&!props.locked&&!busy&&!fullReading,open:button=>{
    const next=button.dataset.hoverPanel as Panel;
    panelOrigin(button);setInspectedTool((button.dataset.annotationKind as AnnotationKind|undefined)??null);setPanel(next);
  },close:()=>setPanel(null)});
  useBackdropMotion(rootRef, metadata?.captureId, chromeVisible && !props.suspended && !props.locked && !busy && !aiBusy && !comparing && !readerMounted && !selectionPreview && canvasSettled,Boolean(selectionPreview)&&props.renderStatus!=='error');
  // 完整阅读退场后再恢复工具焦点，防止把焦点交给仍隐藏的主轨。
  useLayoutEffect(()=>{if(reading)restoreReaderFocus.current=false;else if(!readerMounted&&restoreReaderFocus.current){restoreReaderFocus.current=false;readerTrigger.current?.focus({preventScroll:true});}},[reading,readerMounted]);
  latest.current={props,panel,reading,readingFull:fullReading,comparing};
  function complete(){setComparison(null);props.onComplete();}
  // 手势开始就固定现有工具位置，留白改变成品外框时滑杆不会从指针下移走。
  function beautyGesture(active:boolean){if(active)setPositions({rail:{x:tools.rail.x,y:tools.rail.y},card:{x:tools.card.x,y:tools.card.y}});}
  function closeReader(){restoreReaderFocus.current=true;setReading(false);}
  function closePanel(){hover.dismiss(trigger.current);trigger.current?.focus();}
  function panelOrigin(button:HTMLButtonElement|null){if(trigger.current!==button){trigger.current=button;refreshPanelOrigin(value=>value+1);}}
  function toggleBeauty(){
    hover.dismiss();setComparison(null);canvasRef.current?.exitSelection();
    const mode=editor.mode==='beauty'?'raw':'beauty';
    try{outputSize(doc.image,{...editor,mode});update({mode});}catch(error){props.onError(error);}
  }
  function beginSelectionFollow(){
    if(!metadata||selectionTools.current)return;
    selectionTools.current={area:metadata.selection,next:metadata.selection,rail:{x:tools.rail.x,y:tools.rail.y},card:positions.card,above:tools.rail.y<(mapped?.frame.y??0)};
  }
  /** 相对手势起点平移轨道，避免自动避让在拖动途中上下换边；手动卡片保持相对偏移。 */
  function followSelection(area:PixelRect):ToolPositions|null {
    const start=selectionTools.current;if(!start||!metadata)return null;
    const dx=(area.x+area.width/2-start.area.x-start.area.width/2)*viewport.width/metadata.desktopBounds.width;
    const dy=(area.y-start.area.y+(start.above?0:area.height-start.area.height))*viewport.height/metadata.desktopBounds.height;
    const rail=boundTool({x:start.rail.x+dx,y:start.rail.y+dy},railSize,{x:24,y:24,width:Math.max(1,viewport.width-48),height:Math.max(1,viewport.height-48)});
    return {rail,card:start.card?{x:start.card.x+rail.x-start.rail.x,y:start.card.y+rail.y-start.rail.y}:undefined};
  }
  function previewSelection(area:PixelRect|null){
    if(area){beginSelectionFollow();if(selectionTools.current)selectionTools.current.next=area;}
    else {
      const next=selectionTools.current?.next,committed=metadata?.selection;
      // 新画布提交后沿用落点；取消/失败则仍使用手势前的位置。
      if(next&&committed&&next.x===committed.x&&next.y===committed.y&&next.width===committed.width&&next.height===committed.height){const placement=followSelection(next);if(placement)setPositions(placement);}
      selectionTools.current=null;
    }
    setSelectionPreview(area);
  }
  useEffect(()=>{if(props.requestedPanel){panelOrigin(railRef.current?.querySelector<HTMLButtonElement>('[data-panel-trigger="more"]')??null);setPanel(props.requestedPanel.kind);}},[props.requestedPanel]);
  useEffect(()=>{if(cardContent.current)cardContent.current.scrollTop=0;},[panel]);
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
      if(event.key==='Escape'&&!event.isComposing&&latest.current.props.busy==='完成截图'){event.preventDefault();event.stopPropagation();latest.current.props.onCancelComplete();return;}
      if(event.defaultPrevented||event.repeat||latest.current.props.locked||selectionDragging.current)return;
      const {props:current,panel:currentPanel,reading:currentReading,readingFull}=latest.current,interaction=current.canvasRef.current?.interactionState();
      if(latest.current.comparing&&event.key==='Escape'&&!event.isComposing){event.preventDefault();event.stopPropagation();setComparison(null);return;}
      if(currentReading&&event.key==='Escape'&&!event.isComposing){event.preventDefault();event.stopPropagation();closeReader();return;}
      if(currentReading&&readingFull)return;
      const target=event.target instanceof Element?event.target:null;
      const action=overlayKeyAction({key:event.key,ctrl:event.ctrlKey,meta:event.metaKey,alt:event.altKey,shift:event.shiftKey,composing:event.isComposing||composing.current,textInput:Boolean(target?.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]')),fabricEditing:interaction?.editing||false,selectedObject:interaction?.selected||false,panelOpen:Boolean(currentPanel),textSelection:Boolean(window.getSelection()?.toString())});
      if(action==='ignore')return;event.preventDefault();event.stopPropagation();
      if(action==='exit-object')current.canvasRef.current?.exitSelection();else if(action==='close-panel')closePanel();else if(action==='copy-image'){setComparison(null);current.onComplete();}else current.onPresentation('hidden');
    };
    window.addEventListener('compositionstart',start);window.addEventListener('compositionend',end);window.addEventListener('keydown',keydown);
    return()=>{window.removeEventListener('compositionstart',start);window.removeEventListener('compositionend',end);window.removeEventListener('keydown',keydown);};
  },[]);
  function beginDrag(kind:'rail'|'card',event:PointerEvent<HTMLElement>){
    if(event.button!==0||(event.target as Element).closest('button,input,select,textarea'))return;
    presentationMotion()?.placePanel();
    // 开始手动操作即固定两组当前位置，关闭自动避让；拖动允许跨屏和与其他面板重叠。
    if(rootRef.current)rootRef.current.dataset.motionDragging=kind;
    setPositions(value=>({rail:{x:tools.rail.x,y:tools.rail.y},card:visiblePanel?{x:tools.card.x,y:tools.card.y}:value.card}));
    const origin=kind==='rail'?tools.rail:tools.card;drag.current={kind,pointer:event.pointerId,start:{x:event.clientX,y:event.clientY},origin};event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();
  }
  function moveDrag(event:PointerEvent<HTMLElement>){const current=drag.current;if(!current||current.pointer!==event.pointerId)return;const point={x:current.origin.x+event.clientX-current.start.x,y:current.origin.y+event.clientY-current.start.y};setPositions(value=>({...value,[current.kind]:point}));}
  function endDrag(){drag.current=null;if(rootRef.current)delete rootRef.current.dataset.motionDragging;}
  function moveByKey(kind:'rail'|'card',event:KeyboardEvent<HTMLElement>){
    const delta=event.shiftKey?24:8,directions:Record<string,Point>={ArrowLeft:{x:-delta,y:0},ArrowRight:{x:delta,y:0},ArrowUp:{x:0,y:-delta},ArrowDown:{x:0,y:delta}};
    const direction=directions[event.key];if(!direction)return;event.preventDefault();presentationMotion()?.placePanel(kind==='card');const current=tools[kind];setPositions(value=>({...value,rail:value.rail??{x:tools.rail.x,y:tools.rail.y},card:value.card??(visiblePanel?{x:tools.card.x,y:tools.card.y}:undefined),[kind]:{x:current.x+direction.x,y:current.y+direction.y}}));
  }
  const propertyKind=propertySelection?.type??propertyTool;
  const title=visiblePanel==='beauty'?'美化截图':visiblePanel==='text'?'识别与校对':visiblePanel==='properties'?(propertyKind?annotationNames[propertyKind]:'标注工具'):visiblePanel==='recovery'?'历史记录':'更多操作';
  const panelCaption=visiblePanel==='properties'?(propertySelection?'调整选中的标注':'设置好样式，在画面上绘制'):visiblePanel==='beauty'?'留白、圆角与背景':visiblePanel==='text'?'提取文字，继续校对':visiblePanel==='recovery'?'查看与管理本机记录':'截图、文件与输出';
  return <div ref={rootRef} data-editor-root className={'clay-editor '+(metadata?'is-overlay':'is-neutral')+(chromeVisible?' is-presented':' is-awaiting')+(preparing?' is-preparing':'')+(props.suspended?' is-suspended':'')+(fullReading?' is-reading':'')} inert={props.locked} onKeyDownCapture={event=>{const target=event.target;if(event.key==='Escape'&&!event.nativeEvent.isComposing&&!composing.current&&target instanceof HTMLElement&&target.matches('input,textarea,select')&&!target.closest('.clay-color-popover')){event.preventDefault();event.stopPropagation();target.blur();}}} onDragOver={event=>{if(Array.from(event.dataTransfer.types).includes('Files'))event.preventDefault();}} onDrop={event=>{event.preventDefault();void props.onFiles(event.dataTransfer.files);}}>
    <CaptureSelection viewport={viewport} metadata={metadata} disabled={!!busy||!!aiBusy||props.locked||comparing||!canvasSettled} settled={canvasSettled&&!busy} onAdjust={props.onAdjustCapture} onPreview={previewSelection} onDragging={active=>{selectionDragging.current=active;if(active)beginSelectionFollow();}} hitAnnotation={event=>canvasRef.current?.hasAnnotationAt(event)??false} onBegin={()=>canvasRef.current?.exitSelection()}>
    <div className={metadata?'clay-canvas-fixed':'clay-canvas-stage'} inert={!!busy} style={mapped?{visibility:selectionPreview?'hidden':undefined,left:mapped.frame.x,top:mapped.frame.y,width:mapped.frame.width,height:mapped.frame.height}:undefined}>
      {hasContent?<EditorCanvas ref={canvasRef} compareRaw={comparing} onCompareError={error=>{setComparison(null);props.onError(error);}} showViewControls={visiblePanel!=='recovery'} document={doc} onDrawingToolChange={setDrawingTool} onSelection={props.onSelection} onRenderStatus={props.onRenderStatus} fixedDisplayScale={mapped?.scale} onReady={()=>{setCanvasReady(true);setPaintedImage(doc.image);}} onAnnotations={(annotations,group)=>update({annotations},group)} onError={props.onError}/>:<div className="clay-launcher"><Frame size={32} aria-hidden="true"/><h1>截图，接着编辑。</h1><p>从托盘或快捷键开始，也可以打开本机文件。</p><ControlButton className="clay-primary" disabled={!!busy} onClick={()=>props.onCapture('capture.region')}>区域截图</ControlButton><ControlButton disabled={!!busy} onClick={props.onOpenImage}>打开图片</ControlButton><ControlButton disabled={!!busy} onClick={props.onOpenProject}>打开项目</ControlButton></div>}
    </div>
    </CaptureSelection>
    <svg className="liquid-panel-bridge" aria-hidden="true"><path/></svg>
    <fieldset className="clay-chrome" disabled={!!busy&&!adjusting} inert={fullReading||adjusting||Boolean(selectionPreview&&!selectionDragging.current)}>
      <div className="clay-rail liquid-rail" ref={railRef} role="toolbar" aria-label="截图编辑工具" style={{left:tools.rail.x,top:tools.rail.y,maxWidth:tools.area.width,maxHeight:tools.area.height}}>
        <RailBody/><span className="liquid-sweep" aria-hidden="true"/><span className="liquid-active" aria-hidden="true"><span className="liquid-active-color"/><span className="liquid-active-depth"/></span>
        <span className="clay-grip" role="button" tabIndex={0} aria-label="移动动作轨，方向键微调" onPointerDown={event=>beginDrag('rail',event)} onPointerMove={moveDrag} onPointerUp={endDrag} onLostPointerCapture={endDrag} onKeyDown={event=>moveByKey('rail',event)}><GripVertical aria-hidden="true"/></span>
        {/* 点击执行工具，悬停检查参数；悬停本身不修改文档或触发识别/翻译。 */}
        <div className="clay-image-tools" role="group" aria-label="图片工具">
          <MotionButton group="image" data-hover-panel="beauty" aria-label="美化图片：点击切换，悬停设置" aria-pressed={editor.mode==='beauty'} aria-expanded={panel==='beauty'} aria-controls={panel==='beauty'?'clay-active-panel':undefined} disabled={!doc.image||editor.mode==='reflow'} onClick={toggleBeauty}><ImageAppearanceIcon/></MotionButton>
          <MotionButton group="image" data-hover-panel="text" aria-label="提取文字：点击识别，悬停校对" aria-expanded={panel==='text'} aria-controls={panel==='text'?'clay-active-panel':undefined} disabled={!hasContent||!!aiBusy} onClick={()=>{hover.dismiss();canvasRef.current?.exitSelection();props.onAi('ocr');}}><ScanText aria-hidden="true"/></MotionButton>
          <TranslationTools translating={aiBusy==='翻译图片'} translateDisabled={!doc.image||editor.mode==='reflow'||!!aiBusy||props.renderStatus!=='ready'}
            canRead={Boolean(editor.imageTranslation?.blocks.length)&&editor.mode!=='reflow'} readDisabled={!!aiBusy||props.renderStatus!=='ready'} reading={reading} readerTrigger={readerTrigger}
            onTranslate={()=>{setPanel(null);canvasRef.current?.exitSelection();props.onTranslateImage();}} onCancel={props.onCancelAi}
            onRead={()=>{setPanel(null);canvasRef.current?.exitSelection();setReading(value=>!value);}}/>
        </div>
        <HistoryButtons canUndo={props.canUndo} canRedo={props.canRedo} undo={props.undo} redo={props.redo}/>
        {(['text','rect','ellipse','arrow','brush','highlight','mosaic'] as const).map(kind=><AnnotationToolButton key={kind} kind={kind} state={drawingTool===kind?'drawing':!drawingTool&&(props.selection?.type===kind||kind==='mosaic'&&props.selection?.type==='cover')?'editing':'idle'} expanded={panel==='properties'&&inspectedTool===kind} disabled={!hasContent||props.renderStatus!=='ready'} onClick={()=>{hover.dismiss();canvasRef.current?.add(kind);}}/>)}
        <MotionButton data-motion-action="done" className="clay-primary" aria-label="完成" data-tooltip="完成并复制到剪贴板" disabled={!hasContent||props.renderStatus!=='ready'} onClick={complete}><Check aria-hidden="true"/>完成</MotionButton>
        <MotionButton aria-label="钉到桌面" data-tooltip="钉到桌面，可拖动、缩放和切换置顶" disabled={!hasContent||props.renderStatus!=='ready'||!!aiBusy} onClick={()=>{setComparison(null);props.onPin();}}><Pin aria-hidden="true"/></MotionButton>
        <MotionButton data-panel-trigger="more" data-hover-panel="more" aria-label="更多操作：悬停展开" aria-expanded={panel==='more'} onClick={()=>hover.dismiss()}><MoreHorizontal aria-hidden="true"/></MotionButton><MotionButton aria-label="收起编辑，保留文档" data-tooltip="收起编辑" onClick={()=>props.onPresentation('hidden')}><X aria-hidden="true"/></MotionButton>
      </div>
      {visiblePanel&&<section id="clay-active-panel" data-panel={visiblePanel} aria-hidden={!panel} inert={!panel} className={'clay-card liquid-panel '+(visiblePanel==='more'?'clay-drawer ':'')+(!panel?'is-closing':'')} role="region" aria-label={title} style={{left:tools.card.x,top:tools.card.y,width:tools.card.width,maxHeight:tools.card.height}}>
        <PanelSkin/><div className="liquid-panel-content"><div ref={page} className="liquid-panel-page" inert={switching}>
        <header className="clay-card-heading" tabIndex={0} aria-label={'移动'+title+'，方向键微调'} onPointerDown={event=>beginDrag('card',event)} onPointerMove={moveDrag} onPointerUp={endDrag} onLostPointerCapture={endDrag} onKeyDown={event=>{if(event.target===event.currentTarget)moveByKey('card',event);}}><span className="clay-panel-mark" aria-hidden="true">{visiblePanel==='properties'&&propertyKind?<ToolGlyph kind={propertyKind}/>:visiblePanel==='beauty'?<Sparkles/>:visiblePanel==='text'?<ScanText/>:visiblePanel==='recovery'?<RotateCcw/>:<MoreHorizontal/>}</span><div className="clay-panel-heading-copy"><h2>{title}</h2><p>{panelCaption}</p></div><ControlButton aria-label="关闭浮卡" onClick={closePanel}><X aria-hidden="true"/></ControlButton></header>
        <div className="clay-card-content" ref={cardContent}>
          {visiblePanel==='beauty'&&doc.image&&editor.mode!=='reflow'&&<StyleTools document={doc} update={update} comparing={comparing} onCompare={()=>{canvasRef.current?.exitSelection();setComparison(comparing?null:doc);}} onGesture={beautyGesture} onError={props.onError}/>}
          {visiblePanel==='text'&&<TextTools {...props.textTools} compact/>}
          {visiblePanel==='properties'&&<AnnotationPalette selection={propertySelection} tool={propertyTool} disabled={switching||!panel||props.renderStatus!=='ready'} canvasRef={canvasRef} onError={props.onError}/>}
          {visiblePanel==='recovery'&&props.recoveryPanel}
          {visiblePanel==='more'&&<>
            <section className="clay-section"><h3>截图与文件</h3><div className="clay-action-grid"><ControlButton onClick={()=>props.onCapture('capture.region')}>重新框选</ControlButton><ControlButton onClick={props.onOpenImage}><ImagePlus aria-hidden="true"/>打开图片</ControlButton><ControlButton onClick={props.onOpenProject}><FolderOpen aria-hidden="true"/>打开项目</ControlButton><ControlButton onClick={props.onPaste}>粘贴图片</ControlButton></div></section>
            <CaptureControls onStart={props.clearNotice} backend={props.captureBackend} disabled={!!busy} onCapture={props.onCapture} onError={props.onError}/>
            <section className="clay-section"><h3>项目与记录</h3><div className="clay-action-grid"><ControlButton disabled={!hasContent} onClick={props.onSaveProject}>保存项目</ControlButton><ControlButton onClick={()=>setPanel('recovery')}>历史记录</ControlButton></div></section>
            <section className="clay-section"><h3>输出设置</h3>
              <label>复制图片的尺寸<Select aria-label="导出倍率" value={props.scale} disabled={!hasContent} onChange={value=>props.setScale(Number(value))}><option value={1}>1× 当前尺寸</option><option value={2}>2× 尺寸</option></Select></label>
              {canTransform?<MotionDetails><summary>裁剪与缩放</summary><TransformPanel document={doc} onTransform={props.onTransform}/></MotionDetails>:<div className="clay-unavailable-tool"><span>裁剪与缩放</span><p>{editor.mode==='reflow'?'文字卡片不支持图片裁剪。':'截图或打开图片后可用。'}</p></div>}
            </section>
            <div className="clay-action-grid"><ControlButton onClick={()=>{setPanel(null);props.onConfigure();}}><Settings2 aria-hidden="true"/>设置</ControlButton><ControlButton onClick={()=>setPositions({})}><RotateCcw aria-hidden="true"/>重置工具位置</ControlButton></div>
          </>}
        </div>
        </div></div>
      </section>}
    </fieldset>
    {readerMounted&&reader&&editor.imageTranslation&&<ImageTranslationReader rootRef={readerRoot} open={reading} data={editor.imageTranslation} box={reader.box} screen={screen} full={reader.full} onClose={closeReader} onBoundsChange={setReaderBounds} onReset={()=>setReaderBounds(null)}/>}
    {statusMounted&&task&&<div ref={statusRoot} className="clay-status" aria-hidden={!taskOpen} inert={!taskOpen} style={{left:screen.x+16,top:screen.y+12,maxWidth:screen.width-32}}><div className="liquid-surface-skin" aria-hidden="true"/><div role="status" className="clay-task liquid-surface-content"><span className="spinner"/>{task.text}…{task.cancel==='ocr'&&<ControlButton disabled={!taskOpen} onClick={props.textTools.onCancelOcr}>取消任务</ControlButton>}{task.cancel==='complete'&&<ControlButton disabled={!taskOpen} onClick={props.onCancelComplete}>取消完成</ControlButton>}</div></div>}
    {noticeMounted&&notice&&<div ref={noticeRoot} className={'clay-notice '+(notice.error?'is-error':'')} aria-hidden={!props.notice} style={{top:noticeTop,left:screen.x+screen.width/2,maxWidth:screen.width-32}} role={notice.error?'alert':'status'}><div className="liquid-surface-skin" aria-hidden="true"/><div className="liquid-surface-content"><span>{notice.text}</span><ControlButton aria-label="关闭提示" disabled={!props.notice} onClick={props.clearNotice}><X aria-hidden="true"/></ControlButton></div></div>}
    <OverlayScrollbars/>
    <TooltipLayer/>
  </div>;
}
/** 图片边框与星芒表示外观美化，避免和用于绘制标注的文字 T 图标混淆。 */
function ImageAppearanceIcon(){
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>
    <circle cx="8" cy="9" r="1.2"/>
    <path d="m3 17 5-5 4 4 3-3 6 6M18 2l1.2 3.8L23 7l-3.8 1.2L18 12l-1.2-3.8L13 7l3.8-1.2Z"/>
  </svg>;
}
