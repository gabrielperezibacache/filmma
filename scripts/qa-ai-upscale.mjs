import {createApp} from '../server/app.ts';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import {basename,join,resolve} from 'node:path';
import {once} from 'node:events';
import {runProcess,parseJsonOutput} from '../server/process.ts';

const evidence=resolve('output/qa/ai-upscale'),directory=join(evidence,'store');
await mkdir(join(directory,'media'),{recursive:true});
const sha=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
const original=resolve('runtime/validation/resolution-4k/ltx-864x480.mp4');
if(!process.env.FILMMA_QA_REUSE){
 const project=JSON.parse(await readFile('data/project.json','utf8'));
 project.id='qa-ai-upscale';project.name='Detalle cinematográfico · IA 4K';
 for(const asset of project.assets){if(asset.url.startsWith('/api/media/'))await copyFile(join('data/media',basename(asset.url)),join(directory,'media',basename(asset.url)))}
 await copyFile(original,join(directory,'media','qa-ltx-864.mp4'));
 project.assets.push({id:'qa-ltx-864',name:'Toma LTX 864 × 480 · original',type:'video',url:'/api/media/qa-ltx-864.mp4',mime:'video/mp4',size:(await stat(original)).size});
 project.scenes[0].videoAssetId='qa-ltx-864';project.scenes[0].trimStart=0;project.scenes[0].speed=1;
 await writeFile(join(directory,'project.json'),JSON.stringify(project,null,2));await writeFile(join(directory,'jobs.json'),'[]');
}
const fixture=await createApp({dataDirectory:directory,distDirectory:resolve('output/qa/ai-upscale-dist'),skipDiagnostics:true});
const server=fixture.app.listen(4317,'127.0.0.1');await once(server,'listening');console.log(`QA preparada: ${directory} · http://127.0.0.1:4317`);
const stop=async()=>{await fixture.close();server.closeAllConnections();server.close(()=>process.exit(0))};process.on('SIGTERM',stop);process.on('SIGINT',stop);
if(process.env.FILMMA_QA_RUN==='1'){
 const before={runtimeSha256:await sha('runtime/filmma_upscale.py'),sourceSha256:await sha(original),sourceCopySha256:await sha(join(directory,'media','qa-ltx-864.mp4')),productionProjectSha256:await sha('data/project.json'),scenes:JSON.stringify(fixture.store.project.scenes),characters:JSON.stringify(fixture.store.project.characters)};
 await writeFile(join(evidence,'before.json'),JSON.stringify(before,null,2));
 const started=Date.now();
 const response=await fetch('http://127.0.0.1:4317/api/assets/qa-ltx-864/enhance',{method:'POST',headers:{'Content-Type':'application/json','X-Filmma-Client':'filmma'},body:JSON.stringify({projectId:'qa-ai-upscale',preset:'ai-4k',strength:.35})});
 const submitted=await response.json();if(response.status!==202)throw new Error(JSON.stringify(submitted));
 await writeFile(join(evidence,'submitted.json'),JSON.stringify(submitted,null,2));
 let message='';let job;
 while(true){job=fixture.store.jobs.find(item=>item.id===submitted.job.id);if(job.message!==message){message=job.message;console.log(JSON.stringify({status:job.status,progress:job.progress,message}))}if(['completed','failed','cancelled'].includes(job.status))break;await new Promise(done=>setTimeout(done,2000))}
 const wallSeconds=(Date.now()-started)/1000;await writeFile(join(evidence,'job.json'),JSON.stringify(job,null,2));
 if(job.status!=='completed')throw new Error(job.message);
 const asset=fixture.store.project.assets.find(item=>item.id===job.result.assetId),output=join(directory,'media',basename(asset.url));
 const probed=await runProcess('ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',output],{timeoutMs:120000});
 const probe=parseJsonOutput(probed.stdout),v=probe.streams.find(stream=>stream.codec_type==='video');
 const decoded=await runProcess('ffmpeg',['-v','error','-i',output,'-f','null','-'],{timeoutMs:120000});
 const verification={output,source:original,wallSeconds,asset,runtimeSha256:await sha('runtime/filmma_upscale.py'),runtimeUnchanged:before.runtimeSha256===await sha('runtime/filmma_upscale.py'),sourceSha256:await sha(original),sourceCopySha256:await sha(join(directory,'media','qa-ltx-864.mp4')),productionProjectSha256:await sha('data/project.json'),unchangedScenes:before.scenes===JSON.stringify(fixture.store.project.scenes),unchangedCharacters:before.characters===JSON.stringify(fixture.store.project.characters),originalUnchanged:before.sourceSha256===await sha(original),copyUnchanged:before.sourceCopySha256===await sha(join(directory,'media','qa-ltx-864.mp4')),productionProjectUnchanged:before.productionProjectSha256===await sha('data/project.json'),probe,decodeExitCode:decoded.code,decodeStderr:decoded.stderr,passed:v.width===3840&&v.height===2132&&Number(v.nb_read_frames)===25&&v.avg_frame_rate==='24/1'&&Math.abs(Number(v.duration)-25/24)<.001&&decoded.code===0};
 await writeFile(join(evidence,'verified.json'),JSON.stringify(verification,null,2));console.log(JSON.stringify({complete:true,passed:verification.passed,wallSeconds,output,metrics:asset.enhancement.metrics}));
}
