// 只在独立无头浏览器中生成图片、模拟桥及虚拟指针，不访问桌面、剪贴板或真实服务。
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {installMock}=require('../editor/scripts/mock-host.cjs');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'editor/dist'),checks=[],errors=[];
const server=http.createServer((req,res)=>{
  const file=path.resolve(dist,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(dist+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(data);});
});
let browser,origin;
const click=(p,name)=>p.getByRole('button',{name,exact:true}).click();
async function ready(p){await p.waitForFunction(()=>!window.screenshotPrepareUpdate?.().error&&window.screenshotPrepareUpdate?.().document?.image&&!document.querySelector('button[aria-label="完成"]').disabled);}
async function documentOf(p){await ready(p);return p.evaluate(()=>window.screenshotPrepareUpdate().document);}
async function choose(p,label,name){await p.getByRole('combobox',{name:label,exact:true}).click();await p.getByRole('option',{name,exact:true}).click();}
async function start(){
  const p=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  p.on('pageerror',error=>errors.push(error.message));
  await p.route('**/*',route=>route.request().url().startsWith(origin)||route.request().url().startsWith('data:')?route.continue():route.abort());
  await installMock(p);await p.goto(origin+'/index.html');await p.getByRole('button',{name:'打开图片',exact:true}).waitFor();
  await p.evaluate(()=>{
    const body=Array.from({length:4},()=> 'A compact paragraph with readable original text.').join('\n');
    const regions=[
      {source:'Pay As You Go',text:'按量付费',x:80,y:60,width:180,height:30},
      {source:'Get started!',text:'立即开始！',x:300,y:60,width:140,height:30},
      {source:'3GB',text:'不应调用翻译',x:580,y:60,width:90,height:30},
      {source:body,text:'完整长段落用于验证阅读窗口、原文对照与严格的原位裁切。'.repeat(24),x:80,y:180,width:260,height:36},
    ];
    const c=document.createElement('canvas');c.width=1024;c.height=700;const ctx=c.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,c.width,c.height);
    for(const block of regions){ctx.save();ctx.beginPath();ctx.rect(block.x,block.y,block.width,block.height);ctx.clip();ctx.fillStyle='#161616';ctx.font=(block.source===body?8:20)+'px Microsoft YaHei';block.source.split('\n').forEach((line,i)=>ctx.fillText(line,block.x,block.y+8+i*8));ctx.restore();}
    // 其它内容和原框相隔很近，导出时逐像素检查它们没有被译文扩张覆盖。
    ctx.fillStyle='#e05a44';ctx.fillRect(80,225,600,40);ctx.fillStyle='#173d81';ctx.fillRect(365,170,200,50);
    const image={dataUrl:c.toDataURL(),name:'合成译文布局.png',width:1024,height:700};window.__source=image.dataUrl;window.__regions=regions;
    window.__translations=Object.fromEntries(regions.map(block=>[block.source,block.text]));
    window.__ocrResult={modelVersion:'synthetic',imageWidth:1024,imageHeight:700,blocks:regions.map((block,index)=>({id:'block-'+index,text:block.source,order:index,confidence:.99,polygon:[{x:block.x,y:block.y},{x:block.x+block.width,y:block.y},{x:block.x+block.width,y:block.y+block.height},{x:block.x,y:block.y+block.height}]}))};
    window.__emit({event:'image.loaded',payload:{image,overlay:{captureId:'reader-test',desktopBounds:{x:0,y:0,width:1280,height:900},selection:{x:100,y:80,width:1024,height:700},screens:[{bounds:{x:0,y:0,width:1280,height:900},workArea:{x:0,y:0,width:1280,height:860},primary:true}]}}});
  });await ready(p);return p;
}

/** 只驱动无头页面的虚拟指针，手势坐标来自公开 DOM，未调用组件内部处理器。 */
async function drag(p,locator,dx,dy){const box=await locator.boundingBox();const x=box.x+Math.min(box.width/2,60),y=box.y+box.height/2;await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x+dx,y+dy,{steps:5});await p.mouse.up();}
async function bounds(p){return p.locator('.clay-reader').boundingBox();}
function near(a,b){assert.ok(Math.abs(a-b)<1,`${a} != ${b}`);}
async function closeNotice(p){const close=p.getByRole('button',{name:'关闭提示',exact:true});if(await close.count())await close.click();}

async function main(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(process.env.SCREENSHOT_CHROMIUM_EXECUTABLE?{executablePath:process.env.SCREENSHOT_CHROMIUM_EXECUTABLE}:{channel:'msedge'})});
  const p=await start(),source=await documentOf(p);await click(p,'翻译图片为中文');
  await p.waitForFunction(()=>window.screenshotPrepareUpdate?.().document?.editor.imageTranslation?.blocks.length===3);await ready(p);
  const translated=await documentOf(p);assert.equal(translated.image.dataUrl,source.image.dataUrl);assert.deepEqual(translated.editor.annotations,[]);
  const calls=await p.evaluate(()=>window.__messages.filter(message=>message.method==='ai.translate'));
  assert.equal(calls.length,3);assert.ok(calls.every(call=>call.payload.purpose==='image'&&!('imageDataUrl' in call.payload)&&call.payload.text!=='3GB'));
  assert.equal(translated.editor.imageTranslation.blocks.at(-1).overflow,true);checks.push('local OCR translates only prose, sends no pixels to the text provider and keeps the original image unchanged');

  await click(p,'完成');await p.waitForFunction(()=>window.__messages.some(message=>message.method==='image.copy'));
  const pixels=await p.evaluate(async()=>{
    const decode=async url=>{const image=new Image();image.src=url;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;c.getContext('2d').drawImage(image,0,0);return {width:c.width,height:c.height,pixels:c.getContext('2d').getImageData(0,0,c.width,c.height).data};};
    const source=await decode(window.__source),output=await decode(window.__messages.filter(message=>message.method==='image.copy').at(-1).payload.dataUrl);let changedInside=0,changedOutside=0;
    const boxes=window.__regions.filter(block=>block.source!=='3GB');
    for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
      const at=(y*source.width+x)*4;if(![0,1,2,3].some(channel=>source.pixels[at+channel]!==output.pixels[at+channel]))continue;
      const inside=boxes.some(box=>x>=box.x&&x<box.x+box.width&&y>=box.y&&y<box.y+box.height);
      if(inside)changedInside++;else changedOutside++;
    }
    return {width:output.width,height:output.height,changedInside,changedOutside};
  });assert.equal(pixels.width,1024);assert.equal(pixels.height,700);assert.ok(pixels.changedInside>100);assert.equal(pixels.changedOutside,0);await ready(p);await closeNotice(p);checks.push('PNG changes only original text rectangles; adjacent graphics, quantities and every outside pixel are unchanged');

  await click(p,'阅读完整译文');await p.locator('.clay-reader').waitFor();assert.equal(await p.locator('.clay-reader article').count(),3);assert.equal(await p.locator('.clay-reader details').count(),0);assert.equal(await p.locator('.clay-reader-source').count(),0);
  assert.equal(await p.locator('.clay-reader-text').last().textContent(),translated.editor.imageTranslation.blocks.at(-1).text);
  const heading=p.getByLabel('移动阅读窗口，拖动标题栏或使用方向键',{exact:true}),before=await bounds(p);
  await drag(p,heading,32,24);let box=await bounds(p);near(box.x,before.x+32);near(box.y,before.y+24);assert.equal(await p.locator('.clay-canvas-fixed').isVisible(),true);
  await heading.focus();await p.keyboard.press('ArrowRight');box=await bounds(p);near(box.x,before.x+40);await p.keyboard.press('Shift+ArrowDown');box=await bounds(p);near(box.y,before.y+48);
  const resize=p.getByRole('button',{name:'调整阅读窗口大小，拖动或使用方向键',exact:true});await drag(p,resize,64,20);const enlarged=await bounds(p);near(enlarged.width,box.width+64);near(enlarged.height,box.height+20);checks.push('reader title dragging, keyboard movement and corner resizing preserve manual geometry and restore the screenshot');
  await click(p,'对照');assert.equal(await p.locator('.clay-reader-source').count(),3);assert.equal(await p.locator('.clay-reader article').first().evaluate(element=>getComputedStyle(element).display),'grid');
  await drag(p,resize,500-enlarged.width,0);assert.equal(await p.locator('.clay-reader.is-narrow').count(),1);assert.equal(await p.locator('.clay-reader article').first().evaluate(element=>getComputedStyle(element).display),'block');checks.push('comparison is paired columns when wide and stacked at narrow reading widths');
  await click(p,'译文');const manual=await bounds(p);await click(p,'关闭阅读，返回截图');await click(p,'阅读完整译文');box=await bounds(p);for(const property of ['x','y','width','height'])near(box[property],manual[property]);
  assert.deepEqual(await documentOf(p),translated);checks.push('close/reopen keeps reader position and size without changing project content or history');
  // 正常运动下保留退出表面；快速重开和中途减少动态都不能丢掉阅读矩形。
  await p.emulateMedia({reducedMotion:'no-preference'});await p.evaluate(()=>window.__savedReader=document.querySelector('.clay-reader'));
  await click(p,'关闭阅读，返回截图');assert.equal(await p.locator('.clay-reader').evaluate(el=>el.inert&&el.getAttribute('aria-hidden')==='true'),true);
  await click(p,'阅读完整译文');await p.waitForFunction(()=>document.querySelector('.clay-reader')?.dataset.motionPhase==='open');
  assert.equal(await p.locator('.clay-reader').evaluate(el=>el===window.__savedReader),true);
  box=await bounds(p);for(const property of ['x','y','width','height'])near(box[property],manual[property]);
  assert.equal(await p.locator('.clay-reader > .liquid-surface-content').evaluate(el=>getComputedStyle(el).transform),'none');
  await click(p,'关闭阅读，返回截图');await p.emulateMedia({reducedMotion:'reduce'});await p.waitForSelector('.clay-reader',{state:'detached'});
  assert.equal(await p.getByRole('button',{name:'阅读完整译文',exact:true}).evaluate(el=>document.activeElement===el),true);
  await click(p,'阅读完整译文');checks.push('reader exit/reopen preserves geometry and reduced motion restores focus without scaling text');
  const content=p.locator('.clay-reader-content');await p.waitForFunction(()=>{const e=document.querySelector('.clay-reader-content');return e.scrollHeight>e.clientHeight;});assert.equal(await content.evaluate(element=>element.offsetWidth-element.clientWidth),0);
  await content.evaluate(element=>element.scrollTop=120);await p.waitForFunction(()=>document.querySelector('.clay-scrollbar.is-visible'));await p.mouse.move(1,1);
  await p.waitForFunction(()=>[...document.querySelectorAll('.clay-scrollbar')].filter(element=>!element.hidden).every(element=>Number(getComputedStyle(element).opacity)===0));checks.push('reading scrollbars reserve no content width and hide after idle');
  await p.emulateMedia({reducedMotion:'no-preference'});await click(p,'撤销');assert.equal((await documentOf(p)).editor.imageTranslation,null);
  assert.equal(await p.locator('.clay-reader').count(),0);await click(p,'重做');assert.deepEqual((await documentOf(p)).editor.imageTranslation,translated.editor.imageTranslation);
  assert.equal(await p.locator('.clay-reader').count(),0,'重做不能短暂复活已经撤销的阅读层');await p.emulateMedia({reducedMotion:'reduce'});checks.push('undo/redo while reading does not resurrect a retained hidden surface');checks.push('one undo restores the original and redo restores the complete translation layer');
  await click(p,'更多操作');await choose(p,'导出倍率','2× 尺寸');await click(p,'完成');await p.waitForFunction(()=>window.__messages.filter(message=>message.method==='image.copy').length===2);
  const double=await p.evaluate(()=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve([image.width,image.height]);image.src=window.__messages.filter(message=>message.method==='image.copy').at(-1).payload.dataUrl;}));assert.deepEqual(double,[2048,1400]);await ready(p);await closeNotice(p);
  await click(p,'保存项目');await p.waitForFunction(()=>window.__messages.some(message=>message.method==='project.save'));await ready(p);const saved=await p.evaluate(()=>window.__messages.filter(message=>message.method==='project.save').at(-1).payload.document);
  await p.locator('input[type=file]').nth(1).setInputFiles({name:'reader.screenshot.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});await ready(p);assert.deepEqual(await documentOf(p),saved);checks.push('2x export keeps dimensions and project reload retains full translation metadata');await p.close();

  const late=await start(),initial=await documentOf(late);await late.evaluate(()=>window.__holdMethod='ai.translate');await click(late,'翻译图片为中文');await late.waitForFunction(()=>window.__heldMethods.length>0);await click(late,'取消图片翻译');
  await late.evaluate(()=>{const held=window.__heldMethods.shift();window.__holdMethod=null;window.__emit({id:held.id,ok:true,result:{text:'迟到结果'}});});await ready(late);assert.deepEqual(await documentOf(late),initial);checks.push('cancelled image translation cannot apply a delayed provider result');await late.close();
  assert.deepEqual(errors,[]);const directory=path.join(root,'artifacts/qa/image-translation-reader');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({syntheticOnly:true,desktopAccess:false,externalRequests:false,checks,pixels,errors},null,2));console.log('PASS '+checks.length+' image translation, pixel preservation and reader regression groups');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
