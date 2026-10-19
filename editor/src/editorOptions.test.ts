import { expect,it } from 'vitest';
import { applyEditorChange,defaultEditor,parseDocument } from './document';
import { copyText } from './textCopy';
import { editorStyle,parsePresets } from './stylePresets';
import { textLayout } from './textLayout';
it('keeps translation source through source edits and clears the stale state on undo data',()=>{
  const original={...defaultEditor(),text:'source'};
  const translated=applyEditorChange(original,{translation:'译文'});
  expect(translated.translationSource).toBe('source');
  const changed=applyEditorChange(translated,{text:'new source'});
  expect(changed.translationSource).not.toBe(changed.text);
  expect(translated.translationSource).toBe(translated.text);
  expect(applyEditorChange(changed,{translation:''}).translationSource).toBeNull();
});
it('preserves source line breaks or merges only soft lines with CJK/Latin boundaries',()=>{
  expect(copyText('中文\n文字\n\nhello\nworld',true)).toBe('中文文字\n\nhello world');
  expect(copyText(' x\r\ny ',false)).toBe(' x\r\ny ');
});
it('spacing affects section offsets and stacked translation placement without changing text',()=>{
  const editor={...defaultEditor(),text:'第一段\n第二段',translation:'translation',textLayout:'stacked' as const};
  const base=textLayout(editor), spaced=textLayout({...editor,lineSpacing:2,paragraphSpacing:24});
  expect(spaced.sections[0].offsets[1]).toBe(editor.fontSize*2+24);
  expect(spaced.sections[1].y).toBeGreaterThan(base.sections[1].y);
  expect(spaced.sections[0].lines.join('')).toBe('第一段第二段');
});
it('preset whitelist excludes content, validates bounds, and older projects receive defaults',()=>{
  const editor={...defaultEditor(),text:'private text',translation:'secret',background:'#aabbcc'};
  const presets=parsePresets([{id:'a',name:'测试',style:{...editorStyle(editor),text:'must not persist'}}]);
  expect(presets[0].style).not.toHaveProperty('text');
  expect(JSON.stringify(presets)).not.toContain('secret');
  expect(()=>parsePresets([{id:'a',name:'测试',style:{padding:9999}}])).toThrow();
  expect(()=>parsePresets(Array(21).fill(presets[0]))).toThrow();
  const {borderWidth,lineSpacing,paragraphSpacing,translationSource,...legacy}=defaultEditor();
  const restored=parseDocument({schemaVersion:2,image:null,editor:legacy});
  expect(restored.editor).toMatchObject({borderWidth:0,lineSpacing:1.7,paragraphSpacing:0,translationSource:null});
});
