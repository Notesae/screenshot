// 只读校验应用条款、原始许可与启动门禁；不启动产品或生成用户同意记录。
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
function audit(root){
 const manifest=read(path.join(root,'legal/terms-manifest.json')),docs=new Map();assert.equal(manifest.schemaVersion,1);
 for(const d of manifest.documents){
  assert.ok(!path.isAbsolute(d.file)&&!d.file.includes('\\')&&!d.file.split('/').some(s=>['','..','.'].includes(s)));assert.ok(!docs.has(d.file));
  const b=fs.readFileSync(path.join(root,d.file));assert.equal(hash(b),d.sha256,d.file);docs.set(d.file,d.sha256);
 }
 for(const name of ['legal/TERMS.zh-CN.txt','legal/COPYRIGHT.txt','THIRD-PARTY-NOTICES.md','licenses/Windows-SDK-LICENSE.rtf','licenses/Windows-SDK-REDIST.md','licenses/Windows-SDK-NOTICE.zh-CN.txt','licenses/CsWinRT-LICENSE.txt','licenses/cswinrt-license-sources.json'])assert.ok(docs.has(name),name);
 for(const folder of ['licenses','dependency-licenses','native-provenance/licenses','models/pp-ocrv5-mobile']){
  const walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);assert.ok(!e.isSymbolicLink());if(e.isDirectory())walk(p);else{
   if(folder.startsWith('models')&&!/^(LICENSE|NOTICE)/i.test(e.name))continue;
   if(!/\.(txt|md|rtf)$/i.test(e.name)&&!/^(LICENSE|NOTICE|COPYING)$/i.test(e.name))continue;
   const relative=path.relative(root,p).replaceAll('\\','/');if(!docs.has(relative))docs.set(relative,hash(fs.readFileSync(p)));
  }}};
  if(fs.existsSync(path.join(root,folder)))walk(path.join(root,folder));
 }
 const identity=manifest.version+'\n'+[...docs].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([p,h])=>p+'\0'+h).join('\n');
 const cs=read(path.join(root,'licenses/cswinrt-license-sources.json'));
 assert.equal(hash(fs.readFileSync(path.join(root,'licenses',cs.licenseFile))),cs.licenseSha256);
 if(fs.existsSync(path.join(root,'WinRT.Runtime.dll')))assert.equal(hash(fs.readFileSync(path.join(root,'WinRT.Runtime.dll'))),cs.binary.sha256);
 for(const source of read(path.join(root,'licenses/windows-sdk-license-sources.json')).sources)assert.equal(hash(fs.readFileSync(path.join(root,'licenses',source.file))),source.sha256);
 return {version:manifest.version,digest:hash(Buffer.from(identity,'utf8')),documents:docs.size,coreDocuments:manifest.documents.length,cswinrtBinarySha256:cs.binary.sha256,legalReviewComplete:false};
}
function sourceAudit(root){
 const app=fs.readFileSync(path.join(root,'src/Screenshot.App/App.xaml.cs'),'utf8'),xaml=fs.readFileSync(path.join(root,'src/Screenshot.App/App.xaml'),'utf8'),main=fs.readFileSync(path.join(root,'src/Screenshot.App/MainWindow.xaml.cs'),'utf8'),dialog=fs.readFileSync(path.join(root,'src/Screenshot.App/TermsWindow.xaml'),'utf8');
 assert.ok(!xaml.includes('StartupUri'));
 assert.ok(app.indexOf('ShowDialog() != true')<app.indexOf('startup.Start('));
 assert.ok(app.includes('Shutdown(); return;'));
 assert.ok(main.includes('private MainWindow(TermsStartup terms)')&&main.includes('terms.RequireAccepted(); return new MainWindow(terms)'));
 assert.ok(dialog.includes('IsEnabled="False"')&&!dialog.includes('IsChecked="True"')&&dialog.includes('IsCancel="True"'));
 return {automaticStartupDisabled:true,hostAfterGate:true,uncheckedDefault:true,declineAndCloseExit:true,syntheticOnly:true};
}
module.exports={audit,sourceAudit};
if(require.main===module){const root=path.resolve(__dirname,'..');console.log(JSON.stringify({agreement:audit(root),startup:sourceAudit(root)},null,2));}
