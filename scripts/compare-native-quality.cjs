// Compare all paired observations; exact inputs/text/IDs/pixels prevent speed-only acceptance.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=path.resolve(process.argv[2]||'artifacts/qa/native-rebuild'),rounds=Number(process.argv[3]||3);
const read=n=>JSON.parse(fs.readFileSync(path.join(output,n),'utf8'));
const median=v=>{const a=[...v].sort((x,y)=>x-y);return a[Math.floor(a.length/2)];};
const all={vendor:[],source:[]};for(let i=1;i<=rounds;i++)for(const name of ['vendor','source'])all[name].push(read(name+'-'+i+'.json'));
let maxPolygonDelta=0,maxConfidenceDelta=0,maxTensorDelta=0;
const reference=all.vendor[0];
for(const report of [...all.vendor,...all.source]){
 assert.equal(report.syntheticOnly,true);assert.equal(report.desktopAccess,false);
 for(let i=0;i<reference.cases.length;i++){
  const a=reference.cases[i],b=report.cases[i];assert.equal(b.inputSha256,a.inputSha256);assert.equal(b.result.Text,a.result.Text);assert.equal(b.result.Blocks.length,a.result.Blocks.length);
  for(let j=0;j<a.result.Blocks.length;j++){
   const x=a.result.Blocks[j],y=b.result.Blocks[j];assert.equal(y.Id,x.Id);assert.equal(y.Text,x.Text);assert.equal(y.Order,x.Order);
   maxConfidenceDelta=Math.max(maxConfidenceDelta,Math.abs((y.Confidence??0)-(x.Confidence??0)));
   for(let k=0;k<x.Polygon.length;k++)maxPolygonDelta=Math.max(maxPolygonDelta,Math.abs(x.Polygon[k].X-y.Polygon[k].X),Math.abs(x.Polygon[k].Y-y.Polygon[k].Y));
  }
 }
 assert.equal(report.largePng.inputSha256,reference.largePng.inputSha256);assert.equal(report.largePng.pixelSha256,reference.largePng.pixelSha256);
 assert.equal(report.largePng.tensorSamples.length,reference.largePng.tensorSamples.length);
 for(let i=0;i<report.largePng.tensorSamples.length;i++)maxTensorDelta=Math.max(maxTensorDelta,Math.abs(report.largePng.tensorSamples[i]-reference.largePng.tensorSamples[i]));
}
assert.ok(maxPolygonDelta<=0.25,'Source OCR geometry regressed');assert.ok(maxConfidenceDelta<=0.001,'Source confidence changed materially');assert.ok(maxTensorDelta<=0.000001,'Preprocessing samples differ');
for(const report of all.source){
 const modules=report.buildInfo.match(/To be built:\s*([^\r\n]+)/)?.[1].trim().split(/\s+/).sort();assert.deepEqual(modules,['core','imgcodecs','imgproc']);
 assert.ok(!/Intel IPP(?: IW)?:\s+(?!NO\b)/.test(report.buildInfo),'IPP remains enabled');assert.ok(!/OpenCL:\s+YES/.test(report.buildInfo));assert.ok(!/Trace:\s+YES/.test(report.buildInfo));
}
const scenarios=reference.cases.map((c,i)=>({name:c.kind,vendorMedianMs:median(all.vendor.flatMap(r=>r.cases[i].milliseconds)),sourceMedianMs:median(all.source.flatMap(r=>r.cases[i].milliseconds))}));
scenarios.push({name:'large-png-decode-and-detection-preprocess',vendorMedianMs:median(all.vendor.flatMap(r=>r.largePng.milliseconds)),sourceMedianMs:median(all.source.flatMap(r=>r.largePng.milliseconds))});
for(const scenario of scenarios)scenario.ratio=scenario.sourceMedianMs/scenario.vendorMedianMs;
const result={schemaVersion:1,syntheticOnly:true,rounds,samplesPerScenario:rounds*reference.samplesPerCase,correctness:{sameInputs:true,sameText:true,sameBlockIds:true,sameDecodedPixels:true,maxPolygonDelta,maxConfidenceDelta,maxTensorDelta},scenarios,nativeBytes:{vendor:reference.nativeBytes,source:all.source[0].nativeBytes},sampledPrivatePeakBytes:{vendor:Math.max(...all.vendor.map(r=>r.memory.sampledPeakPrivateBytes)),source:Math.max(...all.source.map(r=>r.memory.sampledPeakPrivateBytes))},performanceReviewRequired:scenarios.some(s=>s.ratio>1.15),scope:'Paired isolated processes, alternating order, fixed synthetic inputs/CPU models and same driver. Five samples per process; timing is an observation on this machine, not a general performance guarantee.'};
fs.writeFileSync(path.join(output,'comparison.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
if(result.performanceReviewRequired){console.error('Source native runtime exceeds 15% median regression threshold; investigate before acceptance.');process.exitCode=1;}
