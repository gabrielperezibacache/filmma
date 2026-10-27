// Isolated research QA only. Upstream MuseTalk fixture is not bundled with Filmma.
import {createApp} from '../server/app.ts';
import {once} from 'node:events';
import {mkdir,readFile,writeFile,copyFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const evidence=resolve('output/qa/dialogue'),directory=join(evidence,'store');
await mkdir(join(directory,'media'),{recursive:true});
if(process.env.FILMMA_QA_REUSE!=='1'){
 const production=await readFile('data/project.json'),project=JSON.parse(production);
 project.id='qa-dialogue';project.name='Una voz, un personaje';project.aiFinishing={enabled:false,strength:.35};project.format='9:16';
 project.scenes=project.scenes.slice(0,2).map((s,i)=>({...s,id:`voice-scene-${i+1}`,title:i?'La misma voz, después':'Antes de la última función',duration:3,trimStart:0,speed:1,videoAssetId:'qa-face',takeAssetIds:[],assetId:undefined,endAssetId:undefined,characterIds:['elena'],dialogue:'ELENA (susurra): Una más.',transition:'cut'}));
 project.tracks=[];project.dialogueLines=[];project.subtitleCues=[];project.audioAssetId=undefined;
 project.characters=project.characters.filter(c=>c.id==='elena').map(c=>({...c,assetId:undefined}));
 const input=resolve('runtime/lipsync/fixtures/yongen.mp4'),output=join(directory,'media','qa-face.mp4');await copyFile(input,output);
 project.assets=[{id:'qa-face',name:'Rostro sintético · prueba de investigación',type:'video',mime:'video/mp4',url:'/api/media/qa-face.mp4',size:(await stat(output)).size}];
 await writeFile(join(directory,'project.json'),JSON.stringify(project,null,2));await writeFile(join(directory,'jobs.json'),'[]');
 await writeFile(join(evidence,'before.json'),JSON.stringify({productionSha:createHash('sha256').update(production).digest('hex'),sourceSha:createHash('sha256').update(await readFile(output)).digest('hex'),source:output,fixtureLicense:'Upstream MuseTalk testdata: non-commercial research only; excluded from product/distribution.'},null,2));
}
const fixture=await createApp({dataDirectory:directory,distDirectory:resolve('output/qa/dialogue-dist'),skipDiagnostics:true});
const server=fixture.app.listen(4317,'127.0.0.1');await once(server,'listening');console.log('Dialogue research QA at http://127.0.0.1:4317');
const stop=async()=>{await fixture.close();server.closeAllConnections();server.close(()=>process.exit(0))};process.on('SIGTERM',stop);process.on('SIGINT',stop);
