import { expect,it } from 'vitest';
import { overlayLayout,type OverlayMetadata } from './overlay';
it('keeps compact controls separate and usable across 500 deterministic geometries',()=>{
 let seed=69173;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 const area=(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number})=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
 const failures:unknown[]=[];
 for(let i=0;i<500;i++){
  const width=640+Math.floor(random()*1280),height=360+Math.floor(random()*720),selection={x:Math.floor(random()*900),y:Math.floor(random()*500),width:80+Math.floor(random()*900),height:60+Math.floor(random()*500)};
  selection.x=Math.min(selection.x,1920-selection.width);selection.y=Math.min(selection.y,1080-selection.height);
  const metadata:OverlayMetadata={desktopBounds:{x:0,y:0,width:1920,height:1080},selection,screens:[{bounds:{x:0,y:0,width:1920,height:1080},primary:true}]};
  const padding=i%2?48:0,statusHeight=32+Math.floor(random()*40),layout=overlayLayout(metadata,{width,height},{width:selection.width+padding*2,height:selection.height+padding*2},padding,{width:560,height:44+Math.floor(random()*50),statusHeight,panelOpen:true}),panel={...layout.panel,height:layout.panel.maxHeight};
  const boxes=[layout.toolbar,layout.status,panel];
  const valid=boxes.every(b=>Number.isFinite(b.x+b.y+b.width+b.height)&&b.x>=-.01&&b.y>=-.01&&b.x+b.width<=width+.01&&b.y+b.height<=height+.01)&&area(panel,layout.toolbar)<.01&&area(panel,layout.status)<.01&&panel.height>=120;
  if(!valid)failures.push({i,viewport:{width,height},metadata,padding,statusHeight,layout});
  expect(Math.abs(layout.frame.x+padding*layout.scale.x-selection.x*width/1920)).toBeLessThan(.01);
 }
 expect(failures).toEqual([]);
});
