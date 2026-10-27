import assert from 'node:assert/strict';
import test from 'node:test';
import {createSeedProject} from '../server/seed.js';
import {restoreFilmOriginals,originalAssetId,aiCopyMatchesSettings} from '../src/film-finishing.js';
import type {Asset} from '../src/types.js';

test('export readiness distinguishes restoration from conservative copies, including legacy projects',()=>{
 const copy:Asset={id:'copy',name:'Copia',type:'video',url:'/copy.mp4',mime:'video/mp4',size:1,enhancement:{sourceAssetId:'original',preset:'ai-4k',method:'realesrgan-ncnn',width:3840,height:2160,duration:3,fps:24,createdAt:'2026-10-18',strength:.35}};
 assert.equal(aiCopyMatchesSettings(copy,undefined),true,'Old copies and absent settings retain the conservative profile');
 assert.equal(aiCopyMatchesSettings(copy,{enabled:true,strength:.35,processingProfile:'restore'}),false,'Matching intensity cannot approve a different treatment');
 const restored={...copy,enhancement:{...copy.enhancement!,profile:'restore' as const,strength:.75}};
 assert.equal(aiCopyMatchesSettings(restored,{enabled:true,strength:.75,processingProfile:'restore'}),true);
 assert.equal(aiCopyMatchesSettings(restored,{enabled:true,strength:.75}),false);
 assert.equal(aiCopyMatchesSettings(restored,{enabled:true,strength:.7,processingProfile:'restore'}),false);
 assert.equal(aiCopyMatchesSettings(undefined,undefined),false);
});

test('restoring AI originals preserves every narrative, timing and visual field in scenes and layers',()=>{
 const project=createSeedProject();
 project.assets.push({id:'source',name:'Original',type:'video',url:'/api/media/source.mp4',mime:'video/mp4',size:1},{id:'ai',name:'AI',type:'video',url:'/api/media/ai.mp4',mime:'video/mp4',size:1,enhancement:{sourceAssetId:'source',preset:'ai-4k',method:'realesrgan-ncnn',createdAt:'2026-10-17',width:3840,height:2160,duration:3,fps:24}});
 project.scenes[0]!.videoAssetId='ai';project.scenes[0]!.trimStart=.3;project.scenes[0]!.speed=.75;
 project.tracks=[{id:'track',name:'Capa',type:'video',volume:.8,muted:false,clips:[{id:'clip',assetId:'ai',sceneId:project.scenes[0]!.id,offset:.2,trimStart:.4,duration:2,speed:.5,color:{temperature:.3}}]}];
 const restored=restoreFilmOriginals(project);
 assert.deepEqual(restored.scenes[0],{...project.scenes[0],videoAssetId:'source'});
 assert.deepEqual(restored.tracks![0]!.clips[0],{...project.tracks[0]!.clips[0],assetId:'source'});
 assert.deepEqual(restored.characters,project.characters);assert.equal(restored.assets,project.assets);
 assert.equal(restoreFilmOriginals(restored),restored);
 project.assets.find(a=>a.id==='source')!.enhancement={...project.assets.find(a=>a.id==='ai')!.enhancement!,sourceAssetId:'ai'};
 assert.equal(originalAssetId('ai',project.assets),'ai');
});
