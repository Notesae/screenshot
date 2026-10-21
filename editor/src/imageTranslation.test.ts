import { expect, it } from 'vitest';
import { groupImageTextLines, parseImageTranslation, shouldTranslateImageText } from './imageTranslation';
import { parseImageTranslationDocument, type ImageTranslationPlacement } from './imageTranslationLayout';
import { defaultEditor, parseDocument, transformContent, type ProjectDocument } from './document';
import { baseRenderKey } from './renderIdentity';
import { commitHistory, createHistory, redoHistory, undoHistory } from './history';

const block:ImageTranslationPlacement={source:'Pay as you go',text:'按量付费',x:100,y:100,width:200,height:40,fontSize:16,color:'#161616',backgroundColor:'#ffffff',align:'left',needsReading:false,overflow:false};
const image={dataUrl:'data:image/png;base64,AAAA',name:'合成图片',width:1000,height:800};
const original:ProjectDocument={schemaVersion:2,image,editor:defaultEditor()};

it('leaves quantities, units, translated prices and URLs unchanged without suppressing natural language',()=>{
  for(const text of ['3GB','250 GB','$3.75/GB','2.00美元/GB','1000px','GB','USD','https://example.test','www.example.com','你好','123'])expect(shouldTranslateImageText(text),text).toBe(false);
  for(const text of ['10 More','Get started!','Pay As You Go','Most popular','Pricing'])expect(shouldTranslateImageText(text),text).toBe(true);
});

it('groups only nearby prose in the same column and retains separate UI labels',()=>{
  const first={source:'A longer paragraph starts here',x:20,y:20,width:200,height:20};
  const next={source:'and continues on the next line',x:20,y:45,width:190,height:20};
  expect(groupImageTextLines([next,first])).toEqual([{...first,source:first.source+'\n'+next.source,height:45}]);
  for(const other of [{...next,x:300},{...next,y:100},{...next,height:40}])expect(groupImageTextLines([first,other])).toHaveLength(2);
  expect(groupImageTextLines([{...first,source:'Pricing'},{...next,source:'Get started'}])).toHaveLength(2);
});

it('rejects service coordinates and responses that cannot be safely placed inside the selection',()=>{
  expect(parseImageTranslation({blocks:[block]})).toEqual([{source:block.source,text:block.text,x:100,y:100,width:200,height:40}]);
  for(const change of [{x:-1},{x:990},{width:0},{height:NaN},{text:''},{source:'x'.repeat(2001)}])expect(()=>parseImageTranslation({blocks:[{...block,...change}]})).toThrow();
  expect(()=>parseImageTranslation({blocks:Array.from({length:251},()=>block)})).toThrow();
});

it('loads only the image translation whitelist and rejects executable or malformed presentation fields',()=>{
  expect(parseImageTranslationDocument({blocks:[{...block,src:'https://example.test',html:'<script>bad()</script>'}]})).toEqual({blocks:[block]});
  for(const change of [{color:'url(https://example.test)'},{backgroundColor:'red'},{align:'right'},{fontSize:4},{fontSize:Infinity},{overflow:'true'},{needsReading:1},{x:1001}])expect(()=>parseImageTranslationDocument({blocks:[{...block,...change}]})).toThrow();
  expect(()=>parseImageTranslationDocument({blocks:Array.from({length:12},()=>({...block,text:'文'.repeat(2000)}))})).toThrow();
});

it('round-trips translation metadata while preserving the original image and source coordinates through crop/resize',()=>{
  const translated={...original,editor:{...original.editor,imageTranslation:{blocks:[block]}}};
  expect(parseDocument(translated)).toMatchObject({image,editor:{imageTranslation:{blocks:[block]}}});
  const cropped=transformContent(translated,{x:50,y:40,width:500,height:400},{width:250,height:200});
  expect(cropped.image).toBe(image);expect(cropped.editor.imageTranslation).toEqual(translated.editor.imageTranslation);
  expect(()=>parseDocument({...translated,image:null})).toThrow();
  expect(parseDocument(original).editor.imageTranslation).toBeNull();
});

it('rebuilds the preview for translated layers and restores the unchanged original through undo/redo',()=>{
  const translated={...original,editor:{...original.editor,imageTranslation:{blocks:[block]}}};
  expect(baseRenderKey(original.editor)).not.toBe(baseRenderKey(translated.editor));
  const history=commitHistory(createHistory(original),translated);
  expect(undoHistory(history).present).toBe(original);
  expect(redoHistory(undoHistory(history)).present).toBe(translated);
  expect(history.present.image).toBe(image);expect(history.present.editor.annotations).toEqual([]);
});
