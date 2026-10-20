const assert=require('node:assert/strict');
const {comparePaired,PROTOCOL,SCENARIOS}=require('./compare-native-quality.cjs');
const hash='a'.repeat(64);let checks=0;
function fixture(ratio=1,drift=false,speed=()=>1){
 const workers=['vendor','source'].map((profile,i)=>({kind:'ready',protocol:2,profile,pid:101+i,nativeSha256:hash,nativeBytes:100,frequency:1000000,
  modelVersion:'fixed-test',tieredCompilation:'0',inputHashes:Object.fromEntries(SCENARIOS.map(n=>[n,hash])),buildInfo:'To be built: core imgcodecs imgproc\nIntel IPP: NO\nOpenCL: NO\nTrace: NO'}));
 const samples=[];let tick=100000;
 function sample(profile,scenario,phase,block,slot,milliseconds){
  const id=samples.length,start=tick,end=start+Math.round(milliseconds*1000);tick=end+1000;
  const correctness=scenario===SCENARIOS[2]?{inputSha256:hash,pixelSha256:hash,tensorSamples:[0.2,0.4]}:
   {inputSha256:hash,result:{Text:'Hello 中文 123',ModelVersion:'fixed-test',Width:900,Height:260,Blocks:[{Id:'block',Text:'Hello 中文 123',Order:0,Confidence:.9,Polygon:[{X:0,Y:0},{X:10,Y:10}]}]}};
  samples.push({kind:'measurement',id,sequence:id,profile,pid:profile==='vendor'?101:102,scenario,phase,block,slot,start,end,frequency:1000000,milliseconds:(end-start)/1000,startedUtc:'2026-10-20T00:00:00Z',correctness});
 }
 for(const scenario of SCENARIOS){
  for(let i=0;i<8;i++)for(const p of ['vendor','source'])sample(p,scenario,'warmup',-1,i,100);
  for(let block=0;block<12;block++){
   const order=block%2?['source','vendor','vendor','source']:['vendor','source','source','vendor'];
   for(let slot=0;slot<4;slot++){
    const factor=typeof ratio==='function'?ratio(block):ratio;
    sample(order[slot],scenario,'sample',block,slot,100*speed((block*4+slot)/48)*(drift?Math.exp((block*4+slot)*.01):1)*(order[slot]==='source'?factor:1));
   }
  }
 }
 return {schemaVersion:2,syntheticOnly:true,desktopAccess:false,protocol:{...PROTOCOL},workers,samples,workerExitCodes:workers.map(w=>({pid:w.pid,code:0,signal:null}))};
}
function check(label,test){test();checks++;console.log('PASS '+label);}
function rejects(label,mutate){check(label,()=>{const r=fixture();mutate(r);assert.throws(()=>comparePaired(r));});}
check('constant-speed exact agreement passes',()=>assert.equal(comparePaired(fixture()).performanceReviewRequired,false));
check('log-linear time drift cancels within ABBA/BAAB blocks',()=>{for(const s of comparePaired(fixture(1,true)).scenarios)assert.ok(Math.abs(s.ratio-1)<.00002);});
check('real 30% regression still fails while drifting',()=>{for(const s of comparePaired(fixture(1.3,true)).scenarios)assert.equal(s.status,'regression');});
check('interval crossing unchanged 15% gate is inconclusive',()=>{for(const s of comparePaired(fixture(i=>i<9?1.1:1.3)).scenarios)assert.equal(s.status,'inconclusive');});
check('no hidden relaxation just below/above threshold',()=>{assert.equal(comparePaired(fixture(1.149)).performanceReviewRequired,false);assert.equal(comparePaired(fixture(1.151)).performanceReviewRequired,true);});
check('same machine-speed steps falsely fail old grouping but pass short pairing',()=>{
 const speed=t=>[1,1,1.3,1,1.3,1.3][Math.min(5,Math.floor(t*6))],old={vendor:[],source:[]},order=['vendor','source','source','vendor','vendor','source'];
 for(let i=0;i<30;i++)old[order[Math.floor(i/5)]].push(100*speed(i/30));
 const median=a=>[...a].sort((a,b)=>a-b)[7];assert.equal(median(old.source)/median(old.vendor),1.3);
 assert.equal(comparePaired(fixture(1,false,speed)).performanceReviewRequired,false);
 assert.equal(comparePaired(fixture(1.3,false,speed)).performanceReviewRequired,true);
});
rejects('missing sample is invalid',r=>r.samples.splice(20,1));
rejects('modified protocol is invalid',r=>r.protocol.regressionRatio=1.3);
rejects('overlapping process timestamps are invalid',r=>r.samples[20].start=r.samples[19].start);
rejects('zero duration is invalid',r=>r.samples[20].milliseconds=0);
rejects('mismatched duration and clock are invalid',r=>r.samples[20].milliseconds=123);
rejects('same process cannot represent both native libraries',r=>r.workers[1].pid=r.workers[0].pid);
rejects('wrong ABBA order is invalid',r=>{r.samples[16].profile='source';r.samples[16].pid=102;});
rejects('unbounded paired span is invalid',r=>{for(let i=17;i<r.samples.length;i++){r.samples[i].start+=10000000;r.samples[i].end+=10000000;}});
rejects('insufficient stable warmup is invalid',r=>{r.samples[7].milliseconds=115;r.samples[7].end=r.samples[7].start+115000;for(let i=8;i<r.samples.length;i++){r.samples[i].start+=15000;r.samples[i].end+=15000;}});
rejects('different input is rejected',r=>r.samples[20].correctness.inputSha256='b'.repeat(64));
rejects('different OCR text is rejected',r=>r.samples[20].correctness.result.Text='Hello 中文 123 changed');
rejects('changed confidence is rejected',r=>r.samples[20].correctness.result.Blocks[0].Confidence=.8);
rejects('changed geometry is rejected',r=>r.samples[20].correctness.result.Blocks[0].Polygon[0].X=1);
rejects('different decoded pixels are rejected',r=>r.samples.at(-1).correctness.pixelSha256='b'.repeat(64));
rejects('different tensor samples are rejected',r=>r.samples.at(-1).correctness.tensorSamples[0]=.3);
rejects('extra native modules are rejected',r=>r.workers[1].buildInfo='To be built: core imgcodecs imgproc dnn\n');
rejects('failed worker exit cannot be accepted',r=>r.workerExitCodes[1].code=1);
rejects('recorded sampling failure cannot be accepted',r=>r.failure='worker pipe closed');
console.log(`PASS ${checks} paired benchmark drift, regression, uncertainty, ordering and correctness checks (synthetic only)`);
