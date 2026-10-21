import { contentGeometry, type ProjectDocument } from './document';
import { loadImage } from './render';
import type { OcrData } from './ocr';
import { fitImageText, parseImageTranslationDocument, type ImageTranslationDocument } from './imageTranslationLayout';

/** 千分比坐标只指向已发送的选区内容，不能引用桌面或任意图片资源。 */
export type ImageTranslationBlock = {source:string;text:string;x:number;y:number;width:number;height:number};
export type ImageTextRegion = Omit<ImageTranslationBlock, 'text'>;
type Rect = {x:number;y:number;width:number;height:number};
type Colors = {background:string;foreground:string};

/** 数量/容量、价格、尺寸、网址和代码不作为自然语言短语交给模型，避免 3GB 被解释成其它概念。 */
export function shouldTranslateImageText(source:string):boolean {
  const text=source.trim();
  if(!Array.from(text).some(char=>/\p{Letter}/u.test(char)&&!/\p{Script=Han}/u.test(char)))return false;
  if(/^(?:https?:\/\/|www\.|[\w.+-]+@)|^[\w.-]+\.(?:com|net|org|io|cn)(?:\/|$)/i.test(text))return false;
  const unit='(?:[kmgtp]i?b|b|px|pt|em|rem|[kmc]?g|[kmc]?m|[mu]?l|usd|eur|gbp|cny|rmb|jpy|usdt|kwh|[kmg]?hz|fps|dpi|mp|ms|s|h|d)';
  const withoutUnits=text.replace(new RegExp('(?<![a-z])'+unit+'(?![a-z])','gi'),'');
  if(!Array.from(withoutUnits).some(char=>/\p{Letter}/u.test(char)&&!/\p{Script=Han}/u.test(char)))return false;
  if(new RegExp('^(?:[\\p{Sc}\\s+−-]*\\d[\\d.,\\s]*\\s*(?:'+unit+'|[×x]\\s*\\d+)?\\s*(?:[/%°]|\\/(?:'+unit+'|月|年|天|小时))?\\s*)+$','iu').test(text))return false;
  return true;
}

/** 保留全部 OCR 框作避让，翻译只选外语；同列且字号相近的连续正文按段处理。 */
export function ocrImageRegions(ocr:OcrData):ImageTextRegion[] {
  return ocr.blocks.map(block => {
    const xs=block.polygon.map(point=>point.x),ys=block.polygon.map(point=>point.y);
    const x=Math.min(...xs)/ocr.imageWidth*1000,y=Math.min(...ys)/ocr.imageHeight*1000;
    return {source:block.text,x,y,width:Math.max(...xs)/ocr.imageWidth*1000-x,height:Math.max(...ys)/ocr.imageHeight*1000-y};
  });
}
export function groupImageTextLines(regions:ImageTextRegion[]):ImageTextRegion[] {
  const groups:{region:ImageTextRegion;last:ImageTextRegion}[]=[];
  for(const region of [...regions].sort((a,b)=>a.y-b.y||a.x-b.x)){
    const match=groups.find(group=>{
      const last=group.last,gap=region.y-last.y-last.height;
      const overlap=Math.min(last.x+last.width,region.x+region.width)-Math.max(last.x,region.x);
      return last.source.trim().length>=16&&region.source.trim().length>=12
        &&gap>=-Math.min(last.height,region.height)*.15&&gap<=Math.min(last.height,region.height)*.65
        &&Math.max(last.height,region.height)<=Math.min(last.height,region.height)*1.45
        &&overlap>=Math.min(last.width,region.width)*.65
        &&Math.abs(last.x-region.x)<=Math.max(3,Math.min(last.width,region.width)*.12)
        &&group.region.source.length+region.source.length+1<=2000;
    });
    if(!match){groups.push({region:{...region},last:region});continue;}
    const before=match.region,x=Math.min(before.x,region.x),y=Math.min(before.y,region.y);
    match.region={source:before.source+'\n'+region.source,x,y,width:Math.max(before.x+before.width,region.x+region.width)-x,height:Math.max(before.y+before.height,region.y+region.height)-y};
    match.last=region;
  }
  return groups.map(group=>group.region);
}

/** 对桥返回值再次检查白名单、文字总量及边界，出错时整次保留原图。 */
export function parseImageTranslation(value:unknown):ImageTranslationBlock[] {
  if(!value||typeof value!=='object'||!('blocks' in value)||!Array.isArray(value.blocks)||value.blocks.length>250)throw new Error('图片翻译结果无效。');
  let sourceLength=0,textLength=0;
  return value.blocks.map((raw:unknown)=>{
    if(!raw||typeof raw!=='object')throw new Error('图片翻译位置无效。');
    const b=raw as Record<string,unknown>;
    if(typeof b.source!=='string'||typeof b.text!=='string'||!b.source.trim()||!b.text.trim()||b.source.length>2000||b.text.length>2000)throw new Error('图片译文无效。');
    const {x,y,width,height}=b;
    if(typeof x!=='number'||typeof y!=='number'||typeof width!=='number'||typeof height!=='number'||![x,y,width,height].every(Number.isFinite)||x<0||y<0||width<=0||height<=0||x+width>1000||y+height>1000)throw new Error('图片翻译位置超出选区。');
    sourceLength+=b.source.length+1;textLength+=b.text.length+1;
    if(sourceLength>20000||textLength>20000)throw new Error('选区文字过多，请缩小范围后翻译。');
    return {source:b.source,text:b.text,x,y,width,height};
  });
}

/** 从框外边缘的主色采样覆盖底色，使用低分辨率副本避免每个框读取整张截图。 */
function replacementColors(pixels:ImageData,rect:Rect,scale:number):Colors {
  const buckets=new Map<string,{r:number;g:number;b:number;count:number}>();
  for(let step=0;step<24;step++){
    const t=step/23;
    for(const [x,y] of [[rect.x+rect.width*t,rect.y-2],[rect.x+rect.width*t,rect.y+rect.height+2],[rect.x-2,rect.y+rect.height*t],[rect.x+rect.width+2,rect.y+rect.height*t]]){
      const px=Math.max(0,Math.min(pixels.width-1,Math.round(x*scale))),py=Math.max(0,Math.min(pixels.height-1,Math.round(y*scale)));
      const index=(py*pixels.width+px)*4,alpha=pixels.data[index+3]/255;
      const r=Math.round(pixels.data[index]*alpha+255*(1-alpha)),g=Math.round(pixels.data[index+1]*alpha+255*(1-alpha)),b=Math.round(pixels.data[index+2]*alpha+255*(1-alpha));
      const key=`${r>>4},${g>>4},${b>>4}`,bucket=buckets.get(key)??{r:0,g:0,b:0,count:0};
      bucket.r+=r;bucket.g+=g;bucket.b+=b;bucket.count++;buckets.set(key,bucket);
    }
  }
  const dominant=[...buckets.values()].sort((a,b)=>b.count-a.count)[0];
  const rgb=[dominant.r,dominant.g,dominant.b].map(channel=>Math.round(channel/dominant.count));
  const linear=rgb.map(channel=>channel/255<=0.04045?channel/255/12.92:((channel/255+0.055)/1.055)**2.4);
  const luminance=0.2126*linear[0]+0.7152*linear[1]+0.0722*linear[2];
  const hex=(channels:number[])=>'#'+channels.map(channel=>Math.round(channel).toString(16).padStart(2,'0')).join('');
  // 框内取与底色有明显对比的主色，保留原文的灰阶或彩色，不把所有文字强制改成纯黑/白。
  const ink=new Map<string,{rgb:number[];count:number;contrast:number}>();
  const left=Math.max(0,Math.floor(rect.x*scale)),top=Math.max(0,Math.floor(rect.y*scale));
  const right=Math.min(pixels.width,Math.ceil((rect.x+rect.width)*scale)),bottom=Math.min(pixels.height,Math.ceil((rect.y+rect.height)*scale));
  const step=Math.max(1,Math.ceil(Math.sqrt((right-left)*(bottom-top)/4096)));
  for(let y=top;y<bottom;y+=step)for(let x=left;x<right;x+=step){
    const at=(y*pixels.width+x)*4,a=pixels.data[at+3]/255;
    const channels=[0,1,2].map(c=>pixels.data[at+c]*a+255*(1-a));
    const linear=channels.map(c=>c/255<=.04045?c/255/12.92:((c/255+.055)/1.055)**2.4);
    const light=.2126*linear[0]+.7152*linear[1]+.0722*linear[2];
    const contrast=(Math.max(light,luminance)+.05)/(Math.min(light,luminance)+.05);
    if(contrast<3)continue;
    const key=channels.map(c=>Math.floor(c/16)).join(','),bucket=ink.get(key)??{rgb:[0,0,0],count:0,contrast:0};
    channels.forEach((channel,i)=>bucket.rgb[i]+=channel);bucket.count++;bucket.contrast+=contrast;ink.set(key,bucket);
  }
  const foreground=[...ink.values()].sort((a,b)=>b.contrast/Math.sqrt(b.count)-a.contrast/Math.sqrt(a.count))[0];
  return {background:hex(rgb),foreground:foreground?hex(foreground.rgb.map(c=>c/foreground.count)):luminance>.179?'#161616':'#ffffff'};
}

/** 译文作为可撤销的图层保存，原图不被涂改；布局以原文字框、原字号为上限。 */
export async function prepareImageTranslation(doc:ProjectDocument,blocks:ImageTranslationBlock[],displayScale=1):Promise<ImageTranslationDocument> {
  if(!doc.image||doc.editor.mode==='reflow')throw new Error('请在截图画面中使用图片翻译。');
  if(typeof document.fonts!=='undefined')await document.fonts.ready;
  const image=await loadImage(doc.image.dataUrl),geometry=contentGeometry(doc.image,doc.editor);
  if(image.naturalWidth!==doc.image.width||image.naturalHeight!==doc.image.height)throw new Error('截图尺寸不一致。');
  const sampler=document.createElement('canvas'),sampleScale=Math.min(1,1600/Math.max(image.width,image.height));
  sampler.width=Math.max(1,Math.ceil(image.width*sampleScale));sampler.height=Math.max(1,Math.ceil(image.height*sampleScale));
  const ctx=sampler.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(image,0,0,sampler.width,sampler.height);
  const pixels=ctx.getImageData(0,0,sampler.width,sampler.height);
  try{
    const placements=blocks.map(block=>{
      const rect={x:geometry.crop.x+block.x/1000*geometry.crop.width,y:geometry.crop.y+block.y/1000*geometry.crop.height,width:block.width/1000*geometry.crop.width,height:block.height/1000*geometry.crop.height};
      const colors=replacementColors(pixels,rect,sampleScale);
      // 同一个紧凑段落的 OCR 断行不是新段落；短标题和按钮保持单行优先。
      const text=block.text.trim().replace(/\s*\n\s*/g,' '),fit=fitImageText(ctx,block.source,text,rect);
      const shownScale=Number.isFinite(displayScale)?Math.max(.01,displayScale):1;
      return {source:block.source,text,x:rect.x/image.width*1000,y:rect.y/image.height*1000,width:rect.width/image.width*1000,height:rect.height/image.height*1000,
        fontSize:fit.fontSize,color:colors.foreground,backgroundColor:colors.background,
        align:!block.source.includes('\n')&&text.length<=40?'center':'left',
        needsReading:fit.layout.overflow||fit.fontSize*geometry.width/geometry.crop.width*shownScale<12,overflow:fit.layout.overflow};
    });
    // 两个区域不能互相覆盖；坐标不可靠时整体保留原文档，避免用译文抹掉其它内容。
    for(let i=0;i<placements.length;i++)for(let j=i+1;j<placements.length;j++){
      const a=placements[i],b=placements[j];
      const area=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
      if(area>Math.min(a.width*a.height,b.width*b.height)*.1)throw new Error('翻译文字区域重叠，已保留原图，请缩小范围后重试。');
    }
    return parseImageTranslationDocument({blocks:placements})!;
  }finally{sampler.width=sampler.height=0;}
}
