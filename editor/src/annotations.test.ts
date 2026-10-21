import { describe, expect, it } from 'vitest';
import { Path, Point } from 'fabric';
import { annotationToObject, annotationFromObject, arrowEndpoints, positionArrow } from './annotations';
import type { Annotation } from './document';
const arrow:Annotation={id:'synthetic-arrow',type:'arrow',left:10,top:20,width:120,height:24,scaleX:1,scaleY:1,angle:0,text:'',color:'#b4432c',fontSize:26};
describe('箭头端点几何',()=>{
  for(const [name,tail,head] of [
    ['向右',new Point(20,30),new Point(180,30)],['反向',new Point(180,140),new Point(20,30)],['竖直',new Point(100,180),new Point(100,20)],
  ] as const)it(name+'绘制精确落在按下和松手点',()=>{
    const object=annotationToObject(arrow) as Path;positionArrow(object,tail,head);
    const result=arrowEndpoints(object);expect(result.tail.distanceFrom(tail)).toBeLessThan(.001);expect(result.head.distanceFrom(head)).toBeLessThan(.001);
    const restored=arrowEndpoints(annotationToObject(annotationFromObject(object)));expect(restored.tail.distanceFrom(tail)).toBeLessThan(.001);expect(restored.head.distanceFrom(head)).toBeLessThan(.001);
  });
  it('改变尾端保留头端，且撤销数据仍能恢复',()=>{
    const object=annotationToObject({...arrow,angle:37,scaleX:1.5,scaleY:.8}) as Path,previous=annotationFromObject(object),before=arrowEndpoints(object);
    const next=new Point(10,150);positionArrow(object,next,before.head);
    expect(arrowEndpoints(object).head.distanceFrom(before.head)).toBeLessThan(.001);expect(arrowEndpoints(object).tail.distanceFrom(next)).toBeLessThan(.001);
    expect(arrowEndpoints(annotationToObject(previous)).tail.distanceFrom(before.tail)).toBeLessThan(.001);
  });
  it('箭头只有两个端点，矩形没有旋转手柄',()=>{
    expect(Object.keys(annotationToObject(arrow).controls)).toEqual(['tail','head']);
    expect(annotationToObject({...arrow,type:'rect'}).isControlVisible('mtr')).toBe(false);
  });
});
