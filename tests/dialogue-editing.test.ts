import test from 'node:test';
import assert from 'node:assert/strict';
import {createSeedProject} from '../server/seed.js';
import {validateEditingReferences,projectSchema} from '../server/types.js';
import {dialogueLinesFromScene,dialogueScriptChanged} from '../src/dialogue.js';
import {duplicateSceneAttachments,removeSceneAttachments} from '../src/multitrack.js';
import {splitProjectScene} from '../src/timeline.js';
import {trimProjectScene} from '../src/scene-trim.js';
import {projectSavePayload} from '../src/projectSync.js';
function fixture(){
 const p=createSeedProject();p.scenes=p.scenes.slice(0,1);const s=p.scenes[0]!;s.dialogue='ELENA: Una más.';s.duration=8;
 p.dialogueLines=dialogueLinesFromScene(p,s.id);p.dialogueLines[0]!.offset=4;
 p.assets.push({id:'voice',name:'voice',type:'audio',mime:'audio/wav',url:'/api/media/voice.wav',size:10});
 p.tracks=[{id:'voice-track',name:'Voz',type:'audio',muted:false,volume:1,clips:[{id:'voice-clip',assetId:'voice',dialogueLineId:p.dialogueLines[0]!.id,sceneId:s.id,offset:4,duration:1,trimStart:0}]}];
 p.subtitleCues=[{id:`dialogue-${p.dialogueLines[0]!.id}`,sceneId:s.id,start:4,end:5,text:'Una más.'}];return p;
}
test('duplicate keeps dialogue/audio/caption links unique and removal never removes original media',()=>{
 const p=fixture(),before=structuredClone(p);p.scenes.push({...p.scenes[0]!,id:'copy'});
 const copy=duplicateSceneAttachments(p,p.scenes[0]!.id,'copy'),line=copy.dialogueLines![1]!;
 assert.notEqual(line.id,p.dialogueLines![0]!.id);assert.equal(copy.tracks![0]!.clips[1]!.dialogueLineId,line.id);
 assert.equal(copy.subtitleCues![1]!.id,`dialogue-${line.id}`);validateEditingReferences(projectSchema.parse(copy));
 const removed={...removeSceneAttachments(copy,'copy'),scenes:copy.scenes.filter(s=>s.id!=='copy')};validateEditingReferences(projectSchema.parse(removed));
 assert.deepEqual(removed.assets,before.assets);assert.deepEqual(removed.dialogueLines,before.dialogueLines);
});
test('split moves later dialogue with its audio while retaining spoken text and requiring new screenplay review',()=>{
 const p=fixture(),next=splitProjectScene(p,p.scenes[0]!.id,3,'later');
 assert.equal(next.dialogueLines![0]!.sceneId,'later');assert.equal(next.dialogueLines![0]!.offset,1);
 assert.equal(next.tracks![0]!.clips[0]!.sceneId,'later');assert.equal(next.dialogueLines![0]!.text,'Una más.');
 assert.equal(dialogueScriptChanged(next,next.dialogueLines![0]!),true);validateEditingReferences(projectSchema.parse(next));
 assert.equal(p.dialogueLines![0]!.offset,4);
});
test('trimming preserves text even outside the retained scene and shifting keeps dialogue attached',()=>{
 const p=fixture(),short=trimProjectScene(p,p.scenes[0]!.id,'end',-6*p.fps);
 assert.equal(short.dialogueLines![0]!.offset,4);assert.equal(short.dialogueLines![0]!.text,'Una más.');validateEditingReferences(projectSchema.parse(short));
 const shifted=trimProjectScene(p,p.scenes[0]!.id,'start',2*p.fps);assert.equal(shifted.dialogueLines![0]!.offset,2);assert.equal(shifted.tracks![0]!.clips[0]!.offset,2);
});
test('scene removal also removes an associated voice that was moved to another scene',()=>{
 const p=fixture();p.scenes.push({...p.scenes[0]!,id:'other'});p.tracks![0]!.clips[0]!.sceneId='other';
 const next={...removeSceneAttachments(p,p.scenes[0]!.id),scenes:[p.scenes[1]!]};assert.equal(next.tracks![0]!.clips.length,0);assert.equal(next.dialogueLines!.length,0);validateEditingReferences(projectSchema.parse(next));
});
test('save omits server-owned dialogue provenance without stripping it from local history',()=>{
 const p=fixture();const asset=p.assets.at(-1)!;Object.assign(asset,{speech:{model:'test'},lipSync:{model:'test'},generation:{model:'test'}});
 const payload=projectSavePayload(p,p);assert.equal(payload.assets.at(-1)!.speech,undefined);assert.equal(payload.assets.at(-1)!.lipSync,undefined);assert.ok(asset.speech);assert.ok(asset.lipSync);
});
