import type { LoadedImage } from './bridge';
import { contentGeometry, parseImage, type ProjectDocument } from './document';
import { FONT, loadImage } from './render';

/** 千分比坐标只指向已发送的选区内容，不能引用桌面或任意图片资源。 */
export type ImageTranslationBlock = {source:string;text:string;x:number;y:number;width:number;height:number};

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

/** 按字符换行，兼容中文、换行和代理对；单个字符过宽时也会参与字号适配。 */
function wrapText(ctx:CanvasRenderingContext2D,text:string,width:number) {
  const lines:string[]=[];
  for(const paragraph of text.replace(/\r\n?/g,'\n').split('\n')){
    let line='';
    for(const char of Array.from(paragraph)){
      if(line&&ctx.measureText(line+char).width>width){lines.push(line);line=char;}else line+=char;
    }
    lines.push(line);
  }
  return lines;
}

/** 从框外边缘的主色采样覆盖底色，使用低分辨率副本避免每个框读取整张截图。 */
function replacementColors(pixels:ImageData,rect:{x:number;y:number;width:number;height:number},scale:number) {
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
  return {background:`rgb(${rgb.join(',')})`,foreground:luminance>0.179?'#161616':'#ffffff'};
}

/** 在源图对应区域替换文字，保留裁剪、缩放及标注；调用方将新图片作为一次撤销事务提交。 */
export async function renderImageTranslation(doc:ProjectDocument,blocks:ImageTranslationBlock[]):Promise<LoadedImage> {
  if(!doc.image||doc.editor.mode==='reflow')throw new Error('请在截图画面中使用图片翻译。');
  const image=await loadImage(doc.image.dataUrl),geometry=contentGeometry(doc.image,doc.editor);
  if(image.naturalWidth!==doc.image.width||image.naturalHeight!==doc.image.height)throw new Error('截图尺寸不一致。');
  const canvas=document.createElement('canvas');canvas.width=doc.image.width;canvas.height=doc.image.height;
  const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);
  const sampler=document.createElement('canvas'),sampleScale=Math.min(1,1024/Math.max(canvas.width,canvas.height));
  sampler.width=Math.max(1,Math.ceil(canvas.width*sampleScale));sampler.height=Math.max(1,Math.ceil(canvas.height*sampleScale));
  const sampleContext=sampler.getContext('2d',{willReadFrequently:true})!;sampleContext.drawImage(image,0,0,sampler.width,sampler.height);
  const pixels=sampleContext.getImageData(0,0,sampler.width,sampler.height);
  try{
    for(const block of blocks){
      const rect={x:geometry.crop.x+block.x/1000*geometry.crop.width,y:geometry.crop.y+block.y/1000*geometry.crop.height,width:block.width/1000*geometry.crop.width,height:block.height/1000*geometry.crop.height};
      const inset=Math.min(2,rect.height*0.05),width=rect.width-inset*2,height=rect.height-inset*2;
      const colors=replacementColors(pixels,rect,sampleScale);
      // 寻找完整容纳译文的最大字号，不截断文字，也不让中文跑到相邻内容上。
      let low=4,high=Math.min(96,height/1.15),fontSize=0,lines:string[]=[];
      for(let attempt=0;attempt<10&&low<=high;attempt++){
        const size=(low+high)/2;ctx.font=`${size}px ${FONT}`;
        const wrapped=wrapText(ctx,block.text,width);
        if(wrapped.length*size*1.15<=height&&wrapped.every(line=>ctx.measureText(line).width<=width)){
          fontSize=size;lines=wrapped;low=size+0.1;
        }else high=size-0.1;
      }
      if(!fontSize)throw new Error('有一段译文无法放入原文字区域，图片尚未修改，请缩小翻译范围后重试。');
      ctx.save();ctx.beginPath();ctx.rect(rect.x,rect.y,rect.width,rect.height);ctx.clip();
      ctx.fillStyle=colors.background;ctx.fillRect(rect.x,rect.y,rect.width,rect.height);
      ctx.font=`${fontSize}px ${FONT}`;ctx.fillStyle=colors.foreground;ctx.textBaseline='top';
      const top=rect.y+(rect.height-lines.length*fontSize*1.15)/2;
      lines.forEach((line,index)=>ctx.fillText(line,rect.x+inset,top+index*fontSize*1.15));ctx.restore();
    }
    return parseImage({...doc.image,dataUrl:canvas.toDataURL('image/png')});
  }finally{canvas.width=canvas.height=sampler.width=sampler.height=0;}
}
