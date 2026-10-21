import { defaultEditor, parseDocument, type EditorState } from './document';
export const STYLE_KEYS = ['mode','padding','radius','background','shadow','borderWidth','borderColor','fontSize','textWidth','lineSpacing','paragraphSpacing'] as const;
export type Style = Pick<EditorState,typeof STYLE_KEYS[number]>;
export type StylePreset = { id:string; name:string; style:Style };
export function editorStyle(editor:EditorState):Style { return Object.fromEntries(STYLE_KEYS.map(key=>[key,editor[key]])) as Style; }
export function parsePresets(value:unknown):StylePreset[] {
  if(!Array.isArray(value)||value.length>20) throw new Error('最多保存20个样式。');
  return value.map(p=>{
    if(!p||typeof p!=='object'||typeof p.id!=='string'||!/^[a-z0-9-]{1,80}$/i.test(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>40||!p.style||typeof p.style!=='object') throw new Error('样式数据无效。');
    // 样式只保存白名单外观字段，不保存图像、正文、OCR、译文或服务配置。
    const style=Object.fromEntries(STYLE_KEYS.filter(key=>key in p.style).map(key=>[key,p.style[key]]));
    const doc=parseDocument({schemaVersion:2,image:null,editor:{...defaultEditor(),...style}});
    return {id:p.id,name:p.name,style:editorStyle(doc.editor)};
  });
}
export const BUILTIN_STYLES:StylePreset[] = [
  {id:'simple',name:'简洁截图',style:editorStyle({...defaultEditor(),mode:'beauty',padding:32,radius:12})},
  {id:'soft',name:'柔和留白',style:editorStyle({...defaultEditor(),mode:'beauty',padding:48,radius:20,background:'#e6e7ec',shadow:true})},
  {id:'paper',name:'文档摘录',style:editorStyle({...defaultEditor(),mode:'reflow',lineSpacing:1.8,paragraphSpacing:16})},
  {id:'outline',name:'清晰边框',style:editorStyle({...defaultEditor(),mode:'beauty',padding:24,radius:8,shadow:false,borderWidth:2})},
];
