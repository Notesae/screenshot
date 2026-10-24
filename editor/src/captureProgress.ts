import { native } from './bridge';
import type { PresentationViewport } from './presentationViewport';

export type CapturePhase = 'received'|'decoded'|'document_committed'|'canvas_ready'|'viewport_wait'|'bridge_retry'|'ready_confirmed'|'layout_timeout'|'image_error'|'canvas_error'|'ready_error';
/** 诊断只发固定阶段和几何；不含截图、文档文字或异常正文，失败不阻挡编辑流程。 */
export function reportCaptureProgress(captureId:string|undefined,phase:CapturePhase,viewport?:PresentationViewport) {
  if(native.available&&captureId)void native.request('presentation.progress',{captureId,phase,...(viewport?{viewport}:{})},2000).catch(()=>{});
}
