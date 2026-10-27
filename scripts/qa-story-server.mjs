import {createApp} from '../server/app.ts';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
const directory=resolve('output/qa/story-store');
await mkdir(join(directory,'media'),{recursive:true});
const project=JSON.parse(await readFile('data/project.json','utf8'));
project.id='qa-story-workflow';project.name='Prueba de montaje y continuidad';
for(const asset of project.assets){if(asset.url.startsWith('/api/media/'))await copyFile(join('data/media',basename(asset.url)),join(directory,'media',basename(asset.url)))}
await writeFile(join(directory,'project.json'),JSON.stringify(project));await writeFile(join(directory,'jobs.json'),'[]');
const fixture=await createApp({dataDirectory:directory,distDirectory:resolve('output/qa/story-dist'),skipDiagnostics:true,codex:'/not-used',python:'/not-used'});
const server=fixture.app.listen(4317,'127.0.0.1',()=>console.log('QA fixture at http://127.0.0.1:4317'));
const stop=async()=>{await fixture.close();server.closeAllConnections();server.close(()=>process.exit(0))};process.on('SIGTERM',stop);process.on('SIGINT',stop);
