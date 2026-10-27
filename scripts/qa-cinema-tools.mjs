import {createApp} from '../server/app.ts';
import {once} from 'node:events';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {createHash} from 'node:crypto';
const evidence=resolve('output/qa/cinema-tools'),directory=join(evidence,'store');
await mkdir(join(directory,'media'),{recursive:true});
if(process.env.FILMMA_QA_REUSE!=='1'){
 const production=await readFile('data/project.json'),project=JSON.parse(production);
 project.id='qa-cinema-tools';project.name='La luz permanece · dirección y tomas';project.aiFinishing={enabled:false,strength:.35};
 for(const asset of project.assets)if(asset.url.startsWith('/api/media/'))await copyFile(join('data/media',basename(asset.url)),join(directory,'media',basename(asset.url)));
 project.scenes[0].trimStart=.5;project.scenes[0].speed=1.5;
 await writeFile(join(directory,'project.json'),JSON.stringify(project,null,2));await writeFile(join(directory,'jobs.json'),'[]');
 const hashes={};for(const asset of project.assets){const path=asset.url.startsWith('/api/media/')?join('data/media',basename(asset.url)):join('public',asset.url);hashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');}
 await writeFile(join(evidence,'before.json'),JSON.stringify({project,productionSha:createHash('sha256').update(production).digest('hex'),originalHashes:hashes},null,2));
}
const fixture=await createApp({dataDirectory:directory,distDirectory:resolve('output/qa/cinema-tools-dist'),skipDiagnostics:true});
const server=fixture.app.listen(4317,'127.0.0.1');await once(server,'listening');console.log('Cinema tools QA at http://127.0.0.1:4317');
const stop=async()=>{await fixture.close();server.closeAllConnections();server.close(()=>process.exit(0));};process.on('SIGTERM',stop);process.on('SIGINT',stop);
