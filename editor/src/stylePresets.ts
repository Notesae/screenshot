import { defaultEditor, parseDocument, type EditorState } from './document';
// 历史文字预设继续按原字段读取，美化面板只应用图片外观白名单。
export const STYLE_KEYS = ['mode','padding','radius','background','shadow','borderWidth','borderColor','fontSize','textWidth','lineSpacing','paragraphSpacing'] as const;
// 图片美化不能改变文字排版、译文、标注或裁剪字段。
export const BEAUTY_KEYS = ['mode','padding','radius','background','shadow','borderWidth','borderColor'] as const;
export type Style = Pick<EditorState,typeof STYLE_KEYS[number]>;
export type BeautyStyle = Pick<EditorState,typeof BEAUTY_KEYS[number]>;
export type StylePreset = { id:string; name:string; style:BeautyStyle & Partial<Style> };
export function editorStyle(editor:EditorState):Style { return Object.fromEntries(STYLE_KEYS.map(key=>[key,editor[key]])) as Style; }
export function beautyStyle(editor:BeautyStyle):BeautyStyle { return Object.fromEntries(BEAUTY_KEYS.map(key=>[key,editor[key]])) as BeautyStyle; }
/** 旧文字样式保持兼容；图片样式持久化时只保留图片外观。 */
export function parsePresets(value:unknown):StylePreset[] {
  if(!Array.isArray(value)||value.length>20) throw new Error('最多保存20个样式。');
  const ids=new Set<string>();
  return value.map(p=>{
    if(!p||typeof p!=='object'||typeof p.id!=='string'||!/^[a-z0-9-]{1,80}$/i.test(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>40||!p.style||typeof p.style!=='object') throw new Error('样式数据无效。');
    if(ids.has(p.id))throw new Error('样式标识重复。');ids.add(p.id);
    // 样式只保存白名单外观字段，不保存图像、正文、OCR、译文或服务配置。
    const style=Object.fromEntries(STYLE_KEYS.filter(key=>key in p.style).map(key=>[key,p.style[key]]));
    const doc=parseDocument({schemaVersion:2,image:null,editor:{...defaultEditor(),...style}});
    return {id:p.id,name:p.name.trim(),style:doc.editor.mode==='reflow'?editorStyle(doc.editor):beautyStyle(doc.editor)};
  });
}
export const BUILTIN_STYLES:StylePreset[] = [
  {id:'simple',name:'简洁截图',style:editorStyle({...defaultEditor(),mode:'beauty',padding:32,radius:12})},
  {id:'soft',name:'柔和留白',style:editorStyle({...defaultEditor(),mode:'beauty',padding:48,radius:20,background:'#e6e7ec',shadow:true})},
  {id:'paper',name:'文档摘录',style:editorStyle({...defaultEditor(),mode:'reflow',lineSpacing:1.8,paragraphSpacing:16})},
  {id:'outline',name:'清晰边框',style:editorStyle({...defaultEditor(),mode:'beauty',padding:24,radius:8,shadow:false,borderWidth:2})},
];

// 主推纯色样式与历史内置列表分开，旧项目和已保存样式不需要迁移 ID。
export const BEAUTY_PRESETS:StylePreset[] = [
  {id:'beauty-clear',name:'清透',style:beautyStyle({...defaultEditor(),mode:'beauty',background:'#f4f3ef',padding:32,radius:10})},
  {id:'beauty-mist',name:'雾灰',style:beautyStyle({...defaultEditor(),mode:'beauty',background:'#e7e9ed',padding:40,radius:14})},
  {id:'beauty-paper',name:'暖纸',style:beautyStyle({...defaultEditor(),mode:'beauty',background:'#e9dfd1',padding:48,radius:18})},
  {id:'beauty-night',name:'夜幕',style:beautyStyle({...defaultEditor(),mode:'beauty',background:'#34312e',padding:40,radius:14,shadow:false})},
];

/** 以 600px 短边为预设基准；只在点选时推荐一次，手调不会随重绘漂移。 */
export function fittedBeautyPresets(shortSide:number):StylePreset[] {
  const ratio=Math.max(1,shortSide)/600;
  return BEAUTY_PRESETS.map(p=>({...p,style:{...p.style,padding:Math.min(200,Math.max(0,Math.round(p.style.padding*ratio))),radius:Math.min(100,Math.max(0,Math.round(p.style.radius*ratio)))}}));
}
