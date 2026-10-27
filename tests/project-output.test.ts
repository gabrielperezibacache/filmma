import test from 'node:test';
import assert from 'node:assert/strict';
import {createSeedProject} from '../server/seed.js';
import {validateProjectFrameRateChange} from '../src/project-output.js';

test('output FPS preserves seconds, sources, dialogue and character continuity',()=>{
 const project={...createSeedProject(),fps:60 as const};
 const before=structuredClone(project);
 validateProjectFrameRateChange(project);
 assert.deepEqual(project,before);
});

test('lower FPS never silently discards brief subtitles, clips or animation keys',()=>{
 const project=createSeedProject();
 project.subtitleCues=[{id:'cue',sceneId:project.scenes[0]!.id,start:0,end:1/60,text:'Una más.'}];
 assert.throws(()=>validateProjectFrameRateChange(project),/subtítulo.*menos de un fotograma/);
 project.subtitleCues=[];
 project.tracks=[{id:'layer',name:'Capa de Elena',type:'video',volume:1,muted:false,clips:[{id:'clip',assetId:'demo-04',sceneId:project.scenes[0]!.id,offset:0,duration:1/60,trimStart:0}]}];
 assert.throws(()=>validateProjectFrameRateChange(project),/clip.*menos de un fotograma/);
 const clip=project.tracks[0]!.clips[0]!;
 clip.duration=2;
 clip.keyframes=[0,1/60].map((time,index)=>({id:`key-${index}`,time,x:0,y:0,scale:1,opacity:1,easing:'linear'}));
 assert.throws(()=>validateProjectFrameRateChange(project),/fotogramas clave.*coincidirían/);
 validateProjectFrameRateChange({...project,fps:60});
 assert.equal(clip.keyframes.length,2);
 assert.equal(clip.keyframes[1]!.time,1/60);
});

test('lower FPS cannot hide a previously visible layer or cue at the last frame',()=>{
 const previous={...createSeedProject(),fps:60 as const};
 previous.scenes=[{...previous.scenes[0]!,duration:1}];
 previous.tracks=[{id:'layer',name:'Detalle final',type:'video',muted:false,volume:1,clips:[{id:'clip',assetId:'demo-01',sceneId:previous.scenes[0]!.id,offset:59/60,duration:3/60,trimStart:0}]}];
 assert.throws(()=>validateProjectFrameRateChange({...previous,fps:24},previous),/clip.*fuera del montaje/);
 previous.tracks=[];
 previous.subtitleCues=[{id:'cue',sceneId:previous.scenes[0]!.id,start:59/60,end:62/60,text:'Fin'}];
 assert.throws(()=>validateProjectFrameRateChange({...previous,fps:24},previous),/subtítulo.*fuera de su plano/);
 // Existing off-screen editorial material is retained without inventing a new restriction.
 previous.subtitleCues[0]!.start=2;previous.subtitleCues[0]!.end=3;
 validateProjectFrameRateChange({...previous,fps:24},previous);
});
