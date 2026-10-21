// 仅使用无头浏览器、合成 PNG 与内存桥；不访问桌面、原生对话框或系统剪贴板。
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.SCREENSHOT_PLAYWRIGHT_MODULE||process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'editor/dist'),out=path.join(root,'artifacts/qa/redesign');
fs.mkdirSync(out,{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{const file=path.resolve(dist,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(dist+path.sep)){res.writeHead(403).end();return;}const target=fs.existsSync(file)&&fs.statSync(file).isDirectory()?path.join(file,'index.html'):file;if(!fs.existsSync(target)){res.writeHead(404).end();return;}res.setHeader('Content-Type',mime[path.extname(target)]||'application/octet-stream');fs.createReadStream(target).pipe(res);});
function mockHost(){
  const listeners=new Set(),state={copied:0,saved:0,ocr:0,translate:0,checkpoints:0,failCheckpoint:false,cancelSave:false,hidden:false,backdrop:false,clipboardText:'',captureId:null,errors:[]};
  const emit=data=>listeners.forEach(listener=>listener({data}));
  function image(name='合成截图.png') {const canvas=document.createElement('canvas');canvas.width=560;canvas.height=300;const ctx=canvas.getContext('2d');ctx.fillStyle='#f1f3f7';ctx.fillRect(0,0,560,300);ctx.fillStyle='#243044';ctx.font='24px sans-serif';ctx.fillText('合成截图 · 原位编辑',32,60);ctx.font='16px sans-serif';ctx.fillText('此图由测试生成，没有读取桌面。',32,102);for(let i=0;i<4;i++){ctx.fillStyle=i%2?'#dae3ee':'#c5d2e3';ctx.fillRect(32,140+i*28,460-i*40,12);}return {dataUrl:canvas.toDataURL(),name,width:560,height:300};}
  const sample=image();
  async function checkpoint(reason,expected){
    const snapshot=window.screenshotPrepareLeave(reason);
    try{if(snapshot.error)throw Error(snapshot.error);if(expected&&(snapshot.documentId!==expected.documentId||snapshot.revision!==expected.revision))return false;if(state.failCheckpoint)throw Error('模拟恢复库写入失败，已保留当前编辑');state.checkpoints++;state.snapshot=snapshot;return true;}finally{window.screenshotFinishLeave();}
  }
  function resume(){state.hidden=false;document.querySelector('[data-mock-host-toast]')?.remove();document.querySelector('[data-editor-root]')?.style.removeProperty('visibility');emit({event:'presentation.changed',payload:{presentation:'workbench',reason:'user_editor'}});emit({event:'editor.action',payload:{action:'continue'}});}
  function toast(text){
    const layer=document.createElement('div');layer.dataset.mockHostToast='true';layer.setAttribute('role','status');layer.style.cssText='position:fixed;bottom:38px;left:50%;transform:translateX(-50%);padding:18px 22px;border-radius:26px;background:linear-gradient(#4a4642,#2a2724);box-shadow:0 20px 40px #0008,inset 0 3px 4px #ffffff29;color:#f5f5f7;font:13px Segoe UI,sans-serif;display:flex;align-items:center;gap:22px';
    const label=document.createElement('span');label.textContent=text+' · 模拟宿主提示';const button=document.createElement('button');button.textContent='继续编辑';button.style.cssText='border:0;border-radius:14px;background:#2563eb;color:white;padding:12px 16px;cursor:pointer';button.onclick=resume;layer.append(label,button);document.body.append(layer);
  }
  state.requests=[];
  Object.assign(window.chrome||=( {}),{webview:{addEventListener:(_name,listener)=>listeners.add(listener),removeEventListener:(_name,listener)=>listeners.delete(listener),postMessage:async request=>{
    state.requests.push(request.method);
    let result={};try{
      switch(request.method){
        case 'app.updateReady': result={ready:true};break;
        case 'settings.read':case 'settings.configure':result={providers:[{id:'synthetic',name:'模拟服务',revision:'synthetic-revision',kind:'openai-compatible',baseUrl:'https://provider.invalid',model:'synthetic',hasApiKey:true}],defaultProviderId:'synthetic'};break;
        case 'capture.settings':result={backend:'wgc'};break;
        case 'ocr.status':result={available:true,modelVersion:'synthetic-only',message:'合成模型状态',missingFiles:[]};break;
        case 'document.preserve':await checkpoint('replace');result={saved:true};break;
        case 'image.open':case 'image.paste':await checkpoint('replace');result=sample;break;
        case 'image.copy':state.copied++;result={copied:true};break;
        case 'image.save':state.saved++;result={saved:!state.cancelSave};break;
        case 'text.copy':state.clipboardText=request.payload.text;result={copied:true};break;
        case 'project.save':result={saved:true};break;
        case 'recovery.save':result={saved:true,stale:false};break;
        case 'recovery.list':result={items:[]};break;
        case 'recovery.usage':result={documents:0,referencedAssetBytes:0,maxDocuments:100,maxAssetBytes:100000};break;
        case 'presentation.ready':result={accepted:request.payload.captureId===state.captureId,presentation:'overlay',captureId:state.captureId};break;
        case 'presentation.editor':state.backdrop=false;state.captureId=null;result={accepted:true,presentation:'workbench'};break;
        case 'presentation.dismiss':await checkpoint('close');state.hidden=true;state.backdrop=false;state.captureId=null;result={accepted:true,presentation:'hidden'};break;
        case 'presentation.complete':{
          state.completion={documentId:request.payload.documentId,revision:request.payload.revision,captureId:request.payload.captureId,actualCaptureId:state.captureId};
          const scope=request.payload.captureId??null;
          if(scope!==state.captureId||!await checkpoint('complete',request.payload)){result={accepted:false};break;}
          state.hidden=true;state.backdrop=false;state.captureId=null;result={accepted:true,presentation:'hidden'};
          setTimeout(()=>{document.querySelector('[data-editor-root]').style.visibility='hidden';toast(request.payload.text);},50);break;
        }
        case 'ocr.local':state.ocr++;result={modelVersion:'synthetic-only',imageWidth:560,imageHeight:300,blocks:[{id:'block-1',text:'合成校对文字',confidence:.99,order:0,polygon:[{x:20,y:20},{x:220,y:20},{x:220,y:50},{x:20,y:50}]}],text:'合成校对文字'};break;
        case 'ai.translate':state.translate++;result={text:'Synthetic corrected text'};break;
        case 'ai.cancel':result={cancelled:true};break;
        default:throw Error('Unexpected mock request: '+request.method);
      }
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
  await click('打开图片');await page.waitForFunction(()=>!document.querySelector('button[aria-label="保存 PNG"]').disabled);
  assert.equal(await page.getByText('完整工作台',{exact:true}).count(),0);
  await page.evaluate(()=>window.__mock.capture());await page.waitForSelector('.is-overlay');
  await page.screenshot({path:path.join(out,'01-raw.png')});
  await click('矩形标注');await page.waitForFunction(()=>window.screenshotPrepareUpdate().document.editor.annotations.length===1);
  const original=await page.evaluate(()=>window.screenshotPrepareUpdate().document.editor.annotations[0].id);
  await click('美化');await click('柔和留白');await page.waitForFunction(()=>!document.querySelector('button[aria-label="保存 PNG"]').disabled);
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
  await page.evaluate(()=>window.__mock.state.failCheckpoint=true);await click('复制 PNG');await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>window.__mock.state.hidden),false);
  await page.evaluate(()=>{window.__mock.state.failCheckpoint=false;window.__mock.state.cancelSave=true;});await click('保存 PNG');await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.__mock.state.hidden),false);
  await page.evaluate(()=>window.__mock.state.cancelSave=false);await click('复制 PNG');await page.waitForSelector('[data-mock-host-toast]');assert.equal(await page.evaluate(()=>window.__mock.state.backdrop),false);
  await page.screenshot({path:path.join(out,'06-mock-toast.png')});const id=await page.evaluate(()=>window.__mock.state.snapshot.documentId);
  await click('继续编辑');await page.waitForSelector('.is-neutral');assert.equal(await page.evaluate(()=>window.screenshotPrepareUpdate().documentId),id);assert.equal(await page.evaluate(()=>window.screenshotPrepareUpdate().document.editor.annotations[0].id),original);
  await click('矩形标注');await click('文字');await page.locator('#compact-text').focus();
  await page.keyboard.press('Escape');assert.equal(await page.locator('#compact-text').evaluate(node=>node===document.activeElement),false);assert.equal(await page.locator('.clay-card').count(),1);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.clay-card').count(),1);assert.equal(await page.evaluate(()=>window.__mock.state.hidden),false);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.clay-card').count(),0);
  await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__mock.state.hidden);await page.evaluate(()=>window.__mock.resume());
  if(await page.getByRole('button',{name:'更多操作',exact:true}).getAttribute('aria-expanded')!=='true')await click('更多操作');await click('重置工具位置');
  for(const width of [768,390]){await page.setViewportSize({width,height:800});await page.waitForTimeout(80);await page.screenshot({path:path.join(out,'responsive-'+width+'.png')});const boxes=await page.locator('.clay-rail,.clay-card').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));for(const box of boxes){assert.ok(box.x>=0&&box.y>=0&&box.right<=width+1&&box.bottom<=801,JSON.stringify(box));}}
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.clay-rail button').first().evaluate(node=>getComputedStyle(node).transitionDuration),'0s');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({syntheticOnly:true,desktopAccess:false,checks:['shared annotation history','virtual pointer drag and keyboard adjustment','explicit OCR','text copy separation','visible text copy','panel scroll reset','failed checkpoint stays open','cancelled save stays open','completion releases backdrop','resume preserves document','four-level Escape','bounded responsive chrome','reduced motion'],screenshots:fs.readdirSync(out).filter(name=>name.endsWith('.png'))},null,2));
  console.log('PASS synthetic editor lifecycle and responsive checks');await browser.close();server.close();
}
main().catch(async error=>{console.error(error);if(activePage){console.error(await activePage.evaluate(()=>{const s=window.__mock?.state;return {requests:s?.requests.slice(-16),completion:s?.completion,copied:s?.copied,hidden:s?.hidden,notice:document.querySelector('[role=alert]')?.textContent,snapshot:window.screenshotPrepareUpdate?.()};}).then(value=>{if(value.snapshot?.document)value.snapshot.document='synthetic document omitted';return value;}).catch(()=>({})));}await activeBrowser?.close();server.close();process.exitCode=1;});
