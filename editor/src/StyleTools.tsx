import { MotionRange } from './MotionRange';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Check, Eye, RotateCcw } from 'lucide-react';
import { ControlButton } from './ControlMotion';
import { MotionDetails } from './MotionDetails';
import { Select } from './Select';
import { ColorField } from './ColorField';
import { contentGeometry, outputSize, type EditorState, type ProjectDocument } from './document';
import { BEAUTY_KEYS, BUILTIN_STYLES, beautyStyle, fittedBeautyPresets, parsePresets, type StylePreset } from './stylePresets';
import { BeautyStylePreview } from './BeautyStylePreview';
import { presentationMotion } from './LiquidMotion';
import { motionSuspended, observeMotionScope } from './motionScope';
import './beauty-tools.css';

// 沿用本机存储键，保留历史文字样式，但不在美化入口展示或应用。
const KEY='screenshot.style-presets.v1';
type Props={document:ProjectDocument;update:(change:Partial<EditorState>,group?:string)=>void;comparing:boolean;onCompare:()=>void;onGesture:(active:boolean)=>void;onError:(error:unknown)=>void};

/** 样式、常用参数与管理共用当前文档；所有动作沿用 v2 控件和折叠动效。 */
export function StyleTools({document:doc,update,comparing,onCompare,onGesture,onError}:Props) {
  const editor=doc.editor,content=contentGeometry(doc.image,editor);
  // 未启用时只在浮卡中预览候选外观；悬停和调参均不替用户切换美化模式。
  const previewDoc=useMemo(()=>editor.mode==='beauty'?doc:{...doc,editor:{...editor,mode:'beauty' as const}},[doc]);
  let outputLabel='请减小留白以恢复输出';
  try{const output=outputSize(doc.image,previewDoc.editor);outputLabel=`${editor.mode==='beauty'?'输出':'启用后'} ${output.width} × ${output.height} px`;}catch{/* 旧文档超限时仍允许用户修正参数。 */}
  const [loaded]=useState(()=>{try{return {items:parsePresets(JSON.parse(localStorage.getItem(KEY)||'[]')),error:''};}catch{return {items:[] as StylePreset[],error:'本机样式暂时无法读取，现有记录未覆盖。'};}});
  const [saved,setSaved]=useState(loaded.items),[showSaved,setShowSaved]=useState(false),[name,setName]=useState('');
  const [selected,setSelected]=useState<string|null>(null),[managed,setManaged]=useState('');
  const [message,setMessage]=useState(loaded.error),[storageBlocked]=useState(Boolean(loaded.error));
  // 删除可在本面板内撤销；只保留一条样式数据，不保存截图内容。
  const [deleted,setDeleted]=useState<{preset:StylePreset;index:number}|null>(null);
  // 切换列表使用外壳共用时钟；只平移内容，快速切换沿用当前透明度与位移。
  const list=useRef<HTMLDivElement>(null),listMotion=useRef({alpha:1,y:0}),listKey='beauty-list:'+useId();
  useLayoutEffect(()=>{
    const node=list.current,clock=presentationMotion(node)?.clock;
    if(!node||!clock||motionSuspended(node))return;
    const from=listMotion.current.alpha<1?{...listMotion.current}:{alpha:.65,y:4};
    // 与浮卡同用 panel 弹簧：位移可轻微越位后回正，透明度按截断进度到达不透明。
    void clock.spring(listKey,progress=>{
      const state=listMotion.current={alpha:from.alpha+(1-from.alpha)*Math.min(1,Math.max(0,progress)),y:from.y*(1-progress)};
      node.style.opacity=String(state.alpha);node.style.transform=`translateY(${state.y}px)`;
    },0,1,'panel');
    const stop=observeMotionScope(node,suspended=>{if(suspended)clock.finish(listKey);});
    return()=>{stop();clock.cancel(listKey);};
  },[showSaved]);
  const builtins=useMemo(()=>fittedBeautyPresets(Math.min(content.width,content.height)),[content.width,content.height]);
  const custom=saved.filter(p=>p.style.mode==='beauty'),legacy=BUILTIN_STYLES.filter(p=>p.style.mode==='beauty');
  const choices=[...builtins,...custom,...legacy],active=choices.find(p=>BEAUTY_KEYS.every(key=>p.style[key]===previewDoc.editor[key]));
  const source=choices.find(p=>p.id===selected),current=(editor.mode!=='beauty'?'待启用 · ':'')+(active?.name??(source?source.name+' · 已调整':'自定义'));
  const managedPreset=custom.find(p=>p.id===managed),visible=showSaved?custom:builtins;
  // 撤销到已知样式时更新来源，修改参数时继续保留「已调整」名称。
  useEffect(()=>{if(active)setSelected(active.id);},[active?.id]);

  /** 存储成功后再更新列表，额度或磁盘错误不造成「已保存」假反馈。 */
  function persist(next:StylePreset[],success:string):boolean {
    try{if(storageBlocked)throw new Error(loaded.error);const parsed=parsePresets(next);localStorage.setItem(KEY,JSON.stringify(parsed));setSaved(parsed);setMessage(success);return true;}
    catch(error){setMessage(error instanceof Error?error.message:'样式未保存，请重试。');return false;}
  }
  function apply(preset:StylePreset){if(change(beautyStyle(preset.style)))setSelected(preset.id);}
  // 扩大留白前检查实际输出范围，超限保留原文档与当前可见成品。
  function change(change:Partial<EditorState>,group?:string){try{outputSize(doc.image,{...editor,...change,mode:'beauty'});update({...change,mode:editor.mode},group);return true;}catch(error){onError(error);return false;}}
  /** 管理操作不修改当前图片，保存内容只包含图片美化白名单。 */
  function manage(action:'save'|'rename'|'replace'|'delete'|'undo') {
    if(action==='save'){
      const id=crypto.randomUUID();
      if(name.trim()&&persist([...saved,{id,name:name.trim(),style:beautyStyle(editor)}],'样式已保存。')){setManaged(id);setSelected(id);setName('');}
    }else if(action==='undo'&&deleted){
      const next=[...saved];next.splice(Math.min(deleted.index,next.length),0,deleted.preset);
      if(persist(next,'已恢复删除的样式。'))setDeleted(null);
    }else if(managedPreset){
      if(action==='delete'){
        if(persist(saved.filter(p=>p.id!==managed),'样式已删除。')){setDeleted({preset:managedPreset,index:saved.indexOf(managedPreset)});setManaged('');setName('');}
      }else if(action==='replace')persist(saved.map(p=>p.id===managed?{...p,style:beautyStyle(editor)}:p),'已用当前外观更新样式。');
      else if(action==='rename'&&name.trim()&&persist(saved.map(p=>p.id===managed?{...p,name:name.trim()}:p),'名称已更新。'))setName('');
    }
  }
  return <section className="clay-style-tools" aria-label="截图美化样式">
    <div className="beauty-heading"><span className="beauty-current">当前：{current}</span><ControlButton className="beauty-quiet" aria-pressed={comparing} disabled={editor.mode!=='beauty'} onClick={onCompare}><Eye aria-hidden="true"/>{comparing?'返回效果':'对比原样'}</ControlButton></div>
    {editor.mode!=='beauty'&&<p className="clay-hint">预览下一次美化效果，点击工具栏的美化按钮启用。</p>}
    <BeautyStylePreview document={previewDoc} comparing={comparing}/>
    <div className="beauty-tabs" role="group" aria-label="样式来源"><ControlButton aria-pressed={!showSaved} onClick={()=>setShowSaved(false)}>内置样式</ControlButton><ControlButton aria-pressed={showSaved} onClick={()=>setShowSaved(true)}>我的样式</ControlButton></div>
    <div className="beauty-presets" ref={list}>{visible.map(p=>
      <ControlButton key={p.id} className="beauty-preset" aria-label={'选择'+p.name+'样式'} aria-pressed={active?.id===p.id} onClick={()=>apply(p)}>
        <span className="beauty-preset-swatch" aria-hidden="true" style={{background:p.style.background}}/>
        <span className="beauty-preset-name">{p.name}<Check aria-hidden="true"/></span>
      </ControlButton>
    )}</div>
    {showSaved&&!custom.length&&<p className="clay-hint">{loaded.error||'还没有图片样式。调好外观后，在下方保存。'}</p>}
    <label>背景颜色<ColorField label="背景颜色" value={editor.background} onChange={background=>change({background})}/></label>
    <BeautyRange label="留白" value={editor.padding} max={200} onChange={(padding,group)=>change({padding},group)} onGesture={onGesture}/>
    <BeautyRange label="圆角" value={editor.radius} max={100} onChange={(radius,group)=>change({radius},group)} onGesture={onGesture}/>
    <label className="checkbox-row"><input type="checkbox" checked={editor.shadow} onChange={event=>change({shadow:event.target.checked})}/>柔和阴影</label>
    <MotionDetails><summary>更多细节</summary>
      <BeautyRange label="图片边框" value={editor.borderWidth} max={12} onChange={(borderWidth,group)=>change({borderWidth},group)} onGesture={onGesture}/>
      <label>边框颜色<ColorField label="边框颜色" value={editor.borderColor} disabled={!editor.borderWidth} onChange={borderColor=>change({borderColor})}/></label>
      <label>兼容样式<Select aria-label="兼容美化样式" value="" onChange={id=>{const preset=legacy.find(p=>p.id===id);if(preset)apply(preset);}}><option value="">选择旧版图片样式</option>{legacy.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>
    </MotionDetails>
    <MotionDetails><summary>保存与管理样式</summary>
      <label>样式名称<input aria-label="样式名称" maxLength={40} placeholder="给当前外观起个名字" value={name} onChange={event=>setName(event.target.value)}/></label>
      <ControlButton disabled={!name.trim()||editor.mode!=='beauty'||storageBlocked||saved.length>=20} onClick={()=>manage('save')}>保存为新样式</ControlButton>
      {saved.length>=20&&<p className="clay-hint">已达到 20 个样式，请先删除不再使用的样式。</p>}
      {custom.length>0&&<><label>管理已有样式<Select aria-label="管理已有样式" value={managed} onChange={id=>{setManaged(id);setName(custom.find(p=>p.id===id)?.name??'');}}><option value="">选择样式</option>{custom.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>
        <div className="beauty-manage-actions"><ControlButton disabled={!managedPreset||!name.trim()||storageBlocked} onClick={()=>manage('rename')}>重命名</ControlButton><ControlButton disabled={!managedPreset||editor.mode!=='beauty'||storageBlocked} onClick={()=>manage('replace')}>更新为当前外观</ControlButton><ControlButton className="beauty-quiet" disabled={!managedPreset||storageBlocked} onClick={()=>manage('delete')}>删除样式</ControlButton></div></>}
      {message&&<p className="clay-hint" role="status">{message}</p>}
      {deleted&&<ControlButton onClick={()=>manage('undo')}>撤销删除「{deleted.preset.name}」</ControlButton>}
    </MotionDetails>
    <div className="beauty-footer"><span>{outputLabel}</span><ControlButton className="beauty-quiet" disabled={editor.mode!=='beauty'} onClick={()=>update({mode:'raw'})}><RotateCcw aria-hidden="true"/>恢复原样</ControlButton></div>
  </section>;
}

/** 拖动和按住方向键各记一步历史；数值草稿允许留空，提交时才验证。 */
function BeautyRange({label,value,max,onChange,onGesture}:{label:string;value:number;max:number;onChange:(value:number,group?:string)=>void;onGesture:(active:boolean)=>void}) {
  const id=useId(),gesture=useRef<string|undefined>(undefined),[draft,setDraft]=useState(String(value)),[error,setError]=useState('');
  const latest=useRef({onChange,onGesture});latest.current={onChange,onGesture};
  useEffect(()=>{setDraft(String(value));setError('');},[value]);
  function begin(){if(!gesture.current){gesture.current='gesture:'+crypto.randomUUID();latest.current.onGesture(true);}}
  function end(){if(gesture.current){gesture.current=undefined;latest.current.onGesture(false);}}
  useEffect(()=>{
    const hidden=()=>{if(document.hidden)end();};window.addEventListener('blur',end);document.addEventListener('visibilitychange',hidden);
    return()=>{end();window.removeEventListener('blur',end);document.removeEventListener('visibilitychange',hidden);};
  },[]);
  function commit(){const next=Number(draft);if(!draft.trim()||!Number.isFinite(next)||next<0||next>max){setDraft(String(value));setError(`请输入 0–${max} 之间的像素值。`);return;}setDraft(String(Math.round(next)));setError('');if(Math.round(next)!==value)latest.current.onChange(Math.round(next));}
  return <div className="beauty-range"><div className="beauty-range-heading"><label htmlFor={id}>{label}</label><label className="beauty-number"><input aria-label={label+'像素'} aria-invalid={Boolean(error)} aria-describedby={error?id+'-error':undefined} type="number" min={0} max={max} step={1} value={draft} onChange={event=>setDraft(event.target.value)} onBlur={commit} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.blur();}}}/><span>px</span></label></div>
    <MotionRange id={id} aria-label={label} min={0} max={max} value={value} style={{'--range-progress':`${value/max*100}%`} as CSSProperties} onPointerDown={event=>{if(event.button===0){begin();event.currentTarget.setPointerCapture(event.pointerId);}}} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onBlur={end} onKeyDown={event=>{if(/^(Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(event.key))begin();}} onKeyUp={end} onChange={event=>onChange(Number(event.target.value),gesture.current)}/>
    {error&&<p id={id+'-error'} className="field-error" role="status">{error}</p>}
  </div>;
}
