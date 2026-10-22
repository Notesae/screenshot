import { ControlButton } from './ControlMotion';
import { MotionDetails } from './MotionDetails';
import { Select } from './Select';
import { ColorField } from './ColorField';
import { useState } from 'react';
import type { EditorState } from './document';
import { BUILTIN_STYLES,editorStyle,parsePresets,type StylePreset } from './stylePresets';
const KEY='screenshot.style-presets.v1';
/** 预设只改变外观字段，标注、文字、项目身份和撤销历史保持在共享文档中。 */
export function StyleTools({editor,update,onError}:{editor:EditorState;update:(change:Partial<EditorState>)=>void;onError:(e:unknown)=>void}) {
  const [saved,setSaved]=useState<StylePreset[]>(()=>{try{return parsePresets(JSON.parse(localStorage.getItem(KEY)||'[]'));}catch{return [];}});
  const [name,setName]=useState(''),[selected,setSelected]=useState('simple');
  function persist(next:StylePreset[]){const value=parsePresets(next);localStorage.setItem(KEY,JSON.stringify(value));setSaved(value);}
  const presets=[...BUILTIN_STYLES,...saved],beauty=presets.filter(p=>p.style.mode==='beauty');
  const active=beauty.find(p=>Object.entries(p.style).every(([key,value])=>editor[key as keyof EditorState]===value))?.id;
  return <section className="clay-style-tools" aria-label="样式预设">
    <div className="clay-preset-list">{beauty.map(p=><ControlButton key={p.id} aria-pressed={active===p.id} onClick={()=>{setSelected(p.id);update(p.style);}}>{p.name}</ControlButton>)}</div>
    <MotionDetails><summary>管理样式与边框</summary>
      <label>已保存样式<Select aria-label="成品样式" value={selected} onChange={value=>setSelected(value)}>{presets.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>
      <ControlButton onClick={()=>{const preset=presets.find(p=>p.id===selected);if(preset)update(preset.style);}}>应用所选样式</ControlButton>
      <label>新样式名称<input aria-label="新样式名称" maxLength={40} value={name} onChange={event=>setName(event.target.value)}/></label>
      <div className="text-copy-actions"><ControlButton disabled={!name.trim()} onClick={()=>{try{const id=crypto.randomUUID();persist([...saved,{id,name:name.trim(),style:editorStyle(editor)}]);setSelected(id);setName('');}catch(error){onError(error);}}}>保存当前样式</ControlButton><ControlButton disabled={!saved.some(p=>p.id===selected)} onClick={()=>{try{persist(saved.filter(p=>p.id!==selected));setSelected('simple');}catch(error){onError(error);}}}>删除所选样式</ControlButton></div>
      <label>边框宽度<input aria-label="边框宽度" type="number" min={0} max={12} value={editor.borderWidth} onChange={event=>{const value=Number(event.target.value);if(value>=0&&value<=12)update({borderWidth:value,mode:'beauty'});}}/></label>
      <label>边框颜色<ColorField label="边框颜色" value={editor.borderColor} onChange={borderColor=>update({borderColor,mode:'beauty'})}/></label>
    </MotionDetails>
  </section>;
}
