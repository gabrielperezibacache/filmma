import test from 'node:test';
import assert from 'node:assert/strict';
import { removeDialogueLine } from '../src/dialogue-removal.js';
import type { Asset, LipSyncProvenance, Project } from '../src/types.js';

const video=(id:string,extra:Partial<Asset>={}):Asset=>({id,name:id,type:'video',url:`/api/media/${id}.mp4`,mime:'video/mp4',size:42,...extra});
const lip=(sourceAssetId:string,extra:Partial<LipSyncProvenance>={}):LipSyncProvenance=>({projectId:'project',sceneId:'scene',lineId:'line',sourceAssetId,audioAssetId:'voice',sourceSha256:'a'.repeat(64),audioSha256:'b'.repeat(64),outputSha256:'c'.repeat(64),sourceFingerprint:'d'.repeat(64),dialogue:{text:'Una historia más.',sourceDialogue:'signature',delivery:'dialogue',voice:{engine:'kokoro',voiceId:'ef_dora',language:'es',speed:1}},lineOffset:0,trimStart:2,speed:.5,sceneDuration:6,duration:6,width:640,height:360,fps:25,frames:150,model:'musetalk',createdAt:'2026-10-18T00:00:00Z',...extra});
function fixture():Project {
  return {id:'project',name:'Film',logline:'',fps:25,format:'16:9',updatedAt:'today',characters:[],
    assets:[video('original'),video('synced',{lipSync:lip('original')}),{id:'voice',name:'Voice',type:'audio',url:'/api/media/voice.wav',mime:'audio/wav',size:30}],
    scenes:[{id:'scene',title:'Escena',description:'',dialogue:'Una historia más.',prompt:'',negativePrompt:'',duration:6,seed:1,camera:'',characterIds:[],videoAssetId:'synced',trimStart:0,speed:1,audio:{volume:.6,muted:true,fadeIn:.2},takeAssetIds:['original','synced']}],
    dialogueLines:[{id:'line',sceneId:'scene',text:'Una historia más.',delivery:'voiceover',offset:0,sourceDialogue:'signature',audioAssetId:'voice'},{id:'other',sceneId:'scene',text:'Otra.',delivery:'voiceover',offset:4,sourceDialogue:'signature'}],
    tracks:[{id:'voices',name:'Voces',type:'audio',muted:false,volume:1,clips:[{id:'clip',assetId:'voice',dialogueLineId:'line',sceneId:'scene',offset:0,duration:2,trimStart:0},{id:'unrelated',assetId:'voice',dialogueLineId:'other',sceneId:'scene',offset:4,duration:1,trimStart:0}]}],
    subtitleCues:[{id:'dialogue-line',sceneId:'scene',text:'Una historia más.',start:0,end:2},{id:'manual',sceneId:'scene',text:'Independiente',start:3,end:4}],subtitlesEnabled:true};
}

test('removing an applied lip-sync intervention restores original clock and preserves assets, screenplay, audio controls and unrelated edits',()=>{
  const project=fixture(),before=structuredClone(project),next=removeDialogueLine(project,'line');
  assert.deepEqual(project,before);
  assert.equal(next.scenes[0]!.videoAssetId,'original');
  assert.equal(next.scenes[0]!.trimStart,2);assert.equal(next.scenes[0]!.speed,.5);
  assert.deepEqual(next.scenes[0]!.audio,before.scenes[0]!.audio);
  assert.equal(next.scenes[0]!.dialogue,before.scenes[0]!.dialogue);
  assert.deepEqual(next.assets,before.assets);
  assert.deepEqual(next.dialogueLines!.map(line=>line.id),['other']);
  assert.deepEqual(next.tracks![0]!.clips.map(clip=>clip.id),['unrelated']);
  assert.deepEqual(next.subtitleCues!.map(cue=>cue.id),['manual']);
});

test('AI descendants and repeated synchronization compose clocks without deleting any takes',()=>{
  const project=fixture();
  project.assets.push(video('synced-again',{lipSync:lip('synced',{trimStart:1,speed:2})}),video('ai',{enhancement:{sourceAssetId:'synced-again',preset:'ai-4k',method:'realesrgan-ncnn',createdAt:'today',width:3840,height:2160,duration:6,fps:25}}));
  Object.assign(project.scenes[0]!,{videoAssetId:'ai',trimStart:.25,speed:1});
  const next=removeDialogueLine(project,'line');
  assert.equal(next.scenes[0]!.videoAssetId,'original');assert.equal(next.scenes[0]!.trimStart,2.75);assert.equal(next.scenes[0]!.speed,1);
  assert.deepEqual(new Set(next.scenes[0]!.takeAssetIds),new Set(['original','synced','synced-again','ai']));
  assert.equal(next.assets.length,project.assets.length);
});

test('copies used in several scenes are restored while another intervention and selected take remain intact',()=>{
  const project=fixture();
  project.assets.push(video('other-sync',{lipSync:lip('synced',{lineId:'other'})}));
  project.scenes.push({...project.scenes[0]!,id:'also-selected',videoAssetId:'synced'}, {...project.scenes[0]!,id:'different-line',videoAssetId:'other-sync'});
  const next=removeDialogueLine(project,'line');
  assert.deepEqual(next.scenes.map(scene=>scene.videoAssetId),['original','original','other-sync']);
});

test('missing sources and cycles fail atomically instead of leaving embedded speech behind',()=>{
  for(const missingOrCycle of ['missing','synced']){
    const project=fixture();project.assets.find(asset=>asset.id==='synced')!.lipSync!.sourceAssetId=missingOrCycle;
    const before=structuredClone(project);
    assert.throws(()=>removeDialogueLine(project,'line'),/original|ciclo/);
    assert.deepEqual(project,before);
  }
});

test('plain voiceover removal preserves the selected unrelated take',()=>{
  const project=fixture();project.scenes[0]!.videoAssetId='original';
  const next=removeDialogueLine(project,'line');assert.deepEqual(next.scenes,project.scenes);assert.deepEqual(next.assets,project.assets);
});

test('unrepresentable combined speed is rejected without silently changing the shot',()=>{
  const project=fixture();project.assets.find(asset=>asset.id==='synced')!.lipSync!.speed=4;project.scenes[0]!.speed=2;
  const before=structuredClone(project);assert.throws(()=>removeDialogueLine(project,'line'),/velocidades/);assert.deepEqual(project,before);
});
