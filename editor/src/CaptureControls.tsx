import { Select } from './Select';
import { useState } from 'react';
import { native } from './bridge';
import { parseCaptureMonitors,type CaptureMonitor } from './captureTargets';

type Props={backend:'wgc'|'gdi'|null;disabled:boolean;onCapture:(method:string,payload?:object)=>void;onError:(error:unknown)=>void;onStart:()=>void};
/** 更多操作只保留截图范围动作；后端、吸附和快捷键统一进入原生设置浮卡。 */
export function CaptureControls(props:Props) {
  const [monitors,setMonitors]=useState<CaptureMonitor[]>([]),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false);
  const disabled=props.disabled||busy;
  async function refreshMonitors(){
    props.onStart();setBusy(true);
    try{const list=parseCaptureMonitors(await native.request('capture.monitors'));setMonitors(list);setSelected((list.find(m=>m.current)||list.find(m=>m.primary)||list[0])?.handle??'');}
    catch(error){props.onError(error);}finally{setBusy(false);}
  }
  return <details className="capture-controls"><summary>截图范围</summary>
    <div className="clay-capture-sections"><section className="clay-capture-section">
      <p className="ai-note">刷新后可选择需要截图的显示器。</p>
      <div className="clay-action-grid">
        <button disabled={disabled||props.backend!=='wgc'} onClick={()=>props.onCapture('capture.current')}>当前屏幕截图</button>
        <button disabled={disabled||props.backend!=='wgc'} onClick={()=>{void refreshMonitors();}}>刷新显示器</button>
      </div>
      <label className="control-label">显示器<Select aria-label="截图显示器" value={selected} disabled={disabled||!monitors.length} onChange={setSelected}><option value="">请先刷新显示器</option>{monitors.map(m=><option key={m.handle} value={m.handle}>{m.label}{m.primary?' · 主屏':''}{m.current?' · 当前':''}</option>)}</Select></label>
      <button className="clay-capture-apply" disabled={disabled||!selected||props.backend!=='wgc'} onClick={()=>props.onCapture('capture.screen',{target:{kind:'monitor',handle:selected}})}>截取所选显示器</button>
      {props.backend==='gdi'&&<p className="ai-note">指定屏幕需在设置中选择 WGC；兼容模式支持桌面与区域截图。</p>}
    </section></div>
  </details>;
}
