// Isolated local UI verification; never modifies the production movie.
import {createApp} from '../server/app.ts';
import {once} from 'node:events';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const evidence=resolve('output/qa/voice-providers'),directory=join(evidence,'store');
await mkdir(directory,{recursive:true});
if(process.env.FILMMA_QA_REUSE!=='1'){
 const original=await readFile('data/project.json'),project=JSON.parse(original);
 project.id='qa-voice-providers';project.name='Una voz, tres caminos';
 project.scenes=project.scenes.slice(0,2).map((s,i)=>({...s,id:`provider-scene-${i+1}`,title:i?'Continuidad de la voz':'La voz de Hermes',duration:10,trimStart:0,speed:1,videoAssetId:undefined,takeAssetIds:[],assetId:undefined,endAssetId:undefined,characterIds:['elena'],dialogue:'ELENA (V.O.): Una más.',transition:'cut'}));
 project.characters=project.characters.filter(c=>c.id==='elena').map(c=>({...c,assetId:undefined,voice:undefined}));
 project.assets=[];project.tracks=[];project.dialogueLines=[];project.subtitleCues=[];project.audioAssetId=undefined;project.aiFinishing={enabled:false,strength:.35};
 await writeFile(join(directory,'project.json'),JSON.stringify(project,null,2));await writeFile(join(directory,'jobs.json'),'[]');
 await writeFile(join(evidence,'before.json'),JSON.stringify({productionSha:createHash('sha256').update(original).digest('hex')},null,2));
}
const fixture=await createApp({dataDirectory:directory,distDirectory:resolve('output/qa/voice-providers-dist'),credentialsDirectory:join(evidence,'private-test-connection'),skipDiagnostics:true});
const server=fixture.app.listen(4317,'127.0.0.1');await once(server,'listening');console.log('Voice providers QA http://127.0.0.1:4317');
const stop=async()=>{await fixture.close();server.closeAllConnections();server.close(()=>process.exit(0))};process.on('SIGTERM',stop);process.on('SIGINT',stop);
