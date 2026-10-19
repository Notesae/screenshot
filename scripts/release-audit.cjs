// 只审查已生成的便携目录及锁定依赖；不运行产品、不下载制品、不读取用户配置。
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),output=path.resolve(process.argv[2]||path.join(root,'artifacts/Screenshot-win-x64'));
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const safe=name=>name.replace(/[^a-z0-9._-]/gi,'_');
if(!fs.existsSync(path.join(output,'Screenshot.exe')))throw new Error('Portable package does not exist.');
const gaps=[],components=[],seen=new Set(),inventory=[];
function add(name,version,ecosystem,license,dir,extraFile){
  const ref=`${ecosystem}:${name}@${version}`;if(seen.has(ref))return;seen.add(ref);
  const files=fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>/^(licen[cs]e|copying|notice|thirdpartynotices)([._-].*)?$/i.test(n)&&fs.statSync(path.join(dir,n)).isFile()):[];
  if(extraFile){const file=path.resolve(dir,extraFile);if(file.startsWith(path.resolve(dir)+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())files.push(path.relative(dir,file));}
  const notices=[];
  for(const file of new Set(files)){
    const source=path.resolve(dir,file);if(!source.startsWith(path.resolve(dir)+path.sep)||fs.statSync(source).size>2*1024*1024)continue;
    const relative=path.join('dependency-licenses',ecosystem,safe(name+'-'+version),safe(file));
    const target=path.join(output,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);notices.push(relative.replaceAll('\\','/'));
  }
  // 已提交的上游许可归属适用于同一包族，记录为现有共享文本，避免误报为缺失。
  const shared=ecosystem==='nuget' ? name.startsWith('Microsoft.Data.Sqlite')?['Microsoft.Data.Sqlite-LICENSE.txt']:name.startsWith('OpenCvSharp4')?['OpenCvSharp-LICENSE.txt','OpenCV-LICENSE.txt']:name.startsWith('SQLitePCLRaw')?['SQLitePCLRaw-LICENSE.txt','SQLitePCLRaw-NOTICE.txt']:[]:[];
  if(ecosystem==='npm' && name==='saxes' && version==='6.0.0')shared.push('saxes-6.0.0-LICENSE.txt');
  for(const file of shared)if(fs.existsSync(path.join(output,'licenses',file)))notices.push('licenses/'+file);
  if(ecosystem==='npm') {
    const parent=name.startsWith('@esbuild/')?'esbuild':name.startsWith('@rollup/rollup-')?'rollup':null;
    if(parent){const parentDir=path.join(root,'editor/node_modules',parent);if(read(path.join(parentDir,'package.json')).version===version){const relative=path.join('dependency-licenses','npm',safe(name+'-'+version),'UPSTREAM-LICENSE.md');fs.mkdirSync(path.dirname(path.join(output,relative)),{recursive:true});fs.copyFileSync(path.join(parentDir,'LICENSE.md'),path.join(output,relative));notices.push(relative.replaceAll('\\\\','/'));}}
    if(name==='canvas') {
      const readme=path.join(dir,'Readme.md');if(fs.existsSync(readme)){const text=fs.readFileSync(readme,'utf8'),start=text.indexOf('## License');if(start>=0){const relative=path.join('dependency-licenses','npm',safe(name+'-'+version),'UPSTREAM-Readme-License.md');fs.mkdirSync(path.dirname(path.join(output,relative)),{recursive:true});fs.writeFileSync(path.join(output,relative),text.slice(start));notices.push(relative.replaceAll('\\\\','/'));}}
      const bmp=path.join(dir,'src/bmp/LICENSE.md');if(fs.existsSync(bmp)){const relative=path.join('dependency-licenses','npm',safe(name+'-'+version),'BMP-LICENSE.md');fs.copyFileSync(bmp,path.join(output,relative));notices.push(relative.replaceAll('\\\\','/'));}
    }
  }
  if(!license||!notices.length)gaps.push({name,version,ecosystem,missing:!license?'license metadata':'license/notice text'});
  components.push({type:'library','bom-ref':ref,name,version,purl:`pkg:${ecosystem}/${name.replace('@','%40')}@${version}`,...(license?{licenses:[{license:{name:license}}]}:{})});
  inventory.push({name,version,ecosystem,license:license||'NOASSERTION',notices});
}
const lock=read(path.join(root,'editor/package-lock.json'));
for(const [relative,entry]of Object.entries(lock.packages)){
  if(!relative)continue;const dir=path.join(root,'editor',relative),file=path.join(dir,'package.json');if(!fs.existsSync(file))continue;
  const p=read(file),license=typeof p.license==='string'?p.license:p.license?.type||entry.license;
  add(p.name,p.version,'npm',license,dir);
}
const assets=read(path.join(root,'artifacts/publish-build/obj/Screenshot.App/project.assets.json'));
for(const [id,library]of Object.entries(assets.libraries)){
  if(library.type!=='package')continue;const split=id.lastIndexOf('/'),name=id.slice(0,split),version=id.slice(split+1);
  const base=Object.keys(assets.packageFolders).map(folder=>path.join(folder,library.path)).find(dir=>fs.existsSync(dir));
  if(!base){gaps.push({name,version,ecosystem:'nuget',missing:'restored package'});continue;}
  const nuspec=fs.readdirSync(base).find(f=>f.endsWith('.nuspec')),xml=nuspec?fs.readFileSync(path.join(base,nuspec),'utf8'):'';
  const match=xml.match(/<license\s+type="(expression|file)"[^>]*>([^<]+)<\/license>/);
  const license=match?.[1]==='expression'?match[2]:xml.includes('<licenseUrl>')?'See package license URL':null;
  add(name,version,'nuget',license,base,match?.[1]==='file'?match[2]:null);
}
const manifest=read(path.join(output,'models/pp-ocrv5-mobile/manifest.json'));
for(const file of manifest.files){const target=path.join(output,'models/pp-ocrv5-mobile',file.name);if(hash(target)!==file.sha256)throw new Error('Model checksum failed: '+file.name);components.push({type:'file','bom-ref':'model:'+file.name,name:file.name,version:manifest.modelVersion,hashes:[{alg:'SHA-256',content:file.sha256}],licenses:[{license:{name:manifest.license}}]});}
const bom={bomFormat:'CycloneDX',specVersion:'1.6',serialNumber:'urn:uuid:'+crypto.randomUUID(),version:1,metadata:{timestamp:new Date().toISOString(),component:{type:'application',name:'Screenshot',version:'0.3.0'}},components};
fs.writeFileSync(path.join(output,'sbom.cdx.json'),JSON.stringify(bom,null,2)+'\n');
fs.writeFileSync(path.join(output,'dependency-inventory.json'),JSON.stringify({scope:'Installed locked npm development/runtime packages and restored NuGet dependency closure; includes build-only components conservatively.',packages:inventory,licenseReviewGaps:gaps},null,2)+'\n');
const required=['Screenshot.exe','Screenshot.runtimeconfig.json','web/index.html','THIRD-PARTY-NOTICES.md','models/pp-ocrv5-mobile/NOTICE.md','models/pp-ocrv5-mobile/LICENSE-PaddleOCR.txt','models/pp-ocrv5-mobile/LICENSE-RapidOCR.txt'];
for(const file of required)if(!fs.existsSync(path.join(output,file)))throw new Error('Missing release file: '+file);
const runtime=read(path.join(output,'Screenshot.runtimeconfig.json'));
const frameworks=runtime.runtimeOptions.includedFrameworks||[];
if(!frameworks.some(f=>f.name==='Microsoft.NETCore.App'&&f.version==='10.0.13')||!frameworks.some(f=>f.name==='Microsoft.WindowsDesktop.App'&&f.version==='10.0.13'))throw new Error('Pinned self-contained runtime mismatch.');
const files=[];function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const absolute=path.join(dir,entry.name);if(entry.isSymbolicLink())throw new Error('Package contains a link.');if(entry.isDirectory())walk(absolute);else files.push(absolute);}}walk(output);
for(const file of files)if(/^(providers\.json|\.env.*)$/i.test(path.basename(file))||/\.(pfx|p12|pem|screenshot\.json|png|jpe?g|webp)$/i.test(file))throw new Error('Unexpected private/configuration/image file in package.');
const sums=files.filter(f=>path.basename(f)!=='SHA256SUMS.txt').sort().map(f=>hash(f)+'  '+path.relative(output,f).replaceAll('\\','/')).join('\n')+'\n';
fs.writeFileSync(path.join(output,'SHA256SUMS.txt'),sums);
console.log(JSON.stringify({files:files.length,components:components.length,licenseReviewGaps:gaps,modelsVerified:manifest.files.length,runtime:'10.0.13',staticPackageCheck:'passed'},null,2));
