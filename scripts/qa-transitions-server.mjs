import {createApp} from '../server/app.ts';
import {mkdir,readFile,writeFile,copyFile,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,join,basename} from 'node:path';
const directory=resolve('output/qa/transitions-store');
await mkdir(join(directory,'media'),{recursive:true});
const project=JSON.parse(await readFile('data/project.json','utf8'));
project.id='qa-transitions-workflow';project.name='Prueba de transiciones y montaje';
for(const asset of project.assets){if(asset.url.startsWith('/api/media/'))await copyFile(join('data/media',basename(asset.url)),join(directory,'media',basename(asset.url)))}
const sound=join(directory,'media','qa-sound.wav');
execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','aevalsrc=0.28*sin(2*PI*220*t)*(0.3+0.7*abs(sin(PI*t))):s=48000:d=12','-t','12',sound]);
project.assets.push({id:'qa-sound',name:'Ambiente de prueba.wav',type:'audio',url:'/api/media/qa-sound.wav',mime:'audio/wav',size:(await stat(sound)).size});
project.tracks=[
{id:'qa-music',name:'Ambiente de sala',type:'audio',volume:1,muted:false,clips:[{id:'qa-audio-clip',assetId:'qa-sound',sceneId:project.scenes[0].id,offset:1,duration:8,trimStart:0,fadeIn:.5,fadeOut:.5,volume:.8}]},
{id:'qa-voice',name:'Voces',type:'audio',volume:1,muted:false,clips:[]},
{id:'qa-picture',name:'Recuerdo',type:'video',volume:1,muted:true,clips:[{id:'qa-picture-clip',assetId:project.scenes[1].assetId,sceneId:project.scenes[0].id,offset:1,duration:2,trimStart:0,opacity:.4}]}
];project.subtitleCues=[{id:'qa-cue',sceneId:project.scenes[0].id,start:2,end:4,text:'Aún queda una historia por contar.',characterId:project.characters[0].id}];project.subtitlesEnabled=true;
await writeFile(join(directory,'project.json'),JSON.stringify(project));await writeFile(join(directory,'jobs.json'),'[]');
const fixture=await createApp({dataDirectory:directory,distDirectory:resolve('output/qa/transitions-dist'),skipDiagnostics:true,codex:'/not-used',python:'/not-used'});
const server=fixture.app.listen(4317,'127.0.0.1',()=>console.log('Isolated transitions fixture ready on 4317'));
const stop=async()=>{await fixture.close();server.closeAllConnections();server.close(()=>process.exit(0))};process.on('SIGTERM',stop);process.on('SIGINT',stop);
