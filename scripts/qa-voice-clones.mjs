// Isolated real-model QA. Never edits the production movie or Hermes configuration.
import {createApp} from '../server/app.ts';
import {once} from 'node:events';
import {mkdir,readFile,writeFile,copyFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {dialogueLinesFromScene} from '../src/dialogue.ts';
const evidence=resolve('output/qa/cinema-voices'),directory=join(evidence,'store');
await mkdir(join(directory,'media'),{recursive:true});
if(process.env.FILMMA_QA_REUSE!=='1'){
 const production=await readFile('data/project.json'),project=JSON.parse(production),prototype=project.characters[0];
 project.id='qa-cinema-voices';project.name='Dos personajes, dos voces';project.aiFinishing={enabled:false,strength:.35};project.format='16:9';
 project.characters=[{...prototype,id:'elena',name:'Elena',assetId:undefined,voice:undefined},{...prototype,id:'victor',name:'Víctor',assetId:undefined,voice:undefined}];
 project.scenes=Array.from({length:3},(_,i)=>({...project.scenes[0],id:`clone-scene-${i+1}`,title:['La voz de Elena','Elena vuelve a escena','La voz de Víctor'][i],duration:5,trimStart:0,speed:1,videoAssetId:undefined,takeAssetIds:[],assetId:undefined,endAssetId:undefined,characterIds:[i===2?'victor':'elena'],dialogue:i===2?'VÍCTOR: La función comienza.':'ELENA: Mira la luz.',transition:'cut'}));
 project.tracks=[];project.subtitleCues=[];delete project.audioAssetId;project.assets=[];
 for(const [id,filename,name] of [['qa-dora','ef_dora.wav','Dora · referencia sintética'],['qa-alex','em_alex.wav','Alex · referencia sintética']]){
  const source=resolve('runtime/validation/speech-20261018-001721',filename),destination=join(directory,'media',`${id}.wav`);await copyFile(source,destination);
  project.assets.push({id,name,type:'audio',mime:'audio/wav',url:`/api/media/${id}.wav`,size:(await stat(destination)).size});
 }
 project.dialogueLines=project.scenes.flatMap(scene=>dialogueLinesFromScene(project,scene.id));
 await writeFile(join(directory,'project.json'),JSON.stringify(project,null,2));await writeFile(join(directory,'jobs.json'),'[]');
 const reference=JSON.parse(await readFile('runtime/qwen/connection.json','utf8')).referencePath.replace(/^~/,process.env.HOME);
 const sha=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
 await writeFile(join(evidence,'before.json'),JSON.stringify({productionSha:createHash('sha256').update(production).digest('hex'),hermesConfigSha:await sha('runtime/qwen/connection.json'),hermesVoiceSha:await sha(reference),hermesReference:reference,originals:await Promise.all(project.assets.map(async a=>({id:a.id,sha256:await sha(join(directory,'media',`${a.id}.wav`))})))},null,2));
}
const adapter=join(evidence,'qwen-audit.py');
await writeFile(adapter,`import sys,json,time\nfrom pathlib import Path\nsys.path.insert(0,${JSON.stringify(resolve('runtime'))})\nimport filmma_qwen_tts as q\noriginal=q._synthesize\ndef audit(request):\n result=original(request)\n Path(${JSON.stringify(evidence)}+'/metrics-'+str(time.time_ns())+'.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))\n return result\nq._synthesize=audit\nq.main()\n`);
const fixture=await createApp({dataDirectory:directory,qwenPath:adapter,skipDiagnostics:true});
const server=fixture.app.listen(4316,'127.0.0.1');await once(server,'listening');console.log('Voice clone QA at http://127.0.0.1:4316');
const stop=async()=>{await fixture.close();server.closeAllConnections();server.close(()=>process.exit(0))};process.on('SIGTERM',stop);process.on('SIGINT',stop);
