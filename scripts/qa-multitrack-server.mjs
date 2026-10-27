import {createApp} from '../server/app.ts';
import {mkdir,readFile,writeFile,copyFile,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,join,basename} from 'node:path';
const directory=resolve('output/qa/multitrack-store');
await mkdir(join(directory,'media'),{recursive:true});
const project=JSON.parse(await readFile('data/project.json','utf8'));
project.id='qa-multitrack-workflow';project.name='Prueba de pistas, sonido y subtítulos';
for(const asset of project.assets){if(asset.url.startsWith('/api/media/'))await copyFile(join('data/media',basename(asset.url)),join(directory,'media',basename(asset.url)))}
const sound=join(directory,'media','qa-sound.wav');
execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','8',sound]);
project.assets.push({id:'qa-sound',name:'Ambiente de prueba.wav',type:'audio',url:'/api/media/qa-sound.wav',mime:'audio/wav',size:(await stat(sound)).size});
project.tracks=[];project.subtitleCues=[];project.subtitlesEnabled=true;
await writeFile(join(directory,'project.json'),JSON.stringify(project));await writeFile(join(directory,'jobs.json'),'[]');
const fixture=await createApp({dataDirectory:directory,distDirectory:resolve('output/qa/multitrack-dist'),skipDiagnostics:true,codex:'/not-used',python:'/not-used'});
const server=fixture.app.listen(4317,'127.0.0.1',()=>console.log('Isolated multitrack fixture ready on 4317'));
const stop=async()=>{await fixture.close();server.closeAllConnections();server.close(()=>process.exit(0))};process.on('SIGTERM',stop);process.on('SIGINT',stop);
