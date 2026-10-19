import type { PixelRect } from './overlay';
export type CaptureMonitor = {handle:string;label:string;bounds:PixelRect;primary:boolean;current:boolean};
/** 显式查询才读取系统元数据；桥接列表不获得文件、窗口标题或任意系统调用能力。 */
export function parseCaptureMonitors(value:unknown):CaptureMonitor[] {
  const monitors=(value as {monitors?:unknown})?.monitors;
  if(!Array.isArray(monitors)||!monitors.length||monitors.length>32)throw new Error('显示器列表无效。');
  const result=monitors.map(m=>{
    if(!m||typeof m.handle!=='string'||!/^([1-9][0-9]{0,18}|0x[0-9a-f]{1,16})$/i.test(m.handle)||typeof m.label!=='string'||m.label.length>100||typeof m.primary!=='boolean'||typeof m.current!=='boolean'||!m.bounds)throw new Error('显示器信息无效。');
    const b=m.bounds;if(![b.x,b.y,b.width,b.height].every(v=>typeof v==='number'&&Number.isInteger(v)&&Math.abs(v)<=1000000)||b.width<1||b.height<1)throw new Error('显示器物理边界无效。');
    return {handle:m.handle,label:m.label,bounds:{x:b.x,y:b.y,width:b.width,height:b.height},primary:m.primary,current:m.current};
  });
  if(new Set(result.map(m=>m.handle)).size!==result.length)throw new Error('显示器标识重复。');
  return result;
}
