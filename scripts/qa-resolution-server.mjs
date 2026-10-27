import {createApp} from '../server/app.ts';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
const directory=resolve('output/qa/resolution-store');
await mkdir(join(directory,'media'),{recursive:true});
if(!process.env.FILMMA_QA_REUSE){
 const project=JSON.parse(await readFile('data/project.json','utf8'));
 project.id='qa-resolution-workflow';project.name='Prueba de resolución 4K';
 for(const asset of project.assets)if(asset.url.startsWith('/api/media/'))await copyFile(join('data/media',basename(asset.url)),join(directory,'media',basename(asset.url)));
 await copyFile('runtime/validation/resolution-4k/ltx-864x480.mp4',join(directory,'media','ltx-864x480.mp4'));
 project.assets.push({id:'qa-native-864',name:'LTX · 864 × 480',type:'video',url:'/api/media/ltx-864x480.mp4',mime:'video/mp4',size:515438});
 project.scenes=[{...project.scenes[0],duration:25/24,videoAssetId:'qa-native-864',trimStart:0,speed:1,transition:'cut'}];
 project.tracks=[];project.subtitleCues=[];project.subtitlesEnabled=false;delete project.musicAssetId;
 await writeFile(join(directory,'project.json'),JSON.stringify(project));await writeFile(join(directory,'jobs.json'),'[]');
}
const fixture=await createApp({dataDirectory:directory,distDirectory:resolve('output/qa/resolution-dist'),skipDiagnostics:true,codex:'/not-used',python:'/not-used'});
const server=fixture.app.listen(4317,'127.0.0.1',()=>console.log('Resolution QA ready on 4317'));
const stop=async()=>{await fixture.close();server.closeAllConnections();server.close(()=>process.exit(0))};process.on('SIGTERM',stop);process.on('SIGINT',stop);
