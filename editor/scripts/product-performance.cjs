const ui=require('./test-ui.cjs');
// 独立无头 Edge、合成 4K 图、内存桥接。计时包含浏览器帧等待，不代表真实桌面帧率。
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {installMock}=require('./mock-host.cjs');
const dist=path.resolve(process.env.SCREENSHOT_BENCH_DIST||path.resolve(__dirname,'../dist'));
const output=path.resolve(process.argv[2]||'artifacts/qa/product-performance.json');
const server=http.createServer((req,res)=>{const file=path.resolve(dist,'.'+(req.url==='/'?'/index.html':req.url));if(!file.startsWith(dist+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(e,b)=>{if(e){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(b);});});
const summary=values=>({samples:values.length,medianMs:[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)],maxMs:Math.max(...values),valuesMs:values});
let browser;
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({...(process.env.SCREENSHOT_CHROMIUM_EXECUTABLE?{executablePath:process.env.SCREENSHOT_CHROMIUM_EXECUTABLE}:{channel:'msedge'}),headless:true,args:['--disable-background-networking','--disable-gpu']});
 const p=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
 p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());await installMock(p);await p.goto(origin);
 await p.getByRole('button',{name:'打开图片',exact:true}).waitFor();
 await p.evaluate(()=>{const c=document.createElement('canvas');c.width=3840;c.height=2160;const g=c.getContext('2d');g.fillStyle='#fcfbf7';g.fillRect(0,0,c.width,c.height);g.fillStyle='#ac432e';g.fillRect(80,80,1200,120);const dataUrl=c.toDataURL();window.__performanceImage=dataUrl;window.__imageAssignments=0;const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');Object.defineProperty(HTMLImageElement.prototype,'src',{...descriptor,set(value){if(value===window.__performanceImage)window.__imageAssignments++;descriptor.set.call(this,value);}});window.__emit({event:'image.loaded',payload:{dataUrl,name:'synthetic-4k.png',width:3840,height:2160}});});
 await p.waitForFunction(()=>document.querySelector('.lower-canvas')?.width===3840);await p.waitForFunction(()=>!document.querySelector('button[aria-label="完成"]').disabled);
 await ui.click(p,'矩形标注');await drawRect(p);
 // 只修改原样模式中不可见的校对文本；观察解码次数与选择状态，而非只看总耗时。
 await ui.inspect(p,'提取文字');await p.evaluate(()=>window.__imageAssignments=0);const edits=[];
 for(let i=0;i<12;i++){
  const started=await p.evaluate(()=>performance.now());await p.locator('#compact-text').fill('合成校对文本 '+i+'，原样画布不需要重绘。');
  await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
  await p.waitForFunction(()=>!document.querySelector('button[aria-label="完成"]').disabled);edits.push(await p.evaluate(()=>performance.now())-started);
 }
 const imageAssignments=await p.evaluate(()=>window.__imageAssignments);
 await p.keyboard.press('Escape');await p.keyboard.press('Delete');await ui.inspect(p,'更多操作');await p.getByRole('button',{name:'保存项目',exact:true}).click();await p.waitForFunction(()=>window.__messages.some(m=>m.method==='project.save'));
 await p.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='保存项目')?.disabled);
 const selectedObjectSurvivesTextEdit=await p.evaluate(()=>window.__messages.filter(m=>m.method==='project.save').at(-1).payload.document.editor.annotations.length===0);
 // 面板开启动画：验证只动画 opacity/transform，并验证减弱动效偏好。
 await p.evaluate(()=>{const image={dataUrl:window.__performanceImage,name:'synthetic-4k.png',width:3840,height:2160};window.__emit({event:'image.loaded',payload:{image,overlay:{captureId:'perf',desktopBounds:{x:0,y:0,width:4096,height:2304},selection:{x:50,y:60,width:3840,height:2160},screens:[{bounds:{x:0,y:0,width:4096,height:2304},primary:true}]}}});});
 await p.waitForFunction(()=>window.__messages.some(m=>m.method==='presentation.ready'));
 await ui.click(p,'美化图片');await p.locator('.clay-card').waitFor();
 // 检查实际 JS 弹簧写入的材质/内容属性，不能用空的 CSS keyframes 冒充通过。
 const motion=await p.locator('.clay-card').evaluate(e=>{const skin=e.querySelector('.liquid-panel-body'),content=e.querySelector('.liquid-panel-content');return {kind:'shared-spring',skinProperties:[...skin.style],contentProperties:[...content.style],contentTransform:getComputedStyle(content).transform};});
 await p.emulateMedia({reducedMotion:'reduce'});const reducedDuration=await p.locator('.clay-card').evaluate(e=>getComputedStyle(e).animationDuration);
 await p.waitForFunction(()=>document.querySelector('.liquid-panel-body')?.style.opacity==='1');
 assert.deepEqual(errors,[]);if(process.argv.includes('--verify')){assert.equal(imageAssignments,0);assert.equal(selectedObjectSurvivesTextEdit,true);assert.ok(parseFloat(reducedDuration)<=.001);assert.ok(motion.skinProperties.includes('transform')&&motion.skinProperties.includes('opacity'));assert.ok(motion.skinProperties.every(key=>['opacity','transform','transform-origin','border-radius','will-change'].includes(key)),'material changes only opacity and transform');assert.ok(motion.contentProperties.every(key=>['opacity'].includes(key)));assert.equal(motion.contentTransform,'none','panel text is never scaled');}
 const report={syntheticOnly:true,headless:true,nativeCalls:false,externalRequests:false,browser:browser.version(),distPath:dist,rawInvisibleTextEdits:{...summary(edits),imageAssignments,selectedObjectSurvivesTextEdit},motion:{...motion,reducedDuration},errors,limits:'12 sequential edits; timings include automation and three requestAnimationFrame waits. Software headless browser, no desktop/GPU/IME frame-rate claim. Assignment count measures repeated source-image decoding requests, not physical disk I/O.'};
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(r=>server.close(r));});


// 标注工具只待命；测试在独立无头 canvas 内拖出矩形，不模拟真实系统输入。
async function drawRect(page){
  await page.waitForFunction(()=>document.querySelector('[data-drawing-tool="rect"]'));
  const canvas=page.locator('.upper-canvas');await canvas.click({position:{x:80,y:60},trial:true});const box=await canvas.boundingBox();
  await page.mouse.move(box.x+box.width*.2,box.y+box.height*.2);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.6,{steps:4});await page.mouse.up();
  await page.waitForFunction(()=>window.screenshotPrepareUpdate().document.editor.annotations.length>0);await page.keyboard.press('Escape');
}
