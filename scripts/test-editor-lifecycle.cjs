// 仅使用无头浏览器、合成 PNG 与内存桥；不访问桌面、原生对话框或系统剪贴板。
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.SCREENSHOT_PLAYWRIGHT_MODULE||process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'editor/dist'),out=path.join(root,'artifacts/qa/redesign');
fs.mkdirSync(out,{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{const file=path.resolve(dist,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(dist+path.sep)){res.writeHead(403).end();return;}const target=fs.existsSync(file)&&fs.statSync(file).isDirectory()?path.join(file,'index.html'):file;if(!fs.existsSync(target)){res.writeHead(404).end();return;}res.setHeader('Content-Type',mime[path.extname(target)]||'application/octet-stream');fs.createReadStream(target).pipe(res);});
function mockHost(){
  const listeners=new Set(),state={copied:0,saved:0,ocr:0,translate:0,checkpoints:0,failCopy:false,copyCancelled:false,holdCopy:false,holdComplete:false,rejectComplete:false,hidden:false,backdrop:false,clipboardText:'',captureId:null,errors:[]};
  const emit=data=>listeners.forEach(listener=>listener({data}));
  function image(name='合成截图.png') {const canvas=document.createElement('canvas');canvas.width=560;canvas.height=300;const ctx=canvas.getContext('2d');ctx.fillStyle='#f1f3f7';ctx.fillRect(0,0,560,300);ctx.fillStyle='#243044';ctx.font='24px sans-serif';ctx.fillText('合成截图 · 原位编辑',32,60);ctx.font='16px sans-serif';ctx.fillText('此图由测试生成，没有读取桌面。',32,102);for(let i=0;i<4;i++){ctx.fillStyle=i%2?'#dae3ee':'#c5d2e3';ctx.fillRect(32,140+i*28,460-i*40,12);}return {dataUrl:canvas.toDataURL(),name,width:560,height:300};}
  const sample=image();
  async function checkpoint(reason,expected){
    const snapshot=window.screenshotPrepareLeave(reason);
    try{if(snapshot.error)throw Error(snapshot.error);if(expected&&(snapshot.documentId!==expected.documentId||snapshot.revision!==expected.revision))return false;state.checkpoints++;state.snapshot=snapshot;return true;}finally{window.screenshotFinishLeave();}
  }
  function resume(){state.hidden=false;document.querySelector('[data-mock-host-toast]')?.remove();document.querySelector('[data-editor-root]')?.style.removeProperty('visibility');emit({event:'presentation.changed',payload:{presentation:'workbench',reason:'user_editor'}});emit({event:'editor.action',payload:{action:'continue'}});}
  state.requests=[];
  Object.assign(window.chrome||=( {}),{webview:{addEventListener:(_name,listener)=>listeners.add(listener),removeEventListener:(_name,listener)=>listeners.delete(listener),postMessage:async request=>{
    state.requests.push(request.method);
    let result={};try{
      switch(request.method){
        case 'app.updateReady': result={ready:true};break;
        case 'settings.read':case 'settings.configure':result={providers:[{id:'synthetic',name:'模拟服务',revision:'synthetic-revision',kind:'openai-compatible',baseUrl:'https://provider.invalid',model:'synthetic',hasApiKey:true}],defaultProviderId:'synthetic'};break;
        case 'capture.adjust':{
          if(request.payload.captureId!==state.captureId)throw Error('过期截图');
          if(state.holdAdjust)await new Promise(resolve=>state.releaseAdjust=resolve);
          if(state.failAdjust)throw Error('模拟选区裁剪失败');
          const area=request.payload.selection,canvas=document.createElement('canvas');canvas.width=area.width;canvas.height=area.height;const source=new Image();source.src=sample.dataUrl;await source.decode();canvas.getContext('2d').drawImage(source,0,0);
          result={image:{...sample,dataUrl:canvas.toDataURL(),width:area.width,height:area.height},overlay:{captureId:request.payload.captureId,desktopBounds:{x:0,y:0,width:1280,height:800},selection:area,screens:[{bounds:{x:0,y:0,width:1280,height:800},workArea:{x:0,y:0,width:1280,height:760},primary:true}]}};break;
        }
        case 'capture.settings':result={backend:'wgc'};break;
        case 'ocr.status':result={available:true,modelVersion:'synthetic-only',message:'合成模型状态',missingFiles:[]};break;
        case 'document.preserve':await checkpoint('replace');result={saved:true};break;
        case 'image.open':case 'image.paste':await checkpoint('replace');result=sample;break;
        case 'image.copy':
          if(state.holdCopy)await new Promise(resolve=>state.releaseCopy=resolve);
          if(state.failCopy)throw Error('模拟剪贴板写入失败');
          state.copied++;result={copied:!state.copyCancelled};break;
        case 'image.save':throw Error('完成不应保存 PNG');
        case 'text.copy':state.clipboardText=request.payload.text;result={copied:true};break;
        case 'project.save':result={saved:true};break;
        case 'recovery.save':throw Error('不得自动保存');
        case 'recovery.list':result={items:[]};break;
        case 'recovery.usage':result={documents:0,referencedAssetBytes:0,maxDocuments:100,maxAssetBytes:100000};break;
        case 'presentation.ready':if(state.holdReady)await new Promise(resolve=>state.releaseReady=resolve);result={accepted:request.payload.captureId===state.captureId,presentation:'overlay',captureId:state.captureId};break;
        case 'presentation.editor':state.backdrop=false;state.captureId=null;result={accepted:true,presentation:'workbench'};break;
        case 'presentation.dismiss':await checkpoint('close');state.hidden=true;state.backdrop=false;state.captureId=null;result={accepted:true,presentation:'hidden'};break;
        case 'presentation.complete':{
          state.completion={documentId:request.payload.documentId,revision:request.payload.revision,captureId:request.payload.captureId,actualCaptureId:state.captureId};
          if(state.holdComplete)await new Promise(resolve=>state.releaseComplete=resolve);
          if(state.rejectComplete){result={accepted:false};break;}
          const scope=request.payload.captureId??null;
          if(scope!==state.captureId||!await checkpoint('complete',request.payload)){result={accepted:false};break;}
          state.hidden=true;state.backdrop=false;state.captureId=null;result={accepted:true,presentation:'hidden'};
          document.querySelector('[data-editor-root]').style.visibility='hidden';break;
        }
        case 'ocr.local':state.ocr++;result={modelVersion:'synthetic-only',imageWidth:560,imageHeight:300,blocks:[{id:'block-1',text:'合成校对文字',confidence:.99,order:0,polygon:[{x:20,y:20},{x:220,y:20},{x:220,y:50},{x:20,y:50}]}],text:'合成校对文字'};break;
        case 'ai.translate':state.translate++;result={text:'Synthetic corrected text'};break;
        case 'ai.cancel':result={cancelled:true};break;
        default:throw Error('Unexpected mock request: '+request.method);
      }
      if(request.method==='presentation.complete'&&result.accepted&&state.holdCompleteReply)await new Promise(resolve=>state.releaseCompleteReply=resolve);
      emit({id:request.id,ok:true,result});
    }catch(error){emit({id:request.id,ok:false,error:{code:'mock_failure',message:error.message}});}
  }}});
  window.__mock={state,resume,capture:()=>{state.captureId='synthetic-capture-'+Date.now();state.backdrop=true;emit({event:'image.loaded',payload:{image:sample,overlay:{captureId:state.captureId,desktopBounds:{x:0,y:0,width:1280,height:800},selection:{x:300,y:180,width:560,height:300},screens:[{bounds:{x:0,y:0,width:1280,height:800},workArea:{x:0,y:0,width:1280,height:760},primary:true}]}}});}};
}
let activeBrowser,activePage;
async function main(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,...(process.env.SCREENSHOT_CHROMIUM_EXECUTABLE?{executablePath:process.env.SCREENSHOT_CHROMIUM_EXECUTABLE}:{channel:'msedge'})});
  activeBrowser=browser;
  const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error('Browser error:',error.stack);});
  activePage=page;
  await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')||route.request().url().startsWith('data:')?route.continue():route.abort());
  await page.addInitScript(mockHost);await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
  const click=label=>page.getByRole('button',{name:label,exact:true}).click();
  await click('打开图片');await page.waitForFunction(()=>!document.querySelector('button[aria-label="完成"]').disabled);
  assert.equal(await page.getByText('完整工作台',{exact:true}).count(),0);
  await page.evaluate(()=>{window.__mock.state.holdReady=true;window.__mock.capture();});await page.waitForSelector('.is-overlay');
  await page.waitForFunction(()=>window.__mock.state.requests.includes('presentation.ready'));
  assert.equal(await page.locator('.clay-rail').evaluate(e=>getComputedStyle(e).animationName),'none','hidden native handoff must not consume the entrance animation');
  await page.evaluate(()=>{window.__mock.state.holdReady=false;window.__mock.state.releaseReady();});
  await page.getByRole('region',{name:'原样截图',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'移动截图选区',exact:true}).count(),0,'no separate move icon');
  await page.screenshot({path:path.join(out,'01-raw.png')});
  // 以下指针和键盘均在无头页面中模拟；验证松手后的调整不要求额外确认。
  const moveSelection=page.getByRole('group',{name:'截图选区',exact:true});
  await moveSelection.focus();await page.keyboard.press('ArrowRight');
  await page.waitForFunction(()=>window.screenshotPrepareUpdate?.().document?.image?.width===560&&!document.querySelector('button[aria-label="完成"]').disabled);
  await page.waitForFunction(()=>Math.round(document.querySelector('.clay-capture-selection').getBoundingClientRect().x)===301);
  await click('撤销');await page.waitForFunction(()=>Math.round(document.querySelector('.clay-capture-selection').getBoundingClientRect().x)===300);
  await click('重做');await page.waitForFunction(()=>Math.round(document.querySelector('.clay-capture-selection').getBoundingClientRect().x)===301);
  // 历史已切换不等于底图已绘完；只在选区手柄重新可用后注入下一次虚拟手势。
  await page.waitForFunction(()=>!window.screenshotPrepareUpdate().error&&!document.querySelector('.clay-selection-handle.is-se').disabled);await page.evaluate(()=>window.__mock.state.holdAdjust=true);
  const bodyBox=await page.locator('.clay-capture-selection').boundingBox();
  await page.locator('.clay-canvas-fixed .upper-canvas').click({position:{x:bodyBox.width-40,y:bodyBox.height-40},trial:true});
  await page.mouse.move(bodyBox.x+bodyBox.width-40,bodyBox.y+bodyBox.height-40);await page.mouse.down();await page.mouse.move(bodyBox.x+bodyBox.width-10,bodyBox.y+bodyBox.height-20);await page.mouse.up();
  await page.waitForFunction(()=>typeof window.__mock.state.releaseAdjust==='function');
  const landed=await page.locator('.clay-capture-selection').boundingBox(),landedRail=await page.locator('.clay-rail').boundingBox();
  assert.equal(Math.round(landed.x),331,'pointer release must retain the preview while crop is pending');assert.equal(Math.round(landed.y),200);
  await page.evaluate(()=>{window.__mock.state.holdAdjust=false;window.__mock.state.releaseAdjust();delete window.__mock.state.releaseAdjust;});
  await page.waitForFunction(()=>!window.screenshotPrepareUpdate().error&&!document.querySelector('.clay-selection-handle.is-se').disabled);
  const settledArea=await page.locator('.clay-capture-selection').boundingBox(),settledRail=await page.locator('.clay-rail').boundingBox();
  assert.equal(settledArea.x,landed.x);assert.equal(settledArea.y,landed.y);assert.equal(settledRail.x,landedRail.x);assert.equal(settledRail.y,landedRail.y);
  await click('撤销');await page.waitForFunction(()=>Math.round(document.querySelector('.clay-capture-selection').getBoundingClientRect().x)===301);
  const southeast=page.getByRole('button',{name:'调整截图选区 se',exact:true});await page.waitForFunction(()=>!document.querySelector('.clay-selection-handle.is-se').disabled);await southeast.click({trial:true});const corner=await southeast.boundingBox();
  await page.mouse.move(corner.x+12,corner.y+12);await page.mouse.down();await page.mouse.move(corner.x+32,corner.y+22);await page.mouse.up();
  await page.waitForFunction(()=>window.screenshotPrepareUpdate?.().document?.image?.width===580&&!document.querySelector('button[aria-label="完成"]').disabled);
  assert.equal(await page.evaluate(()=>window.screenshotPrepareUpdate().document.image.height),310);
  await click('撤销');await page.waitForFunction(()=>window.screenshotPrepareUpdate?.().document?.image?.width===560&&!document.querySelector('button[aria-label="完成"]').disabled);
  const requestsBefore=await page.evaluate(()=>window.__mock.state.requests.filter(m=>m==='capture.adjust').length);
  await page.waitForFunction(()=>!document.querySelector('.clay-selection-handle.is-se').disabled);await southeast.click({trial:true});const cancelCorner=await southeast.boundingBox();await page.mouse.move(cancelCorner.x+12,cancelCorner.y+12);await page.mouse.down();await page.mouse.move(cancelCorner.x+50,cancelCorner.y+50);await page.keyboard.press('Escape');await page.mouse.up();
  assert.equal(await page.evaluate(()=>window.__mock.state.requests.filter(m=>m==='capture.adjust').length),requestsBefore);
  await page.mouse.click(20,700);assert.equal(await page.locator('.is-overlay').count(),1);
  assert.equal(await page.evaluate(()=>window.__mock.state.requests.filter(m=>m==='capture.region').length),0);
  await page.evaluate(()=>window.__mock.state.failAdjust=true);await moveSelection.focus();await page.keyboard.press('ArrowDown');await page.getByRole('alert').waitFor();
  assert.equal(Math.round((await page.locator('.clay-capture-selection').boundingBox()).y),180);
  await page.evaluate(()=>window.__mock.state.failAdjust=false);await click('关闭提示');
  await page.evaluate(()=>window.__mock.state.holdAdjust=true);await moveSelection.focus();await page.keyboard.press('ArrowRight');
  await page.waitForFunction(()=>typeof window.__mock.state.releaseAdjust==='function');
  const blockedHistory=await page.evaluate(()=>document.querySelector('.clay-capture-selection').getBoundingClientRect().x);await page.keyboard.press('Control+z');
  assert.equal(await page.evaluate(()=>document.querySelector('.clay-capture-selection').getBoundingClientRect().x),blockedHistory);
  await page.evaluate(()=>window.__mock.capture());await page.waitForFunction(()=>window.__mock.state.requests.filter(m=>m==='presentation.ready').length===2);
  await page.evaluate(()=>{window.__mock.state.holdAdjust=false;window.__mock.state.releaseAdjust();});
  await page.waitForFunction(()=>!document.querySelector('button[aria-label="完成"]').disabled);
  assert.equal(Math.round((await page.locator('.clay-capture-selection').boundingBox()).x),300);
  await click('矩形标注');await drawRect(page);await page.waitForFunction(()=>window.screenshotPrepareUpdate().document.editor.annotations.length===1);
  const original=await page.evaluate(()=>window.screenshotPrepareUpdate().document.editor.annotations[0].id);
  const annotationBefore=await page.evaluate(()=>window.screenshotPrepareUpdate().document.editor.annotations[0]),captureCount=await page.evaluate(()=>window.__mock.state.requests.filter(m=>m==='capture.adjust').length);
  const contentBox=await page.locator('.clay-canvas-fixed').boundingBox(),objectX=contentBox.x+annotationBefore.left+annotationBefore.width/2,objectY=contentBox.y+annotationBefore.top+annotationBefore.height/2;
  await page.mouse.move(objectX,objectY);await page.mouse.down();await page.mouse.move(objectX+12,objectY+8,{steps:4});await page.mouse.up();
  await page.waitForFunction(left=>window.screenshotPrepareUpdate().document.editor.annotations[0].left>left+5,annotationBefore.left);
  assert.equal(await page.evaluate(()=>window.__mock.state.requests.filter(m=>m==='capture.adjust').length),captureCount,'annotation drag must stay in Fabric');
  await click('美化');await click('柔和留白');await page.waitForFunction(()=>!document.querySelector('button[aria-label="完成"]').disabled);
  assert.equal(await page.evaluate(()=>window.screenshotPrepareUpdate().document.editor.annotations[0].id),original);
  await page.screenshot({path:path.join(out,'02-beauty.png')});
  // 这里只移动无头页面内的虚拟指针；不涉及 Windows 鼠标或实际窗口。
  const grip=page.getByRole('button',{name:'移动动作轨，方向键微调',exact:true});
  const railBefore=await page.locator('.clay-rail').boundingBox(),gripBox=await grip.boundingBox();
  await page.mouse.move(gripBox.x+gripBox.width/2,gripBox.y+gripBox.height/2);await page.mouse.down();await page.mouse.move(gripBox.x+gripBox.width/2+32,gripBox.y+gripBox.height/2+20);await page.mouse.up();
  const railAfter=await page.locator('.clay-rail').boundingBox();assert.equal(Math.round(railAfter.x-railBefore.x),32);assert.equal(Math.round(railAfter.y-railBefore.y),20);
  await grip.focus();await page.keyboard.press('ArrowLeft');assert.equal(Math.round((await page.locator('.clay-rail').boundingBox()).x-railAfter.x),-8);
  assert.equal(await page.evaluate(()=>window.screenshotPrepareUpdate().document.editor.annotations[0].id),original);
  await click('文字');assert.equal(await page.evaluate(()=>window.__mock.state.ocr),0);
  await click('本地识别文字');await page.waitForFunction(()=>document.querySelector('#compact-text')?.value==='合成校对文字');
  assert.equal(await page.evaluate(()=>window.screenshotPrepareUpdate().document.editor.mode),'beauty');
  await page.screenshot({path:path.join(out,'03-text.png')});
  const copyBox=await page.getByRole('button',{name:'复制原文',exact:true}).boundingBox(),cardBox=await page.locator('.clay-card').boundingBox();assert.ok(copyBox.y+copyBox.height<=cardBox.y+cardBox.height,'text copy action must be visible without scrolling');
  await click('复制原文');assert.equal(await page.evaluate(()=>window.__mock.state.clipboardText),'合成校对文字');assert.equal(await page.evaluate(()=>window.__mock.state.hidden),false);
  await click('更多操作');await page.screenshot({path:path.join(out,'05-more.png')});
  assert.equal(await page.locator('.clay-card-content').evaluate(node=>node.scrollTop),0);
  // 只操作内存桥：旧去抖周期之后仍不得写恢复库或显示自动保存状态。
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('.recovery-status').count(),0);
  assert.equal(await page.locator('.clay-status').count(),0,'空闲时不保留自动保存提示的空胶囊');
  assert.equal(await page.getByRole('button',{name:'保存 PNG',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'复制 PNG',exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>window.__mock.state.requests.filter(x=>x==='recovery.save').length),0);
  await page.evaluate(()=>window.__mock.state.failCopy=true);await click('完成');await page.getByRole('alert').waitFor();
  assert.equal(await page.evaluate(()=>window.__mock.state.hidden),false);
  assert.equal(await page.evaluate(()=>window.screenshotPrepareUpdate().document.editor.annotations[0].id),original);
  await page.evaluate(()=>{window.__mock.state.failCopy=false;window.__mock.state.copyCancelled=true;});await click('关闭提示');await click('完成');await page.getByRole('alert').waitFor();
  assert.equal(await page.evaluate(()=>window.__mock.state.hidden),false);
  await page.evaluate(()=>{window.__mock.state.copyCancelled=false;window.__mock.state.rejectComplete=true;});await click('关闭提示');await click('完成');await page.getByRole('alert').waitFor();
  assert.equal(await page.evaluate(()=>window.__mock.state.hidden),false);
  assert.equal(await page.evaluate(()=>window.screenshotPrepareUpdate().document.editor.annotations[0].id),original);
  await page.evaluate(()=>window.__mock.state.rejectComplete=false);await click('关闭提示');await click('完成');await page.waitForFunction(()=>window.__mock.state.hidden);
  assert.equal(await page.evaluate(()=>window.__mock.state.backdrop),false);
  await page.waitForFunction(()=>{const d=window.screenshotPrepareUpdate().document;return d&&d.image===null&&d.editor.text===''&&d.editor.translation===''&&d.editor.annotations.length===0;});
  assert.equal(await page.getByRole('button',{name:'撤销',exact:true}).isDisabled(),true,'完成后不能撤销回到已结束的截图');
  assert.equal(await page.getByRole('button',{name:'继续编辑',exact:true}).count(),0);
  assert.equal(await page.locator('[data-mock-host-toast]').count(),0);
  assert.equal(await page.evaluate(()=>window.__mock.state.requests.filter(x=>x==='image.save'||x==='recovery.save').length),0);
  // 成功后开始下一张，不能恢复刚完成的内容；后续分层 Escape 继续使用新文档。
  await page.evaluate(()=>{window.__mock.resume();window.__mock.capture();});await page.waitForFunction(()=>!window.screenshotPrepareUpdate().error&&!document.querySelector('button[aria-label="完成"]').disabled);
  assert.equal(await page.evaluate(()=>window.screenshotPrepareUpdate().document.editor.annotations.length),0);
  await click('矩形标注');await drawRect(page);await click('文字');await page.locator('#compact-text').focus();
  await page.keyboard.press('Escape');assert.equal(await page.locator('#compact-text').evaluate(node=>node===document.activeElement),false);assert.equal(await page.locator('.clay-card').count(),1);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.clay-card').count(),1);assert.equal(await page.evaluate(()=>window.__mock.state.hidden),false);
  await page.keyboard.press('Escape');await page.waitForSelector('.clay-card',{state:'detached'});
  await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__mock.state.hidden);await page.evaluate(()=>window.__mock.resume());
  if(await page.getByRole('button',{name:'更多操作',exact:true}).getAttribute('aria-expanded')!=='true')await click('更多操作');await click('重置工具位置');
  for(const width of [768,390]){await page.setViewportSize({width,height:800});await page.waitForTimeout(80);await page.screenshot({path:path.join(out,'responsive-'+width+'.png')});const boxes=await page.locator('.clay-rail,.clay-card').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));for(const box of boxes){assert.ok(box.x>=0&&box.y>=0&&box.right<=width+1&&box.bottom<=801,JSON.stringify(box));}}
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.clay-rail button').first().evaluate(node=>getComputedStyle(node).transitionDuration),'0s');
  // 注入复制/完成回复延迟，再载入新截图；旧回复不得收起或清空新的文档。
  for(const stage of ['copy','complete-reply']){
    const late=await context.newPage();late.on('pageerror',error=>errors.push(error.message));
    await late.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')||route.request().url().startsWith('data:')?route.continue():route.abort());
    await late.addInitScript(mockHost);await late.goto('http://127.0.0.1:'+server.address().port+'/index.html');
    await late.getByRole('button',{name:'打开图片',exact:true}).waitFor();await late.evaluate(()=>window.__mock.capture());
    await late.waitForFunction(()=>!window.screenshotPrepareUpdate().error&&!document.querySelector('button[aria-label="完成"]').disabled);
    const prior=await late.evaluate(()=>({id:window.screenshotPrepareUpdate().documentId,capture:window.__mock.state.captureId}));
    await late.evaluate(stage=>{if(stage==='copy')window.__mock.state.holdCopy=true;else window.__mock.state.holdCompleteReply=true;},stage);
    await late.getByRole('button',{name:'完成',exact:true}).click();
    await late.waitForFunction(stage=>typeof window.__mock.state[stage==='copy'?'releaseCopy':'releaseCompleteReply']==='function',stage);
    await late.evaluate(()=>{window.__mock.resume();window.__mock.capture();});
    await late.waitForFunction(prior=>window.__mock.state.captureId!==prior&&window.__mock.state.requests.filter(m=>m==='presentation.ready').length===2,prior.capture);
    await late.evaluate(stage=>{const state=window.__mock.state;if(stage==='copy'){state.holdCopy=false;state.releaseCopy();}else{state.holdCompleteReply=false;state.releaseCompleteReply();}},stage);
    await late.waitForFunction(()=>!window.screenshotPrepareUpdate().error&&!document.querySelector('button[aria-label="完成"]').disabled);
    const after=await late.evaluate(()=>({snapshot:window.screenshotPrepareUpdate(),hidden:window.__mock.state.hidden,completeCount:window.__mock.state.requests.filter(m=>m==='presentation.complete').length}));
    assert.notEqual(after.snapshot.documentId,prior.id);assert.ok(after.snapshot.document.image);assert.equal(after.hidden,false);
    assert.equal(after.completeCount,stage==='copy'?0:1);await late.close();
  }
  // DPR 仅验证合成页面渲染和坐标，不代表 Windows 的真实 100% / 150% DPI 验收。
  for(const dpr of [1,1.5]){
    const dpiContext=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:dpr,reducedMotion:'reduce'}),dpiPage=await dpiContext.newPage();
    dpiPage.on('pageerror',error=>errors.push(error.message));
    await dpiPage.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')||route.request().url().startsWith('data:')?route.continue():route.abort());
    await dpiPage.addInitScript(mockHost);await dpiPage.goto('http://127.0.0.1:'+server.address().port+'/index.html');
    await dpiPage.getByRole('button',{name:'打开图片',exact:true}).waitFor();await dpiPage.evaluate(()=>window.__mock.capture());
    await dpiPage.waitForFunction(()=>window.__mock.state.requests.includes('presentation.ready')&&!document.querySelector('button[aria-label="完成"]').disabled);
    for(const [surface,label]of [['raw',null],['beauty','美化'],['text','文字'],['more','更多操作']]){
      if(label)await dpiPage.getByRole('button',{name:label,exact:true}).click();
      await dpiPage.screenshot({path:path.join(out,'mock-dpr-'+dpr+'-'+surface+'.png')});
    }
    const beforeMove=await dpiPage.locator('.clay-capture-selection').boundingBox();
    await dpiPage.getByRole('group',{name:'截图选区',exact:true}).focus();await dpiPage.keyboard.press('ArrowRight');
    await dpiPage.waitForFunction(()=>Math.round(document.querySelector('.clay-capture-selection').getBoundingClientRect().x)===301);
    assert.equal(Math.round((await dpiPage.locator('.clay-capture-selection').boundingBox()).x-beforeMove.x),1);
    await dpiContext.close();
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({syntheticOnly:true,desktopAccess:false,checks:['entry animation starts only after host accepts layout','no separate move icon','body drag holds frame and toolbar while recrop is pending','annotation drag does not adjust capture','automatic entry with path card','physical selection move/resize/undo','Escape cancels adjustment first','blank click does not reselect','failed recrop preserves document','stale recrop cannot replace newer capture','synthetic DPR 1 and 1.5','shared annotation history','virtual pointer drag and keyboard adjustment','explicit OCR','text copy separation','visible text copy','panel scroll reset','autosave never requested after debounce','one completion action','clipboard error and false result stay open','rejected completion retains document','completion releases backdrop and clears document','no continuation toast or button','late clipboard and completion replies preserve a newer capture','four-level Escape','bounded responsive chrome','reduced motion'],screenshots:fs.readdirSync(out).filter(name=>name.endsWith('.png'))},null,2));
  console.log('PASS synthetic editor lifecycle and responsive checks');await browser.close();server.close();
}
main().catch(async error=>{console.error(error);if(activePage){console.error(await activePage.evaluate(()=>{const s=window.__mock?.state;return {requests:s?.requests.slice(-16),completion:s?.completion,copied:s?.copied,hidden:s?.hidden,notice:document.querySelector('[role=alert]')?.textContent,handles:Array.from(document.querySelectorAll('.clay-selection-handle')).map(e=>({class:e.className,disabled:e.disabled,box:e.getBoundingClientRect().toJSON()})),snapshot:window.screenshotPrepareUpdate?.()};}).then(value=>{if(value.snapshot?.document)value.snapshot.document='synthetic document omitted';return value;}).catch(()=>({})));}await activeBrowser?.close();server.close();process.exitCode=1;});


// 标注工具只待命；测试在独立无头 canvas 内拖出矩形，不模拟真实系统输入。
async function drawRect(page){
  await page.waitForFunction(()=>document.querySelector('[data-drawing-tool="rect"]'));
  const canvas=page.locator('.upper-canvas');await canvas.click({position:{x:80,y:60},trial:true});const box=await canvas.boundingBox();
  await page.mouse.move(box.x+box.width*.2,box.y+box.height*.2);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.6,{steps:4});await page.mouse.up();
  await page.waitForFunction(()=>!document.querySelector('[data-drawing-tool]'));
}
