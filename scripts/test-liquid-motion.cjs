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
  const listeners=new Set(),emit=message=>listeners.forEach(fn=>fn({data:message}));
  const canvas=document.createElement('canvas');canvas.width=560;canvas.height=300;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#e9e5e0';ctx.fillRect(0,0,560,300);ctx.fillStyle='#3b424b';ctx.font='24px sans-serif';ctx.fillText('合成动效回归',28,48);
  for(let i=0;i<5;i++){ctx.fillStyle=i%2?'#abb9ca':'#c7ccd2';ctx.fillRect(28,85+i*35,420-i*30,15);}
  const image={dataUrl:canvas.toDataURL(),width:560,height:300,name:'合成.png'};
  const state={sequence:0,captureId:null,copied:0,completed:0,hidden:false,failCopy:false,holdCopy:false,rejectComplete:false,rejectDismiss:false,requests:[],exitAtComplete:null};
  const load=(fileOnly=false)=>{if(fileOnly){state.captureId=null;state.hidden=false;document.querySelector('[data-editor-root]')?.style.removeProperty('visibility');emit({event:'image.loaded',payload:image});return;}state.captureId='motion-'+(++state.sequence);state.hidden=false;document.querySelector('[data-editor-root]')?.style.removeProperty('visibility');emit({event:'image.loaded',payload:{image,overlay:{captureId:state.captureId,desktopBounds:{x:0,y:0,width:1280,height:800},selection:{x:300,y:180,width:560,height:300},screens:[{bounds:{x:0,y:0,width:1280,height:800},workArea:{x:0,y:0,width:1280,height:760},primary:true}]}}});};
  window.__motionTest={state,load,resume:()=>{state.hidden=false;document.querySelector('[data-editor-root]').style.removeProperty('visibility');emit({event:'presentation.changed',payload:{presentation:'workbench',reason:'user_editor'}});}};
  Object.assign(window.chrome||={}, {webview:{addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn),postMessage:async request=>{
    state.requests.push(request.method);let result={};
    try{
      switch(request.method){
        case 'app.updateReady':result={ready:true};break;
        case 'settings.read':result={providers:[]};break;
        case 'capture.settings':result={backend:'wgc'};break;
        case 'ocr.status':result={available:false,modelVersion:'synthetic',message:'测试不加载模型',missingFiles:[]};break;
        case 'presentation.ready':result={accepted:request.payload.captureId===state.captureId,presentation:'overlay',captureId:state.captureId};break;
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
let browser,page;
const checks=[];
/** 在正式构建页面中验证表现层与真实业务入口的先后顺序。 */
async function main(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,...(process.env.SCREENSHOT_CHROMIUM_EXECUTABLE?{executablePath:process.env.SCREENSHOT_CHROMIUM_EXECUTABLE}:{channel:'msedge'})});
  const context=await browser.newContext({viewport:{width:1280,height:800}});page=await context.newPage();const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')||route.request().url().startsWith('data:')?route.continue():route.abort());
  await page.addInitScript(mockHost);await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
  const ready=async()=>{await page.waitForFunction(()=>document.querySelector('.is-overlay.is-presented')&&[...document.querySelectorAll('[data-motion-button]')].every(node=>node.dataset.motionReady==='true'));};
  const load=async()=>{await page.evaluate(()=>window.__motionTest.load());await ready();};
  const click=name=>page.getByRole('button',{name,exact:true}).click();
  await load();
  const original=await page.locator('canvas.lower-canvas').evaluate(canvas=>canvas.toDataURL());
  const rectTool=page.getByRole('button',{name:'矩形标注',exact:true}),arrowTool=page.getByRole('button',{name:'箭头标注',exact:true});
  const fixed=await rectTool.boundingBox();await page.mouse.move(fixed.x+fixed.width*.75,fixed.y+8);await page.waitForTimeout(160);
  assert.deepEqual(await rectTool.boundingBox(),fixed,'迎向不能移动命中槽位');
  const material=await rectTool.locator('.liquid-skin').evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);
  assert.ok(material>0,'材质确实迎向指针');
  const glyph=await rectTool.locator('.liquid-glyph').evaluate(el=>{const m=new DOMMatrixReadOnly(getComputedStyle(el).transform);return {x:m.m11,y:m.m22};});
  assert.ok(Math.abs(glyph.x-1)<.001&&Math.abs(glyph.y-1)<.001,'图文不拉伸');checks.push('fixed-hitbox-and-unscaled-glyph');
  await rectTool.click();await page.mouse.move(fixed.x+fixed.width/2,fixed.y+fixed.height/2);await page.waitForTimeout(100);
  const arrow=await arrowTool.boundingBox();await page.mouse.move(arrow.x+arrow.width/2,arrow.y+arrow.height/2);
  await page.waitForFunction(()=>Boolean(document.querySelector('.liquid-bridge path')?.getAttribute('d')));
  assert.equal(await rectTool.getAttribute('aria-pressed'),'true','hover 不切换逻辑工具');checks.push('same-group-bridge-and-click-only-selection');
  await click('美化图片');await click('提取文字');await click('美化图片');
  await page.waitForFunction(()=>document.querySelector('.clay-card[aria-label="美化截图"] .liquid-panel-content')?.style.opacity==='1');
  assert.equal(await page.locator('.clay-card').count(),1,'旧关闭不移除新浮卡');
  assert.equal(await page.locator('.liquid-panel-content').evaluate(el=>getComputedStyle(el).transform),'none');checks.push('interruptible-panel-with-static-content');
  const details=page.locator('.clay-card').getByText('细调外观',{exact:true});await details.click();await page.waitForTimeout(50);await details.click();await page.waitForTimeout(50);await details.click();
  await page.waitForFunction(()=>{const node=[...document.querySelectorAll('details')].find(el=>el.querySelector('summary')?.textContent==='细调外观');return node?.open&&!node.style.height;});checks.push('redirected-disclosure');
  await page.mouse.move(8,8);await page.waitForFunction(()=>document.querySelector('[data-editor-root]')?.dataset.motionState==='sleep');
  const frames=await page.locator('[data-editor-root]').getAttribute('data-motion-frames');await page.waitForTimeout(140);assert.equal(await page.locator('[data-editor-root]').getAttribute('data-motion-frames'),frames);
  assert.equal(await page.locator('canvas.lower-canvas').evaluate(canvas=>canvas.toDataURL()),original,'UI 动效不得进入画布');checks.push('sleep-and-image-pixels-preserved');
  await page.screenshot({path:path.join(out,'01-panel.png')});
  await page.evaluate(()=>{window.__motionTest.state.failCopy=true;});await click('完成');
  await page.getByRole('alert').waitFor();assert.equal(await page.locator('.liquid-image-copy').count(),0);assert.equal(await page.evaluate(()=>window.__motionTest.state.completed),0);checks.push('copy-failure-keeps-editor');
  await page.evaluate(()=>{const s=window.__motionTest.state;s.failCopy=false;s.holdCopy=true;});await click('完成');
  await page.waitForFunction(()=>typeof window.__motionTest.state.releaseCopy==='function');
  assert.equal(await page.locator('[data-motion-exit]').count(),0,'复制确认前不收束');
  await page.evaluate(()=>{const s=window.__motionTest.state;s.holdCopy=false;s.releaseCopy();});
  await page.waitForSelector('.liquid-image-copy');await load();
  await page.waitForTimeout(450);assert.equal(await page.evaluate(()=>window.__motionTest.state.completed),0);assert.equal(await page.locator('[data-motion-exit]').count(),0);checks.push('new-capture-interrupts-old-success');
  await page.evaluate(()=>window.__motionTest.state.rejectComplete=true);await click('完成');await page.getByRole('alert').waitFor();
  assert.equal(await page.locator('[data-motion-exit]').count(),0);assert.equal(await page.locator('.clay-canvas-fixed').evaluate(el=>getComputedStyle(el).opacity),'1');checks.push('host-rejection-restores-surface');
  await page.evaluate(()=>{const s=window.__motionTest.state;s.rejectComplete=false;s.rejectDismiss=true;});await click('收起编辑，保留文档');
  await page.waitForFunction(()=>!document.querySelector('[data-motion-exit]')&&!document.querySelector('fieldset').disabled);assert.equal(await page.locator('canvas.lower-canvas').count(),1);checks.push('dismiss-rejection-keeps-document');
  // 取消的是收起意图；夹具仍会返回已经交给宿主的复制结果。
  await page.evaluate(()=>{const s=window.__motionTest.state;s.holdCopy=true;s.releaseCopy=null;});await click('完成');
  await page.waitForFunction(()=>typeof window.__motionTest.state.releaseCopy==='function');await click('取消完成');
  await page.evaluate(()=>{const s=window.__motionTest.state;s.holdCopy=false;s.releaseCopy();});
  await page.waitForFunction(()=>!document.querySelector('fieldset').disabled);assert.equal(await page.evaluate(()=>window.__motionTest.state.completed),0);assert.equal(await page.locator('[data-motion-exit]').count(),0);checks.push('cancel-copy-wait-does-not-hide');
  await click('完成');await page.waitForSelector('[data-motion-exit=complete]');await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('[data-motion-exit]')&&!document.querySelector('fieldset').disabled);assert.equal(await page.evaluate(()=>window.__motionTest.state.completed),0);checks.push('escape-interrupts-exit');
  await page.evaluate(()=>window.__motionTest.load());
  await page.waitForSelector('.is-overlay.is-presented');await click('矩形标注');
  await page.waitForSelector('[data-drawing-tool=rect]');checks.push('early-tool-click-is-not-dropped');
  await ready();
  await page.emulateMedia({reducedMotion:'reduce'});await click('美化图片');
  await page.waitForFunction(()=>document.querySelector('[data-editor-root]')?.dataset.motionReduced==='true');
  assert.equal(await page.locator('.liquid-bridge').evaluate(el=>getComputedStyle(el).display),'none');
  assert.equal(await rectTool.locator('.liquid-skin').evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).m41),0);checks.push('system-reduced-motion');
  await page.screenshot({path:path.join(out,'02-reduced.png')});await click('完成');await page.waitForFunction(()=>window.__motionTest.state.hidden);
  assert.equal(await page.evaluate(()=>window.__motionTest.state.exitAtComplete),'complete');assert.equal(await page.evaluate(()=>window.__motionTest.state.completed),1);checks.push('ack-animation-then-native-hide');
  // 无 captureId 的文件也必须保护用户刚恢复的呈现，不被迟到的成功回复清空。
  await page.evaluate(()=>{window.__motionTest.state.holdCompleteReply=true;window.__motionTest.load(true);});
  await page.waitForSelector('.is-neutral canvas.lower-canvas');await click('完成');
  await page.waitForFunction(()=>typeof window.__motionTest.state.releaseCompleteReply==='function');
  await page.evaluate(()=>{window.__motionTest.resume();window.__motionTest.state.releaseCompleteReply();});
  await page.waitForFunction(()=>!document.querySelector('fieldset').disabled);assert.equal(await page.locator('canvas.lower-canvas').count(),1);checks.push('file-resume-invalidates-late-completion');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,errors,scope:'headless synthetic only'},null,2));
  console.log(JSON.stringify({passed:checks.length,checks,errors},null,2));await browser.close();server.close();
}
main().catch(async error=>{console.error(error.stack);if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});if(browser)await browser.close();server.close();process.exitCode=1;});
