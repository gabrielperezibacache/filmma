import {createApp} from '../server/app.ts';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {copyFile,mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import {basename,join,resolve} from 'node:path';
import {runProcess,parseJsonOutput} from '../server/process.ts';

const evidence=resolve('output/qa/film-finishing'),directory=join(evidence,'store');
await mkdir(join(directory,'media'),{recursive:true});
const sha=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
const prior=JSON.parse(await readFile('output/qa/ai-upscale/verified.json','utf8'));
if(!process.env.FILMMA_QA_REUSE){
 const project=JSON.parse(await readFile('data/project.json','utf8'));project.id='qa-film-finishing';project.name='La luz permanece · acabado de película';
 for(const asset of project.assets)if(asset.url.startsWith('/api/media/'))await copyFile(join('data/media',basename(asset.url)),join(directory,'media',basename(asset.url)));
 await copyFile(prior.source,join(directory,'media','qa-source-old.mp4'));await copyFile(prior.output,join(directory,'media','qa-copy-old.mp4'));
 const original={id:'qa-source-old',name:'Marquesina · original 864 × 480',type:'video',url:'/api/media/qa-source-old.mp4',mime:'video/mp4',size:(await stat(prior.source)).size};
 const derivative={...prior.asset,id:'qa-copy-old',name:'Marquesina · versión IA existente',url:'/api/media/qa-copy-old.mp4',enhancement:{...prior.asset.enhancement,sourceAssetId:original.id}};
 project.assets.push(original,derivative);project.scenes=project.scenes.slice(0,2);
 Object.assign(project.scenes[0],{videoAssetId:original.id,duration:25/24,trimStart:0,speed:1,look:'original',transition:'cut'});
 delete project.scenes[1].videoAssetId;project.scenes[1].duration=1;project.scenes[1].trimStart=0;project.scenes[1].speed=1;
 project.aiFinishing={enabled:true,strength:.35};project.format='16:9';project.fps=24;
 project.tracks=[{id:'qa-layer',name:'Memoria de la marquesina',type:'video',muted:true,volume:1,clips:[{id:'qa-layer-clip',sceneId:project.scenes[0].id,assetId:original.id,offset:0,duration:1,trimStart:0,speed:1,transform:{x:28,y:-24,scale:.28,opacity:.85}}]}];
 project.subtitleCues=[{id:'qa-line',sceneId:project.scenes[0].id,start:0,end:1,text:'La luz no se ha apagado.',characterId:project.characters[0].id}];project.subtitlesEnabled=true;
 await writeFile(join(directory,'project.json'),JSON.stringify(project,null,2));await writeFile(join(directory,'jobs.json'),'[]');
}
const fixture=await createApp({dataDirectory:directory,distDirectory:resolve('output/qa/film-finishing-dist'),skipDiagnostics:true});
const server=fixture.app.listen(4317,'127.0.0.1');await once(server,'listening');console.log('Film finishing QA ready at http://127.0.0.1:4317');
const stop=async()=>{await fixture.close();server.closeAllConnections();server.close(()=>process.exit(0))};process.on('SIGINT',stop);process.on('SIGTERM',stop);
const post=async(path,body)=>{const response=await fetch('http://127.0.0.1:4317'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Filmma-Client':'filmma'},body:JSON.stringify(body)});const value=await response.json();if(response.status!==202)throw new Error(JSON.stringify(value));return value.job.id};
const wait=async id=>{let message='';while(true){const job=fixture.store.jobs.find(job=>job.id===id);if(job.message!==message){message=job.message;console.log(JSON.stringify({id,status:job.status,progress:job.progress,message}))}if(['failed','completed','cancelled'].includes(job.status)){await writeFile(join(evidence,`${job.type}-${id}.json`),JSON.stringify(job,null,2));if(job.status!=='completed')throw new Error(job.message);return structuredClone(job)}await new Promise(done=>setTimeout(done,2000))}};
if(process.env.FILMMA_QA_RUN==='1'){
 const before=structuredClone(fixture.store.project),productionHash=await sha('data/project.json'),sourceHash=await sha(prior.source),copyHash=await sha(prior.output);
 await writeFile(join(evidence,'before.json'),JSON.stringify({project:before,productionHash,sourceHash,copyHash},null,2));
 const started=Date.now();const generation=await wait(await post('/api/generate',{sceneId:before.scenes[1].id,model:'ltx-2b',conditioningMode:'image',duration:1,width:512,height:288,steps:4}));const generationWall=(Date.now()-started)/1000;
 const generatedOriginal=fixture.store.project.assets.find(asset=>asset.id===generation.result.originalAssetId),generatedHash=await sha(join(directory,'media',basename(generatedOriginal.url)));
 const batchStarted=Date.now();const batch=await wait(await post('/api/enhance-sequence',{projectId:before.id,strength:.35}));const batchWall=(Date.now()-batchStarted)/1000;
 const bindingsBeforeExport=structuredClone({scenes:fixture.store.project.scenes,tracks:fixture.store.project.tracks});
 const exportStarted=Date.now();const exported=await wait(await post('/api/export',{format:'mp4',resolution:'2160p',aiEnhance:true,strength:.35}));const exportWall=(Date.now()-exportStarted)/1000;
 const output=join(directory,'exports',exported.result.filename),probeResult=await runProcess('ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',output],{timeoutMs:120000}),probe=parseJsonOutput(probeResult.stdout),video=probe.streams.find(s=>s.codec_type==='video');
 const decoded=await runProcess('ffmpeg',['-v','error','-i',output,'-f','null','-'],{timeoutMs:120000});
 const withoutMedia=scene=>{const {videoAssetId,...rest}=scene;return rest};
 const withoutClipSource=track=>({...track,clips:track.clips.map(({assetId,...rest})=>rest)});
 const checks={sourceUnchanged:sourceHash===await sha(prior.source),priorCopyUnchanged:copyHash===await sha(prior.output),generatedOriginalUnchanged:generatedHash===await sha(join(directory,'media',basename(generatedOriginal.url))),productionUnchanged:productionHash===await sha('data/project.json'),scenesUnchanged:JSON.stringify(before.scenes.map(withoutMedia))===JSON.stringify(fixture.store.project.scenes.map(withoutMedia)),charactersUnchanged:JSON.stringify(before.characters)===JSON.stringify(fixture.store.project.characters),layerSettingsUnchanged:JSON.stringify(before.tracks.map(withoutClipSource))===JSON.stringify(fixture.store.project.tracks.map(withoutClipSource)),subtitlesUnchanged:JSON.stringify(before.subtitleCues)===JSON.stringify(fixture.store.project.subtitleCues),exportDidNotChangeBindings:JSON.stringify(bindingsBeforeExport)===JSON.stringify({scenes:fixture.store.project.scenes,tracks:fixture.store.project.tracks}),batchReusedTwo:batch.result.finishing.reused===2&&batch.result.finishing.created===0,exportReusedTwo:exported.result.finishing.reused===2&&exported.result.finishing.created===0,validUhd:video.width===3840&&video.height===2160&&Number(video.nb_read_frames)===49&&video.avg_frame_rate==='24/1'&&decoded.code===0};
 const final={checks,passed:Object.values(checks).every(Boolean),generationWall,batchWall,exportWall,generation,batch,exported,output,probe,decodeExitCode:decoded.code,decodeStderr:decoded.stderr,generatedOriginalHash:generatedHash,modelRuntimeSha:await sha('runtime/filmma_upscale.py')};
 await writeFile(join(evidence,'verified.json'),JSON.stringify(final,null,2));await copyFile(output,join(evidence,'filmma-ai-film-4k.mp4'));console.log(JSON.stringify({passed:final.passed,checks,generationWall,batchWall,exportWall,output}));
}
