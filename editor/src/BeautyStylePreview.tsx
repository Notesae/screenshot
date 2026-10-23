import { useEffect, useState } from 'react';
import { ControlButton } from './ControlMotion';
import type { ProjectDocument } from './document';
import { renderBeautyPreview, undecoratedDocument } from './beautyPreview';
import { beautyStyle } from './stylePresets';

type Preview = {image:ProjectDocument['image'];contentKey:string;key:string;url:string};

/** 预览只读当前成品；放大左上边角方便辨认留白、圆角与阴影，不写文档历史。 */
export function BeautyStylePreview({document:doc,comparing}:{document:ProjectDocument;comparing:boolean}) {
  const [detail,setDetail]=useState(false),[preview,setPreview]=useState<Preview|null>(null);
  const [failedKey,setFailedKey]=useState<string|null>(null),[retry,setRetry]=useState(0);
  const raw=undecoratedDocument(doc),shown=comparing?raw:doc;
  const contentKey=JSON.stringify([raw.editor.crop,raw.editor.resize,raw.editor.annotations,raw.editor.imageTranslation]);
  const key=JSON.stringify([contentKey,beautyStyle(shown.editor)]);
  useEffect(()=>{
    let cancelled=false;
    const snapshot=shown;setFailedKey(null);
    // 连续拖动先合并请求；同内容的旧预览保留并标明更新中，新图片不会沿用旧截图。
    const timer=window.setTimeout(()=>{
      void renderBeautyPreview(snapshot,1536).then(canvas=>{
        try{if(!cancelled){setPreview({image:snapshot.image,contentKey,key,url:canvas.toDataURL('image/png')});setFailedKey(null);}}
        finally{canvas.width=canvas.height=0;}
      }).catch(()=>{if(!cancelled)setFailedKey(key);});
    },60);
    return()=>{cancelled=true;window.clearTimeout(timer);};
  },[doc.image,contentKey,key,retry]);
  const failed=failedKey===key;
  const image=preview?.image===doc.image&&preview.contentKey===contentKey&&!failed?preview:null;
  const pending=!failed&&image?.key!==key;
  return <div className="beauty-preview">
    <div className="beauty-preview-heading"><span>{comparing?'原样预览':'效果预览'}</span>
      <div className="beauty-preview-modes" role="group" aria-label="预览比例">
        <ControlButton aria-pressed={!detail} onClick={()=>setDetail(false)}>完整</ControlButton>
        <ControlButton aria-pressed={detail} onClick={()=>setDetail(true)}>3× 边角</ControlButton>
      </div>
    </div>
    <div className="beauty-preview-viewport" data-detail={detail||undefined} aria-busy={pending}>
      {image&&<img src={image.url} alt={detail?'当前截图左上边角的三倍预览':'当前截图的完整效果预览'} draggable={false}/>}
      {(pending||failed)&&<div className="beauty-preview-message" role="status">
        <span>{failed?'预览暂不可用':image?'更新预览中…':'正在生成预览…'}</span>
        {failed&&<ControlButton onClick={()=>{setFailedKey(null);setRetry(value=>value+1);}}>重试</ControlButton>}
      </div>}
    </div>
  </div>;
}
