import { FabricImage, StaticCanvas } from 'fabric';
import { annotationToObject } from './annotations';
import { applyEditorChange, outputSize, type ProjectDocument } from './document';
import { renderBase } from './render';

/** 只移除美化装饰并补偿标注坐标；遮盖、裁剪和译文继续参与本地预览。 */
export function undecoratedDocument(doc:ProjectDocument):ProjectDocument {
  return {...doc,editor:applyEditorChange(doc.editor,{mode:'raw'})};
}

/** 按目标尺寸合成已提交内容，缩略图不分配全尺寸背板，也不写盘或调用宿主。 */
export async function renderBeautyContent(doc:ProjectDocument,maxEdge:number):Promise<HTMLCanvasElement> {
  return renderBeautyPreview(undecoratedDocument(doc),maxEdge);
}

/** 大预览复用成品底图与标注顺序；限制背板尺寸，参数变化也不会分配全尺寸截图。 */
export async function renderBeautyPreview(doc:ProjectDocument,maxEdge:number):Promise<HTMLCanvasElement> {
  const size=outputSize(doc.image,doc.editor);
  const scale=Math.min(1,maxEdge/Math.max(size.width,size.height));
  const base=await renderBase(doc,scale);
  if(!doc.editor.annotations.length)return base;
  const canvas=new StaticCanvas(undefined,{width:base.width,height:base.height,enableRetinaScaling:false,renderOnAddRemove:false});
  try{
    canvas.setViewportTransform([scale,0,0,scale,0,0]);
    canvas.add(new FabricImage(base,{originX:'left',originY:'top',scaleX:1/scale,scaleY:1/scale}));
    for(const annotation of doc.editor.annotations)canvas.add(annotationToObject(annotation));
    canvas.renderAll();
    return canvas.toCanvasElement(1);
  }finally{await canvas.dispose();base.width=base.height=0;}
}
