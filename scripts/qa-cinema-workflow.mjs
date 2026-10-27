import {createApp} from '../server/app.ts';
import {once} from 'node:events';
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const evidence=resolve('output/qa/cinema-workflow'),directory=join(evidence,'store');
if(process.env.FILMMA_QA_REUSE!=='1'){
 await mkdir(evidence,{recursive:true});
 await cp(resolve('output/qa/cinema-voices/store'),directory,{recursive:true});
 const file=join(directory,'project.json'),project=JSON.parse(await readFile(file,'utf8'));
 project.name='La luz que permanece';project.logline='Dos personajes se reencuentran en el vestíbulo de un antiguo cine. Proyecto aislado de comprobación.';
 for(const [index,name] of ['framing-medium','framing-wide','framing-two'].entries()){
  const id='qa-cinema-image-'+index;await cp(resolve('public/cinema-references',name+'.webp'),join(directory,'media',id+'.webp'));
  project.assets.push({id,name:'Referencia ilustrativa · '+name,type:'image',url:'/api/media/'+id+'.webp',mime:'image/webp',size:1});project.scenes[index].assetId=id;
 }
 project.characters[0].assetId='qa-cinema-image-0';
 await writeFile(file,JSON.stringify(project,null,2));
}
const fixture=await createApp({dataDirectory:directory,distDirectory:resolve('output/qa/cinema-voices-dist'),credentialsDirectory:join(evidence,'private-test-connection'),skipDiagnostics:true});
const server=fixture.app.listen(4317,'127.0.0.1');await once(server,'listening');console.log('Cinema workflow QA http://127.0.0.1:4317');
const stop=async()=>{await fixture.close();server.closeAllConnections();server.close(()=>process.exit(0))};process.on('SIGTERM',stop);process.on('SIGINT',stop);
