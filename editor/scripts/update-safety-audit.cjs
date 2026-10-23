const ui=require('./test-ui.cjs');
// 新建无头浏览器和内存宿主；不连接桌面应用、不访问系统剪贴板、不执行更新进程。
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {installMock}=require('./mock-host.cjs');
const dist=path.resolve(__dirname,'../dist'),checks=[];
const server=http.createServer((req,res)=>{const file=path.resolve(dist,'.'+(req.url==='/'?'/index.html':req.url));if(!file.startsWith(dist+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(data);});});
(async()=>{
  let browser;
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
    browser=await chromium.launch({...(process.env.SCREENSHOT_CHROMIUM_EXECUTABLE?{executablePath:process.env.SCREENSHOT_CHROMIUM_EXECUTABLE}:{channel:'msedge'}),headless:true,args:['--disable-background-networking']});
    const page=await browser.newPage();await installMock(page);await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await page.goto(origin);await page.waitForFunction(()=>typeof window.screenshotPrepareUpdate==='function'&&window.__messages.some(m=>m.method==='app.updateReady'));
    checks.push('React mount reports update health through the local bridge');
    await page.evaluate(()=>{const c=document.createElement('canvas');c.width=80;c.height=60;window.__emit({event:'image.loaded',payload:{dataUrl:c.toDataURL(),name:'合成.png',width:80,height:60}});});await page.waitForFunction(()=>!document.querySelector('button[aria-label="完成"]').disabled);await ui.inspect(page,'提取文字');await page.locator('#compact-text').fill('更新前尚未手动保存的合成项目');
    await page.evaluate(()=>window.__holdMethod='settings.configure');await ui.inspect(page,'更多操作');await page.getByRole('button',{name:'设置',exact:true}).click();
    await page.waitForFunction(()=>window.__heldMethods.some(m=>m.method==='settings.configure'));
    const snapshot=await page.evaluate(()=>window.screenshotPrepareUpdate());assert.equal(snapshot.error,undefined);assert.equal(snapshot.document.editor.text,'更新前尚未手动保存的合成项目');assert.ok(snapshot.revision>0);assert.ok(snapshot.documentId);
    checks.push('An open settings request permits an exact current unsaved snapshot');
    const result={passed:true,checks};const output=path.resolve(process.argv[2]||'artifacts/update-headless.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
