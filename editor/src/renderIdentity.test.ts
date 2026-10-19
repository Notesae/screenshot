import { expect, it } from 'vitest';
import { defaultEditor } from './document';
import { baseRenderKey } from './renderIdentity';

it('ignores invisible text and style in raw images but invalidates crop and resize', () => {
  const editor = defaultEditor(), key = baseRenderKey(editor);
  expect(baseRenderKey({ ...editor, text:'校对', translation:'Translation', title:'卡片', padding:100, background:'#112233', lineSpacing:2 })).toBe(key);
  expect(baseRenderKey({ ...editor, crop:{x:0,y:0,width:20,height:20} })).not.toBe(key);
  expect(baseRenderKey({ ...editor, resize:{width:20,height:20} })).not.toBe(key);
});
it('tracks every visible beauty decoration while ignoring OCR text', () => {
  const editor = { ...defaultEditor(), mode:'beauty' as const }, key = baseRenderKey(editor);
  expect(baseRenderKey({ ...editor, text:'校对', translation:'Translation', fontSize:40 })).toBe(key);
  for (const change of [{padding:100},{radius:10},{background:'#112233'},{shadow:!editor.shadow},{borderWidth:2},{borderColor:'#112233'}]) expect(baseRenderKey({...editor,...change})).not.toBe(key);
});
it('invalidates visible reflow text and typography, keeping hidden fields out of the key', () => {
  const editor = { ...defaultEditor(), mode:'reflow' as const, text:'正文', translation:'Translation' }, key = baseRenderKey(editor);
  expect(baseRenderKey({...editor,translation:'Other',padding:100})).toBe(key);
  for(const change of [{text:'新正文'},{title:'新标题'},{fontSize:40},{textWidth:1000},{lineSpacing:2},{paragraphSpacing:30},{textLayout:'parallel' as const}]) expect(baseRenderKey({...editor,...change})).not.toBe(key);
  const translated={...editor,textLayout:'translated' as const};
  expect(baseRenderKey({...translated,text:'隐藏原文'})).toBe(baseRenderKey(translated));
  expect(baseRenderKey({...translated,translation:'新译文'})).not.toBe(baseRenderKey(translated));
});
