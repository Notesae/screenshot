const {PROTOCOL}=require('./compare-native-quality.cjs');
const DIAGNOSTIC={version:1,extraRounds:64,maximumMs:30000,tailSamples:20,centralDriftRatio:1.05,relativeMadLimit:.05,canAccept:false};
const median=a=>{const v=[...a].sort((x,y)=>x-y);return (v[Math.floor((v.length-1)/2)]+v[Math.floor(v.length/2)])/2;};
const spread=a=>Math.max(...a)/Math.min(...a);

// 此摘要只解释失败；不能放宽预热、恢复正式采样或把诊断尾部改判为通过。
function analyzeWarmup(report){
 const scenario=report.failedScenario??'small-text',all=[...report.samples,...(report.diagnosticSamples??[])].filter(s=>s.scenario===scenario&&s.phase==='warmup');
 const profiles={};
 for(const profile of ['vendor','source']){
  const rows=all.filter(s=>s.profile===profile),values=rows.map(s=>s.milliseconds);
  if(values.some(v=>!Number.isFinite(v)||v<=0))throw new Error('Invalid diagnostic durations');
  const tail=values.slice(-DIAGNOSTIC.tailSamples),centre=tail.length?median(tail):null;
  const before=tail.slice(0,Math.floor(tail.length/2)),after=tail.slice(Math.floor(tail.length/2));
  const drift=before.length?Math.max(median(before)/median(after),median(after)/median(before)):null;
  const cpu=rows.filter(s=>Number.isFinite(s.processCpuMilliseconds)).map(s=>s.processCpuMilliseconds/s.milliseconds);
  profiles[profile]={count:values.length,first:values[0]??null,last:values.at(-1)??null,tailMedian:centre,tailSpread:tail.length?spread(tail):null,
   tailCentralDriftRatio:drift,tailRelativeMad:centre?median(tail.map(v=>Math.abs(v-centre)))/centre:null,
   cpuWallRatioMedian:cpu.length?median(cpu):null,gcObservedMeasurements:rows.filter(s=>s.gcCollections?.some(n=>n>0)).length};
 }
 const windows=[];const a=all.filter(s=>s.profile==='vendor'),b=all.filter(s=>s.profile==='source');
 for(let count=PROTOCOL.warmupMinimum;count<=Math.min(a.length,b.length);count++){
  const v=spread(a.slice(count-5,count).map(s=>s.milliseconds)),s=spread(b.slice(count-5,count).map(s=>s.milliseconds));
  windows.push({after:count,vendorSpread:v,sourceSpread:s,meetsOriginalCondition:v<=PROTOCOL.warmupSpread&&s<=PROTOCOL.warmupSpread});
 }
 let classification='insufficient-long-trace';
 if(Object.values(profiles).every(p=>p.count>=DIAGNOSTIC.tailSamples)){
  if(Object.values(profiles).every(p=>p.tailSpread<=PROTOCOL.warmupSpread))classification='stable-tail-observed-after-failure';
  else if(Object.values(profiles).some(p=>p.tailCentralDriftRatio>DIAGNOSTIC.centralDriftRatio))classification='central-level-still-changing';
  else if(Object.values(profiles).every(p=>p.tailRelativeMad<=DIAGNOSTIC.relativeMadLimit))classification='central-level-steady-with-scatter';
  else classification='continuing-dispersion';
 }
 return {schemaVersion:1,accepted:false,performanceConclusion:'inconclusive',classification,scenario,diagnosticProtocol:DIAGNOSTIC,profiles,windows,
  scope:'Descriptive failure analysis only. CPU time is process-wide and coarse; GC associations do not establish the cause of wall-clock variation.'};
}

async function collectAfterFailure(report,measure,scenario,clock=()=>performance.now()){
 report.failure??='Warmup remained unstable: '+scenario;report.failedScenario=scenario;report.diagnosticProtocol=DIAGNOSTIC;report.diagnosticSamples??=[];
 const start=clock();let rounds=0;
 // 失败决定先落定；即使后来稳定，也固定收集剩余数据，绝不恢复验收。
 for(;rounds<DIAGNOSTIC.extraRounds;rounds++){
  if(clock()-start>=DIAGNOSTIC.maximumMs)break;
  for(const profile of rounds%2?['source','vendor']:['vendor','source'])await measure(profile,scenario,'warmup',-2,rounds,true);
 }
 report.diagnosticRounds=rounds;report.diagnosticAnalysis=analyzeWarmup(report);
 throw new Error(report.failure);
}
module.exports={DIAGNOSTIC,analyzeWarmup,collectAfterFailure};
if(require.main===module){
 const fs=require('node:fs'),path=require('node:path'),root=path.resolve(process.argv[2]);
 const summary=analyzeWarmup(JSON.parse(fs.readFileSync(path.join(root,'paired-timeseries.json'),'utf8')));
 fs.writeFileSync(path.join(root,'warmup-analysis.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
}
