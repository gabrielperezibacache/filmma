import test from 'node:test';
import assert from 'node:assert/strict';
import type {Project} from '../src/types';
import {createSeedProject} from '../server/seed';
import {emptyHistory,recordHistory,travelHistory} from '../src/projectHistory';
import {mergeProjectMedia} from '../src/projectSync';

function project():Project {
  const base:Project=createSeedProject();
  base.tracks=[{id:'layer',name:'Recuerdo',type:'video',muted:true,volume:1,clips:[{id:'layer-clip',sceneId:base.scenes[0].id,assetId:base.assets[0].id,offset:1,duration:2,trimStart:0,opacity:.5}]}];
  base.subtitleCues=[{id:'cue',sceneId:base.scenes[0].id,start:1,end:3,text:'La primera historia.'}];
  return base;
}
test('undo and redo restore layered editing while retaining a take arriving in the library',()=>{
  const before=project(),after=structuredClone(before);
  after.tracks![0].clips[0].opacity=.25;after.subtitleCues![0].text='Nuestra historia.';
  const live=structuredClone(after);live.assets.push({id:'generated-after-edit',name:'Nueva toma',type:'video',url:'/api/media/after.mp4',mime:'video/mp4',size:100});
  live.scenes[0].videoAssetId='generated-after-edit';
  const undone=travelHistory(recordHistory(emptyHistory(),before,after),live,'undo');
  assert.equal(undone.project.tracks![0].clips[0].opacity,.5);assert.equal(undone.project.subtitleCues![0].text,'La primera historia.');
  assert.equal(undone.project.scenes[0].videoAssetId,'generated-after-edit');assert.ok(undone.project.assets.some(item=>item.id==='generated-after-edit'));
  const redone=travelHistory(undone.history,undone.project,'redo').project;
  assert.equal(redone.tracks![0].clips[0].opacity,.25);assert.equal(redone.subtitleCues![0].text,'Nuestra historia.');
});
test('a delayed media refresh cannot overwrite edited tracks or subtitle timing',()=>{
  const base=project(),local=structuredClone(base),remote=structuredClone(base);
  local.tracks![0].volume=.2;local.subtitleCues![0].start=2;
  remote.assets.push({id:'late',name:'Toma tardía',type:'video',url:'/api/media/late.mp4',mime:'video/mp4',size:100});remote.scenes[0].videoAssetId='late';
  const merged=mergeProjectMedia(local,remote,base);
  assert.equal(merged.tracks![0].volume,.2);assert.equal(merged.subtitleCues![0].start,2);assert.equal(merged.scenes[0].videoAssetId,'late');
});
