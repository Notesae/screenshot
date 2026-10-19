import { expect, it } from 'vitest';
import { defaultEditor, transformContent, type ProjectDocument } from './document';
import { processingMasks } from './processingPrivacy';
const doc: ProjectDocument = { schemaVersion: 2, image: { dataUrl: 'data:image/png;base64,AAAA', name: 'synthetic', width: 800, height: 600 }, editor: { ...defaultEditor(), annotations: [{ id:'cover', type:'cover', left:100, top:80, width:100, height:50, scaleX:1, scaleY:1, angle:0, text:'', color:'#123456', fontSize:26 }] } };
it('maps a cover before crop/resize sampling and keeps original source immutable', () => {
  const transformed = transformContent(doc, { x:40, y:20, width:400, height:300 }, { width:200, height:150 });
  expect(processingMasks(transformed)).toEqual([{ x:58, y:58, width:104, height:54, color:'#123456' }]);
  expect(transformed.image).toBe(doc.image);
});
it('uses the same content coordinates with beauty padding and conservative rotated bounds', () => {
  const editor = { ...doc.editor, mode:'beauty' as const, padding:48, annotations:doc.editor.annotations.map(a=>({...a,left:148,top:128,angle:90})) };
  expect(processingMasks({ ...doc, editor })[0]).toMatchObject({ x:48, y:78, width:54, height:104 });
});
it('clips outside covers, ignores visual markers, and refuses ambiguous text-card cover coordinates', () => {
  expect(processingMasks({...doc,editor:{...doc.editor,annotations:doc.editor.annotations.map(a=>({...a,left:-200}))}})).toEqual([]);
  expect(processingMasks({...doc,editor:{...doc.editor,annotations:doc.editor.annotations.map(a=>({...a,type:'highlight'}))}})).toEqual([]);
  expect(()=>processingMasks({...doc,editor:{...doc.editor,mode:'reflow'}})).toThrow('无法对应原图');
});
