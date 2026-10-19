import {expect,it} from 'vitest';
import {applyEditorChange,defaultEditor,parseDocument} from './document';
import {createTranslationDocument,parseTranslationDocument,canResumeTranslation,correctTranslationChunk,translationText} from './translationDocument';
const revision='a'.repeat(64);
const ocr={modelVersion:'synthetic',imageWidth:80,imageHeight:60,source:{crop:null,resize:null},blocks:[{id:'a',order:0,originalText:'first',text:'first',confidence:null,polygon:[{x:1,y:1},{x:30,y:1},{x:30,y:20},{x:1,y:20}]},{id:'b',order:1,originalText:'second',text:'second',confidence:null,polygon:[{x:1,y:22},{x:30,y:22},{x:30,y:40},{x:1,y:40}]}]};
it('persists stable OCR-source associations and successful/failed chunks across project parse',()=>{
 const editor={...defaultEditor(),text:'first\nsecond',ocr};const data=createTranslationDocument(editor,'p',revision,'Chinese');
 expect(data.chunks.map(c=>c.sourceBlockId)).toEqual(['a','b']);
 const partial=parseTranslationDocument({...data,chunks:data.chunks.map((c,i)=>({...c,status:i?'failed':'done',text:i?null:'第一块',generatedText:i?null:'第一块',error:i?'HTTP429':null}))})!;
 const doc=parseDocument({schemaVersion:2,image:{dataUrl:'data:image/png;base64,AAAA',name:'synthetic',width:80,height:60},editor:{...editor,translationData:partial}});
 expect(doc.editor.translationData).toEqual(partial);expect(canResumeTranslation(partial,editor,'p',revision,'Chinese')).toBe(true);
 expect(canResumeTranslation(partial,editor,'p','b'.repeat(64),'Chinese')).toBe(false);
 const fresh=createTranslationDocument(editor,'p',revision,'Chinese',partial);expect(fresh.chunks[0].text).toBe('第一块');expect(fresh.chunks[1].status).toBe('pending');
});
it('preserves generated text when correcting a chunk, clears metadata on explicit full translation deletion',()=>{
 const editor={...defaultEditor(),text:'source'};const data=createTranslationDocument(editor,'p',revision,'Chinese');const done=parseTranslationDocument({...data,chunks:data.chunks.map(c=>({...c,text:'生成结果',generatedText:'生成结果',status:'done'}))})!;
 const corrected=correctTranslationChunk(done,done.chunks[0].id,'人工修订');expect(corrected.chunks[0].generatedText).toBe('生成结果');expect(translationText(corrected)).toBe('人工修订');
 expect(applyEditorChange({...editor,translation:'人工修订',translationData:corrected},{translation:''}).translationData).toBeNull();
});
it('normalizes interrupted running state and rejects duplicate IDs, mismatched source and oversized aggregate',()=>{
 const data=createTranslationDocument({...defaultEditor(),text:'x'},'p',revision,'Chinese');
 expect(parseTranslationDocument({...data,chunks:data.chunks.map(c=>({...c,status:'running'}))})!.chunks[0].status).toBe('pending');
 expect(()=>parseTranslationDocument({...data,source:'different'})).toThrow();expect(()=>parseTranslationDocument({...data,chunks:[...data.chunks,...data.chunks]})).toThrow();
 const changed=createTranslationDocument({...defaultEditor(),text:'changed'},'p',revision,'Chinese',data);expect(changed.chunks[0].status).toBe('pending');
});
