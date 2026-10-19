// 只解析PE文件与已还原依赖；不加载DLL，不枚举桌面，不安装运行时。
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function walk(dir){const files=[];for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isSymbolicLink())throw new Error('Refuse linked package path');if(e.isDirectory())files.push(...walk(p));else files.push(p);}return files;}
function imports(file){
 const b=fs.readFileSync(file),pe=b.readUInt32LE(0x3c);if(pe+24>b.length||b.toString('binary',pe,pe+4)!=='PE\0\0')throw new Error('Invalid PE '+path.basename(file));
 const optional=pe+24,magic=b.readUInt16LE(optional),directory=optional+(magic===0x20b?112:96),sectionCount=b.readUInt16LE(pe+6),sections=optional+b.readUInt16LE(pe+20);if(![0x10b,0x20b].includes(magic)||sectionCount>128)throw new Error('Unsupported PE format');
 const rvaToOffset=rva=>{for(let i=0;i<sectionCount;i++){const s=sections+i*40,va=b.readUInt32LE(s+12),length=Math.max(b.readUInt32LE(s+8),b.readUInt32LE(s+16));if(rva>=va&&rva<va+length){const o=b.readUInt32LE(s+20)+rva-va;if(o<b.length)return o;}}throw new Error('PE RVA outside sections');};
 const nameAt=rva=>{const start=rvaToOffset(rva),end=b.indexOf(0,start);if(end<start||end-start>256)throw new Error('Invalid PE import name');const name=b.toString('ascii',start,end).toLowerCase();if(!/^[a-z0-9_.-]+\.dll$/i.test(name))throw new Error('Unsafe PE import name');return name;};
 const result=[];for(const [index,size,kind]of [[1,20,'direct'],[13,32,'delay']]){
  const table=b.readUInt32LE(directory+index*8);if(!table)continue;const start=rvaToOffset(table);
  for(let i=0;i<4096;i++){const o=start+i*size;if(o+size>b.length)throw new Error('Truncated import table');if(b.subarray(o,o+size).every(v=>v===0))break;
   let rva=b.readUInt32LE(o+(kind==='direct'?12:4));if(kind==='delay'&&!(b.readUInt32LE(o)&1))rva-=magic===0x20b?Number(b.readBigUInt64LE(optional+24)):b.readUInt32LE(optional+28);
   result.push({name:nameAt(rva),kind});
  }
 }return result;
}
function inventory(output,assets){
 const binaries=walk(output).filter(p=>/\.(dll|exe)$/i.test(p)),wanted=new Set(binaries.map(p=>path.basename(p).toLowerCase())),sources=new Map(),hashes=new Map();
 const hash=p=>{if(!hashes.has(p))hashes.set(p,digest(p));return hashes.get(p);};
 function source(file,owner){const name=path.basename(file).toLowerCase();if(!wanted.has(name)||!fs.existsSync(file))return;const key=name+':'+hash(file);if(!sources.has(key))sources.set(key,[]);sources.get(key).push(owner);}
 for(const [id,library]of Object.entries(assets.libraries))if(library.type==='package'){
  const base=Object.keys(assets.packageFolders).map(folder=>path.join(folder,library.path)).find(p=>fs.existsSync(p));if(!base)continue;
  for(const relative of library.files||[])if(/\.(dll|exe)$/i.test(relative))source(path.join(base,relative),{package:id,relative});
 }
 for(const [name,version]of [['Microsoft.NETCore.App.Runtime.win-x64','10.0.13'],['Microsoft.WindowsDesktop.App.Runtime.win-x64','10.0.13'],['Microsoft.Windows.SDK.NET.Ref','10.0.19041.57']]){
  const base=Object.keys(assets.packageFolders).map(folder=>path.join(folder,name.toLowerCase(),version)).find(p=>fs.existsSync(p));if(base)for(const p of walk(base))if(/\.(dll|exe)$/i.test(p))source(p,{package:name+'/'+version,relative:path.relative(base,p).replaceAll('\\','/')});
 }
 const osNames=new Set('kernel32 user32 gdi32 gdi32full advapi32 ole32 oleaut32 shell32 shlwapi shcore comdlg32 comctl32 ntdll msvcrt ucrtbase ws2_32 winmm winspool drv dnsapi crypt32 bcrypt bcryptprimitives version wintrust normaliz iphlpapi secur32 sspicli setupapi cfgmgr32 imm32 rpcrt4 propsys dwmapi d3d9 d3d11 d3d12 dxgi dxguid d2d1 dwrite dcomp uxtheme windowscodecs winhttp wininet psapi powrprof wtsapi32 userenv dhcpcsvc ncrypt netapi32 hid winusb xmllite mscoree wldap32 authz imagehlp dbghelp cabinet d3dcompiler_47 msimg32 avrt nsi pdh mpr mswsock win32u'.split(' ').map(n=>n+'.dll'));
 const project=new Set(['screenshot.exe','screenshot.dll','screenshot.ai.dll','screenshot.ocr.dll','screenshot.storage.dll']);
 const records=binaries.map(file=>{const name=path.basename(file).toLowerCase();return {file:path.relative(output,file).replaceAll('\\','/'),sha256:hash(file),owners:project.has(name)?[{project:'Screenshot'}]:(sources.get(name+':'+hash(file))||[]),imports:imports(file).map(i=>({...i,resolution:wanted.has(i.name)?'package':/^((api|ext)-ms-)/.test(i.name)?'windows-api-set':osNames.has(i.name)?'windows-system':/^(msvcp|vcruntime|concrt)[0-9]/.test(i.name)?'visual-cpp-runtime':/^(mf|evr|ksuser|strmiids|quartz|avicap)/.test(i.name)?'windows-media-feature':'external-review'}))};});
 const requirements=[...new Map(records.flatMap(r=>r.imports.filter(i=>['visual-cpp-runtime','windows-media-feature','external-review'].includes(i.resolution)).map(i=>[i.name+':'+i.kind,{...i,presentInSystem32:process.platform==='win32'&&fs.existsSync(path.join(process.env.SystemRoot||'C:\\Windows','System32',i.name))}]))).values()];
 return {schemaVersion:1,staticOnly:true,dllsLoaded:false,binaries:records,unownedBinaries:records.filter(r=>!r.owners.length).map(r=>r.file),externalRequirements:requirements,limitations:'PE import metadata alone does not prove runtime loading or enumerate statically embedded components; embedded provenance is recorded separately. API sets are virtual Windows contracts.'};
}
module.exports={inventory,imports};
if(require.main===module){if(!process.argv[2]||!process.argv[3])throw new Error('Use native-audit.cjs PACKAGE REPORT');const root=path.resolve(__dirname,'..'),result=inventory(path.resolve(process.argv[2]),JSON.parse(fs.readFileSync(path.join(root,'artifacts/publish-build/obj/Screenshot.App/project.assets.json'),'utf8')));fs.mkdirSync(path.dirname(path.resolve(process.argv[3])),{recursive:true});fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({binaries:result.binaries.length,unowned:result.unownedBinaries,externalRequirements:result.externalRequirements},null,2));}
