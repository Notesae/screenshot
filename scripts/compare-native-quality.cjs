// 采样前固定的配对门禁；完整协议见 docs/OCR-BENCHMARK-PROTOCOL.md。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const SCENARIOS=['small-text','large-text','large-png-decode-and-detection-preprocess'];
const PROTOCOL={version:2,blocks:12,warmupMinimum:8,warmupMaximum:16,warmupWindow:5,warmupSpread:1.10,maximumBlockMs:8000,regressionRatio:1.15,intervalConfidence:0.96142578125};
const median=values=>{const a=[...values].sort((x,y)=>x-y);return (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2;};
const stable=values=>values.length>=PROTOCOL.warmupMinimum&&Math.max(...values.slice(-5))/Math.min(...values.slice(-5))<=PROTOCOL.warmupSpread;
function comparePaired(report){
 assert.deepEqual(report.protocol,PROTOCOL,'Benchmark protocol changed');
 assert.ok(!report.failure,'Sampling failed');
 assert.equal(report.diagnosticSamples?.length??0,0,'Diagnostic data cannot enter acceptance');
 assert.equal(report.syntheticOnly,true);assert.equal(report.desktopAccess,false);
 assert.equal(report.workers.length,2);const workers=Object.fromEntries(report.workers.map(w=>[w.profile,w]));
 assert.ok(workers.vendor&&workers.source&&workers.vendor.pid!==workers.source.pid,'Workers must be isolated');
 assert.equal(report.workerExitCodes.length,2);
 for(const w of Object.values(workers))assert.ok(report.workerExitCodes.some(exit=>exit.pid===w.pid&&exit.code===0&&!exit.signal),'Worker did not exit cleanly');
 for(const w of Object.values(workers)){
  assert.equal(w.kind,'ready');assert.equal(w.protocol,2);assert.equal(w.tieredCompilation,'0');assert.ok(Number.isInteger(w.pid)&&w.pid>0);
  assert.match(w.nativeSha256,/^[a-f0-9]{64}$/);assert.ok(Number.isFinite(w.nativeBytes)&&w.nativeBytes>0);
  assert.ok(Number.isFinite(w.frequency)&&w.frequency>0);assert.equal(w.modelVersion,workers.vendor.modelVersion);
  assert.deepEqual(w.inputHashes,workers.vendor.inputHashes);
 }
 const info=workers.source.buildInfo;
 assert.deepEqual(info.match(/To be built:\s*([^\r\n]+)/)?.[1].trim().split(/\s+/).sort(),['core','imgcodecs','imgproc']);
 assert.ok(!/Intel IPP(?: IW)?:\s+(?!NO\b)/.test(info),'IPP remains enabled');assert.ok(!/OpenCL:\s+YES/.test(info));assert.ok(!/Trace:\s+YES/.test(info));
 let maxPolygonDelta=0,maxConfidenceDelta=0,maxTensorDelta=0,lastEnd=0;
 const references={};let nextScenario=0,lastPhase='warmup';
 for(const [index,s] of report.samples.entries()){
  assert.equal(s.id,index);assert.equal(s.sequence,index);assert.equal(s.kind,'measurement');assert.ok(SCENARIOS.includes(s.scenario));
  const w=workers[s.profile];assert.ok(w);assert.equal(s.pid,w.pid);assert.equal(s.frequency,w.frequency);
  assert.ok(Number.isSafeInteger(s.start)&&Number.isSafeInteger(s.end)&&s.end>s.start&&s.start>=lastEnd,'Overlapping or invalid monotonic times');lastEnd=s.end;
  assert.ok(Number.isFinite(s.milliseconds)&&s.milliseconds>0);assert.ok(Math.abs(s.milliseconds-(s.end-s.start)*1000/s.frequency)<0.005,'Timing mismatch');
  assert.ok(Number.isFinite(Date.parse(s.startedUtc)));assert.ok(['warmup','sample'].includes(s.phase));
  const scenarioIndex=SCENARIOS.indexOf(s.scenario);assert.ok(scenarioIndex===nextScenario||scenarioIndex===nextScenario+1,'Scenario order differs');
  if(scenarioIndex!==nextScenario){nextScenario=scenarioIndex;lastPhase='warmup';}
  assert.ok(!(lastPhase==='sample'&&s.phase==='warmup'),'Warmup after sampling');lastPhase=s.phase;
  const a=references[s.scenario]??=s.correctness,b=s.correctness;assert.equal(b.inputSha256,w.inputHashes[s.scenario]);assert.equal(b.inputSha256,a.inputSha256);
  if(s.scenario===SCENARIOS[2]){
   assert.equal(b.pixelSha256,a.pixelSha256);assert.match(b.pixelSha256,/^[a-f0-9]{64}$/);assert.equal(b.tensorSamples.length,a.tensorSamples.length);assert.ok(b.tensorSamples.length>0);
   b.tensorSamples.forEach((v,i)=>{assert.ok(Number.isFinite(v));maxTensorDelta=Math.max(maxTensorDelta,Math.abs(v-a.tensorSamples[i]));});
  }else{
   assert.ok(b.result.Text.includes('Hello')&&b.result.Text.includes('中文')&&b.result.Text.includes('123'));
   for(const key of ['Text','ModelVersion','Width','Height'])assert.equal(b.result[key],a.result[key]);
   assert.equal(b.result.Blocks.length,a.result.Blocks.length);assert.ok(b.result.Blocks.length>0);
   b.result.Blocks.forEach((y,j)=>{const x=a.result.Blocks[j];for(const key of ['Id','Text','Order'])assert.equal(y[key],x[key]);
    assert.ok(Number.isFinite(y.Confidence));maxConfidenceDelta=Math.max(maxConfidenceDelta,Math.abs(y.Confidence-x.Confidence));assert.equal(y.Polygon.length,x.Polygon.length);
    y.Polygon.forEach((p,k)=>{assert.ok(Number.isFinite(p.X)&&Number.isFinite(p.Y));maxPolygonDelta=Math.max(maxPolygonDelta,Math.abs(p.X-x.Polygon[k].X),Math.abs(p.Y-x.Polygon[k].Y));});
   });
  }
 }
 assert.ok(maxPolygonDelta<=0.25,'Source OCR geometry regressed');assert.ok(maxConfidenceDelta<=0.001,'Source confidence changed materially');assert.ok(maxTensorDelta<=0.000001,'Preprocessing samples differ');
 const scenarios=SCENARIOS.map(name=>{
  for(const profile of ['vendor','source']){
   const warmup=report.samples.filter(s=>s.scenario===name&&s.profile===profile&&s.phase==='warmup');
   assert.ok(warmup.length>=PROTOCOL.warmupMinimum&&warmup.length<=PROTOCOL.warmupMaximum&&stable(warmup.map(s=>s.milliseconds)),'Unstable or incomplete warmup');
  }
  const samples=report.samples.filter(s=>s.scenario===name&&s.phase==='sample');assert.equal(samples.length,PROTOCOL.blocks*4,'Missing or extra paired samples');
  const blocks=[];
  for(let block=0;block<PROTOCOL.blocks;block++){
   const rows=samples.slice(block*4,block*4+4),order=block%2?['source','vendor','vendor','source']:['vendor','source','source','vendor'];
   rows.forEach((s,slot)=>{assert.equal(s.block,block);assert.equal(s.slot,slot);assert.equal(s.profile,order[slot],'ABBA/BAAB order differs');});
   const spanMs=(rows[3].end-rows[0].start)*1000/rows[0].frequency;assert.ok(spanMs<=PROTOCOL.maximumBlockMs,'Paired block exceeds time limit');
   const meanLog=profile=>rows.filter(s=>s.profile===profile).reduce((sum,s)=>sum+Math.log(s.milliseconds),0)/2;
   blocks.push({block,ratio:Math.exp(meanLog('source')-meanLog('vendor')),spanMs});
  }
  const ratios=blocks.map(b=>b.ratio),sorted=[...ratios].sort((a,b)=>a-b),ratio=median(ratios),lower=sorted[2],upper=sorted[9];
  const status=ratio>PROTOCOL.regressionRatio?'regression':upper>PROTOCOL.regressionRatio?'inconclusive':'pass';
  return {name,vendorMedianMs:median(samples.filter(s=>s.profile==='vendor').map(s=>s.milliseconds)),sourceMedianMs:median(samples.filter(s=>s.profile==='source').map(s=>s.milliseconds)),
   ratio,medianInterval:{lower,upper,confidence:PROTOCOL.intervalConfidence},status,blocks};
 });
 return {schemaVersion:2,syntheticOnly:true,desktopAccess:false,protocol:PROTOCOL,correctness:{sameInputs:true,sameText:true,sameBlockIds:true,sameDecodedPixels:true,maxPolygonDelta,maxConfidenceDelta,maxTensorDelta},scenarios,
  performanceReviewRequired:scenarios.some(s=>s.status!=='pass'),nativeBytes:{vendor:workers.vendor.nativeBytes,source:workers.source.nativeBytes},
  scope:'Persistent isolated workers; complete warmup and ABBA/BAAB time series; fixed paired median and exact median interval. Observations on this machine, not a general performance guarantee.'};
}
module.exports={comparePaired,PROTOCOL,SCENARIOS,stable};
if(require.main===module){
 const output=path.resolve(process.argv[2]||'artifacts/qa/native-rebuild');
 try{const report=JSON.parse(fs.readFileSync(path.join(output,'paired-timeseries.json'),'utf8')),result=comparePaired(report);
  fs.writeFileSync(path.join(output,'comparison.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
  if(result.performanceReviewRequired){console.error('Paired OCR performance regressed or is inconclusive at the unchanged 15% gate.');process.exitCode=1;}
 }catch(error){fs.writeFileSync(path.join(output,'comparison.json'),JSON.stringify({schemaVersion:2,accepted:false,invalid:true,error:error.message},null,2)+'\n');console.error('Invalid paired benchmark: '+error.message);process.exitCode=1;}
}
