import type { EditorState } from './document';
import { ocrText } from './ocr';
import { translationChunks,type TranslationChunk } from './translation';
export type TranslationDocument={schemaVersion:1;source:string;providerId:string;providerRevision:string;targetLanguage:string;chunks:TranslationChunk[]};
const string=(v:unknown,max:number)=>{if(typeof v!=='string'||v.length>max)throw new Error('块译文文字无效或过长。');return v;};
/** 项目/恢复共用白名单；运行中块恢复为待处理，不把中断状态当作已完成。 */
export function parseTranslationDocument(value:unknown):TranslationDocument|null {
  if(value==null)return null;if(typeof value!=='object'||Array.isArray(value))throw new Error('块译文格式无效。');
  const d=value as Record<string,unknown>;if(d.schemaVersion!==1||!Array.isArray(d.chunks)||d.chunks.length>1000)throw new Error('块译文版本或数量无效。');
  const source=string(d.source,20000),providerId=string(d.providerId,100),providerRevision=string(d.providerRevision,64),targetLanguage=string(d.targetLanguage,100);
  if(providerRevision&&!/^[a-f0-9]{64}$/i.test(providerRevision))throw new Error('服务配置身份无效。');
  const chunks:TranslationChunk[]=d.chunks.map(raw=>{
    if(!raw||typeof raw!=='object')throw new Error('块译文无效。');const c=raw as Record<string,unknown>,id=string(c.id,160);
    if(!/^[a-z0-9_-]+$/i.test(id)||!['pending','running','done','failed'].includes(String(c.status)))throw new Error('块译文标识或状态无效。');
    const sourceBlockId=c.sourceBlockId==null?null:string(c.sourceBlockId,100);if(sourceBlockId&&!/^[a-z0-9_-]+$/i.test(sourceBlockId))throw new Error('原文块标识无效。');
    const text=c.text==null?null:string(c.text,20000),generatedText=c.generatedText==null?null:string(c.generatedText,20000);
    if(c.status==='done'&&text===null)throw new Error('完成的译文块缺少文字。');
    return {id,source:string(c.source,6000),sourceBlockId,text,generatedText,error:c.error==null?null:string(c.error,500),status:c.status==='running'?'pending':c.status as TranslationChunk['status']};
  });
  if(new Set(chunks.map(c=>c.id)).size!==chunks.length||chunks.map(c=>c.source).join('')!==source||chunks.reduce((s,c)=>s+(c.text?.length||0)+1,0)>20001||chunks.reduce((s,c)=>s+(c.generatedText?.length||0),0)>20000)throw new Error('块译文重复、源版本不一致或完整文字过长。');
  return {schemaVersion:1,source,providerId,providerRevision,targetLanguage,chunks};
}
/** OCR全文未被独立改写时保留OCR块ID；普通全文使用稳定的任务内切片ID。 */
export function createTranslationDocument(editor:EditorState,providerId:string,providerRevision:string,targetLanguage:string,previous:TranslationDocument|null=null):TranslationDocument {
  const linked=editor.ocr&&ocrText(editor.ocr)===editor.text;
  const rows=linked?editor.ocr!.blocks.map((b,i)=>({id:b.id,source:b.text+(i<editor.ocr!.blocks.length-1?'\n':'')})):[{id:null,source:editor.text}];
  let chunks:TranslationChunk[]=[];
  for(const row of rows){const parts=translationChunks(row.source);if(!parts.length)parts.push({id:'chunk-0',source:'',text:'',error:null,status:'done'});
    chunks.push(...parts.map((part,i)=>({...part,id:row.id?`${row.id}-tr-${i}`:part.id,sourceBlockId:row.id,generatedText:null,...(!part.source.trim()?{text:'',status:'done' as const}:{} )})));
  }
  const reusable=previous?.providerId===providerId&&!!providerRevision&&previous.providerRevision===providerRevision&&previous.targetLanguage===targetLanguage;
  if(reusable)chunks=chunks.map(c=>{const old=previous!.chunks.find(p=>p.id===c.id&&p.source===c.source&&p.sourceBlockId===c.sourceBlockId&&p.status==='done');return old?{...old}:c;});
  return parseTranslationDocument({schemaVersion:1,source:editor.text,providerId,providerRevision,targetLanguage,chunks})!;
}
export function translationText(data:TranslationDocument){return data.chunks.map(c=>c.text||'').join('\n');}
export function canResumeTranslation(data:TranslationDocument,editor:EditorState,providerId:string,providerRevision:string,targetLanguage:string){
  if(data.source!==editor.text||data.providerId!==providerId||!providerRevision||data.providerRevision!==providerRevision||data.targetLanguage!==targetLanguage)return false;
  const expected=createTranslationDocument(editor,providerId,providerRevision,targetLanguage);
  return expected.chunks.length===data.chunks.length&&expected.chunks.every((c,i)=>c.id===data.chunks[i].id&&c.source===data.chunks[i].source&&c.sourceBlockId===data.chunks[i].sourceBlockId);
}
/** 校对只改当前译文，保留生成原文、原文切片和块ID，包含在同一文档历史里。 */
export function correctTranslationChunk(data:TranslationDocument,id:string,text:string){
  return parseTranslationDocument({...data,chunks:data.chunks.map(c=>c.id===id?{...c,text,status:'done',error:null}:c)})!;
}
