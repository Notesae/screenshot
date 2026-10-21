import {expect,it} from 'vitest';
import {boundTool,placeTools} from './toolPlacement';
it('工具位置在屏内，空间足够时浮卡与轨留出48px净空，不修改图像坐标',()=>{
  const frame={x:400,y:200,width:500,height:300},original=JSON.stringify(frame);
  const layout=placeTools({x:0,y:0,width:1600,height:1000},frame,{width:800,height:52},{width:340,height:420});
  const a=layout.card,b=layout.rail;
  expect(a.x+a.width+48<=b.x||b.x+b.width+48<=a.x||a.y+a.height+48<=b.y||b.y+b.height+48<=a.y).toBe(true);
  expect(JSON.stringify(frame)).toBe(original);
});
it('在窄显示器自动缩短浮卡滚动区，不覆盖横跨屏宽的动作轨',()=>{
  const layout=placeTools({x:0,y:0,width:640,height:760},{x:100,y:160,width:320,height:240},{width:608,height:92},{width:360,height:620});
  const a=layout.card,b=layout.rail;
  expect(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y).toBe(true);
  expect(a.height).toBeLessThan(620);expect(a.height).toBeGreaterThanOrEqual(80);
});
it('手动位置不因普通重绘重置，缩小窗口后校正到可达范围',()=>{
  expect(boundTool({x:-100,y:1000},{width:300,height:200},{x:0,y:0,width:640,height:480})).toEqual({x:0,y:280});
  const layout=placeTools({x:0,y:0,width:1200,height:800},null,{width:600,height:52},{width:300,height:400},{rail:{x:100,y:650},card:{x:800,y:100}});
  expect(layout.rail).toMatchObject({x:100,y:650});expect(layout.card).toMatchObject({x:800,y:100});
});
it.each([{x:-1920,y:-240,width:1920,height:1080},{x:0,y:0,width:390,height:600}])('兼容负坐标与窄屏，不把工具放到屏外',screen=>{
  const layout=placeTools(screen,null,{width:800,height:90},{width:340,height:500});
  for(const box of [layout.rail,layout.card]){expect(box.x).toBeGreaterThanOrEqual(screen.x);expect(box.y).toBeGreaterThanOrEqual(screen.y);expect(box.x+box.width).toBeLessThanOrEqual(screen.x+screen.width);expect(box.y+box.height).toBeLessThanOrEqual(screen.y+screen.height);}
});
