import {expect,it} from 'vitest';
import {parseCaptureMonitors} from './captureTargets';
import {overlayForImportedImage,overlayLayout,type OverlayMetadata} from './overlay';
const metadata:OverlayMetadata={captureId:'a',desktopBounds:{x:-1920,y:0,width:4480,height:1440},selection:{x:-1500,y:200,width:80,height:60},screens:[{bounds:{x:-1920,y:0,width:1920,height:1080},primary:false},{bounds:{x:0,y:0,width:2560,height:1440},primary:true}]};
it('validates explicit monitor identities and retains physical negative coordinates',()=>{
 const m={handle:'9007199254740993',label:'synthetic',bounds:{x:-1920,y:-240,width:1920,height:1080},primary:false,current:true};
 expect(parseCaptureMonitors({monitors:[m]})[0]).toEqual(m);
 expect(()=>parseCaptureMonitors({monitors:[{...m,handle:1}]})).toThrow();expect(()=>parseCaptureMonitors({monitors:[m,m]})).toThrow();
});
it('fits imported presentation without changing document dimensions or desktop mapping',()=>{
 const fitted=overlayForImportedImage(metadata,{width:4000,height:3000});expect(fitted.contentScale).toBeLessThan(1);expect(fitted.selection.x).toBeGreaterThanOrEqual(-1920);
 expect(fitted.selection.x+fitted.selection.width).toBeLessThanOrEqual(0);
 const layout=overlayLayout(fitted,{width:2240,height:720},{width:4000,height:3000},0);
 expect(layout.frame.width).toBeCloseTo(4000*.5*fitted.contentScale!);expect(layout.scale.x).toBeCloseTo(.5*fitted.contentScale!);
 expect(metadata.selection.width).toBe(80);
});
