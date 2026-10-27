import {createApp} from '../server/app.ts';
import {once} from 'node:events';
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const evidence=resolve('output/qa/cinema-period'),directory=join(evidence,'store');
await mkdir(evidence,{recursive:true});
if(process.env.FILMMA_QA_REUSE!=='1'){
 await cp(resolve('output/qa/cinema-workflow/store'),directory,{recursive:true});
 const file=join(directory,'project.json'),project=JSON.parse(await readFile(file,'utf8'));
 project.name='La luz que permanece';
 project.logline='Proyecto aislado para comprobar época, película, óptica y continuidad. Ningún cambio afecta a la película original.';
 for(const scene of project.scenes) delete scene.cinematography;
 project.scenes[1].cinematography={lens:'85mm',lensFamily:'spherical-modern',aperture:'balanced',cameraBody:'cinema-digital'};
 await writeFile(file,JSON.stringify(project,null,2));
 await writeFile(join(evidence,'before.json'),JSON.stringify({project,productionSha:createHash('sha256').update(await readFile('data/project.json')).digest('hex')},null,2));
}
const fixture=await createApp({dataDirectory:directory,distDirectory:resolve('output/qa/cinema-period-dist'),credentialsDirectory:join(evidence,'private-test-connection'),skipDiagnostics:true});
const server=fixture.app.listen(4317,'127.0.0.1');await once(server,'listening');console.log('Cinema period QA http://127.0.0.1:4317');
const stop=async()=>{await fixture.close();server.closeAllConnections();server.close(()=>process.exit(0))};process.on('SIGTERM',stop);process.on('SIGINT',stop);
