import { Control, FabricObject, Path, Point, Rect, Textbox, controlsUtils, util } from 'fabric';
import { FONT } from './render';
import type { Annotation, AnnotationKind } from './document';
const kinds = new WeakMap<FabricObject, { type: AnnotationKind; id: string }>();
/** 只用本地几何构造标注，不恢复任意 Fabric JSON；遮盖不接受透明度字段。 */
export function annotationToObject(a: Annotation): FabricObject {
  const props = { originX: 'left' as const, originY: 'top' as const, left: a.left, top: a.top, width: a.width, height: a.height, scaleX: a.scaleX, scaleY: a.scaleY, angle: a.angle, cornerColor: '#b4432c', borderColor: '#b4432c', transparentCorners: false, lockScalingFlip: true };
  let object: FabricObject;
  if (a.type === 'text') object = new Textbox(a.text, { ...props, fontFamily: FONT, fontSize: a.fontSize, fill: a.color, splitByGrapheme: true, backgroundColor: a.backgroundColor || '' });
  else if (a.type === 'arrow') object = new Path(`M 0 ${a.height / 2} L ${a.width} ${a.height / 2} M ${Math.max(0, a.width - 16)} 0 L ${a.width} ${a.height / 2} L ${Math.max(0, a.width - 16)} ${a.height}`, { ...props, fill: 'transparent', stroke: a.color, strokeWidth: 3, strokeUniform: true });
  else object = new Rect({ ...props, fill: a.type === 'rect' ? 'transparent' : a.color, stroke: a.type === 'rect' ? a.color : undefined, strokeWidth: a.type === 'rect' ? 3 : 0, strokeUniform: true, opacity: a.type === 'highlight' ? .3 : 1 });
  object.set({cornerColor:'#f5f5f7',cornerStrokeColor:'#3b82f6',borderColor:'#3b82f6',cornerStyle:'circle',cornerSize:12});
  if(a.type==='arrow'){
    object.hasBorders=false;
    object.controls=Object.fromEntries((['tail','head'] as const).map(end=>[end,new Control({
      cursorStyle:'crosshair',actionName:'modifyArrow',render:controlsUtils.renderCircleControl,
      positionHandler(_dim,_matrix,target){const endpoints=arrowEndpoints(target);return endpoints[end].transform(target.getViewportTransform());},
      actionHandler(_event,transform,x,y){
        const target=transform.target,endpoints=arrowEndpoints(target),canvas=target.canvas;
        const point=new Point(Math.max(0,Math.min(canvas?.width??16000,x)),Math.max(0,Math.min(canvas?.height??16000,y)));
        const tail=end==='tail'?point:endpoints.tail,head=end==='head'?point:endpoints.head;
        if(tail.distanceFrom(head)<2)return false;
        positionArrow(target as Path,tail,head);return true;
      },
    })]));
  }else if(a.type!=='text')object.setControlsVisibility({mtr:false});
  kinds.set(object, { type: a.type, id: a.id || crypto.randomUUID() });
  return object;
}
/** 序列化白名单字段，图像/滤镜/混合模式和不透明遮盖之外的状态均不会保存。 */
export function annotationFromObject(object: FabricObject): Annotation {
  const meta = kinds.get(object) || { type: object instanceof Textbox ? 'text' as const : 'rect' as const, id: crypto.randomUUID() };
  const filled = meta.type === 'text' || meta.type === 'highlight' || meta.type === 'cover';
  return { ...meta, left: object.left, top: object.top, width: Math.max(1, object.width), height: Math.max(1, object.height), scaleX: object.scaleX, scaleY: object.scaleY, angle: object.angle, text: object instanceof Textbox ? object.text : '', color: String(filled ? object.fill : object.stroke), fontSize: object instanceof Textbox ? object.fontSize : 26, ...(object instanceof Textbox && /^#[0-9a-f]{6}$/i.test(object.backgroundColor) ? { backgroundColor: object.backgroundColor } : {}) };
}
/** 选中对象属性作为一次可撤销变更；实色遮盖始终重新强制不透明。 */
export function patchAnnotationObject(object: FabricObject, change: { color: string; fontSize: number }) {
  const annotation = annotationFromObject(object);
  if (annotation.type === 'text') object.set({ fill: change.color });
  else if (annotation.type === 'rect' || annotation.type === 'arrow') object.set({ stroke: change.color });
  else object.set({ fill: change.color, opacity: annotation.type === 'cover' ? 1 : .3 });
  if (object instanceof Textbox) object.set({ fontSize: change.fontSize });
  object.setCoords();
}

/** 箭头只保留首尾控制点；路径局部中心经完整矩阵映射，兼容已有旋转/缩放项目。 */
export function arrowEndpoints(object:Pick<FabricObject,'width'|'calcTransformMatrix'>){
  const matrix=object.calcTransformMatrix();
  return {tail:new Point(-object.width/2,0).transform(matrix),head:new Point(object.width/2,0).transform(matrix)};
}
/** 重建局部路径并固定首尾中点；移动一端时另一端不受包围框重算影响。 */
export function positionArrow(object:Path,tail:Point,head:Point){
  const length=Math.max(1,tail.distanceFrom(head)),height=Math.min(24,length),tip=Math.min(16,length*.4);
  object.set({path:util.parsePath(`M 0 ${height/2} L ${length} ${height/2} M ${length-tip} 0 L ${length} ${height/2} L ${length-tip} ${height}`),scaleX:1,scaleY:1,angle:Math.atan2(head.y-tail.y,head.x-tail.x)*180/Math.PI});
  object.setDimensions();object.setPositionByOrigin(tail.midPointFrom(head),'center','center');object.setCoords();
}
