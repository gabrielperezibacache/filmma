import test from 'node:test';
import assert from 'node:assert/strict';
import {createSeedProject} from '../server/seed';
import {projectSchema} from '../server/types';
import {applySceneSourceTrim,trimProjectScene} from '../src/scene-trim';
import {sourceTrim} from '../src/sourceTrim';
import {splitProjectScene,buildTimeline} from '../src/timeline';
import {resolveTimelineClips} from '../src/multitrack';
import {evaluateLayerTransform} from '../src/visual-effects';
import {assignScenePatch} from '../src/scene-source';
import {syncMediaClock} from '../src/playback';
import type {Project} from '../src/types';
function fixture():Project {
 const p:Project=createSeedProject(),scene=p.scenes[0]!;
 p.assets.push({id:'v',name:'Original',type:'video',mime:'video/mp4',url:'/api/media/v.mp4',size:1});
 scene.videoAssetId='v';scene.trimStart=.125;scene.speed=.25;scene.color={exposure:.3,temperature:.2};
 p.tracks=[{id:'v2',name:'Memoria',type:'video',muted:true,volume:1,clips:[{id:'c',assetId:'v',sceneId:scene.id,offset:0,duration:5,trimStart:.125,speed:.25,keyframes:[{id:'k1',time:0,x:-20,y:0,scale:.5,opacity:1,easing:'ease-in-out'},{id:'k2',time:4,x:20,y:10,scale:1,opacity:.4,easing:'linear'}]}]}];
 p.subtitleCues=[{id:'cue',sceneId:scene.id,start:1,end:4,text:'Elena',characterId:p.characters[0]!.id}];return p;
}
test('slow source offsets stay exact through split, trim and linked animation',()=>{
 const p=fixture(),scene=p.scenes[0]!,clip=p.tracks![0]!.clips[0]!,before=structuredClone(p);
 const trimmed=trimProjectScene(p,scene.id,'start',1),next=trimmed.tracks![0]!.clips[0]!;
 assert.equal(trimmed.scenes[0]!.trimStart,.125+.25/24);assert.equal(next.trimStart,.125+.25/24);
 assert.equal(resolveTimelineClips(trimmed)[0]!.sourceStartFrame,next.trimStart*24);
 assert.deepEqual(evaluateLayerTransform(next,1,24),evaluateLayerTransform(clip,1+1/24,24));
 assert.equal(trimmed.scenes[0]!.dialogue,scene.dialogue);assert.deepEqual(trimmed.scenes[0]!.characterIds,scene.characterIds);
 assert.equal(trimmed.subtitleCues![0]!.characterId,p.characters[0]!.id);
 const split=splitProjectScene(p,scene.id,2,'second');assert.equal(split.scenes[1]!.trimStart,.625);assert.deepEqual(split.scenes[1]!.color,scene.color);assert.equal(split.scenes[1]!.speed,.25);
 assert.equal(buildTimeline(split).totalFrames,buildTimeline(p).totalFrames);assert.deepEqual(p,before);assert.ok(projectSchema.safeParse(trimmed).success);
});
test('original-source selection uses mounted speed and rebases attached content',()=>{
 const p=fixture(),patch=sourceTrim(9,33,4,24,.25);assert.deepEqual(patch,{trimStart:.375,duration:4});
 const result=applySceneSourceTrim(p,p.scenes[0]!.id,patch);
 assert.equal(result.tracks![0]!.clips[0]!.trimStart,.375);assert.equal(result.tracks![0]!.clips[0]!.keyframes![0]!.time,-1);
 assert.equal(result.subtitleCues![0]!.start,0);assert.equal(result.subtitleCues![0]!.end,3);assert.ok(projectSchema.safeParse(result).success);
 assert.throws(()=>sourceTrim(0,24,4,24,4),/segundo/);
});
test('finishing schema rejects impossible values and duplicate animation frames while retaining cut endpoints',()=>{
 const p=fixture();p.tracks![0]!.clips[0]!.keyframes![0]!.time=-1;assert.ok(projectSchema.safeParse(p).success);
 for(const speed of [0,5]) {const next=structuredClone(p);next.scenes[0]!.speed=speed;assert.equal(projectSchema.safeParse(next).success,false)}
 for(const color of [{exposure:3},{saturation:-1},{contrast:2},{temperature:2}]) {const next=structuredClone(p);next.scenes[0]!.color=color;assert.equal(projectSchema.safeParse(next).success,false)}
 const next=structuredClone(p),keys=next.tracks![0]!.clips[0]!.keyframes!;keys[1]!.time=keys[0]!.time+.001;assert.equal(projectSchema.safeParse(next).success,false);
});
test('preview playback rate preserves pitch, resets to normal and holds exhausted source',()=>{
 const raw={duration:4,readyState:1,currentTime:0,volume:1,muted:false,paused:true,playbackRate:1,preservesPitch:false,pause(){raw.paused=true},play(){raw.paused=false;return Promise.resolve()}};
 const element=raw as unknown as HTMLMediaElement;
 syncMediaClock(element,{time:1,rate:.25,playing:true,volume:1,fps:24});assert.equal(element.playbackRate,.25);assert.equal(element.preservesPitch,true);
 syncMediaClock(element,{time:5,rate:4,playing:true,volume:1,fps:24});assert.equal(element.paused,true);assert.equal(element.muted,true);
 syncMediaClock(element,{time:1,playing:true,volume:1,fps:24});assert.equal(element.playbackRate,1);assert.equal(element.muted,false);
});

test('replacing a take resets its clock, while original and enhanced versions share edits',()=>{
 const p=fixture(),scene=p.scenes[0]!;p.assets.push({id:'derived',name:'Versión',type:'video',url:'/api/media/d.mp4',mime:'video/mp4',size:1,enhancement:{sourceAssetId:'v',preset:'upscale',method:'ffmpeg-lanczos',createdAt:'now',width:320,height:180,duration:4,fps:24}});
 const enhanced=assignScenePatch(scene,{videoAssetId:'derived'},p.assets);assert.equal(enhanced.trimStart,scene.trimStart);assert.equal(enhanced.speed,scene.speed);assert.deepEqual(enhanced.color,scene.color);
 const original=assignScenePatch(enhanced,{videoAssetId:'v'},p.assets);assert.equal(original.speed,scene.speed);
 const unrelated=assignScenePatch(scene,{videoAssetId:'another'},p.assets);assert.equal(unrelated.trimStart,0);assert.equal(unrelated.speed,1);assert.deepEqual(unrelated.characterIds,scene.characterIds);
});
