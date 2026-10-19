import { FabricObject, Path, Rect, Textbox } from 'fabric';
import { FONT } from './render';
import type { Annotation, AnnotationKind } from './document';
const kinds = new WeakMap<FabricObject, { type: AnnotationKind; id: string }>();
/** 只用本地几何构造标注，不恢复任意 Fabric JSON；遮盖不接受透明度字段。 */
export function annotationToObject(a: Annotation): FabricObject {
  const props = { originX: 'left' as const, originY: 'top' as const, left: a.left, top: a.top, width: a.width, height: a.height, scaleX: a.scaleX, scaleY: a.scaleY, angle: a.angle, cornerColor: '#b4432c', borderColor: '#b4432c', transparentCorners: false, lockScalingFlip: true };
  let object: FabricObject;
  if (a.type === 'text') object = new Textbox(a.text, { ...props, fontFamily: FONT, fontSize: a.fontSize, fill: a.color, splitByGrapheme: true });
  else if (a.type === 'arrow') object = new Path(`M 0 ${a.height / 2} L ${a.width} ${a.height / 2} M ${Math.max(0, a.width - 16)} 0 L ${a.width} ${a.height / 2} L ${Math.max(0, a.width - 16)} ${a.height}`, { ...props, fill: 'transparent', stroke: a.color, strokeWidth: 3, strokeUniform: true });
  else object = new Rect({ ...props, fill: a.type === 'rect' ? 'transparent' : a.color, stroke: a.type === 'rect' ? a.color : undefined, strokeWidth: a.type === 'rect' ? 3 : 0, strokeUniform: true, opacity: a.type === 'highlight' ? .3 : 1 });
  kinds.set(object, { type: a.type, id: a.id || crypto.randomUUID() });
  return object;
}
/** 序列化白名单字段，图像/滤镜/混合模式和不透明遮盖之外的状态均不会保存。 */
export function annotationFromObject(object: FabricObject): Annotation {
  const meta = kinds.get(object) || { type: object instanceof Textbox ? 'text' as const : 'rect' as const, id: crypto.randomUUID() };
  const filled = meta.type === 'text' || meta.type === 'highlight' || meta.type === 'cover';
  return { ...meta, left: object.left, top: object.top, width: Math.max(1, object.width), height: Math.max(1, object.height), scaleX: object.scaleX, scaleY: object.scaleY, angle: object.angle, text: object instanceof Textbox ? object.text : '', color: String(filled ? object.fill : object.stroke), fontSize: object instanceof Textbox ? object.fontSize : 26 };
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
