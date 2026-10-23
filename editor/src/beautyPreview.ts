import { FabricImage, StaticCanvas } from 'fabric';
import { annotationToObject } from './annotations';
import { applyEditorChange, contentGeometry, type ProjectDocument } from './document';
import { renderBase } from './render';

/** 只移除美化装饰并补偿标注坐标；遮盖、裁剪和译文继续参与本地预览。 */
export function undecoratedDocument(doc:ProjectDocument):ProjectDocument {
  return {...doc,editor:applyEditorChange(doc.editor,{mode:'raw'})};
}

/** 按目标尺寸合成已提交内容，缩略图不分配全尺寸背板，也不写盘或调用宿主。 */
export async function renderBeautyContent(doc:ProjectDocument,maxEdge:number):Promise<HTMLCanvasElement> {
  const raw=undecoratedDocument(doc),size=contentGeometry(raw.image,raw.editor);
  const scale=Math.min(1,maxEdge/Math.max(size.width,size.height));
  const base=await renderBase(raw,scale);
  if(!raw.editor.annotations.length)return base;
  const canvas=new StaticCanvas(undefined,{width:base.width,height:base.height,enableRetinaScaling:false,renderOnAddRemove:false});
  try{
    canvas.setViewportTransform([scale,0,0,scale,0,0]);
    canvas.add(new FabricImage(base,{originX:'left',originY:'top',scaleX:1/scale,scaleY:1/scale}));
    for(const annotation of raw.editor.annotations)canvas.add(annotationToObject(annotation));
    canvas.renderAll();
    return canvas.toCanvasElement(1);
  }finally{await canvas.dispose();base.width=base.height=0;}
}
