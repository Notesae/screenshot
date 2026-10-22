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
/** 仅替换合成页面的可见性读数，不切换桌面窗口或浏览器焦点。 */
async function visibility(hidden){
  await page.evaluate(hidden=>{
    if(hidden)Object.defineProperties(document,{hidden:{configurable:true,value:true},visibilityState:{configurable:true,value:'hidden'}});
    else{delete document.hidden;delete document.visibilityState;}
    document.dispatchEvent(new Event('visibilitychange'));
  },hidden);
}
/** 在真实材质尚未显现完时触发操作，避免机器速度改变采样时机。 */
async function interruptPanel(action){
  await page.clock.pauseAt(await page.evaluate(()=>Date.now()+100));
  const interrupted=page.evaluate(action=>new Promise((resolve,reject)=>{
    const observer=new MutationObserver(()=>{
      const skin=document.querySelector('.liquid-panel-skin'),before=Number(skin?.style.opacity);
      if(!skin||before<=.05||before>=.75)return;
      clearTimeout(timeout);observer.disconnect();
      document.querySelector('[aria-label="'+action+'"]').click();
      queueMicrotask(()=>resolve({before,after:Number(skin.style.opacity)}));
    });
    const timeout=setTimeout(()=>{observer.disconnect();reject(Error('未捕捉到主浮卡中间帧'));},4000);
    observer.observe(document.querySelector('[data-editor-root]'),{subtree:true,childList:true,attributes:true,attributeFilter:['style']});
    document.querySelector('[aria-label="美化图片"]').click();
  }),action);
  // 明确推进 16ms 帧，避免慢机器首帧直接越过部分透明区而让回归偶发超时。
  try{await page.clock.runFor(80);}finally{await page.clock.resume();}
  return interrupted;
}
/** 用受控帧在小菜单尚未长成时取消，测量可见材质而非固定语义槽位。 */
async function closeGrowingMenu(){
  await page.clock.pauseAt(await page.evaluate(()=>Date.now()+100));
  const interrupted=page.evaluate(()=>new Promise((resolve,reject)=>{
    const observer=new MutationObserver(()=>{
      const skin=document.querySelector('.clay-select-menu > .liquid-surface-skin'),alpha=Number(skin?.style.opacity);
      if(!skin||alpha<.15||alpha>.75)return;
      const box=skin.getBoundingClientRect();clearTimeout(timeout);observer.disconnect();
      skin.parentElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      resolve({width:box.width,height:box.height});
    });
    const timeout=setTimeout(()=>{observer.disconnect();reject(Error('未捕捉到小菜单中间帧'));},4000);
    observer.observe(document.querySelector('[data-editor-root]'),{subtree:true,childList:true,attributes:true,attributeFilter:['style']});
    document.querySelector('[role=combobox][aria-label="导出倍率"]').click();
  }));
  try{
    await page.clock.runFor(96);const before=await interrupted;
    const after=await page.locator('.clay-select-menu > .liquid-surface-skin').boundingBox();
    assert.ok(after&&after.width<=before.width+.1&&after.height<=before.height+.1,'提前退出材质只能从当前可见体积收拢');
  }finally{await page.clock.resume();}
}
/** 改变真实布局后先等 ResizeObserver，尚未推进下一动效帧时也不能跳大材质。 */
async function resizeEnteringPanel(){
  await page.clock.pauseAt(await page.evaluate(()=>Date.now()+100));
  try{
    await page.evaluate(()=>document.querySelector('[aria-label="美化图片"]').click());
    await page.clock.runFor(64);
    const result=await page.evaluate(()=>new Promise(resolve=>{
      const panel=document.querySelector('.clay-card'),skin=panel.querySelector('.liquid-panel-skin');
      const before=skin.getBoundingClientRect().width,original=panel.style.width;
      const observer=new ResizeObserver(()=>{
        observer.disconnect();const after=skin.getBoundingClientRect().width;panel.style.width=original;resolve({before,after});
      });
      observer.observe(panel);panel.style.width='440px';
    }));
    assert.ok(Math.abs(result.after-result.before)<.1,'内容尺寸变化不能先拉大材质一帧');
    await page.clock.runFor(1200);
  }finally{await page.clock.resume();}
}
/** 模拟已经隐藏后才到达的异步提示/关闭，验证不依赖下一次 visibilitychange。 */
async function alreadyHiddenUpdates(){
  await page.clock.pauseAt(await page.evaluate(()=>Date.now()+100));
  try{
    await visibility(true);const before=await page.locator('[data-editor-root]').getAttribute('data-motion-frames');
    await page.evaluate(()=>window.__motionTest.notice('隐藏后迟到的合成通知',true));
    assert.equal(await page.locator('.clay-notice').evaluate(el=>el.dataset.motionPhase==='open'&&el.querySelector('.liquid-surface-skin').style.opacity==='1'),true);
    await page.locator('.clay-notice button').evaluate(el=>el.click());
    assert.equal(await page.locator('.clay-notice').count(),0,'已隐藏时关闭仍应清理保留层');
    const details=page.locator('details').filter({has:page.locator('summary').filter({hasText:'细调外观'})});
    await details.locator('summary').evaluate(el=>el.click());
    assert.equal(await details.evaluate(el=>el.open&&!el.style.height&&!el.style.overflow),true);
    await details.locator('summary').evaluate(el=>el.click());
    assert.equal(await details.evaluate(el=>!el.open&&!el.style.height&&!el.style.overflow),true);
    assert.equal(await page.locator('[data-editor-root]').getAttribute('data-motion-frames'),before,'隐藏的新请求不得重新排主轨帧');
    await clickHiddenClose();
    assert.equal(await page.locator('.clay-card').count(),0,'隐藏期间到达的主浮卡关闭也要完成卸载');
  }finally{await visibility(false);await page.clock.resume();}
  async function clickHiddenClose(){await page.getByRole('button',{name:'关闭浮卡',exact:true}).evaluate(el=>el.click());}
}
async function suspendedDisclosure(click){
  await click('美化图片');
  await page.clock.pauseAt(await page.evaluate(()=>Date.now()+100));
  const details=page.locator('details').filter({has:page.locator('summary').filter({hasText:'细调外观'})});
  try{
    await details.locator('summary').evaluate(el=>el.click());await page.clock.runFor(48);
    assert.equal(await details.evaluate(el=>!!el.style.height),true);
    await page.locator('[data-editor-root]').evaluate(el=>el.classList.add('is-suspended'));
    assert.equal(await details.evaluate(el=>el.open&&!el.style.height),true,'宿主挂起也应释放折叠高度');
    await details.locator('summary').evaluate(el=>el.click());
    assert.equal(await details.evaluate(el=>!el.open&&!el.style.height),true,'挂起后到达的新折叠动作直接归位');
  }finally{await page.locator('[data-editor-root]').evaluate(el=>el.classList.remove('is-suspended'));await page.clock.resume();}
  await click('关闭浮卡');await page.waitForSelector('.clay-card',{state:'detached'});
}
/** 直接操作生产组件；滑杆、控件反馈和文档历史共用同一合成页面。 */
async function componentChecks(click,load){
  const document=()=>page.evaluate(()=>window.screenshotPrepareUpdate().document);
  const settled=()=>page.waitForFunction(()=>document.querySelector('.liquid-panel-content')?.style.opacity==='1');
  await click('美化图片');await settled();
  const preset=page.getByRole('button',{name:'简洁截图',exact:true}),fixed=await preset.boundingBox();
  await preset.focus();await page.keyboard.down('Space');
  await page.waitForFunction(()=>new DOMMatrixReadOnly(getComputedStyle([...document.querySelectorAll('[data-control-button]')].find(el=>el.textContent==='简洁截图').querySelector('.control-skin')).transform).m22<.95);
  assert.deepEqual(await preset.boundingBox(),fixed);
  assert.equal(await preset.locator('.control-content').evaluate(el=>{const m=new DOMMatrixReadOnly(getComputedStyle(el).transform);return m.m11===1&&m.m22===1;}),true);
  await preset.evaluate(el=>el.disabled=true);await page.keyboard.up('Space');
  assert.equal(await preset.locator('.control-skin').evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).isIdentity),true,'禁用立即复位按压，不遗留形变');
  await preset.evaluate(el=>el.disabled=false);checks.push('panel-controls-fixed-hitbox-and-unscaled-content');
  await page.mouse.move(fixed.x+fixed.width*.8,fixed.y+fixed.height*.7);await page.waitForTimeout(130);
  assert.ok(await preset.locator('.control-skin').evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).m41>0));
  assert.deepEqual(await preset.boundingBox(),fixed);
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await preset.locator('.control-skin').evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).isIdentity),true);
  await page.emulateMedia({reducedMotion:'no-preference'});checks.push('ordinary-control-hover-and-reduced-reset');
  const heading=page.getByRole('region',{name:'美化截图',exact:true}).getByLabel('移动美化截图，方向键微调');
  const beforeMove=await page.locator('.clay-card').boundingBox();await heading.focus();await page.keyboard.press('ArrowLeft');
  const placement=await page.locator('.clay-card').boundingBox(),material=await page.locator('.liquid-panel-skin').boundingBox();
  assert.ok(Math.abs(placement.x-(beforeMove.x-8))<.5&&Math.abs(material.x-placement.x)<.5&&Math.abs(material.width-placement.width)<.5,'手动微调不留材质追赶');
  // 只抓住标题又松开也不能把“手动放置”留给后续关闭动画。
  const grab=await heading.boundingBox();await page.mouse.move(grab.x+8,grab.y+10);await page.mouse.down();await page.mouse.up();
  checks.push('manual-panel-placement-takes-over-immediately');
  await page.clock.pauseAt(await page.evaluate(()=>Date.now()+100));
  const closingFrom=await page.locator('.liquid-panel-skin').boundingBox();
  await page.getByRole('button',{name:'关闭浮卡',exact:true}).evaluate(el=>el.click());await page.clock.runFor(100);
  const closingAt=await page.locator('.liquid-panel-skin').boundingBox();
  assert.ok(Math.hypot(closingAt.x-closingFrom.x,closingAt.y-closingFrom.y)<10&&closingAt.width>closingFrom.width*.97,'关闭只短距回收，不飞过截图');
  await page.clock.resume();await page.waitForSelector('.clay-card',{state:'detached'});checks.push('panel-exit-is-short-directional-retraction');
  await click('美化图片');await settled();await click('提取文字');
  assert.ok(Number(await page.locator('.liquid-panel-skin').evaluate(el=>el.style.opacity))>.9);
  assert.ok(Number(await page.locator('.liquid-panel-content').evaluate(el=>el.style.opacity))<.95,'新内容在材质后段独立进入');
  await settled();await click('关闭浮卡');await page.waitForSelector('.clay-card',{state:'detached'});checks.push('panel-switch-keeps-material-and-delays-new-content');
  await click('美化图片');await settled();await page.getByText('细调外观',{exact:true}).click();
  await page.waitForFunction(()=>{const d=[...document.querySelectorAll('details')].find(el=>el.querySelector('summary')?.textContent==='细调外观');return d?.open&&!d.style.height;});
  const checkbox=page.getByRole('checkbox',{name:'柔和阴影',exact:true}),checkboxBox=await checkbox.boundingBox();
  await checkbox.focus();await page.keyboard.down('Space');
  await page.waitForFunction(()=>parseFloat(document.querySelector('input[type=checkbox]').style.getPropertyValue('--check-scale-y'))<.95);
  assert.deepEqual(await checkbox.boundingBox(),checkboxBox);
  assert.equal(await checkbox.evaluate(el=>getComputedStyle(el).transform),'none','只形变复选框材质，命中和勾选图形不缩放');
  await page.keyboard.up('Space');checks.push('checkbox-material-feedback-keeps-fixed-input');
  const initial=await document(),range=page.getByRole('slider',{name:'留白',exact:true}),box=await range.boundingBox();
  await page.screenshot({path:path.join(out,'06-components.png')});
  await page.mouse.move(box.x+box.width*.35,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.55,box.y+box.height/2,{steps:3});
  await page.waitForFunction(()=>parseFloat(document.querySelector('input[aria-label="留白"]').style.getPropertyValue('--range-scale-x'))>1.02);
  await page.waitForTimeout(900);await page.mouse.move(box.x+box.width*.8,box.y+box.height/2,{steps:3});await page.mouse.up();
  const first=await document();assert.notEqual(first.editor.padding,initial.editor.padding);
  await click('撤销');assert.deepEqual((await document()).editor,initial.editor,'长拖动只占一次撤销');
  await click('重做');assert.deepEqual((await document()).editor,first.editor);
  await range.focus();await page.keyboard.press('ArrowLeft');assert.notEqual((await document()).editor.padding,first.editor.padding);
  await click('撤销');assert.deepEqual((await document()).editor,first.editor,'下一次紧接的键盘手势必须单独撤销');
  checks.push('range-pressure-and-one-undo-per-gesture');
  await load();
}
/** 在正式构建页面中验证表现层与真实业务入口的先后顺序。 */
async function main(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,...(process.env.SCREENSHOT_CHROMIUM_EXECUTABLE?{executablePath:process.env.SCREENSHOT_CHROMIUM_EXECUTABLE}:{channel:'msedge'})});
  const context=await browser.newContext({viewport:{width:1280,height:800}});page=await context.newPage();const errors=[];
  await page.clock.install();
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')||route.request().url().startsWith('data:')?route.continue():route.abort());
  await page.addInitScript(mockHost);await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
  const ready=async()=>{await page.waitForFunction(()=>document.querySelector('.is-overlay.is-presented')&&[...document.querySelectorAll('[data-motion-button]')].every(node=>node.dataset.motionReady==='true'));};
  const load=async()=>{await page.evaluate(()=>window.__motionTest.load());await ready();};
  const click=name=>page.getByRole('button',{name,exact:true}).click();
  await load();
  const original=await page.locator('canvas.lower-canvas').evaluate(canvas=>canvas.toDataURL());
  await resizeEnteringPanel();checks.push('panel-layout-resize-preserves-current-material');
  await alreadyHiddenUpdates();checks.push('already-hidden-late-surfaces-finish-without-frames');
  await suspendedDisclosure(click);checks.push('host-suspension-finishes-and-gates-disclosure');
  const earlyClose=await interruptPanel('关闭浮卡');
  assert.ok(earlyClose.after<=earlyClose.before+.1,'主浮卡提前关闭不能跳亮');
  await page.waitForSelector('.clay-card',{state:'detached'});checks.push('early-panel-close-preserves-material-opacity');
  const switching=await interruptPanel('提取文字');
  assert.ok(switching.after>=switching.before*.9,'切换浮卡不能重新闪成透明');
  await page.waitForFunction(()=>document.querySelector('.clay-card[aria-label="识别与校对"] .liquid-panel-content')?.style.opacity==='1');
  await click('关闭浮卡');await page.waitForSelector('.clay-card',{state:'detached'});checks.push('panel-switch-retains-visible-material');
  await click('美化图片');
  await page.waitForFunction(()=>{const n=document.querySelector('.liquid-panel-content');return n&&Number(n.style.opacity)>0&&Number(n.style.opacity)<1;});
  await visibility(true);
  assert.equal(await page.locator('.liquid-panel-content').evaluate(el=>el.style.opacity),'1');
  const hiddenFrames=await page.locator('[data-editor-root]').getAttribute('data-motion-frames');await page.waitForTimeout(80);
  assert.equal(await page.locator('[data-editor-root]').getAttribute('data-motion-frames'),hiddenFrames,'隐藏期间没有残留帧');
  await visibility(false);
  assert.equal(await page.locator('.liquid-panel-skin').evaluate(el=>{const m=new DOMMatrixReadOnly(getComputedStyle(el).transform);return Math.abs(m.m11-1)<.001&&Math.abs(m.m22-1)<.001;}),true);
  checks.push('hidden-panel-enter-settles-and-sleeps');
  await click('关闭浮卡');await visibility(true);
  await page.waitForSelector('.clay-card',{state:'detached'});await visibility(false);checks.push('hidden-panel-close-removes-retained-surface');
  await click('更多操作');await page.getByRole('combobox',{name:'导出倍率',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.clay-select-menu')?.dataset.motionPhase==='open');
  await page.keyboard.press('Escape');await visibility(true);
  await page.waitForSelector('.clay-select-menu',{state:'detached'});await visibility(false);checks.push('hidden-menu-close-releases-retained-surface');
  await page.getByText('裁剪与缩放',{exact:true}).click();await visibility(true);
  assert.equal(await page.locator('details').filter({has:page.locator('summary').filter({hasText:'裁剪与缩放'})}).evaluate(el=>el.open&&!el.style.height&&!el.style.overflow),true);
  await visibility(false);await click('关闭浮卡');await page.waitForSelector('.clay-card',{state:'detached'});checks.push('hidden-disclosure-finishes-at-semantic-state');
  await click('完成');await page.waitForSelector('[data-motion-exit=complete]');await visibility(true);await visibility(false);
  await page.waitForFunction(()=>!document.querySelector('fieldset').disabled);
  assert.equal(await page.evaluate(()=>window.__motionTest.state.completed),0,'隐藏只取消收束，不能确认完成');
  assert.equal(await page.locator('[data-motion-exit]').count(),0);assert.equal(await page.locator('canvas.lower-canvas').count(),1);checks.push('hidden-exit-does-not-send-stale-completion');
  await page.evaluate(()=>{window.__motionTest.state.holdCopy=true;window.__motionTest.state.releaseCopy=null;});await click('完成');
  await page.waitForFunction(()=>typeof window.__motionTest.state.releaseCopy==='function');await visibility(true);
  await page.evaluate(()=>{const s=window.__motionTest.state;s.holdCopy=false;s.releaseCopy();});
  await page.waitForFunction(()=>!document.querySelector('fieldset').disabled);
  assert.equal(await page.evaluate(()=>window.__motionTest.state.completed),0,'隐藏后才到达的复制确认不得自动提交完成');
  assert.equal(await page.locator('canvas.lower-canvas').count(),1);await visibility(false);checks.push('already-hidden-copy-ack-keeps-document');
  await componentChecks(click,load);
  const rectTool=page.getByRole('button',{name:'矩形标注',exact:true}),arrowTool=page.getByRole('button',{name:'箭头标注',exact:true});
  await rectTool.focus();await page.keyboard.down('Space');
  await page.waitForFunction(()=>new DOMMatrixReadOnly(document.querySelector('[aria-label="矩形标注"] .liquid-skin').style.transform).m22<.95);
  await visibility(true);
  assert.equal(await rectTool.locator('.liquid-skin').evaluate(el=>new DOMMatrixReadOnly(el.style.transform).isIdentity),true);
  await rectTool.evaluate(el=>el.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true})));
  await page.waitForTimeout(80);assert.equal(await rectTool.locator('.liquid-skin').evaluate(el=>new DOMMatrixReadOnly(el.style.transform).isIdentity),true);
  await page.keyboard.up('Space');await visibility(false);await page.waitForTimeout(80);
  assert.equal(await rectTool.locator('.liquid-skin').evaluate(el=>new DOMMatrixReadOnly(el.style.transform).isIdentity),true);checks.push('hidden-held-rail-resets-without-stale-hover');
  await rectTool.focus();await page.keyboard.down('Space');
  await page.waitForFunction(()=>new DOMMatrixReadOnly(document.querySelector('[aria-label="矩形标注"] .liquid-skin').style.transform).m22<.95);
  await page.locator('fieldset.clay-chrome').evaluate(el=>el.disabled=true);
  await page.waitForFunction(()=>new DOMMatrixReadOnly(document.querySelector('[aria-label="矩形标注"] .liquid-skin').style.transform).isIdentity);
  await page.keyboard.up('Space');await page.locator('fieldset.clay-chrome').evaluate(el=>el.disabled=false);checks.push('ancestor-disable-clears-held-rail');
  const handle=page.locator('[data-selection-handle=se]'),handleBox=await handle.boundingBox();
  await page.mouse.move(handleBox.x+12,handleBox.y+12);await page.mouse.down();
  await page.waitForFunction(()=>Number(document.querySelector('[data-selection-handle=se]').style.getPropertyValue('--handle-scale-y'))<.95);
  assert.deepEqual(await handle.boundingBox(),handleBox,'选区捕获手势时手柄命中槽位不形变');
  await page.mouse.up();await page.waitForFunction(()=>document.querySelector('[data-selection-handle=se]').style.getPropertyValue('--handle-scale-y')==='1');checks.push('selection-handle-feedback-survives-capture-handler');
  const fixed=await rectTool.boundingBox();await page.mouse.move(fixed.x+fixed.width*.75,fixed.y+8);await page.waitForTimeout(160);
  assert.deepEqual(await rectTool.boundingBox(),fixed,'迎向不能移动命中槽位');
  const material=await rectTool.locator('.liquid-skin').evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);
  assert.ok(material>0,'材质确实迎向指针');
  const glyph=await rectTool.locator('.liquid-glyph').evaluate(el=>{const m=new DOMMatrixReadOnly(getComputedStyle(el).transform);return {x:m.m11,y:m.m22};});
  assert.ok(Math.abs(glyph.x-1)<.001&&Math.abs(glyph.y-1)<.001,'图文不拉伸');checks.push('fixed-hitbox-and-unscaled-glyph');
  assert.ok((await rectTool.locator('.liquid-skin').evaluate(el=>el.style.borderRadius)).split(' ').length>1,'材质曲率随指针变化');
  assert.ok(await rectTool.locator('.liquid-skin').evaluate(el=>parseFloat(el.style.getPropertyValue('--liquid-light-y'))<50),'追光使用真实纵向位置');checks.push('material-curvature-and-two-axis-light');
  await rectTool.focus();await page.keyboard.down('Space');
  await page.waitForFunction(()=>new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[aria-label="矩形标注"] .liquid-skin')).transform).m22<.95);
  assert.deepEqual(await rectTool.boundingBox(),fixed,'键盘按压仍保持命中矩形');await page.keyboard.up('Space');checks.push('keyboard-press-shares-material-feedback');
  if(await rectTool.getAttribute('aria-pressed')!=='true')await rectTool.click();await page.mouse.move(fixed.x+fixed.width/2,fixed.y+fixed.height/2);await page.waitForTimeout(100);
  const arrow=await arrowTool.boundingBox();await page.mouse.move(arrow.x+arrow.width/2,arrow.y+arrow.height/2);
  await page.waitForFunction(()=>Boolean(document.querySelector('.liquid-bridge path')?.getAttribute('d')));
  assert.equal(await rectTool.getAttribute('aria-pressed'),'true','hover 不切换逻辑工具');checks.push('same-group-bridge-and-click-only-selection');
  await click('美化图片');await click('提取文字');await click('美化图片');
  await page.waitForFunction(()=>document.querySelector('.clay-card[aria-label="美化截图"] .liquid-panel-content')?.style.opacity==='1');
  assert.equal(await page.locator('.clay-card').count(),1,'旧关闭不移除新浮卡');
  assert.equal(await page.locator('.liquid-panel-content').evaluate(el=>getComputedStyle(el).transform),'none');checks.push('interruptible-panel-with-static-content');
  const details=page.locator('.clay-card').getByText('细调外观',{exact:true});await details.click();await page.waitForTimeout(50);await details.click();await page.waitForTimeout(50);await details.click();
  await page.waitForFunction(()=>{const node=[...document.querySelectorAll('details')].find(el=>el.querySelector('summary')?.textContent==='细调外观');return node?.open&&!node.style.height;});checks.push('redirected-disclosure');
  // 小弹层退出仍保留表面，但立即离开辅助树和命中；重开取消旧关闭。
  await click('更多操作');const select=page.getByRole('combobox',{name:'导出倍率',exact:true});
  await closeGrowingMenu();await page.waitForSelector('.clay-select-menu',{state:'detached'});checks.push('early-surface-close-never-expands-current-material');
  await select.click();
  await page.waitForFunction(()=>{const skin=document.querySelector('.clay-select-menu > .liquid-surface-skin'),body=document.querySelector('.clay-select-menu > .liquid-surface-content');return skin&&Number(skin.style.opacity)>.15&&Number(body.style.opacity)<.4;});
  const beforeClose=await page.locator('.clay-select-menu > .liquid-surface-skin').evaluate(el=>Number(el.style.opacity));
  await page.keyboard.press('Escape');
  const afterClose=await page.locator('.clay-select-menu > .liquid-surface-skin').evaluate(el=>Number(el.style.opacity));
  assert.ok(afterClose>=beforeClose*.6&&afterClose<=beforeClose+.35,'正文尚未淡入时关闭，材质仍从当前透明度退场');
  await select.click();await page.waitForFunction(()=>document.querySelector('.clay-select-menu')?.dataset.motionPhase==='open');checks.push('early-surface-close-preserves-material-opacity');
  await page.screenshot({path:path.join(out,'03-select.png')});
  await page.evaluate(()=>window.__savedMenu=document.querySelector('.clay-select-menu'));await page.keyboard.press('Escape');
  assert.equal(await page.locator('.clay-select-menu').evaluate(el=>el.inert&&el.getAttribute('aria-hidden')==='true'),true);
  await select.click();await page.waitForTimeout(230);
  assert.equal(await page.locator('.clay-select-menu').evaluate(el=>el===window.__savedMenu&&!el.inert&&el.dataset.motionPhase!=='closed'),true);
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await page.waitForSelector('.clay-select-menu',{state:'detached'});assert.equal(await select.evaluate(el=>document.activeElement===el),true);checks.push('select-retained-exit-reopen-and-keyboard-focus');
  await select.click();await page.getByRole('option',{name:'1× 当前尺寸',exact:true}).click();
  await click('美化图片');await page.getByText('细调外观',{exact:true}).click();
  const color=page.getByRole('button',{name:'背景颜色',exact:true});
  const background=await page.evaluate(()=>window.screenshotPrepareUpdate().document.editor.background);
  await color.click();const colorInput=page.getByRole('textbox',{name:'颜色值',exact:true});await colorInput.fill('#123456');await page.keyboard.press('Escape');
  assert.equal(await page.locator('.clay-color-popover').evaluate(el=>el.inert),true);
  await color.click();await page.waitForTimeout(230);assert.equal(await colorInput.inputValue(),background);
  await page.screenshot({path:path.join(out,'04-color.png')});
  assert.equal(await page.locator('.clay-color-popover > .liquid-surface-content').evaluate(el=>getComputedStyle(el).transform),'none');
  await colorInput.fill('#oops');await page.keyboard.press('Enter');assert.equal(await colorInput.getAttribute('aria-invalid'),'true');
  await page.keyboard.press('Escape');await page.emulateMedia({reducedMotion:'reduce'});await page.waitForSelector('.clay-color-popover',{state:'detached'});
  assert.equal(await page.evaluate(()=>window.screenshotPrepareUpdate().document.editor.background),background,'取消颜色草稿不能写入文档');
  assert.equal(await color.evaluate(el=>document.activeElement===el),true);checks.push('color-draft-cancel-reopen-and-reduced-exit');
  await page.emulateMedia({reducedMotion:'no-preference'});await click('关闭浮卡');
  await rectTool.focus();await page.getByRole('tooltip').filter({hasText:'矩形标注'}).waitFor({timeout:4000});
  const described=await rectTool.getAttribute('aria-describedby');assert.ok(described);
  await rectTool.evaluate(el=>el.blur());assert.equal(await rectTool.getAttribute('aria-describedby'),null);
  await arrowTool.focus();await page.waitForFunction(()=>document.querySelector('.clay-tooltip')?.textContent==='箭头标注'&&document.querySelector('.clay-tooltip')?.dataset.motionPhase==='open');
  assert.equal(await page.locator('.clay-tooltip').count(),1);await arrowTool.evaluate(el=>el.blur());await page.waitForSelector('.clay-tooltip',{state:'detached'});checks.push('tooltip-reopen-and-description-lifecycle');
  await arrowTool.focus();await page.getByRole('tooltip').waitFor();await page.clock.pauseAt(await page.evaluate(()=>Date.now()+100));
  try{
    await visibility(true);await page.waitForSelector('.clay-tooltip',{state:'detached'});
    assert.equal(await arrowTool.getAttribute('aria-describedby'),null);
    await arrowTool.evaluate(el=>el.dispatchEvent(new FocusEvent('focusin',{bubbles:true})));await page.clock.runFor(300);
    assert.equal(await page.locator('.clay-tooltip').count(),0,'隐藏后到达的延迟提示不得显示');
  }finally{await visibility(false);await page.clock.resume();}
  await arrowTool.evaluate(el=>el.blur());checks.push('tooltip-hidden-clear-and-late-timer-rejection');
  await page.mouse.move(8,8);await page.waitForFunction(()=>document.querySelector('[data-editor-root]')?.dataset.motionState==='sleep');
  const frames=await page.locator('[data-editor-root]').getAttribute('data-motion-frames');await page.waitForTimeout(140);assert.equal(await page.locator('[data-editor-root]').getAttribute('data-motion-frames'),frames);
  assert.equal(await page.locator('canvas.lower-canvas').evaluate(canvas=>canvas.toDataURL()),original,'UI 动效不得进入画布');checks.push('sleep-and-image-pixels-preserved');
  await page.screenshot({path:path.join(out,'01-panel.png')});
  await page.evaluate(()=>{window.__motionTest.state.failCopy=true;});await click('完成');
  await page.getByRole('alert').waitFor();assert.equal(await page.locator('.liquid-image-copy').count(),0);assert.equal(await page.evaluate(()=>window.__motionTest.state.completed),0);checks.push('copy-failure-keeps-editor');
  await click('关闭提示');assert.equal(await page.locator('.clay-notice').getAttribute('aria-hidden'),'true');
  await click('完成');await page.getByRole('alert').waitFor();await page.waitForFunction(()=>document.querySelector('.clay-notice')?.dataset.motionPhase==='open');
  assert.equal(await page.locator('.clay-notice').count(),1);
  await page.screenshot({path:path.join(out,'05-notice.png')});
  assert.equal(await page.locator('.clay-notice').evaluate(el=>getComputedStyle(el).pointerEvents),'none');
  assert.equal(await page.getByRole('button',{name:'关闭提示',exact:true}).evaluate(el=>getComputedStyle(el).pointerEvents),'auto');checks.push('notice-replacement-and-text-click-through');
  await page.clock.fastForward(5000);assert.equal(await page.getByRole('alert').count(),1,'错误不能依赖超时消失');
  await page.evaluate(()=>window.__motionTest.notice('合成普通提示',false));await page.getByRole('status').filter({hasText:'合成普通提示'}).waitFor();
  await page.clock.fastForward(5000);await page.waitForSelector('.clay-notice',{state:'detached'});checks.push('native-notice-kind-controls-persistence');
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
  await page.clock.pauseAt(await page.evaluate(()=>Date.now()+100));
  await page.evaluate(()=>{const s=window.__motionTest.state;s.holdCopy=false;s.releaseCopy();});
  await page.waitForFunction(()=>!document.querySelector('fieldset').disabled);assert.equal(await page.evaluate(()=>window.__motionTest.state.completed),0);assert.equal(await page.locator('[data-motion-exit]').count(),0);checks.push('cancel-copy-wait-does-not-hide');
  assert.equal(await page.locator('.clay-status').evaluate(el=>el.dataset.motionPhase==='closing'&&el.inert&&el.getAttribute('aria-hidden')==='true'),true);
  assert.equal(await page.locator('.clay-status button').isDisabled(),true);await page.clock.runFor(200);await page.clock.resume();
  await page.waitForSelector('.clay-status',{state:'detached'});checks.push('task-status-retains-noninteractive-exit');
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
