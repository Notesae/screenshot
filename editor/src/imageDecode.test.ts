import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 手动完成解码，只计图片源赋值与竞态；不依赖 DOM、网络或真实图片。
class FakeImage {
  static created:FakeImage[]=[];
  onload:(()=>void)|null=null;
  onerror:(()=>void)|null=null;
  src='';
  constructor(){FakeImage.created.push(this);}
}
beforeEach(()=>{vi.resetModules();FakeImage.created=[];vi.stubGlobal('Image',FakeImage);});
afterEach(()=>vi.unstubAllGlobals());
describe('bounded image decode reuse',()=>{
  it('shares pending and completed decode between validation and canvas render',async()=>{
    const {loadImage}=await import('./render');
    const first=loadImage('same');expect(loadImage('same')).toBe(first);
    FakeImage.created[0].onload!();await first;
    expect(loadImage('same')).toBe(first);expect(FakeImage.created).toHaveLength(1);
  });
  it('keeps only the most recent source instead of caching undo history',async()=>{
    const {loadImage}=await import('./render');
    const first=loadImage('a');FakeImage.created[0].onload!();await first;
    const second=loadImage('b');FakeImage.created[1].onload!();await second;
    expect(loadImage('a')).not.toBe(first);expect(FakeImage.created).toHaveLength(3);
    FakeImage.created[2].onload!();
  });
  it('retries the most recent image after a decoding failure',async()=>{
    const {loadImage}=await import('./render');
    const first=loadImage('broken'),failure=expect(first).rejects.toThrow('图片无法解码');
    FakeImage.created[0].onerror!();await failure;
    const retry=loadImage('broken');expect(retry).not.toBe(first);
    FakeImage.created[1].onload!();await retry;
  });
  it('does not evict a newer decode when an old request for the same URL fails late',async()=>{
    const {loadImage}=await import('./render');
    const first=loadImage('a'),failure=expect(first).rejects.toThrow();
    const middle=loadImage('b');FakeImage.created[1].onload!();await middle;
    const latest=loadImage('a');FakeImage.created[0].onerror!();await failure;
    expect(loadImage('a')).toBe(latest);expect(FakeImage.created).toHaveLength(3);
    FakeImage.created[2].onload!();await latest;
  });
});
