// Isolated CPU fixture. Does not generate video or touch the production project.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir,readFile,writeFile,copyFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/app.ts';
import { runProcess } from '../server/process.ts';
const reuse=process.env.FILMMA_QA_REUSE==='1';
const root=resolve('.'),qa=join(root,'output/qa/visual-continuity'),dataDirectory=join(qa,'store');
await mkdir(join(dataDirectory,'media'),{recursive:true});
const sha=async(path)=>createHash('sha256').update(await readFile(path)).digest('hex');
const productionHash=await sha(join(root,'data/project.json')),source=join(root,'public/demo/scene-04.png'),sourceHash=await sha(source);
const sourceCopy=join(dataDirectory,'media','qa-portrait.png');if(!reuse)await copyFile(source,sourceCopy);
const production=JSON.parse(await readFile(join(root,'data/project.json'),'utf8'));
const project={...structuredClone(production),id:'qa-visual-continuity',name:'La luz permanece · continuidad visual',aiFinishing:{enabled:false,strength:.35},characters:[{...production.characters.find(c=>c.id==='elena'),assetId:'qa-portrait',continuity:{costume:'Abrigo color mostaza',appearance:'Misma persona y peinado',props:'Butaca de cine roja'}}],assets:[{id:'qa-portrait',name:'Elena · original conservado',type:'image',url:'/api/media/qa-portrait.png',mime:'image/png',size:(await readFile(sourceCopy)).length}],tracks:[],subtitleCues:[],subtitlesEnabled:false,audioAssetId:undefined,scenes:production.scenes.slice(0,3).map((scene,i)=>({...scene,id:`qa-scene-${i+1}`,title:['La primera mirada','La misma mirada','Cambio de luz'][i],assetId:'qa-portrait',videoAssetId:undefined,endAssetId:undefined,characterIds:['elena'],continuity:undefined,duration:1,trimStart:0,speed:1,transition:'cut',look:'original',color:i===2?{saturation:0,temperature:-.8,contrast:1.3}:undefined}))};
if(!reuse){await writeFile(join(dataDirectory,'project.json'),JSON.stringify(project,null,2));await writeFile(join(dataDirectory,'jobs.json'),'[]');}
const runtime=await createApp({dataDirectory,distDirectory:join(root,'output/qa/visual-continuity-dist'),skipDiagnostics:true});
const server=runtime.app.listen(4317,'127.0.0.1');await once(server,'listening');
const base='http://127.0.0.1:4317';
const request=async(path,body,method='POST')=>fetch(base+path,{method,headers:{'Content-Type':'application/json','X-Filmma-Client':'filmma'},body:JSON.stringify(body)});
const wait=async(id)=>{for(let n=0;n<1800;n++){const job=runtime.store.jobs.find(item=>item.id===id);if(['completed','failed','cancelled'].includes(job.status))return job;await new Promise(r=>setTimeout(r,100));}throw new Error('QA timeout');};
try{if(!reuse){
 const regions=project.scenes.flatMap(scene=>[{sceneId:scene.id,characterId:'elena',category:'wardrobe',rect:{x:.24,y:.53,width:.25,height:.31}},{sceneId:scene.id,characterId:'elena',category:'object',rect:{x:.69,y:.61,width:.18,height:.20}}]);
 const queued=await request('/api/continuity/analyze',{projectId:project.id,settings:{regions,sampleTimes:[]}});assert.equal(queued.status,202);const job=await wait((await queued.json()).job.id);assert.equal(job.status,'completed',job.message);
 const state=await(await fetch(base+'/api/continuity')).json(),report=state.report;
 assert.equal(report.comparisons.length,2);assert.ok(report.comparisons[0].checks.every(c=>c.status==='no-obvious-change'),JSON.stringify(report.comparisons[0].checks));
 assert.ok(report.comparisons[1].checks.some(c=>c.status==='possible-change'),JSON.stringify(report.comparisons[1].checks));
 const payload={format:'mp4',resolution:'2160p',requireContinuityReview:true,continuityReportId:report.id,continuityFingerprint:report.fingerprint};
 assert.equal((await request('/api/export',payload)).status,409);
 for(const comparison of report.comparisons)assert.equal((await request('/api/continuity/review',{projectId:project.id,reportId:report.id,fingerprint:report.fingerprint,comparisonId:comparison.id,decision:comparison.id==='pair-1'?'intentional':'reviewed',allSamplesReviewed:true,note:'Fixture: el segundo par cambia sólo el tratamiento de color; revisado visualmente.'},'PUT')).status,200);
 assert.equal((await request('/api/continuity/review',{projectId:project.id,reportId:report.id,fingerprint:report.fingerprint,note:'Fixture: revisadas las limitaciones del muestreo; comparación local sin reconocimiento de identidad.'},'PUT')).status,200);
 const approved=await request('/api/export',payload);assert.equal(approved.status,202);const exportJob=await wait((await approved.json()).job.id);assert.equal(exportJob.status,'completed',exportJob.message);
 const exported=join(dataDirectory,'exports',exportJob.result.filename),probe=await runProcess('ffprobe',['-v','error','-count_frames','-show_entries','stream=codec_type,width,height,nb_read_frames,r_frame_rate:format=duration','-of','json',exported]);assert.equal(probe.code,0,probe.stderr);const media=JSON.parse(probe.stdout),video=media.streams.find(s=>s.codec_type==='video');assert.deepEqual([video.width,video.height,Number(video.nb_read_frames)],[3840,2160,72]);
 const decoded=await runProcess('ffmpeg',['-v','error','-threads','2','-i',exported,'-f','null','-'],{timeoutMs:120000});assert.equal(decoded.code,0,decoded.stderr);
 assert.equal(await sha(source),sourceHash);assert.equal(await sha(sourceCopy),sourceHash);assert.equal(await sha(join(root,'data/project.json')),productionHash);assert.deepEqual(runtime.store.project,JSON.parse(JSON.stringify(project)));
 await copyFile(exported,join(qa,'filmma-continuity-reviewed-4k.mp4'));
 // Leave the second pair pending for UI QA while retaining the export evidence.
 await request('/api/continuity/review',{projectId:project.id,reportId:report.id,fingerprint:report.fingerprint,comparisonId:'pair-1',decision:'pending'},'PUT');
 const evidence={checkedAt:new Date().toISOString(),engine:'apple-vision-cpu',reportId:report.id,fingerprint:report.fingerprint,checks:report.comparisons.map(c=>({id:c.id,checks:c.checks})),originalSha256:sourceHash,productionProjectUnchanged:true,originalsUnchanged:true,exportRejectedBeforeReview:true,exportJob,media,limitations:report.warnings};
 await writeFile(join(qa,'verified.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({ready:true,url:base,evidence:join(qa,'verified.json')}));
}}catch(error){console.error(error);await writeFile(join(qa,'failed.txt'),String(error.stack??error));}
const stop=async()=>{await runtime.close();server.closeAllConnections();server.close(()=>process.exit());};process.on('SIGTERM',stop);process.on('SIGINT',stop);console.log('QA server remains available on 4317');
