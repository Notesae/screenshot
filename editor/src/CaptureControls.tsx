import { useState } from 'react';
import { native } from './bridge';
import { parseCaptureMonitors,type CaptureMonitor } from './captureTargets';
type Binding={enabled:boolean;ctrl:boolean;alt:boolean;shift:boolean;key:string};
type Hotkey={binding:Binding;registered:boolean;applied:boolean;message:string;cleanupPending?:boolean};
type Props={backend:'wgc'|'gdi'|null;disabled:boolean;onCapture:(method:string,payload?:object)=>void;onError:(error:unknown)=>void;onStart:()=>void};
/** 两种编辑呈现共用系统设置入口，列表和热键状态都在用户点击后读取。 */
export function CaptureControls(props:Props) {
  const [monitors,setMonitors]=useState<CaptureMonitor[]>([]),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false);
  const [settings,setSettings]=useState<{snapWindows:boolean;windowArea:'window'|'client'}|null>(null),[hotkey,setHotkey]=useState<Hotkey|null>(null),[draft,setDraft]=useState<Binding>({enabled:true,ctrl:true,alt:false,shift:true,key:'S'});
  async function act(work:()=>Promise<void>){props.onStart();setBusy(true);try{await work();}catch(error){props.onError(error);}finally{setBusy(false);}}
  const disabled=props.disabled||busy;
  return <details className="capture-controls"><summary>捕获范围与区域热键</summary>
    <p className="ai-note">当前屏幕按工作台或当前选区所在屏幕选择。点击刷新才读取显示器；不读取窗口标题。</p>
    <button disabled={disabled||props.backend!=='wgc'} onClick={()=>props.onCapture('capture.current')}>捕获当前屏幕</button>
    <button disabled={disabled||props.backend!=='wgc'} onClick={()=>{void act(async()=>{const list=parseCaptureMonitors(await native.request('capture.monitors'));setMonitors(list);setSelected((list.find(m=>m.current)||list.find(m=>m.primary)||list[0]).handle);});}}>刷新显示器列表</button>
    <label className="control-label">截图显示器<select aria-label="截图显示器" value={selected} disabled={disabled||!monitors.length} onChange={e=>setSelected(e.target.value)}><option value="">请先刷新</option>{monitors.map(m=><option key={m.handle} value={m.handle}>{m.label}{m.primary?' · 主屏':''}{m.current?' · 当前':''}</option>)}</select></label>
    <button disabled={disabled||!selected||props.backend!=='wgc'} onClick={()=>props.onCapture('capture.screen',{target:{kind:'monitor',handle:selected}})}>捕获所选屏幕</button>
    {props.backend==='gdi'&&<p className="ai-note">指定/当前屏幕使用WGC；GDI保留桌面/区域兼容路径。</p>}
    <button disabled={disabled} onClick={()=>{void act(async()=>{const [capture,keys]=await Promise.all([native.request<{snapWindows:boolean;windowArea:'window'|'client'}>('capture.settings'),native.request<Hotkey>('hotkey.read')]);if(typeof capture.snapWindows!=='boolean'||!['window','client'].includes(capture.windowArea))throw new Error('捕获设置无效。');setSettings(capture);setHotkey(keys);setDraft(keys.binding);});}}>读取捕获与快捷键设置</button>
    {settings&&<><label className="checkbox-row"><input aria-label="窗口吸附" type="checkbox" checked={settings.snapWindows} onChange={e=>setSettings({...settings,snapWindows:e.target.checked})}/>区域截图启用窗口吸附</label><label className="control-label">吸附范围<select aria-label="吸附范围" value={settings.windowArea} onChange={e=>setSettings({...settings,windowArea:e.target.value as 'window'|'client'})}><option value="window">包含标题栏</option><option value="client">仅客户区</option></select></label><button disabled={disabled} onClick={()=>{void act(async()=>{await native.request('capture.configure',{backend:props.backend,...settings});});}}>应用吸附设置</button></>}
    {hotkey&&<fieldset><legend>区域截图全局快捷键</legend><label className="checkbox-row"><input aria-label="启用区域截图热键" type="checkbox" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/>启用</label><div className="hotkey-modifiers">{(['ctrl','alt','shift']as const).map(flag=><label key={flag}><input aria-label={'热键'+flag} type="checkbox" checked={draft[flag]} onChange={e=>setDraft({...draft,[flag]:e.target.checked})}/>{flag}</label>)}</div><label className="control-label">热键按键<select aria-label="热键按键" value={draft.key} onChange={e=>setDraft({...draft,key:e.target.value})}>{[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',...Array.from({length:11},(_,i)=>'F'+(i+1))].map(key=><option key={key}>{key}</option>)}</select></label><p className="ai-note">需包含Ctrl或Alt。先尝试注册新组合，冲突时保留旧组合；不自动触发截图测试。</p><button disabled={disabled} onClick={()=>{void act(async()=>{const result=await native.request<Hotkey>('hotkey.configure',draft);setHotkey(result);setDraft(result.binding);if(!result.applied)throw new Error(result.message);});}}>应用区域热键</button><p role="status" className="ai-note">{hotkey.message}{hotkey.cleanupPending?'（释放待确认）':''}</p></fieldset>}
  </details>;
}
