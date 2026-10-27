import assert from 'node:assert/strict';
import test from 'node:test';
import {mergeProjectMedia,projectSavePayload,sameProjectContent} from '../src/projectSync.js';
import {createSeedProject} from '../server/seed.js';
import {assignScenePatch} from '../src/scene-source.js';

test('server timestamp and property ordering do not create edits, but character continuity and undo states do',()=>{
 const original=createSeedProject(),next=structuredClone(original);next.updatedAt='later';assert.equal(sameProjectContent(original,next),true);
 const reordered=Object.fromEntries(Object.entries(next).reverse()) as typeof next;assert.equal(sameProjectContent(original,reordered),true);
 next.characters[0].description+=' · reloj antiguo';assert.equal(sameProjectContent(original,next),false);assert.equal(sameProjectContent(next,original),false);
});
import {restoreHistorySnapshot} from '../src/projectHistory.js';
import {listSceneTakes} from '../src/takes.js';
import type {Project} from '../src/types.js';

test('a delayed poll preserves a locally chosen clip and imports completed media',()=>{
 const base=createSeedProject();base.scenes[0]!.videoAssetId='old';
 const local=structuredClone(base);local.scenes[0]!.videoAssetId='chosen';
 const remote=structuredClone(base);remote.scenes[0]!.videoAssetId='generated';
 remote.assets.push({id:'generated',name:'Take',type:'video',mime:'video/mp4',url:'/api/media/generated.mp4',size:100});
 const merged=mergeProjectMedia(local,remote,base);
 assert.equal(merged.scenes[0]!.videoAssetId,'chosen');assert.ok(merged.assets.some(a=>a.id==='generated'));
 assert.equal(mergeProjectMedia(base,remote,base).scenes[0]!.videoAssetId,'generated');
});

test('pending saves, explicit removal and project switches do not accept stale clips',()=>{
 const base=createSeedProject(), remote=structuredClone(base);remote.scenes[0]!.videoAssetId='generated';
 assert.equal(mergeProjectMedia(base,remote,base,false).scenes[0]!.videoAssetId,undefined);
 const removed=structuredClone(base);removed.scenes[0]!.clearVideoAsset=true;
 assert.equal(mergeProjectMedia(removed,remote,base).scenes[0]!.videoAssetId,undefined);
 const other=structuredClone(base);other.id='another-film';
 assert.equal(mergeProjectMedia(other,remote,base),other);
});


test('a generated source brings its own trim and speed without erasing newer local adjustments',()=>{
 const base=createSeedProject();base.scenes[0]!.videoAssetId='old';base.scenes[0]!.trimStart=5;base.scenes[0]!.speed=2;base.scenes[0]!.color={temperature:.4};
 const remote=structuredClone(base);remote.scenes[0]!.videoAssetId='generated';remote.scenes[0]!.trimStart=0;remote.scenes[0]!.speed=1;
 const fresh=mergeProjectMedia(base,remote,base).scenes[0]!;
 assert.equal(fresh.videoAssetId,'generated');assert.equal(fresh.trimStart,0);assert.equal(fresh.speed,1);assert.deepEqual(fresh.color,{temperature:.4});assert.deepEqual(fresh.characterIds,base.scenes[0]!.characterIds);
 const local=structuredClone(base);local.scenes[0]!.trimStart=.5;local.scenes[0]!.speed=.75;local.scenes[0]!.description='Updated dialogue direction';
 const edited=mergeProjectMedia(local,remote,base).scenes[0]!;
 assert.equal(edited.videoAssetId,'generated');assert.equal(edited.trimStart,.5);assert.equal(edited.speed,.75);assert.equal(edited.description,'Updated dialogue direction');
 const speedOnly=structuredClone(base);speedOnly.scenes[0]!.speed=.5;
 const partial=mergeProjectMedia(speedOnly,remote,base).scenes[0]!;assert.equal(partial.trimStart,0);assert.equal(partial.speed,.5);
});

test('batch finishing merges layer sources while preserving newer edits and manual choices',()=>{
 const base=createSeedProject();base.tracks=[{id:'layer',name:'Overlay',type:'video',muted:false,volume:1,clips:[{id:'clip',assetId:'original',sceneId:base.scenes[0]!.id,offset:1,duration:2,trimStart:.25,speed:.5}]}];
 const remote=structuredClone(base);remote.tracks![0]!.clips[0]!.assetId='ai';
 remote.assets.push({id:'ai',name:'AI',type:'video',url:'/api/media/ai.mp4',mime:'video/mp4',size:1});
 const local=structuredClone(base);local.tracks![0]!.clips[0]!.offset=2;local.tracks![0]!.clips[0]!.trimStart=.75;local.tracks![0]!.clips[0]!.speed=1.5;
 local.tracks![0]!.clips[0]!.keyframes=[{id:'k',time:.1,x:7,y:9,scale:1.2,opacity:.8,easing:'hold'}];
 const merged=mergeProjectMedia(local,remote,base),clip=merged.tracks![0]!.clips[0]!;
 assert.deepEqual(clip,{...local.tracks![0]!.clips[0],assetId:'ai'});
 local.tracks![0]!.clips[0]!.assetId='manual';assert.equal(mergeProjectMedia(local,remote,base).tracks![0]!.clips[0]!.assetId,'manual');
 assert.equal(mergeProjectMedia(base,remote,base,false).tracks![0]!.clips[0]!.assetId,'original');
 local.tracks![0]!.clips=[];assert.deepEqual(mergeProjectMedia(local,remote,base).tracks![0]!.clips,[]);
});

test('save payload marks unchanged layer choices but not new or manually replaced clips',()=>{
 const base=createSeedProject();base.tracks=[{id:'layer',name:'Overlay',type:'video',muted:false,volume:1,clips:[{id:'clip',assetId:'original',sceneId:base.scenes[0]!.id,offset:0,duration:2,trimStart:0}]}];
 const local=structuredClone(base);local.tracks![0]!.clips[0]!.trimStart=.5;
 assert.equal(projectSavePayload(local,base).tracks![0]!.clips[0]!.preserveAsset,true);
 local.tracks![0]!.clips[0]!.assetId='manual';assert.equal(projectSavePayload(local,base).tracks![0]!.clips[0]!.preserveAsset,false);
 assert.equal(projectSavePayload(local,null).tracks![0]!.clips[0]!.preserveAsset,false);
});

test('saving many takes omits immutable prompts without altering local state or lineage',()=>{
 const project=createSeedProject();
 const generation={projectId:project.id,sceneId:project.scenes[0]!.id,model:'ltx-2b' as const,seed:42,prompt:'x'.repeat(30000),negativePrompt:'',createdAt:new Date().toISOString(),width:512,height:288,numFrames:25,fps:24,steps:4,conditioningMode:'image' as const,referenceAssetIds:['demo-01'],characterIds:[]};
 project.assets=Array.from({length:150},(_,i)=>({id:`take-${i}`,name:`Take ${i}`,type:'video' as const,url:`/api/media/take-${i}.mp4`,mime:'video/mp4',size:100,generation:{...generation,seed:i}}));
 project.assets[1]!.enhancement={sourceAssetId:'take-0',preset:'ai-4k',method:'realesrgan-ncnn',createdAt:generation.createdAt,width:3840,height:2160,duration:1,fps:24};
 const before=structuredClone(project),payload=projectSavePayload(project,project);
 assert.ok(JSON.stringify(project).length>4*1024*1024);
 assert.ok(JSON.stringify(payload).length<100000);
 assert.ok(payload.assets.every(asset=>!('generation' in asset)));
 assert.deepEqual(payload.assets[1]!.enhancement,project.assets[1]!.enhancement);
 assert.deepEqual(project,before);
 assert.equal(project.assets[0]!.generation!.prompt.length,30000);
});

test('imported alternatives stay discoverable through selection, background polls and undo',()=>{
 const base:Project=createSeedProject();
 base.assets.push(...['old','new'].map(id=>({id,name:id,type:'video' as const,url:`/api/media/${id}.mp4`,mime:'video/mp4',size:100})));
 base.scenes[0]!.videoAssetId='old';base.scenes[0]!.trimStart=.5;base.scenes[0]!.speed=1.5;
 const chosen=structuredClone(base);chosen.scenes[0]=assignScenePatch(chosen.scenes[0]!,{videoAssetId:'new'},chosen.assets);
 assert.deepEqual(new Set(listSceneTakes(chosen,chosen.scenes[0]!.id).map(t=>t.asset.id)),new Set(['old','new']));
 const remote=structuredClone(base);remote.scenes[0]!.takeAssetIds=['old','new'];
 const merged=mergeProjectMedia(base,remote,base,false);
 assert.equal(merged.scenes[0]!.videoAssetId,'old');assert.deepEqual(merged.scenes[0]!.takeAssetIds,['old','new']);
 const undone=restoreHistorySnapshot(chosen,chosen,base,[base.scenes[0]!.id]);
 assert.equal(undone.scenes[0]!.videoAssetId,'old');assert.equal(undone.scenes[0]!.trimStart,.5);assert.equal(undone.scenes[0]!.speed,1.5);
 assert.equal(listSceneTakes(undone,undone.scenes[0]!.id).length,2);
});
