const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {DIAGNOSTIC,analyzeWarmup,collectAfterFailure}=require('./native-warmup-diagnostic.cjs');
const {comparePaired,PROTOCOL}=require('./compare-native-quality.cjs');let checks=0;
function report(values){return {failure:'Warmup remained unstable: small-text',failedScenario:'small-text',samples:['vendor','source'].flatMap(profile=>values.map(milliseconds=>({profile,scenario:'small-text',phase:'warmup',milliseconds}))),diagnosticSamples:[]};}
function check(label,test){test();checks++;console.log('PASS '+label);}
check('short trace cannot distinguish budget from persistent variation',()=>assert.equal(analyzeWarmup(report(Array(16).fill(100))).classification,'insufficient-long-trace'));
check('sustained tail stability is descriptive and cannot accept',()=>{const result=analyzeWarmup(report([...Array(60).fill(150),...Array(20).fill(100)]));assert.equal(result.classification,'stable-tail-observed-after-failure');assert.equal(result.accepted,false);});
check('continuing central drift is distinguished from scatter',()=>assert.equal(analyzeWarmup(report(Array.from({length:80},(_,i)=>100-i))).classification,'central-level-still-changing'));
check('steady centre with isolated scatter still does not pass original rule',()=>{const result=analyzeWarmup(report(Array.from({length:80},(_,i)=>i%5===0?120:100)));assert.equal(result.classification,'central-level-steady-with-scatter');assert.equal(result.windows.at(-1).meetsOriginalCondition,false);assert.equal(result.accepted,false);});
check('invalid duration is not classified as warmup stability',()=>assert.throws(()=>analyzeWarmup(report([0,100]))));
check('diagnostic rows cannot be accepted even if failure flag is removed',()=>assert.throws(()=>comparePaired({protocol:PROTOCOL,diagnosticSamples:[{}]}),/Diagnostic data/));
check('interrupted NDJSON cannot be overwritten',()=>{
 const root=fs.mkdtempSync(path.join(process.cwd(),'artifacts','warmup-diagnostic-tests-')),file=path.join(root,'paired-timeseries.ndjson');fs.writeFileSync(file,'preserve');
 const run=spawnSync(process.execPath,['scripts/run-native-quality.cjs',...Array(6).fill('unused'),root],{encoding:'utf8',windowsHide:true});assert.equal(run.status,1);assert.match(run.stderr,/Refuse to overwrite/);assert.equal(fs.readFileSync(file,'utf8'),'preserve');
});
(async()=>{
 const r=report(Array(16).fill(130));let calls=0;
 await assert.rejects(()=>collectAfterFailure(r,async(profile,scenario,phase,block,slot)=>{assert.ok(r.failure);calls++;r.diagnosticSamples.push({profile,scenario,phase,milliseconds:100});},'small-text',()=>0),/Warmup remained unstable/);
 assert.equal(calls,DIAGNOSTIC.extraRounds*2);assert.equal(r.diagnosticAnalysis.accepted,false);assert.equal(r.diagnosticAnalysis.classification,'stable-tail-observed-after-failure');checks++;console.log('PASS later stability cannot resume acceptance or stop diagnostic sampling selectively');
 const broken=report(Array(16).fill(130));
 await assert.rejects(()=>collectAfterFailure(broken,async()=>{throw new Error('pipe closed');},'small-text',()=>0),/pipe closed/);assert.equal(broken.failure,'Warmup remained unstable: small-text');checks++;console.log('PASS interrupted diagnostic preserves the original failed decision');
 const exhausted=report(Array(16).fill(130));let clock=0;
 await assert.rejects(()=>collectAfterFailure(exhausted,async()=>{throw new Error('must not start');},'small-text',()=>clock++?DIAGNOSTIC.maximumMs:0),/Warmup remained unstable/);assert.equal(exhausted.diagnosticRounds,0);checks++;console.log('PASS fixed diagnostic time budget stops new rounds and retains failure');
 console.log(`PASS ${checks} warmup diagnosis and failure-preservation checks`);
})().catch(error=>{console.error(error);process.exitCode=1;});
