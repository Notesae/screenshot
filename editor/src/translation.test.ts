import { expect,it } from 'vitest';
import { runTranslationChunks,translationChunks } from './translation';
it('chunks preserve every source code point and prefer paragraph boundaries',()=>{
  const source='中文😀'.repeat(900)+'\n'+'tail '.repeat(300),chunks=translationChunks(source);
  expect(chunks.map(c=>c.source).join('')).toBe(source);
  expect(chunks.every(c=>Array.from(c.source).length<=2000)).toBe(true);
  expect(chunks.every(c=>!/[\uD800-\uDBFF]$/.test(c.source))).toBe(true);
});
it('keeps successful blocks and retries only failed blocks in order',async()=>{
  let calls=0;const chunks=translationChunks('a'.repeat(4300));
  const failed=await runTranslationChunks(chunks,async()=>{calls++;if(calls===2)throw new Error('limited');return 'translated-'+calls;},()=>{},()=>true);
  expect(failed.map(c=>c.status)).toEqual(['done','failed','done']);expect(calls).toBe(3);
  const retried=await runTranslationChunks(failed,async()=>{calls++;return 'retry';},()=>{},()=>true);
  expect(calls).toBe(4);expect(retried.map(c=>c.text)).toEqual(['translated-1','retry','translated-3']);
  expect(chunks.every(c=>c.status==='pending')).toBe(true);
});
it('cancellation stops later sends and stale responses never publish progress',async()=>{
  let current=true,calls=0,updates=0;
  await runTranslationChunks(translationChunks('a'.repeat(4300)),async()=>{calls++;current=false;return 'late';},()=>updates++,()=>current);
  expect(calls).toBe(1);expect(updates).toBe(1);
});
