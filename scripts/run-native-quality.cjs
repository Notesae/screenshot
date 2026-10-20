const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline'),{spawn}=require('node:child_process');
const {PROTOCOL,SCENARIOS,stable}=require('./compare-native-quality.cjs');
const {collectAfterFailure}=require('./native-warmup-diagnostic.cjs');
// 诊断证实 16 次可能截断过渡；只增加有界预算，原稳定条件和全部原始记录仍保留。
async function warmupWorkers(measure,clock=()=>performance.now()){
 const values={vendor:[],source:[]},start=clock();
 for(let round=0;round<PROTOCOL.warmupMaximum;round++){
  if(clock()-start>=PROTOCOL.warmupMaximumMs)return false;
  for(const profile of round%2?['source','vendor']:['vendor','source'])values[profile].push(await measure(profile,round));
  if(clock()-start<=PROTOCOL.warmupMaximumMs&&stable(values.vendor)&&stable(values.source))return true;
 }
 return false;
}
// 控制器只串行发请求；每次原始响应立即落盘，失败也保留已获得的数据。
async function run(){
 const [runner,models,vendor,vendorHash,source,sourceHash,output]=process.argv.slice(2);if(!output)throw new Error('Missing paired benchmark paths');
 const directory=path.resolve(output);fs.mkdirSync(directory,{recursive:true});
 if(['paired-timeseries.json','paired-timeseries.ndjson'].some(file=>fs.existsSync(path.join(directory,file))))throw new Error('Refuse to overwrite benchmark evidence');
 const report={schemaVersion:2,syntheticOnly:true,desktopAccess:false,protocol:PROTOCOL,workers:[],samples:[],diagnosticSamples:[]};
 const children=[];let id=0;
 const persist=value=>fs.appendFileSync(path.join(directory,'paired-timeseries.ndjson'),JSON.stringify(value)+'\n');
 async function create(profile,library,hash){
  const child=spawn('dotnet',[runner,'--native-quality-worker',models,library,hash,profile],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,DOTNET_TieredCompilation:'0'}});
  const rows=readline.createInterface({input:child.stdout,crlfDelay:Infinity})[Symbol.asyncIterator]();let stderr='';child.stderr.on('data',data=>{stderr=(stderr+data).slice(-16000);});
  const startup=new Promise((_,reject)=>child.once('error',reject));
  child.stdin.on('error',error=>{stderr=(stderr+error.message).slice(-16000);});
  const next=async()=>{let timer;try{return await Promise.race([rows.next().then(row=>{if(row.done)throw new Error(profile+' exited before reply: '+stderr);return JSON.parse(row.value);}),startup,
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(profile+' reply timeout')),45000);timer.unref();})]);}finally{clearTimeout(timer);}};
  const worker={child,next,rows};children.push(worker);const ready=await next();if(ready.kind!=='ready'||ready.profile!==profile||ready.nativeSha256!==hash)throw new Error('Worker identity mismatch');
  worker.ready=ready;report.workers.push(ready);persist(ready);return worker;
 }
 try{
  const workers={vendor:await create('vendor',vendor,vendorHash),source:await create('source',source,sourceHash)};
  async function measure(profile,scenario,phase,block,slot,diagnostic=false){
   const worker=workers[profile],request={id:id++,operation:phase,scenario};worker.child.stdin.write(JSON.stringify(request)+'\n');const sample=await worker.next();
   if(sample.id!==request.id||sample.profile!==profile||sample.scenario!==scenario||sample.phase!==phase||sample.pid!==worker.ready.pid)throw new Error('Measurement reply mismatch');
   const row={...sample,sequence:report.samples.length+report.diagnosticSamples.length,block,slot,diagnostic};
   (diagnostic?report.diagnosticSamples:report.samples).push(row);persist(row);return sample.milliseconds;
  }
  for(const scenario of SCENARIOS){
   const warmed=await warmupWorkers((profile,round)=>measure(profile,scenario,'warmup',-1,round));
   if(!warmed)await collectAfterFailure(report,measure,scenario);
   for(let block=0;block<PROTOCOL.blocks;block++){
    const order=block%2?['source','vendor','vendor','source']:['vendor','source','source','vendor'];
    for(let slot=0;slot<order.length;slot++)await measure(order[slot],scenario,'sample',block,slot);
   }
   console.log('Collected paired OCR scenario: '+scenario);
  }
 }catch(error){if(report.failure&&report.failure!==error.message)report.diagnosticError=error.message;report.failure??=error.message;throw error;}
 finally{
  report.workerExitCodes=[];
  for(const {child,rows} of children){
   if(child.exitCode===null){child.stdin.end(JSON.stringify({operation:'exit'})+'\n');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);}
   if(child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}
   report.workerExitCodes.push({pid:child.pid,code:child.exitCode,signal:child.signalCode});await rows.return?.();
  }
  if(report.workerExitCodes.some(exit=>exit.code!==0))report.failure??='Worker did not exit cleanly';
  fs.writeFileSync(path.join(directory,'paired-timeseries.json'),JSON.stringify(report,null,2)+'\n');
  if(report.failure)throw new Error(report.failure);
 }
}
module.exports={warmupWorkers};
if(require.main===module)run().catch(error=>{console.error('FAIL paired native benchmark: '+error.message);process.exitCode=1;});
