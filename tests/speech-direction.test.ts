import test from 'node:test';
import assert from 'node:assert/strict';
import {createSeedProject} from '../server/seed';
import {dialogueLineSchema,dialogueSnapshotSchema} from '../server/types';
import {dialogueSnapshot,speechIsCurrent,applyDialogueSubtitle,dialogueSourceSignature} from '../src/dialogue';
import {directedSpeechText,spokenAlignment} from '../src/speech-direction';
import {saveDialogueRequest} from '../src/dialogue-request';
import type {Asset,ElevenLabsVoice} from '../src/types';

test('acting direction travels in provenance, not the script or subtitles; legacy voices remain current',()=>{
 const p=createSeedProject(),s=p.scenes[0]!;s.characterIds=[];s.duration=8;
 const voice:ElevenLabsVoice={engine:'elevenlabs',voiceId:'narrator',modelId:'eleven_v4',language:'es',speed:1};
 s.dialogue='Todavía estoy aquí.';
 const l={id:'l',sceneId:s.id,text:'Todavía estoy aquí.',sourceDialogue:dialogueSourceSignature(s.dialogue),delivery:'voiceover' as const,offset:0,voice};
 p.dialogueLines=[l];
 const snapshot=dialogueSnapshot(p,l);
 const a:Asset={id:'a',name:'Original voice',type:'audio',url:'/api/media/a.wav',mime:'audio/wav',size:44,speech:{...snapshot,projectId:p.id,sceneId:s.id,lineId:l.id,duration:2,sampleRate:24000,createdAt:'now',model:'eleven_v4',sourceFingerprint:'a'.repeat(64),outputSha256:'b'.repeat(64)}};
 assert.equal(speechIsCurrent(p,l,a),true);
 const directed={...l,direction:'quiet'};
 assert.equal(directedSpeechText(directed,voice),'[quietly] Todavía estoy aquí.');
 assert.equal(dialogueSnapshotSchema.parse(dialogueSnapshot(p,directed)).direction,directed.direction);
 assert.equal(directed.text,l.text);assert(!dialogueSnapshot(p,l).direction);
 assert.throws(()=>directedSpeechText(directed,{...voice,modelId:'eleven_multilingual_v2'}),/requiere/);
 for(const direction of ['[sad]','<break>','line\nline','x'.repeat(181)])assert(!dialogueLineSchema.safeParse({...l,direction}).success);
});

test('tag timestamps and unknown normalization never invent caption timing',()=>{
 const line={text:'Hola.',direction:'quiet'},text='[softly] Hola.';
 const a={source:'elevenlabs' as const,textKind:'original' as const,characters:Array.from(text),starts:Array.from(text,(_,i)=>i*.1),ends:Array.from(text,(_,i)=>(i+1)*.1)};
 assert.equal(spokenAlignment(a,line),undefined);
 const stripped={...a,characters:Array.from(line.text),starts:[0,.1,.2,.3,.4],ends:[.1,.2,.3,.4,.5]};
 assert.equal(spokenAlignment({...a,characters:['unrecognized']},line),undefined);
 assert.equal(spokenAlignment(stripped,line),stripped);
});

test('changing direction invalidates the selected recording and a pending generation click',async()=>{
 const p=createSeedProject(),s=p.scenes[0]!;s.duration=8;
 const {dialogueSourceSignature}=await import('../src/dialogue');
 const l={id:'l',sceneId:s.id,text:'Hola.',sourceDialogue:dialogueSourceSignature(s.dialogue),delivery:'voiceover' as const,offset:0,voice:{engine:'elevenlabs' as const,voiceId:'narrator',modelId:'eleven_v4',language:'es' as const,speed:1}};
 p.dialogueLines=[l];
 const a:Asset={id:'a',name:'Voice',type:'audio',url:'/api/media/a.wav',mime:'audio/wav',size:44,speech:{...dialogueSnapshot(p,l),projectId:p.id,sceneId:s.id,lineId:l.id,duration:2,sampleRate:24000,createdAt:'now',model:'eleven_v4',sourceFingerprint:'a'.repeat(64),outputSha256:'b'.repeat(64)}};
 p.assets.push(a);assert(speechIsCurrent(p,l,a));
 await assert.rejects(saveDialogueRequest(()=>p,l.id,async()=>{p.dialogueLines![0]!.direction='tenderly'}),/no se envió/);
 assert(!speechIsCurrent(p,p.dialogueLines![0]!,a));assert.throws(()=>applyDialogueSubtitle(p,l.id,a.id),/vigente/);
});
