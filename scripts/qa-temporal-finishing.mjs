/** Real local inference + movie preparation/export in a private 24-frame QA project. */
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,stat,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../server/app.ts';
import {runProcess,parseJsonOutput} from '../server/process.ts';

const root=resolve(import.meta.dirname,'..'),directory=join(root,'output/qa/temporal-pipeline-v2'),store=join(directory,'store');
const finishExisting=process.argv.includes('--finish-existing');
await mkdir(join(store,'media'),{recursive:true});
await writeFile(join(directory,finishExisting?'finish-existing-attempt.json':'attempt.json'),JSON.stringify({startedAt:new Date().toISOString(),maximumAdditionalRetries:0,finishExisting}),{flag:'wx'});
const hash=async(path)=>createHash('sha256').update(await readFile(path)).digest('hex');
const original=join(root,'output/qa/minimax-scene/store/media/aff6fd55-a41a-4ab1-a3c5-394de109b2d4.mp4');
const expected='f9ab463b327527cad9d7e8b5c30ff98481e2243a5709568522ac42d91c5d7016';assert.equal(await hash(original),expected);
const productionHash=await hash(join(root,'data/project.json'));
const source=join(store,'media','native512.mp4');
if(!finishExisting){const trim=await runProcess('ffmpeg',['-v','error','-n','-i',original,'-t','1','-map','0:v:0','-map','0:a:0','-c:v','libx264','-qp','0','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k',source]);assert.equal(trim.code,0,trim.stderr);}
const project=JSON.parse(await readFile(join(root,'output/qa/minimax-scene/store/project.json'),'utf8'));
project.id='qa-temporal-finishing';project.name='Prueba de restauración estable';project.scenes=[{...project.scenes[0],id:'stable-shot',title:'Muestra de integración · 24 fotogramas',videoAssetId:'native512',assetId:undefined,duration:1,trimStart:0,speed:1,look:'original',transition:'cut'}];
project.assets=[{id:'native512',name:'Original 512 · muestra técnica aislada',type:'video',url:'/api/media/native512.mp4',mime:'video/mp4',size:(await stat(source)).size}];
project.tracks=[];project.subtitlesEnabled=false;project.subtitleCues=[];project.dialogueLines=[];delete project.audioAssetId;
project.aiFinishing={enabled:false,processingProfile:'temporal',strength:.65};
if(!finishExisting){await writeFile(join(store,'project.json'),JSON.stringify(project));await writeFile(join(store,'jobs.json'),'[]');}
const sourceHash=await hash(source),characters=JSON.stringify(project.characters),scenes=JSON.parse(JSON.stringify(project.scenes));
const runtime=await createApp({dataDirectory:store,skipDiagnostics:true,distDirectory:join(directory,'not-used')});
const server=runtime.app.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
const post=async(path,body)=>{const r=await fetch(base+'/api'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Filmma-Client':'filmma'},body:JSON.stringify(body)});assert.equal(r.status,202,await r.clone().text());return (await r.json()).job;};
const wait=async(job)=>{const deadline=Date.now()+8*60*1000;while(Date.now()<deadline){const current=runtime.store.jobs.find(item=>item.id===job.id);if(!['queued','running'].includes(current.status)){assert.equal(current.status,'completed',current.message);return current}await new Promise(done=>setTimeout(done,250))}throw Error('QA timeout; do not resubmit automatically');};
const record={status:'running',source,sourceHash,productionHash};
if(finishExisting){const previous=JSON.parse(await readFile(join(directory,'validation.json'),'utf8'));assert.equal(previous.sourceHash,sourceHash);assert.equal(previous.productionHash,productionHash);await copyFile(join(directory,'validation.json'),join(directory,'initial-validation-diagnostic.json'));}
const save=()=>writeFile(join(directory,'validation.json'),JSON.stringify(record,null,2));
try{
 await save();
 const status=await(await fetch(base+'/api/upscaler')).json();assert(status.ready&&status.temporalAvailable);
 if(finishExisting){record.enhance=runtime.store.jobs.find(job=>job.type==='enhance'&&job.status==='completed'&&job.result?.projectId===project.id);assert(record.enhance,'The existing inference must be completed; never start another automatically');}
 else record.enhance=await wait(await post('/enhance-sequence',{projectId:project.id,processingProfile:'temporal',strength:.65}));
 const selected=runtime.store.project.scenes[0].videoAssetId,asset=runtime.store.project.assets.find(item=>item.id===selected);
 assert.equal(asset.enhancement.profile,'temporal');assert.equal(asset.enhancement.strength,.65);assert.equal(asset.enhancement.temporalMode,'motion-compensated-residual-v1');assert.equal(asset.enhancement.sourceAssetId,'native512');
 assert.equal(asset.enhancement.metrics.temporal.frames,24);assert.equal(asset.enhancement.metrics.temporal.stateFrames,1);
 assert.equal(JSON.stringify(runtime.store.project.characters),characters);
 assert.deepEqual(runtime.store.project.scenes.map(scene=>({...scene,videoAssetId:scenes[0].videoAssetId})),scenes);
 record.enhancement=asset.enhancement;record.aiPath=join(store,'media',`${asset.id}.mp4`);await save();
 record.export=await wait(await post('/export',{format:'mp4',resolution:'2160p',aiEnhance:true,processingProfile:'temporal',strength:.65}));
 assert.equal(record.export.result.finishing.created,0);assert.equal(record.export.result.finishing.reused,1);
 record.exportPath=join(store,'exports',record.export.result.filename);
 for(const [label,path,width,height] of [['original',source,512,320],['ai',record.aiPath,3642,2276],['export',record.exportPath,3840,2160]]){
  const probe=await runProcess('ffprobe',['-v','error','-count_frames','-show_streams','-of','json',path]);assert.equal(probe.code,0,probe.stderr);
  const video=parseJsonOutput(probe.stdout).streams.find(x=>x.codec_type==='video');assert.equal(video.width,width);assert.equal(video.height,height);assert.equal(video.nb_read_frames,'24');assert.equal(video.avg_frame_rate,'24/1');assert.equal(Number(video.duration),1);
  const decode=await runProcess('ffmpeg',['-v','error','-xerror','-hwaccel','none','-threads','2','-i',path,'-f','null','-']);assert.equal(decode.code,0,decode.stderr);
  record[label+'Sha256']=await hash(path);
 }
 const audioHash=async(path)=>{const result=await runProcess('ffmpeg',['-v','error','-i',path,'-map','0:a:0','-c','copy','-f','hash','-']);assert.equal(result.code,0,result.stderr);return result.stdout.trim()};
 assert.equal(await audioHash(source),await audioHash(record.aiPath));
 assert.equal(await hash(source),sourceHash);assert.equal(await hash(original),expected);assert.equal(await hash(join(root,'data/project.json')),productionHash);
 record.status='verified';record.completedAt=new Date().toISOString();record.originalsPreserved=true;record.originalAudioPacketsPreserved=true;await save();
 console.log(JSON.stringify(record));
}catch(error){record.status='failed';record.error=String(error);await save();throw error}
finally{await runtime.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
