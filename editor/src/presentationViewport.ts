/** 页面布局使用同一份视口快照，缩放是浏览器实际设备像素比。 */
export type PresentationViewport={width:number;height:number;scale:number};
export function readPresentationViewport():PresentationViewport{return {width:window.innerWidth,height:window.innerHeight,scale:window.devicePixelRatio};}
/** 比较物理客户区而非强制整数 CSS 尺寸，允许分数 DPI 下的一个像素取整。 */
export function matchesPresentationViewport(actual:PresentationViewport,expected?:PresentationViewport):boolean{
  if(!expected)return true;
  return [actual.width,actual.height,actual.scale,expected.width,expected.height,expected.scale].every(n=>Number.isFinite(n)&&n>0)
    &&Math.abs(actual.scale-expected.scale)<.001&&Math.abs(actual.width*actual.scale-expected.width*expected.scale)<=2&&Math.abs(actual.height*actual.scale-expected.height*expected.scale)<=2;
}
