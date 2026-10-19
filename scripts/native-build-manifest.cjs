// Audits build evidence without loading any DLL; source archives and toolchain remain explicit.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),output=path.resolve(process.argv[2]||'artifacts/native-runtime/win-x64');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const lockFile=path.join(root,'native/sources.lock.json'),lock=read(lockFile),evidence=path.join(output,'evidence');
const directories=read(path.join(evidence,'source-directories.json'));
const cache=fs.readFileSync(path.join(evidence,'opencv-CMakeCache.txt'),'utf8');
for(const name of ['CV_TRACE','WITH_FLATBUFFERS','WITH_OBSENSOR','WITH_IPP','WITH_ITT','WITH_OPENCL','WITH_JPEG','WITH_TIFF','WITH_WEBP','WITH_OPENEXR','WITH_OPENJPEG','WITH_PROTOBUF'])assert.ok(new RegExp('^'+name+':BOOL=OFF$','m').test(cache),name+' must remain disabled');
assert.match(cache,/^BUILD_LIST:STRING=core,imgproc,imgcodecs$/m);
const map=fs.readFileSync(path.join(evidence,'OpenCvSharpExtern.map'),'utf8');
const linkLog=fs.readFileSync(path.join(evidence,'wrapper-build.log'),'utf8');
const libraryObjects={};
for(const line of map.split(/\r?\n/)){
 if(!/^\s+[0-9a-f]{4}:[0-9a-f]{8,}\s+/i.test(line))continue;
 const match=line.match(/\s([A-Za-z0-9_.-]+):([^\s:]+)\s*$/);if(!match)continue;
 const name=(match[1].toLowerCase().endsWith('.lib')?match[1]:match[1]+'.lib').toLowerCase();
 (libraryObjects[name]??=new Set()).add(match[2]);
}
const libraryNames=Object.keys(libraryObjects).sort();
assert.ok(map.length>1000,'Link map missing');
for(const prefix of ['opencv_core','opencv_imgproc','opencv_imgcodecs','zlibstatic','libpng16_static'])assert.ok(libraryNames.some(n=>n.startsWith(prefix)),prefix+' absent from resolved library evidence');
assert.ok(!libraryNames.some(n=>/^(ipp|ittnotify|tesseract|lept|libprotobuf|libwebp|tiff|jpeg|openjp|ilmimf)/i.test(n)),'Unexpected third-party library');
const licenseDirectory=path.join(output,'licenses');fs.mkdirSync(licenseDirectory,{recursive:true});
const components=lock.sources.map(source=>{
 const original=path.join(directories[source.name],source.licenseFile),relative='licenses/'+source.name+'-'+source.version+'-LICENSE.txt';fs.copyFileSync(original,path.join(output,relative));
 return {name:source.name,version:source.version,repository:source.repository,commit:source.commit,sourceArchiveSha256:source.sha256,license:source.license,noticeFile:relative,noticeSha256:hash(original)};
});
const cvCopyright=path.join(directories.opencv,'COPYRIGHT');fs.copyFileSync(cvCopyright,path.join(licenseDirectory,'opencv-COPYRIGHT.txt'));components.find(c=>c.name==='opencv').copyrightFile='licenses/opencv-COPYRIGHT.txt';
// Preserve complete license-bearing comment blocks from conservative source subtrees,
// including OpenCV's bundled SoftFloat/fdlibm and legacy BSD notices, not just root LICENSE.
const noticeBlocks=new Map();
function collectNotices(directory,sourceRoot){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
 const file=path.join(directory,entry.name);if(entry.isDirectory()){collectNotices(file,sourceRoot);continue;}
 if(!/\.(?:c|cpp|h|hpp|inl)$/.test(entry.name))continue;
 const text=fs.readFileSync(file,'utf8');
 for(const match of text.matchAll(/\/\*[\s\S]*?\*\/|(?:^[ \t]*\/\/[^\r\n]*(?:\r?\n|$))+/gm)){
  const block=match[0];if(!/copyright|licen[cs]e|redistribution|permission to/i.test(block))continue;
  const key=crypto.createHash('sha256').update(block).digest('hex');
  const record=noticeBlocks.get(key)||{text:block,files:[]};record.files.push(path.relative(sourceRoot,file).replaceAll('\\','/'));noticeBlocks.set(key,record);
 }
}}
for(const module of ['core','imgproc','imgcodecs'])for(const sub of ['src','include'])collectNotices(path.join(directories.opencv,'modules',module,sub),directories.opencv);
collectNotices(path.join(directories.opencvsharp,'src/OpenCvSharpExtern'),directories.opencvsharp);
const sourceNoticeFile='licenses/opencv-binding-source-notices.txt';
fs.writeFileSync(path.join(output,sourceNoticeFile),'Conservative source-subtree notice collection; unmodified complete comment blocks.\nIncludes optional/unlinked code notices; does not replace root licenses.\n\n'+[...noticeBlocks.values()].map(n=>'Source files: '+n.files.join(', ')+'\n'+n.text).join('\n\n'));
components.find(c=>c.name==='opencv').bundledSourceNotices=sourceNoticeFile;
fs.copyFileSync(lockFile,path.join(output,'sources.lock.json'));
const files=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isSymbolicLink())throw new Error('Linked build artifact');if(e.isDirectory())walk(p);else if(!['native-build.json','SHA256SUMS.txt'].includes(e.name))files.push({file:path.relative(output,p).replaceAll('\\','/'),sha256:hash(p),bytes:fs.statSync(p).size});}}walk(output);
const dll=files.find(f=>f.file==='OpenCvSharpExtern.dll');assert.ok(dll,'Native DLL missing');
const manifest={schemaVersion:1,kind:'source-built-opencvsharp',platform:'windows-x64',sourceLockSha256:hash(lockFile),recipeSha256:{build:hash(path.join(root,'scripts/build-native.ps1')),wrapper:hash(path.join(root,'native/CMakeLists.txt')),audit:hash(__filename)},components,modules:lock.modules,disabled:lock.disabled,linkedLibraryEvidence:libraryNames,linkedObjectEvidence:Object.fromEntries(Object.entries(libraryObjects).map(([name,objects])=>[name,[...objects].sort()])),toolchain:read(path.join(evidence,'toolchain.json')),binary:dll,files,limitations:'Traceable source inputs and build/link evidence. Different MSVC/SDK versions may produce different DLL hashes; bit-identical reproducibility is not claimed. Windows/MSVC platform libraries follow their own terms; no redistributable runtime installer is bundled.'};
fs.writeFileSync(path.join(output,'native-build.json'),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(output,'SHA256SUMS.txt'),[...files,{file:'native-build.json',sha256:hash(path.join(output,'native-build.json'))}].sort((a,b)=>a.file.localeCompare(b.file)).map(f=>f.sha256+'  '+f.file).join('\n')+'\n');
console.log(JSON.stringify({binary:dll,components:components.map(c=>({name:c.name,version:c.version,license:c.license})),modules:lock.modules,linkedLibraryEvidence:libraryNames,sourceLockSha256:manifest.sourceLockSha256},null,2));
