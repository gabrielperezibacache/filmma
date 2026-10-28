import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createApp } from '../server/app.js';
import { createSeedProject } from '../server/seed.js';
import { allowsAutomaticVisualMatch, emptyVisualSettings, visualComparisonPlan, visualReviewReady, visualSampleTime } from '../server/visual-continuity.js';
import { runProcess } from '../server/process.js';
const sha=(value:Buffer)=>createHash('sha256').update(value).digest('hex');

test('comparison plan follows previous entity appearance and samples trimmed accelerated source with EOF freeze',()=>{
  const project=createSeedProject();project.characters=project.characters.slice(0,1);project.scenes.forEach(scene=>scene.characterIds=[]);project.scenes[0].characterIds=['elena'];project.scenes[2].characterIds=['elena'];project.scenes[3].characterIds=['elena'];
  assert.deepEqual(visualComparisonPlan(project).map(item=>[item.left.id,item.right.id]),[['scene-01','scene-03'],['scene-03','scene-04']]);
  const scene={...project.scenes[0],duration:4,trimStart:2,speed:2};
  assert.deepEqual(visualSampleTime(scene,24,emptyVisualSettings(),5,24),{time:2,sourceTime:5-1/24});
  assert.deepEqual(visualSampleTime(scene,24,{regions:[],sampleTimes:[{sceneId:scene.id,time:1}]},10,24),{time:1,sourceTime:4});
});

async function fixture(mode='success') {
  const directory=await mkdtemp(join(tmpdir(),'filmma-visual-')),dataDirectory=join(directory,'data'),publicDirectory=join(directory,'public'),worker=join(directory,'vision.cjs'),calls=join(directory,'calls.jsonl');
  await mkdir(join(publicDirectory,'demo'),{recursive:true});
  const image=await sharp({create:{width:160,height:100,channels:3,background:'#aabbcc'}}).png().toBuffer();
  await Promise.all([1,2,3,4].map(n=>writeFile(join(publicDirectory,'demo',`scene-0${n}.png`),image)));
  await writeFile(worker,`const fs=require('node:fs');const r=JSON.parse(fs.readFileSync(process.argv.at(-1)));fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(r)+'\\n');${mode==='pause'?'setTimeout(()=>{},30000);':''}console.log(JSON.stringify({engine:'apple-vision-cpu',faces:{left:[],right:[]},checks:['face','wardrobe','object'].map(category=>({category,status:category==='wardrobe'?'possible-change':'insufficient',origin:'manual',distance:.7,message:'Fixture visual signal'})),elapsedMs:10}));`);
  const upscaler=join(directory,'upscaler.cjs');await writeFile(upscaler,`if(process.argv[2]==='doctor'){console.log(JSON.stringify({ready:true,model:'realesrgan-x4plus',version:'20220424',modelSha256:'a'.repeat(64),tile:128,temporalMode:'frame-independent-conservative'}));}else{console.error('Unexpected AI inference');process.exit(1);}`);
  const app=await createApp({dataDirectory,publicDirectory,continuityPath:worker,upscalerPath:upscaler,python:process.execPath,skipDiagnostics:true});
  const project=app.store.project;project.characters=project.characters.slice(0,1);project.scenes=project.scenes.slice(0,3);for(const scene of project.scenes){scene.characterIds=['elena'];scene.duration=1;}
  project.scenes[1].continuity={elena:{costume:'Abrigo azul',intentionalChange:true,changeReason:'Cambio de día'}};await app.store.save();
  const server=app.app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
  const request=(path:string,body:unknown,method='POST')=>fetch(base+path,{method,headers:{'Content-Type':'application/json','X-Filmma-Client':'filmma'},body:JSON.stringify(body)});
  const state=async()=>(await fetch(base+'/api/continuity')).json();
  async function wait(id:string){for(let n=0;n<1000;n++){const job=app.store.jobs.find(item=>item.id===id)!;if(['completed','failed','cancelled'].includes(job.status))return job;await new Promise(done=>setTimeout(done,20));}throw new Error('Timeout');}
  async function audit(){const response=await request('/api/continuity/analyze',{projectId:project.id});assert.equal(response.status,202);const job=await wait((await response.json()).job.id);assert.equal(job.status,'completed',job.message);return(await state()).report;}
  async function approve(report:any){for(const comparison of report.comparisons)assert.equal((await request('/api/continuity/review',{projectId:project.id,reportId:report.id,fingerprint:report.fingerprint,comparisonId:comparison.id,decision:'reviewed',allSamplesReviewed:true,note:'Revisado visualmente.'},'PUT')).status,200);assert.equal((await request('/api/continuity/review',{projectId:project.id,reportId:report.id,fingerprint:report.fingerprint,note:'Revisadas las limitaciones y la reproducción.'},'PUT')).status,200);}
  return{...app,directory,dataDirectory,publicDirectory,base,calls,request,state,wait,audit,approve,close:async()=>{await app.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await rm(directory,{recursive:true,force:true});}};
}

test('visual report persists detached from project; originals, narrative, timing and characters stay unchanged',async()=>{
  const f=await fixture();try{
    const before=structuredClone(f.store.project),source=join(f.publicDirectory,'demo','scene-01.png'),original=sha(await readFile(source));
    const report=await f.audit();assert.equal(report.comparisons.length,2);assert.equal(report.comparisons[0].intentionalChange,true);assert.equal(report.comparisons[0].expected.wardrobe,'Abrigo azul');assert.equal(report.comparisons[0].checks[1].status,'possible-change');
    assert.equal((await fetch(f.base+report.comparisons[0].left.url)).status,200);assert.equal((await fetch(f.base+'/api/continuity/media/'+before.id+'/'+report.id+'/request-0.json')).status,404);
    assert.deepEqual(f.store.project,before);assert.equal(sha(await readFile(source)),original);
    assert.equal((await f.state()).stale,false);await f.approve(report);assert.equal(visualReviewReady((await f.state()).report),true);
    assert.equal((await f.request('/api/continuity/review',{projectId:before.id,reportId:report.id,fingerprint:report.fingerprint,comparisonId:'pair-0',decision:'pending'},'PUT')).status,200);assert.equal((await f.state()).report.acknowledgement,undefined);
    f.store.project.scenes[0].trimStart=.1;assert.equal((await f.state()).stale,true);
    assert.equal((await f.request('/api/continuity/review',{projectId:before.id,reportId:report.id,fingerprint:report.fingerprint,note:'x'},'PUT')).status,409);
  }finally{await f.close();}
});

test('strict 4K export refuses pending, stale and byte-changed reports before creating jobs',async()=>{
  const f=await fixture();try{
    const report=await f.audit(),body={format:'mp4',resolution:'2160p',requireContinuityReview:true,continuityReportId:report.id,continuityFingerprint:report.fingerprint};
    assert.equal((await f.request('/api/export',body)).status,409);await f.approve(report);
    const count=f.store.jobs.length;await writeFile(join(f.publicDirectory,'demo','scene-01.png'),await sharp({create:{width:160,height:100,channels:3,background:'#bbccdd'}}).png().toBuffer());
    assert.equal((await f.state()).stale,true);assert.equal((await f.request('/api/export',body)).status,409);assert.equal(f.store.jobs.length,count);
  }finally{await f.close();}
});

test('changing director, take or movement makes the previous 4K continuity approval stale without altering originals',async()=>{
  const f=await fixture();try{
    const original=structuredClone(f.store.project),report=await f.audit();await f.approve(report);
    for(const change of [{director:'varda'},{takeType:'reaction'},{movement:'dolly-zoom'}] as const){
      f.store.project.scenes[0].cinematography=change;
      assert.equal((await f.state()).stale,true);
      const count=f.store.jobs.length;
      assert.equal((await f.request('/api/export',{format:'mp4',resolution:'2160p',requireContinuityReview:true,continuityReportId:report.id,continuityFingerprint:report.fingerprint})).status,409);
      assert.equal(f.store.jobs.length,count);
      f.store.project=structuredClone(original);
      assert.equal((await f.state()).stale,false);
    }
    assert.deepEqual(f.store.project.assets,original.assets);assert.deepEqual(f.store.project.characters,original.characters);
  }finally{await f.close();}
});

test('manual regions and sample times persist, multiple linked entities disable automatic matching',async()=>{
  const f=await fixture();try{
    f.store.project.characters.push({id:'extra',name:'Otra persona',description:'',role:'',locked:true});f.store.project.scenes[0].characterIds.push('extra');
    const settings={regions:[{sceneId:'scene-01',characterId:'elena',category:'object',rect:{x:.1,y:.2,width:.3,height:.4}},{sceneId:'scene-02',characterId:'elena',category:'object',rect:{x:.2,y:.2,width:.3,height:.4}}],sampleTimes:[{sceneId:'scene-01',time:.2}]};
    const response=await f.request('/api/continuity/analyze',{projectId:f.store.project.id,settings});assert.equal(response.status,202);assert.equal((await f.wait((await response.json()).job.id)).status,'completed');
    const records=(await readFile(f.calls,'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.equal(records[0].allowAutomatic,false);assert.deepEqual(records[0].regions.object.left,settings.regions[0].rect);assert.deepEqual((await f.state()).settings,settings);
    assert.equal((await f.request('/api/continuity/analyze',{projectId:f.store.project.id,settings:{...settings,regions:[...settings.regions,settings.regions[0]]}})).status,400);
  }finally{await f.close();}
});

test('missing source is insufficient and cannot be silently approved without a note',async()=>{
  const f=await fixture();try{
    delete f.store.project.scenes[0].assetId;const report=await f.audit();assert.ok(report.comparisons[0].checks.every((check:any)=>check.status==='insufficient'));assert.match(report.comparisons[0].left.error,/no tiene/);
    assert.equal((await f.request('/api/continuity/review',{projectId:f.store.project.id,reportId:report.id,fingerprint:report.fingerprint,comparisonId:'pair-0',decision:'reviewed'},'PUT')).status,400);
    await f.approve(report);assert.equal(visualReviewReady((await f.state()).report),true);
  }finally{await f.close();}
});

test('cancelled report remains partial and cannot authorize export',async()=>{
  const f=await fixture('pause');try{
    const response=await f.request('/api/continuity/analyze',{projectId:f.store.project.id}),job=(await response.json()).job;
    for(let n=0;n<200;n++){if(await readFile(f.calls).catch(()=>undefined))break;await new Promise(done=>setTimeout(done,20));}
    assert.equal((await f.request('/api/jobs/'+job.id+'/cancel',{})).status,200);assert.equal((await f.wait(job.id)).status,'cancelled');const state=await f.state();assert.equal(state.report.status,'cancelled');assert.equal(visualReviewReady(state.report),false);
  }finally{await f.close();}
});

test('video samples beyond EOF use the last source frame and retain requested montage time',async()=>{
  const f=await fixture();try{
    const path=join(f.dataDirectory,'media','short.mp4');const made=await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','color=c=red:s=160x100:r=24:d=0.25','-c:v','libx264',path]);assert.equal(made.code,0,made.stderr);
    f.store.project.assets.push({id:'short',name:'Short',type:'video',url:'/api/media/short.mp4',mime:'video/mp4',size:(await readFile(path)).length});f.store.project.scenes[0].videoAssetId='short';f.store.project.scenes[0].trimStart=20;f.store.project.scenes[0].speed=4;
    const report=await f.audit();assert.equal(report.comparisons[0].left.time,.5);assert.equal(report.comparisons[0].left.sourceTime,.25-1/24);assert.equal(report.comparisons[0].left.error,undefined);assert.ok(report.comparisons[0].left.url);
  }finally{await f.close();}
});


test('strict AI export refuses unreviewed derivative replacement before queue or inference',async()=>{
 const f=await fixture();try{
  const path=join(f.dataDirectory,'media','short.mp4');const made=await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=160x100:r=24:d=0.25','-c:v','libx264',path]);assert.equal(made.code,0,made.stderr);
  f.store.project.assets.push({id:'short',name:'Short original',type:'video',url:'/api/media/short.mp4',mime:'video/mp4',size:(await readFile(path)).length});f.store.project.scenes[0].videoAssetId='short';
  const report=await f.audit();await f.approve(report);const count=f.store.jobs.length;
  const rejected=await f.request('/api/export',{format:'mp4',resolution:'2160p',aiEnhance:true,strength:.35,requireContinuityReview:true,continuityReportId:report.id,continuityFingerprint:report.fingerprint});assert.equal(rejected.status,409);assert.match((await rejected.json()).error,/versiones IA/);assert.equal(f.store.jobs.length,count);assert.equal(f.store.project.scenes[0].videoAssetId,'short');
 }finally{await f.close();}
});

test('single object links never auto-bind a background face; no-pair coverage requires explicit acknowledgement',async()=>{
 const f=await fixture();try{
  f.store.project.characters[0].role='Objeto recurrente';const report=await f.audit();const records=(await readFile(f.calls,'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.ok(records.every(record=>record.allowAutomatic===false));
  f.store.project.scenes=f.store.project.scenes.slice(0,1);const empty=await f.audit();assert.equal(empty.comparisons.length,0);assert.equal(visualReviewReady(empty),false);assert.ok(empty.warnings.some((message:string)=>message.includes('No hay elementos')));await f.approve(empty);assert.equal(visualReviewReady((await f.state()).report),true);
 }finally{await f.close();}
});

test('queued strict export rechecks montage changes before rendering', {timeout:30000}, async()=>{
 const f=await fixture();try{
  const report=await f.audit();await f.approve(report);
  const first=await f.request('/api/export',{format:'mp4',resolution:'1080p'});assert.equal(first.status,202);
  const second=await f.request('/api/export',{format:'mp4',resolution:'2160p',requireContinuityReview:true,continuityReportId:report.id,continuityFingerprint:report.fingerprint});assert.equal(second.status,202);const job=(await second.json()).job;
  f.store.project.scenes[0].color={saturation:.8};
  const completed=await f.wait(job.id);assert.equal(completed.status,'failed');assert.match(completed.message,/desactualizado/);assert.equal(completed.result?.url,undefined);
 }finally{await f.close();}
});


test('one explicit human plus known props remains automatic; multiple humans or ambiguous roles require regions',()=>{
 const project=createSeedProject(),scene=project.scenes[1];scene.characterIds=['elena','projector'];
 assert.equal(allowsAutomaticVisualMatch(project,scene,'elena'),true);assert.equal(allowsAutomaticVisualMatch(project,scene,'projector'),false);
 project.characters.push({id:'other',name:'Otra presencia',role:'Personaje',description:'',locked:true});scene.characterIds.push('other');assert.equal(allowsAutomaticVisualMatch(project,scene,'elena'),false);
 project.characters.find(character=>character.id==='other')!.role='Presencia';assert.equal(allowsAutomaticVisualMatch(project,scene,'elena'),false);
 project.characters.find(character=>character.id==='other')!.role='Objeto recurrente';assert.equal(allowsAutomaticVisualMatch(project,scene,'elena'),true);
 scene.characterIds.push('missing');assert.equal(allowsAutomaticVisualMatch(project,scene,'elena'),false);
});


test('remembering an alternative take keeps a review current until that source is selected', async()=>{
 const f=await fixture();try{
  const report=await f.audit();await f.approve(report);
  const path=join(f.dataDirectory,'media','alternative.mp4');const made=await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=160x100:r=24:d=0.25','-c:v','libx264',path]);assert.equal(made.code,0,made.stderr);
  f.store.project.assets.push({id:'alternative',name:'Alternative take',type:'video',url:'/api/media/alternative.mp4',mime:'video/mp4',size:(await readFile(path)).length});
  f.store.project.scenes[0].takeAssetIds=['alternative'];
  const unchanged=await f.state();assert.equal(unchanged.stale,false);assert.equal(unchanged.currentFingerprint,report.fingerprint);assert.equal(visualReviewReady(unchanged.report),true);
  f.store.project.scenes[0].videoAssetId='alternative';assert.equal((await f.state()).stale,true);
  const response=await f.request('/api/export',{format:'mp4',resolution:'2160p',requireContinuityReview:true,continuityReportId:report.id,continuityFingerprint:report.fingerprint});assert.equal(response.status,409);
 }finally{await f.close();}
});

test('multi-frame video analyses retain only unchanged appearance reviews and require a new final acknowledgement', {timeout:30000}, async()=>{
 const f=await fixture();try{
  const path=join(f.dataDirectory,'media','temporal.mp4');const made=await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=160x100:r=24:d=1','-c:v','libx264',path]);assert.equal(made.code,0,made.stderr);
  const original=sha(await readFile(path));f.store.project.assets.push({id:'temporal',name:'Temporal original',type:'video',url:'/api/media/temporal.mp4',mime:'video/mp4',size:(await readFile(path)).length});f.store.project.scenes.forEach(s=>{s.videoAssetId='temporal';s.look='original';s.color=undefined});
  const first=await f.audit();assert.equal(first.samplingVersion,2);assert.deepEqual(first.summary,{analyzed:2,reused:0,frames:9,intervals:12});assert.deepEqual(first.comparisons.map((c:any)=>c.intervals.length),[7,5]);
  assert.equal((await f.request('/api/continuity/review',{projectId:f.store.project.id,reportId:first.id,fingerprint:first.fingerprint,comparisonId:'pair-0',decision:'reviewed',note:'Missing explicit review.'},'PUT')).status,400);
  await f.approve(first);const calls=()=>readFile(f.calls,'utf8').then(s=>s.trim().split('\n').map(l=>JSON.parse(l)));assert.equal((await calls()).length,12);
  const cached=await f.audit();assert.deepEqual(cached.summary,{analyzed:0,reused:2,frames:9,intervals:12});assert.ok(cached.comparisons.every((c:any)=>c.decision&&c.reusedFrom===first.id));assert.equal(cached.acknowledgement,undefined);assert.equal(visualReviewReady(cached),false);assert.equal((await calls()).length,12);assert.equal((await fetch(f.base+cached.comparisons[0].intervals[1].left.url)).status,200);
  f.store.project.scenes[2].color={saturation:.3};const partial=await f.audit();assert.equal(partial.summary.reused,1);assert.equal(partial.summary.analyzed,1);assert.ok(partial.comparisons[0].decision);assert.equal(partial.comparisons[1].decision,undefined);assert.equal((await calls()).length,17);
  const settings={sampleCount:3,regions:[{sceneId:f.store.project.scenes[2].id,characterId:'elena',category:'object',sample:'end',rect:{x:.2,y:.2,width:.4,height:.4}}],sampleTimes:[{sceneId:f.store.project.scenes[2].id,sample:'end',time:.8}]};
  const changed=await f.request('/api/continuity/analyze',{projectId:f.store.project.id,settings});assert.equal(changed.status,202);assert.equal((await f.wait((await changed.json()).job.id)).status,'completed');const selected=(await f.state()).report;assert.equal(selected.summary.reused,1);assert.equal((await calls()).length,22);const end=selected.comparisons[1].intervals.find((i:any)=>i.kind==='between'&&i.right.moment==='end');assert.equal(end.right.time,19/24);const records=await calls();assert.ok(records.slice(-5).some(r=>r.regions.object?.right?.x===.2));
  const force=await f.request('/api/continuity/analyze',{projectId:f.store.project.id,settings,force:true});assert.equal(force.status,202);assert.equal((await f.wait((await force.json()).job.id)).status,'completed');const forced=(await f.state()).report;assert.equal(forced.summary.reused,0);assert.equal(forced.summary.analyzed,2);assert.ok(forced.comparisons.every((c:any)=>!c.decision));assert.equal(sha(await readFile(path)),original);
 }finally{await f.close()}
});

test('five samples include internal-only video appearances and missing cached thumbnails are recomputed', {timeout:30000}, async()=>{
 const f=await fixture();try{
  const path=join(f.dataDirectory,'media','single.mp4');const made=await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=160x100:r=24:d=1','-c:v','libx264',path]);assert.equal(made.code,0,made.stderr);
  f.store.project.scenes=f.store.project.scenes.slice(0,1);f.store.project.assets.push({id:'single',name:'Single original',type:'video',url:'/api/media/single.mp4',mime:'video/mp4',size:(await readFile(path)).length});f.store.project.scenes[0].videoAssetId='single';
  const queued=await f.request('/api/continuity/analyze',{projectId:f.store.project.id,settings:{sampleCount:5,regions:[],sampleTimes:[]}});assert.equal(queued.status,202);assert.equal((await f.wait((await queued.json()).job.id)).status,'completed');const first=(await f.state()).report;assert.equal(first.comparisons.length,1);assert.equal(first.summary.frames,5);assert.equal(first.summary.intervals,4);assert.ok(first.comparisons[0].intervals.every((i:any)=>i.kind==='within'));
  const missing=first.comparisons[0].intervals[0].left.url.split('/').at(-1);await rm(join(f.dataDirectory,'continuity',f.store.project.id,first.id,missing));const again=await f.audit();assert.equal(again.summary.analyzed,1);assert.equal(again.summary.reused,0);assert.equal(again.summary.frames,5);
 }finally{await f.close()}
});

test('supporting reference bytes and narrative context invalidate retained reviews for the affected character',async()=>{
 const f=await fixture();try{
  f.store.project.characters[0].referenceAssetIds=[f.store.project.scenes[0].assetId!];f.store.project.story={sequences:[{id:'seq',title:'Acto primero'}],scenes:[{id:'story',sequenceId:'seq',title:'La sala',setting:'Noche',notes:'La luz permanece'}]};f.store.project.scenes.forEach(s=>s.storySceneId='story');
  const first=await f.audit();await f.approve(first);f.store.project.story.scenes[0].setting='Amanecer';assert.equal((await f.state()).stale,true);const context=await f.audit();assert.equal(context.summary.reused,0);assert.ok(context.comparisons.every((c:any)=>!c.decision));await f.approve(context);
  await writeFile(join(f.publicDirectory,'demo','scene-01.png'),await sharp({create:{width:160,height:100,channels:3,background:'#123456'}}).png().toBuffer());assert.equal((await f.state()).stale,true);const changed=await f.audit();assert.equal(changed.summary.reused,0);assert.ok(changed.comparisons.every((c:any)=>!c.decision));
 }finally{await f.close()}
});

test('one-frame video coverage records its single sample without inventing temporal evidence',async()=>{
 const f=await fixture();try{
  const path=join(f.dataDirectory,'media','one.mp4');const made=await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','color=c=red:s=160x100:r=24','-frames:v','1','-c:v','libx264',path]);assert.equal(made.code,0,made.stderr);
  f.store.project.scenes=f.store.project.scenes.slice(0,1);f.store.project.assets.push({id:'one',name:'One frame',type:'video',url:'/api/media/one.mp4',mime:'video/mp4',size:(await readFile(path)).length});f.store.project.scenes[0].videoAssetId='one';const r=await f.audit();assert.equal(r.summary.frames,1);assert.equal(r.summary.intervals,0);assert.equal(r.comparisons[0].coverage.left.unique,1);assert.ok(r.comparisons[0].checks.every((c:any)=>c.status==='insufficient'));assert.equal(visualReviewReady(r),false);
 }finally{await f.close()}
});
