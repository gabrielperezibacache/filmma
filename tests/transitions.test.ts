import test from 'node:test';
import assert from 'node:assert/strict';
import {createSeedProject} from '../server/seed.js';
import {projectSchema} from '../server/types.js';
import {resolveSceneTransitions,transitionOpacity,sceneTransitionGain} from '../src/transitions.js';
import {buildTimeline,splitProjectScene} from '../src/timeline.js';
import {trimProjectScene} from '../src/scene-trim.js';
import type {Project} from '../src/types.js';

test('transitions retain scene clock, frame endpoints and independent attachments',()=>{
  for(const fps of [24,25,30]) {
    const p:Project={...createSeedProject(),fps};p.scenes[1]={...p.scenes[1]!,transition:'dissolve',transitionDuration:1};p.scenes[2]={...p.scenes[2]!,transition:'dip',transitionDuration:1};
    const before=buildTimeline(p),[a,b]=resolveSceneTransitions(p);
    assert.deepEqual(buildTimeline(p),before);assert.equal(a!.durationFrames,fps);
    assert.deepEqual(transitionOpacity(a!,a!.startFrame),{incoming:0,outgoing:1});
    assert.deepEqual(transitionOpacity(a!,a!.endFrame-1),{incoming:1,outgoing:0});
    assert.equal(sceneTransitionGain([a!],a!.incoming.id,a!.startFrame),0);
    assert.equal(sceneTransitionGain([a!],'unrelated',a!.startFrame),1);
    assert.equal(transitionOpacity(b!,b!.boundaryFrame-1).outgoing,0);assert.equal(transitionOpacity(b!,b!.boundaryFrame).incoming,0);
    assert.equal(sceneTransitionGain([b!],b!.outgoing.id,b!.startFrame),1);
    assert.equal(sceneTransitionGain([b!],b!.incoming.id,b!.endFrame-1),1);
    assert.ok(projectSchema.safeParse(p).success);
  }
});
test('adjacent transitions cannot overlap inside short scenes and split keeps incoming transition',()=>{
  const p:Project=createSeedProject();p.scenes=p.scenes.map(s=>({...s,duration:1,transition:'dissolve',transitionDuration:2}));p.scenes[2]!.transition='dip';
  const list=resolveSceneTransitions(p);assert.equal(list.length,3);assert.ok(list.every((t,i)=>!i||list[i-1]!.endFrame<=t.startFrame));
  p.scenes[1]!.duration=4;const split=splitProjectScene(p,p.scenes[1]!.id,2,'part');assert.equal(split.scenes[1]!.transition,'dissolve');assert.equal(split.scenes[2]!.transition,'cut');
  p.scenes[1]!.transitionDuration=1/24;const one=resolveSceneTransitions(p)[0]!;assert.deepEqual(transitionOpacity(one,one.startFrame),{incoming:1,outgoing:0});
  assert.equal(resolveSceneTransitions({...p,scenes:[p.scenes[0]!]}).length,0);
});
function fixture():Project {
  const p:Project=createSeedProject(),id=p.scenes[0]!.id;
  p.assets.push({id:'video',type:'video',name:'v',url:'/api/media/v.mp4',mime:'video/mp4',size:1});
  p.scenes[0]={...p.scenes[0]!,videoAssetId:'video',trimStart:2};
  p.tracks=[{id:'t',name:'Capa',type:'video',volume:1,muted:false,clips:[{id:'cross',assetId:'video',sceneId:id,offset:0,duration:4,trimStart:1},{id:'late',assetId:'video',sceneId:id,offset:3,duration:2,trimStart:0}]}];
  p.subtitleCues=[{id:'cue',sceneId:id,start:1,end:4,text:'Elena',characterId:p.characters[0]!.id},{id:'removed',sceneId:id,start:0,end:.5,text:'Antes'}];return p;
}
test('left ripple trim follows retained media, captions and characters without touching screenplay or originals',()=>{
  const p=fixture(),original=structuredClone(p),s=p.scenes[0]!,result=trimProjectScene(p,s.id,'start',48);
  assert.deepEqual(p,original);assert.equal(result.assets,p.assets);assert.equal(result.characters,p.characters);
  assert.equal(result.scenes[0]!.duration,3);assert.equal(result.scenes[0]!.trimStart,4);assert.equal(result.scenes[0]!.dialogue,s.dialogue);assert.deepEqual(result.scenes[0]!.characterIds,s.characterIds);
  assert.deepEqual(result.tracks![0]!.clips.map(c=>[c.offset,c.duration,c.trimStart]),[[0,2,3],[1,2,0]]);
  assert.deepEqual(result.subtitleCues!.map(c=>[c.start,c.end,c.characterId]),[[0,2,p.characters[0]!.id]]);
  assert.equal(buildTimeline(result).totalFrames,buildTimeline(p).totalFrames-48);assert.ok(projectSchema.safeParse(result).success);
});
test('right trim and extensions preserve editable attachments and bound source/duration',()=>{
  const p=fixture(),id=p.scenes[0]!.id;
  const shorter=trimProjectScene(p,id,'end',-9999);assert.equal(shorter.scenes[0]!.duration,1);assert.equal(shorter.tracks,p.tracks);assert.equal(shorter.subtitleCues,p.subtitleCues);
  const extended=trimProjectScene(p,id,'start',-9999);assert.equal(extended.scenes[0]!.trimStart,0);assert.equal(extended.scenes[0]!.duration,7);assert.equal(extended.subtitleCues![0]!.start,3);
  assert.equal(trimProjectScene(p,id,'end',99999).scenes[0]!.duration,120);assert.equal(trimProjectScene(p,id,'end',0),p);
  assert.throws(()=>trimProjectScene(p,id,'end',NaN),/válidas/);
});

test('left trim removes sub-frame caption remnants and rejects invalid linked timing atomically',()=>{
  const p=fixture(),id=p.scenes[0]!.id;
  p.subtitleCues=[{id:'short',sceneId:id,start:0,end:.06,text:'Breve'}];
  assert.ok(projectSchema.safeParse(p).success);
  const next=trimProjectScene(p,id,'start',1);assert.deepEqual(next.subtitleCues,[]);assert.ok(projectSchema.safeParse(next).success);
  p.tracks![0]!.clips[0]!.trimStart=86400;const before=structuredClone(p);
  assert.throws(()=>trimProjectScene(p,id,'start',24),/rango/);assert.deepEqual(p,before);
});
