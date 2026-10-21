import { describe, expect, it } from 'vitest';
import { matchesPresentationViewport } from './presentationViewport';

describe('capture presentation viewport',()=>{
  const target={width:3584,height:1440,scale:1.25};
  it('accepts the current viewport and fractional CSS rounding',()=>{
    expect(matchesPresentationViewport({...target},target)).toBe(true);
    expect(matchesPresentationViewport({width:2987,height:1200,scale:1.5},{width:4480/1.5,height:1200,scale:1.5})).toBe(true);
  });
  it('rejects stale DPI even when physical dimensions coincide',()=>{
    expect(matchesPresentationViewport({width:4480/1.5,height:1200,scale:1.5},target)).toBe(false);
  });
  it('rejects a resize that has not reached the browser',()=>{
    expect(matchesPresentationViewport({width:1100,height:760,scale:1},target)).toBe(false);
    expect(matchesPresentationViewport({...target,width:target.width-3},target)).toBe(false);
  });
  it('rejects invalid sizes and supports hosts without the optional viewport',()=>{
    for(const value of [0,-1,NaN,Infinity]){
      expect(matchesPresentationViewport({...target,scale:value},target)).toBe(false);
      expect(matchesPresentationViewport(target,{...target,width:value})).toBe(false);
    }
    expect(matchesPresentationViewport(target)).toBe(true);
  });
});
