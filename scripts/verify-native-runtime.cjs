// Static verification only; never load a DLL or silently fall back to a vendor runtime.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
// 发行包可保留 gzip 证据；摘要始终对解压后的原始字节验证，不接受省略证据。
function readArtifact(base,file){
 const target=path.resolve(base,file.file);assert.ok(target.startsWith(base+path.sep),'Artifact path escapes root');
 assert.ok(Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=64*1024*1024,'Native artifact size invalid');
 const compressed=!fs.existsSync(target)&&file.file.startsWith('evidence/'),physical=compressed?target+'.gz':target;
 assert.ok(fs.statSync(physical).isFile()&&!fs.lstatSync(physical).isSymbolicLink(),'Native artifact missing or linked');
 const bytes=compressed?require('node:zlib').gunzipSync(fs.readFileSync(physical),{maxOutputLength:Math.max(1,file.bytes)}):fs.readFileSync(physical);
 assert.equal(bytes.length,file.bytes,'Native artifact length differs: '+file.file);
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),file.sha256,'Native artifact checksum failed: '+file.file);
 return bytes;
}
function verify(output,checkRecipe=true,binaryRoot=output){
 output=path.resolve(output);const manifest=read(path.join(output,'native-build.json'));
 assert.equal(manifest.kind,'source-built-opencvsharp');assert.equal(manifest.platform,'windows-x64');
 assert.equal(manifest.sourceLockSha256,hash(path.join(root,'native/sources.lock.json')),'Source lock differs');
 if(checkRecipe)for(const [key,name]of Object.entries({build:'scripts/build-native.ps1',wrapper:'native/CMakeLists.txt',audit:'scripts/native-build-manifest.cjs'}))assert.equal(manifest.recipeSha256[key],hash(path.join(root,name)),'Build recipe differs: '+name);
 assert.deepEqual(manifest.modules,['core','imgproc','imgcodecs']);
 for(const file of manifest.files)readArtifact(file.file==='OpenCvSharpExtern.dll'?path.resolve(binaryRoot):output,file);
 assert.equal(hash(path.join(binaryRoot,'OpenCvSharpExtern.dll')),manifest.binary.sha256);
 assert.equal(manifest.components.length,4);for(const component of manifest.components)assert.equal(hash(path.join(output,component.noticeFile)),component.noticeSha256);
 return manifest;
}
module.exports={verify,readArtifact};
if(require.main===module){const manifest=verify(process.argv[2]||path.join(root,'artifacts/native-runtime/win-x64'));console.log(JSON.stringify({verified:true,binary:manifest.binary,modules:manifest.modules,components:manifest.components.map(c=>c.name)},null,2));}
