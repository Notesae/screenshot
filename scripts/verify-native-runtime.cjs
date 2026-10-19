// Static verification only; never load a DLL or silently fall back to a vendor runtime.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function verify(output,checkRecipe=true,binaryRoot=output){
 output=path.resolve(output);const manifest=read(path.join(output,'native-build.json'));
 assert.equal(manifest.kind,'source-built-opencvsharp');assert.equal(manifest.platform,'windows-x64');
 assert.equal(manifest.sourceLockSha256,hash(path.join(root,'native/sources.lock.json')),'Source lock differs');
 if(checkRecipe)for(const [key,name]of Object.entries({build:'scripts/build-native.ps1',wrapper:'native/CMakeLists.txt',audit:'scripts/native-build-manifest.cjs'}))assert.equal(manifest.recipeSha256[key],hash(path.join(root,name)),'Build recipe differs: '+name);
 assert.deepEqual(manifest.modules,['core','imgproc','imgcodecs']);
 for(const file of manifest.files){const base=file.file==='OpenCvSharpExtern.dll'?path.resolve(binaryRoot):output;const p=path.resolve(base,file.file);assert.ok(p.startsWith(base+path.sep),'Artifact path escapes root');assert.ok(fs.statSync(p).isFile()&&!fs.lstatSync(p).isSymbolicLink());assert.equal(hash(p),file.sha256,'Native artifact checksum failed: '+file.file);}
 assert.equal(hash(path.join(binaryRoot,'OpenCvSharpExtern.dll')),manifest.binary.sha256);
 assert.equal(manifest.components.length,4);for(const component of manifest.components)assert.equal(hash(path.join(output,component.noticeFile)),component.noticeSha256);
 return manifest;
}
module.exports={verify};
if(require.main===module){const manifest=verify(process.argv[2]||path.join(root,'artifacts/native-runtime/win-x64'));console.log(JSON.stringify({verified:true,binary:manifest.binary,modules:manifest.modules,components:manifest.components.map(c=>c.name)},null,2));}
