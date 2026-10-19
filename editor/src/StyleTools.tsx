import { useState } from 'react';
import type { EditorState } from './document';
import { BUILTIN_STYLES,editorStyle,parsePresets,type StylePreset } from './stylePresets';
const KEY='screenshot.style-presets.v1';
/** 原位与工作台复用；仅外观参数存入本机 WebView 存储，内容永不进入预设。 */
export function StyleTools({editor,update,onError}:{editor:EditorState;update:(change:Partial<EditorState>)=>void;onError:(e:unknown)=>void}) {
  const [saved,setSaved]=useState<StylePreset[]>(()=>{try{return parsePresets(JSON.parse(localStorage.getItem(KEY)||'[]'));}catch{return [];}});
  const [name,setName]=useState(''),[selected,setSelected]=useState('simple');
  function persist(next:StylePreset[]) { const value=parsePresets(next); localStorage.setItem(KEY,JSON.stringify(value)); setSaved(value); }
  return <section className="style-tools" aria-label="样式预设"><label className="control-label">成品样式<select aria-label="成品样式" value={selected} onChange={e=>setSelected(e.target.value)}>{[...BUILTIN_STYLES,...saved].map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <button onClick={()=>{const preset=[...BUILTIN_STYLES,...saved].find(p=>p.id===selected);if(preset)update(preset.style);}}>应用样式</button>
    <label className="control-label">新样式名称<input aria-label="新样式名称" maxLength={40} value={name} onChange={e=>setName(e.target.value)}/></label>
    <div className="text-copy-actions"><button disabled={!name.trim()} onClick={()=>{try{const id=crypto.randomUUID();persist([...saved,{id,name:name.trim(),style:editorStyle(editor)}]);setSelected(id);setName('');}catch(e){onError(e);}}}>保存当前样式</button><button disabled={!saved.some(p=>p.id===selected)} onClick={()=>{try{persist(saved.filter(p=>p.id!==selected));setSelected('simple');}catch(e){onError(e);}}}>删除所选样式</button></div>
    {editor.mode==='beauty'&&<><label className="control-label">边框宽度<input aria-label="边框宽度" type="number" min={0} max={12} value={editor.borderWidth} onChange={e=>{const n=Number(e.target.value);if(n>=0&&n<=12)update({borderWidth:n});}}/></label><label className="control-label">边框颜色<input aria-label="边框颜色" type="color" value={editor.borderColor} onChange={e=>update({borderColor:e.target.value})}/></label></>}
  </section>;
}
