/** 图片译文使用原图千分比坐标；仅保存文字和白名单样式，不保存可执行绘图对象。 */
export type ImageTranslationPlacement = {
  source:string;text:string;x:number;y:number;width:number;height:number;
  fontSize:number;color:string;backgroundColor:string;align:'left'|'center';needsReading:boolean;overflow:boolean;
};
export type ImageTranslationDocument = {blocks:ImageTranslationPlacement[]};
export type TextRect = {x:number;y:number;width:number;height:number};
export const IMAGE_TEXT_FONT = '"Microsoft YaHei", "PingFang SC", sans-serif';
const LINE_HEIGHT=1.22;

/** 老项目缺省为空；位置、总字数和颜色独立校验，不能借项目加载任意资源。 */
export function parseImageTranslationDocument(value:unknown):ImageTranslationDocument|null {
  if(value==null)return null;
  if(typeof value!=='object'||!('blocks' in value)||!Array.isArray(value.blocks)||value.blocks.length>250)throw new Error('项目图片译文无效。');
  let sources=0,texts=0;
  const blocks=value.blocks.map((value:unknown):ImageTranslationPlacement=>{
    if(!value||typeof value!=='object')throw new Error('项目图片译文无效。');
    const b=value as Record<string,unknown>;
    if(typeof b.source!=='string'||typeof b.text!=='string'||!b.source.trim()||!b.text.trim()||b.source.length>2000||b.text.length>2000)throw new Error('项目图片译文无效。');
    const {x,y,width,height,fontSize,color,backgroundColor,align,needsReading,overflow}=b;
    if(typeof x!=='number'||typeof y!=='number'||typeof width!=='number'||typeof height!=='number'||typeof fontSize!=='number'
      ||![x,y,width,height,fontSize].every(Number.isFinite)||x<0||y<0||width<=0||height<=0||x+width>1000.001||y+height>1000.001||fontSize<8||fontSize>1024
      ||typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color)||typeof backgroundColor!=='string'||!/^#[0-9a-f]{6}$/i.test(backgroundColor)
      ||(align!=='left'&&align!=='center')||typeof needsReading!=='boolean'||typeof overflow!=='boolean')throw new Error('项目图片译文排版无效。');
    sources+=b.source.length+1;texts+=b.text.length+1;
    if(sources>20000||texts>20000)throw new Error('项目图片译文过长。');
    return {source:b.source,text:b.text,x,y,width,height,fontSize,color,backgroundColor,align,needsReading,overflow};
  });
  return {blocks};
}

/** 英文单词尽量不断开，中文按字换行；段内 OCR 换行由译文按原框宽度重新排。 */
export function wrapImageText(ctx:CanvasRenderingContext2D,text:string,width:number):string[] {
  const lines:string[]=[];
  const closing=/^[，。！？、；：）】》”’.,!?;:)]$/u,opening=/[（【《“‘(\[]$/u;
  for(const paragraph of text.replace(/\r\n?/g,'\n').split('\n')){
    let line='';
    for(const char of Array.from(paragraph)){
      if(!line||ctx.measureText(line+char).width<=width){line+=char;continue;}
      const word=/[a-z0-9]+$/i.exec(line);
      if(/[a-z0-9]/i.test(char)&&word&&word.index>0){
        lines.push(line.slice(0,word.index).trimEnd());line=word[0]+char;
      }else if((closing.test(char)||opening.test(line))&&Array.from(line).length>1){
        const chars=Array.from(line),last=chars.pop()!;lines.push(chars.join('').trimEnd());line=last+char;
      }else{lines.push(line.trimEnd());line=char.trimStart();}
      // 长网址或没有分词边界的单词仍需有界，不能越过原文字框。
      while(line&&ctx.measureText(line).width>width&&Array.from(line).length>1){
        const chars=Array.from(line);let part='';
        while(chars.length&&(!part||ctx.measureText(part+chars[0]).width<=width))part+=chars.shift();
        lines.push(part);line=chars.join('');
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function imageTextMetrics(ctx:CanvasRenderingContext2D,size:number) {
  ctx.font=`${size}px ${IMAGE_TEXT_FONT}`;
  const metrics=ctx.measureText('国Ag'),ascent=metrics.actualBoundingBoxAscent||size*.85,descent=metrics.actualBoundingBoxDescent||size*.2;
  return {ascent,height:ascent+descent,advance:Math.max(ascent+descent,size*LINE_HEIGHT)};
}

/** 布局永远局限在原框；无法容纳全文时只显示有省略号的预览，完整文字留在阅读视图。 */
export function imageTextLayout(ctx:CanvasRenderingContext2D,text:string,rect:TextRect,fontSize:number) {
  const metrics=imageTextMetrics(ctx,fontSize),lines=wrapImageText(ctx,text,rect.width);
  const count=rect.height<metrics.height?0:1+Math.floor((rect.height-metrics.height)/metrics.advance+.001);
  const overflow=lines.length>count||lines.some(line=>ctx.measureText(line).width>rect.width);
  const visible=lines.slice(0,count);
  if(overflow&&visible.length){
    let last=Array.from(visible[visible.length-1]);
    while(last.length&&ctx.measureText(last.join('')+'…').width>rect.width)last.pop();
    visible[visible.length-1]=ctx.measureText('…').width<=rect.width?last.join('')+'…':'';
  }
  return {lines,visible,overflow,...metrics};
}

/** 按原字体的字形高度和行宽估计字号，保留小字/标题的层级，不用统一大字号撑坏布局。 */
export function fitImageText(ctx:CanvasRenderingContext2D,source:string,text:string,rect:TextRect) {
  const sourceLines=source.replace(/\r/g,'').split('\n');let low=1,high=Math.min(1024,rect.height*2);
  for(let i=0;i<14;i++){
    const size=(low+high)/2,metrics=imageTextMetrics(ctx,size);
    const fits=metrics.height+(sourceLines.length-1)*metrics.advance<=rect.height
      &&sourceLines.every(line=>ctx.measureText(line).width<=rect.width*1.08);
    if(fits)low=size;else high=size;
  }
  const preferred=Math.max(8,low),minimum=Math.max(8,preferred*.85);
  let best=minimum;
  if(!imageTextLayout(ctx,text,rect,minimum).overflow){
    let start=minimum,end=preferred;
    for(let i=0;i<10;i++){
      const size=(start+end)/2;
      if(imageTextLayout(ctx,text,rect,size).overflow)end=size;else{start=size;best=size;}
    }
  }
  return {fontSize:best,layout:imageTextLayout(ctx,text,rect,best)};
}

/** 预览与任意倍率导出共用同一裁切规则；背景只填原文字框，绝不扩到按钮、图片或其它段落。 */
export function drawImageTranslations(ctx:CanvasRenderingContext2D,data:ImageTranslationDocument|null|undefined,image:{width:number;height:number}) {
  for(const block of data?.blocks??[]){
    const rect={x:block.x/1000*image.width,y:block.y/1000*image.height,width:block.width/1000*image.width,height:block.height/1000*image.height};
    const layout=imageTextLayout(ctx,block.text,rect,block.fontSize);
    // 极小原框连一个完整字形也容不下时保留原像素，由阅读入口呈现译文。
    if(!layout.visible.length)continue;
    ctx.save();ctx.beginPath();ctx.rect(rect.x,rect.y,rect.width,rect.height);ctx.clip();
    ctx.fillStyle=block.backgroundColor;ctx.fillRect(rect.x,rect.y,rect.width,rect.height);
    ctx.font=`${block.fontSize}px ${IMAGE_TEXT_FONT}`;ctx.fillStyle=block.color;ctx.textBaseline='alphabetic';ctx.textAlign=block.align;
    const top=rect.y+(layout.visible.length===1?(rect.height-layout.height)/2:0);
    const x=block.align==='center'?rect.x+rect.width/2:rect.x;
    layout.visible.forEach((line,index)=>ctx.fillText(line,x,top+layout.ascent+index*layout.advance));
    ctx.restore();
  }
}
