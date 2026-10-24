// 只压缩随包构建证据；原始字节摘要、来源、许可与运行库校验全部保留。
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..');
if(!process.argv[2])throw new Error('请指定当前工作区内的 app 打包目录。');
const output=path.resolve(process.argv[2]);
if(!output.startsWith(root+path.sep)||!fs.existsSync(path.join(output,'Screenshot.exe')))throw new Error('不是当前工作区的 Screenshot 打包目录。');
function plain(file){
  for(let current=file;current!==root;current=path.dirname(current))if(fs.lstatSync(current).isSymbolicLink())throw new Error('打包路径不能包含链接。');
}
plain(output);
const provenance=path.join(output,'native-provenance'),native=require('./verify-native-runtime.cjs');
let before=0,after=0,count=0;
if(fs.existsSync(provenance)){
  const manifest=native.verify(provenance,true,output);
  for(const file of manifest.files.filter(file=>file.file.startsWith('evidence/'))){
    const target=path.resolve(provenance,file.file),archive=target+'.gz';
    if(!target.startsWith(provenance+path.sep))throw new Error('证据文件越界。');
    if(!fs.existsSync(target))continue;
    plain(target);
    const original=native.readArtifact(provenance,file),compressed=zlib.gzipSync(original,{level:9});
    if(fs.existsSync(archive)){
      plain(archive);
      const restored=zlib.gunzipSync(fs.readFileSync(archive),{maxOutputLength:Math.max(1,file.bytes)});
      if(!restored.equals(original))throw new Error('已有压缩证据与原始内容不符。');
    }else fs.writeFileSync(archive,compressed,{flag:'wx'});
    // 压缩文件也必须核对恢复后的原始摘要，成功后才删除随包明文副本。
    const restored=zlib.gunzipSync(fs.readFileSync(archive),{maxOutputLength:Math.max(1,file.bytes)});
    if(!restored.equals(original))throw new Error('证据压缩内容不一致。');
    fs.unlinkSync(target);before+=original.length;after+=fs.statSync(archive).size;count++;
  }
  // 旧清单描述原始证据；新清单覆盖实际发行文件，native-build.json 继续绑定原始摘要。
  const files=[];
  function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const file=path.join(directory,entry.name);plain(file);
    if(entry.isDirectory())walk(file);else if(file!==path.join(provenance,'SHA256SUMS.txt'))files.push(file);
  }}
  walk(provenance);
  const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  fs.writeFileSync(path.join(provenance,'SHA256SUMS.txt'),files.sort().map(file=>digest(file)+'  '+path.relative(provenance,file).replaceAll('\\','/')).join('\n')+'\n');
  native.verify(provenance,true,output);
}
let symbolBytes=0;
for(const name of ['Screenshot.pdb','Screenshot.AI.pdb','Screenshot.Ocr.pdb','Screenshot.Storage.pdb']){
  const file=path.join(output,name);if(!fs.existsSync(file))continue;plain(file);symbolBytes+=fs.statSync(file).size;fs.unlinkSync(file);
}
console.log(JSON.stringify({compressedEvidenceFiles:count,evidenceBeforeBytes:before,evidenceAfterBytes:after,separateSymbolBytes:symbolBytes}));
