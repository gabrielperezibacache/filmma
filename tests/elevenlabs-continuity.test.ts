import test from 'node:test';
import assert from 'node:assert/strict';
import {createSeedProject} from '../server/seed.js';
import {characterVoiceSchema,projectSchema,speechProvenanceSchema} from '../server/types.js';
import {dialogueSnapshot,dialogueSourceSignature,applyDialogueSubtitle,speechIsCurrent} from '../src/dialogue.js';
import {alignSubtitleToVoice} from '../src/subtitle-voice.js';
import {createHash} from 'node:crypto';
import type {Project,Asset} from '../src/types.js';
function movie(){
 const p=createSeedProject() as Project;p.scenes=p.scenes.slice(0,1);const scene=p.scenes[0]!;scene.duration=4;scene.dialogue='ELENA: Hola.';scene.characterIds=['elena'];
 p.characters=p.characters.filter(c=>c.id==='elena');p.characters[0]!.voice={engine:'elevenlabs',voiceId:'voice-elena',modelId:'eleven_multilingual_v2',language:'es',speed:1};
 p.dialogueLines=[{id:'line',sceneId:scene.id,characterId:'elena',text:'Hola.',sourceDialogue:dialogueSourceSignature(scene.dialogue),delivery:'dialogue',offset:1}];
 const snapshot=dialogueSnapshot(p,p.dialogueLines[0]!);
 const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,canonical(v[k])])):v;
 const asset:Asset={id:'voice',name:'Voz de Elena',type:'audio',url:'/api/media/voice.wav',mime:'audio/wav',size:48044,speech:{...snapshot,projectId:p.id,sceneId:scene.id,lineId:'line',duration:1,sampleRate:24000,createdAt:new Date().toISOString(),model:'eleven_multilingual_v2',outputSha256:'a'.repeat(64),sourceFingerprint:createHash('sha256').update(JSON.stringify(canonical(snapshot))).digest('hex'),alignment:{source:'elevenlabs',textKind:'original',characters:['H','o','l','a','.'],starts:[.125,.25,.375,.5,.625],ends:[.25,.375,.5,.625,.75]},timingStatus:'aligned'}};
 p.assets.push(asset);p.dialogueLines[0]!.audioAssetId=asset.id;return{p,asset};
}

test('legacy voice profiles keep their exact identity after schema validation; performance edits invalidate speech',()=>{
 const {p,asset}=movie();const voice=p.characters[0]!.voice!;assert.deepEqual(characterVoiceSchema.parse(voice),voice);assert(speechIsCurrent(p,p.dialogueLines![0]!,asset));
 p.characters[0]!.voice={...voice,engine:'elevenlabs',modelId:'eleven_multilingual_v2',settings:{stability:.8}};
 assert(!speechIsCurrent(p,p.dialogueLines![0]!,asset));assert.equal(asset.speech!.voice.engine,'elevenlabs');assert.equal((asset.speech!.voice as any).settings,undefined);
});

test('speech timings exclude padding while retaining edited subtitles and character links',()=>{
 const {p,asset}=movie(),before=structuredClone(p);const next=applyDialogueSubtitle(p,'line',asset.id),cue=next.subtitleCues![0]!;
 assert.equal(cue.start,1.125);assert.equal(cue.end,1.75);assert.equal(cue.characterId,'elena');assert.equal(cue.text,'Hola.');
 cue.text='Texto editado por el director';cue.start=0;cue.end=3;
 const aligned=alignSubtitleToVoice(next,cue.id);assert.equal(aligned.subtitleCues![0]!.text,cue.text);assert.equal(aligned.subtitleCues![0]!.start,27/24);assert.equal(aligned.subtitleCues![0]!.end,1.75);assert.deepEqual(p,before);
 const parsed=projectSchema.parse(aligned);assert.deepEqual(parsed.assets.find(a=>a.id===asset.id)!.speech!.alignment,asset.speech!.alignment);
 p.characters[0]!.continuity={costume:'Otro abrigo'};assert.throws(()=>applyDialogueSubtitle(p,'line',asset.id),/vigente/);
});

test('project provenance rejects timings beyond audio or with inconsistent arrays',()=>{
 const {asset}=movie();assert(speechProvenanceSchema.safeParse(asset.speech).success);
 for(const patch of [{ends:[.25]}, {starts:[.5,.25,.375,.5,.625]}, {ends:[.25,.375,.5,.625,1.1]}])assert(!speechProvenanceSchema.safeParse({...asset.speech,alignment:{...asset.speech!.alignment,...patch}}).success);
});
