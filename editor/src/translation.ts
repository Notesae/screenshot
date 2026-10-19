export type TranslationChunk = { id:string; source:string; text:string|null; error:string|null; status:'pending'|'running'|'done'|'failed' };
/** 按Unicode码点切分，优先在后半段换行处切开；原文切片拼接后逐字相同。 */
export function translationChunks(text:string,limit=2000):TranslationChunk[] {
  if(!Number.isInteger(limit)||limit<2||limit>4000)throw new Error('翻译分块上限无效。');
  const points=Array.from(text),chunks:TranslationChunk[]=[];let start=0;
  while(start<points.length){let end=Math.min(start+limit,points.length);if(end<points.length){for(let i=end-1;i>=start+limit/2;i--)if(points[i]==='\n'){end=i+1;break;}}
    chunks.push({id:`chunk-${chunks.length}`,source:points.slice(start,end).join(''),text:null,error:null,status:'pending'});start=end;
  }
  return chunks;
}
/** 只发送未成功块，顺序请求且不自动重试；过期/取消后停止后续块与进度更新。 */
export async function runTranslationChunks(input:TranslationChunk[],send:(text:string)=>Promise<string>,progress:(chunks:TranslationChunk[])=>void,current:()=>boolean) {
  let chunks:TranslationChunk[]=input.map(c=>({...c,status:c.status==='done'?'done' as const:'pending' as const}));
  for(let i=0;i<chunks.length;i++){
    if(!current())break;if(chunks[i].status==='done')continue;
    chunks=chunks.map((c,n)=>n===i?{...c,status:'running',error:null}:c);progress(chunks);
    try{const text=await send(chunks[i].source);if(!current())break;if(typeof text!=='string'||text.length>20000||!text.trim())throw new Error('此块译文无效或过长。');chunks=chunks.map((c,n)=>n===i?{...c,text,status:'done'}:c);}
    catch(error){if(!current())break;chunks=chunks.map((c,n)=>n===i?{...c,status:'failed',error:error instanceof Error?error.message:'翻译失败'}:c);}
    progress(chunks);
  }
  return chunks;
}
