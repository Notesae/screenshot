// 隔离浏览器只消费合成图片和内存桥；不启动产品、不访问用户桌面或系统剪贴板。
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.SCREENSHOT_PLAYWRIGHT_MODULE||process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'editor/dist'),out=path.join(root,'output/playwright/liquid-motion');
fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
  const file=path.resolve(dist,'.'+new URL(req.url,'http://localhost').pathname),target=fs.existsSync(file)&&fs.statSync(file).isDirectory()?path.join(file,'index.html'):file;
  if(!file.startsWith(dist+path.sep)||!fs.existsSync(target)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(target)]||'application/octet-stream');fs.createReadStream(target).pipe(res);
});
/** 所有业务结果均由夹具控制，便于检查复制确认前后和迟到回调的区别。 */
function mockHost(){
  Object.defineProperty(navigator,'hardwareConcurrency',{configurable:true,value:8});
  const listeners=new Set(),emit=message=>listeners.forEach(fn=>fn({data:message}));
  const canvas=document.createElement('canvas');canvas.width=560;canvas.height=300;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#e9e5e0';ctx.fillRect(0,0,560,300);ctx.fillStyle='#3b424b';ctx.font='24px sans-serif';ctx.fillText('合成动效回归',28,48);
  for(let i=0;i<5;i++){ctx.fillStyle=i%2?'#abb9ca':'#c7ccd2';ctx.fillRect(28,85+i*35,420-i*30,15);}
  const image={dataUrl:canvas.toDataURL(),width:560,height:300,name:'合成.png'};
  const state={sequence:0,captureId:null,copied:0,completed:0,hidden:false,failCopy:false,holdCopy:false,rejectComplete:false,rejectDismiss:false,requests:[],background:[],exitAtComplete:null};
  const load=(fileOnly=false)=>{if(fileOnly){state.captureId=null;state.hidden=false;document.querySelector('[data-editor-root]')?.style.removeProperty('visibility');emit({event:'image.loaded',payload:image});return;}state.captureId='motion-'+(++state.sequence);state.hidden=false;document.querySelector('[data-editor-root]')?.style.removeProperty('visibility');emit({event:'image.loaded',payload:{image,overlay:{captureId:state.captureId,desktopBounds:{x:0,y:0,width:1280,height:800},selection:{x:300,y:180,width:560,height:300},screens:[{bounds:{x:0,y:0,width:1280,height:800},workArea:{x:0,y:0,width:1280,height:760},primary:true}]}}});};
  window.__motionTest={state,load,notice:(text,error)=>emit({event:'editor.action',payload:{action:'notice',text,error}}),resume:()=>{state.hidden=false;document.querySelector('[data-editor-root]').style.removeProperty('visibility');emit({event:'presentation.changed',payload:{presentation:'workbench',reason:'user_editor'}});}};
  Object.assign(window.chrome||={}, {webview:{addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn),postMessage:async request=>{
    state.requests.push(request.method);let result={};
    try{
      switch(request.method){
        case 'app.updateReady':result={ready:true};break;
        case 'settings.read':result={providers:[]};break;
        case 'capture.settings':result={backend:'wgc'};break;
        case 'ocr.status':result={available:false,modelVersion:'synthetic',message:'测试不加载模型',missingFiles:[]};break;
        case 'presentation.ready':result={accepted:request.payload.captureId===state.captureId,presentation:'overlay',captureId:state.captureId};break;
        case 'presentation.background':state.background.push(request.payload);result={accepted:request.payload.captureId===state.captureId};break;
        case 'image.copy':
          if(state.holdCopy)await new Promise(resolve=>state.releaseCopy=resolve);
          if(state.failCopy)throw Error('合成复制失败');
          state.copied++;result={copied:true};break;
        case 'presentation.complete':{
          state.exitAtComplete=document.querySelector('[data-editor-root]')?.dataset.motionExit;
          if(state.rejectComplete){result={accepted:false};break;}
          const snapshot=window.screenshotPrepareLeave('complete');window.screenshotFinishLeave();
          assertSnapshot: {
            if(snapshot.error||snapshot.documentId!==request.payload.documentId||snapshot.revision!==request.payload.revision||(request.payload.captureId??null)!==state.captureId){result={accepted:false};break assertSnapshot;}
            state.completed++;state.hidden=true;result={accepted:true,presentation:'hidden'};document.querySelector('[data-editor-root]').style.visibility='hidden';
          }
          break;
        }
        case 'presentation.dismiss':
          if(state.rejectDismiss){result={accepted:false};break;}
          state.hidden=true;result={accepted:true,presentation:'hidden'};document.querySelector('[data-editor-root]').style.visibility='hidden';break;
        case 'presentation.editor':state.captureId=null;result={accepted:true,presentation:'workbench'};break;
        case 'document.preserve':result={saved:true};break;
        default:throw Error('Unexpected mock request '+request.method);
      }
      if(request.method==='presentation.complete'&&result.accepted&&state.holdCompleteReply)await new Promise(resolve=>state.releaseCompleteReply=resolve);
      emit({id:request.id,ok:true,result});
    }catch(error){emit({id:request.id,ok:false,error:{code:'synthetic',message:error.message}});}
  }}});
}
const ui=require('../editor/scripts/test-ui.cjs');
let browser,page;
const checks=[];
async function load(){await page.evaluate(()=>window.__motionTest.load());await page.waitForFunction(()=>document.querySelector('.is-overlay.is-presented')&&[...document.querySelectorAll('[data-motion-button]')].every(el=>el.dataset.motionReady==='true'));await page.waitForTimeout(120);}
async function card(name){await ui.inspect(page,name);await page.waitForFunction(()=>document.querySelector('.liquid-panel-body')?.style.opacity==='1'&&document.querySelector('.liquid-panel-page')?.style.opacity==='1');}
async function closeCard(){if(await page.locator('.clay-card').count()){await page.getByRole('button',{name:'关闭浮卡',exact:true}).click();await page.locator('.clay-card').waitFor({state:'detached'});}}
async function hidden(value){await page.evaluate(value=>{if(value)Object.defineProperty(document,'hidden',{configurable:true,value:true});else delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));},value);}
async function check(name,run){await run();checks.push(name);console.log('PASS '+name);}
async function main(){
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true,...(process.env.SCREENSHOT_CHROMIUM_EXECUTABLE?{executablePath:process.env.SCREENSHOT_CHROMIUM_EXECUTABLE}:{channel:'msedge'})});
 page=await browser.newPage({viewport:{width:1280,height:800}});const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')||route.request().url().startsWith('data:')?route.continue():route.abort());
 await page.addInitScript(mockHost);await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');await load();
 await check('tool-click-arms-continuous-drawing-without-card',async()=>{
  await ui.button(page,'矩形标注').click();await page.mouse.move(20,20);
  assert.equal(await page.locator('[data-drawing-tool=rect]').count(),1);assert.equal(await page.locator('.clay-card').count(),0);
  assert.equal(await page.locator('[data-annotation-kind=rect]').getAttribute('data-tool-state'),'drawing');await page.keyboard.press('Escape');
 });
 await check('hover-inspects-without-selecting-or-provider-request',async()=>{
  const before=await page.evaluate(()=>window.__motionTest.state.requests.length);await card('圆形标注');
  assert.equal(await page.locator('[data-drawing-tool]').count(),0);assert.equal(await page.locator('[data-annotation-kind=ellipse]').getAttribute('data-tool-state'),'idle');
  assert.equal(await page.evaluate(n=>window.__motionTest.state.requests.slice(n).some(x=>x.startsWith('ai.')||x==='ocr.local'),before),false);await closeCard();
 });
 await check('beauty-click-toggles-mode-and-hover-only-inspects',async()=>{
  const button=ui.button(page,'美化图片');await button.click();await page.mouse.move(20,20);
  assert.equal(await page.locator('.clay-card').count(),0);assert.equal(await button.getAttribute('aria-pressed'),'true');
  await card('美化图片');await closeCard();await button.click();await page.mouse.move(20,20);assert.equal(await button.getAttribute('aria-pressed'),'false');
 });
 await check('panel-body-and-content-share-continuous-deformation',async()=>{
  await card('美化图片');
  const pose=await page.locator('.liquid-panel-body').evaluate(el=>({transform:el.style.transform,opacity:el.style.opacity,contains:el.contains(document.querySelector('.liquid-panel-content')),filter:getComputedStyle(el).filter}));
  assert.ok(pose.transform.startsWith('matrix('));assert.equal(pose.opacity,'1');assert.equal(pose.contains,true);assert.equal(pose.filter,'none');
  await page.getByRole('button',{name:'关闭浮卡',exact:true}).evaluate(el=>el.click());await page.waitForTimeout(45);
  assert.equal(await page.locator('.clay-card').getAttribute('aria-hidden'),'true');assert.equal(await page.locator('.clay-card').evaluate(el=>el.inert),true);
  await ui.inspect(page,'美化图片');await card('美化图片');assert.equal(await page.locator('.clay-card').count(),1);await closeCard();
 });
 await check('continuous-panel-switch-retains-one-shell-and-latest-page',async()=>{
  await card('美化图片');await page.locator('.liquid-panel-body').evaluate(el=>el.dataset.testIdentity='retained');
  await ui.inspect(page,'提取文字');await ui.inspect(page,'美化图片');await card('美化图片');
  assert.equal(await page.locator('.liquid-panel-body').getAttribute('data-test-identity'),'retained');assert.equal(await page.locator('.clay-card').getAttribute('aria-label'),'美化截图');await closeCard();
 });
 await check('panel-close-keeps-layout-while-material-returns',async()=>{
  await card('圆形标注');const before=await page.locator('.clay-card').evaluate(el=>[el.style.left,el.style.top,el.style.width]);
  await page.getByRole('button',{name:'关闭浮卡',exact:true}).evaluate(el=>el.click());await page.waitForTimeout(30);
  assert.deepEqual(await page.locator('.clay-card').evaluate(el=>[el.style.left,el.style.top,el.style.width]),before);await page.locator('.clay-card').waitFor({state:'detached'});
 });
 await check('button-top-highlight-has-no-discrete-shadow-swap',async()=>{
  await card('圆形标注');const tool=ui.button(page,'圆形标注');await page.waitForTimeout(300);
  const before=await tool.locator('.liquid-skin').evaluate(el=>({depth:Number(el.style.getPropertyValue('--liquid-depth')),shadow:getComputedStyle(el,'::before').boxShadow}));assert.ok(before.depth>.99);
  await page.getByRole('button',{name:'关闭浮卡',exact:true}).evaluate(el=>el.click());await page.mouse.move(20,20);
  const samples=await tool.locator('.liquid-skin').evaluate(async el=>{const rows=[];for(let i=0;i<50;i++){await new Promise(requestAnimationFrame);rows.push({depth:Number(el.style.getPropertyValue('--liquid-depth')),shadow:getComputedStyle(el,'::before').boxShadow,opacity:Number(getComputedStyle(el,'::before').opacity)});}return rows;});
  assert.ok(samples.some(x=>x.depth>.05&&x.depth<.95));assert.ok(samples.every(x=>x.shadow===before.shadow));assert.ok(samples.every((x,i)=>!i||Math.abs(x.depth-samples[i-1].depth)<.3),'highlights blend continuously');await page.waitForFunction(()=>Number(document.querySelector('[data-annotation-kind=ellipse] .liquid-skin').style.getPropertyValue('--liquid-depth'))<.003);assert.ok(await tool.locator('.liquid-skin').evaluate(el=>Number(getComputedStyle(el,'::before').opacity)>.99));
 });
 await check('every-enabled-rail-icon-deforms-its-own-vector-parts',async()=>{
  const selectors=['.clay-grip','[data-icon-motion=appearance]','[data-icon-motion=scan]','[data-icon-motion=translate]','[data-annotation-kind=text]','[data-annotation-kind=rect]','[data-annotation-kind=ellipse]','[data-annotation-kind=arrow]','[data-annotation-kind=brush]','[data-annotation-kind=highlight]','[data-annotation-kind=mosaic]','[data-motion-action=done]','[data-icon-motion=pin]','[data-panel-trigger=more]','[data-icon-motion=close]'];
  for(const selector of selectors){
   await page.mouse.move(20,20);await page.waitForTimeout(250);const button=page.locator(selector);if(await button.isDisabled())continue;
   const target=await button.boundingBox();await page.mouse.move(target.x+target.width/2,target.y+target.height/2);await page.waitForTimeout(115);
   const magnitude=await button.locator('[data-rail-icon-part]').evaluateAll(parts=>Math.max(...parts.map(el=>{const m=new DOMMatrixReadOnly(getComputedStyle(el).transform);return Math.max(Math.abs(m.m11-1),Math.abs(m.m22-1),Math.abs(m.m12),Math.abs(m.m21));})));
   assert.ok(magnitude>.04,selector+' must visibly deform SVG itself: '+magnitude);
   assert.deepEqual(await button.boundingBox(),target,'icon feedback keeps its hit box');
  }
  await page.mouse.move(20,20);await closeCard();
 });
 await check('rapid-tool-reversal-keeps-finite-shape-and-settles',async()=>{
  const tool=ui.button(page,'矩形标注');for(let i=0;i<5;i++){await tool.click();await page.waitForTimeout(55);}
  await page.mouse.move(20,20);await page.keyboard.press('Escape');await page.waitForTimeout(1800);
  assert.equal(await tool.getAttribute('data-tool-state'),'idle');assert.equal(await tool.evaluate(el=>el.getBoundingClientRect().width),39);
  const pose=await tool.locator('.liquid-skin').evaluate(el=>{const m=new DOMMatrixReadOnly(el.style.transform);return [m.m11,m.m22,m.m41,m.m42];});assert.ok(pose.every(Number.isFinite));assert.ok(Math.abs(pose[0]-1)<.003&&Math.abs(pose[1]-1)<.003);
 });
 await check('disabled-and-hidden-reset-icon-and-button-forces',async()=>{
  await hidden(true);const frames=await page.locator('[data-editor-root]').getAttribute('data-motion-frames');await page.waitForTimeout(100);
  assert.equal(await page.locator('[data-editor-root]').getAttribute('data-motion-frames'),frames);
  const transforms=await page.locator('[data-rail-icon-part]').evaluateAll(parts=>parts.map(el=>el.style.transform));assert.ok(transforms.every(value=>!value||new DOMMatrixReadOnly(value).isIdentity));await hidden(false);
 });
 await check('reduced-motion-uses-correct-static-terminal-state',async()=>{
  await page.emulateMedia({reducedMotion:'reduce'});await card('美化图片');
  assert.equal(await page.locator('[data-editor-root]').getAttribute('data-motion-reduced'),'true');assert.equal(await page.locator('.liquid-panel-body').evaluate(el=>el.dataset.motionRunning),'false');await closeCard();await page.emulateMedia({reducedMotion:'no-preference'});
 });
 await check('copy-error-retains-document-without-success-dismissal',async()=>{
  await load();await page.evaluate(()=>window.__motionTest.state.failCopy=true);await ui.button(page,'完成').click();await page.getByRole('alert').waitFor();
  assert.equal(await page.evaluate(()=>window.__motionTest.state.completed),0);assert.ok(await page.evaluate(()=>window.screenshotPrepareUpdate().document.image));await page.evaluate(()=>window.__motionTest.state.failCopy=false);await page.getByRole('button',{name:'关闭提示',exact:true}).click();
 });
 await check('completion-waits-for-copy-acknowledgement',async()=>{
  await page.evaluate(()=>window.__motionTest.state.holdCopy=true);await ui.button(page,'完成').click();await page.waitForFunction(()=>typeof window.__motionTest.state.releaseCopy==='function');
  assert.equal(await page.locator('[data-motion-exit=complete]').count(),0);assert.equal(await page.evaluate(()=>window.__motionTest.state.completed),0);
  await page.evaluate(()=>{window.__motionTest.state.holdCopy=false;window.__motionTest.state.releaseCopy();});await page.waitForFunction(()=>window.__motionTest.state.completed===1);
 });
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({syntheticOnly:true,desktopAccess:false,checks,errors},null,2));console.log('PASS '+checks.length+' current liquid motion regression groups');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
