import test from 'node:test';
import assert from 'node:assert/strict';
import {saveDialogueRequest} from '../src/dialogue-request.ts';
import type {Project} from '../src/types.ts';
const make=():Project=>({id:'film',name:'Film',logline:'',format:'16:9',fps:24,updatedAt:'',assets:[],characters:[],scenes:[{id:'s',title:'Plano',description:'',dialogue:'Una más.',prompt:'',negativePrompt:'',duration:5,seed:1,camera:'',characterIds:[]}],dialogueLines:[{id:'line',sceneId:'s',text:'Una más.',offset:0,delivery:'voiceover',sourceDialogue:'signature',voice:{engine:'kokoro',voiceId:'ef_dora',language:'es',speed:1}}]});
test('a local generation click cannot turn into a cloud request while saving',async()=>{
 const p=make();let submitted=0;
 await assert.rejects(async()=>{await saveDialogueRequest(()=>p,'line',async()=>{await Promise.resolve();p.dialogueLines![0]!.voice={engine:'elevenlabs',voiceId:'account-voice',modelId:'eleven_multilingual_v2',language:'es',speed:1}});submitted++},/no se envió/);
 assert.equal(submitted,0);
});
test('changed words, removed intervention and switching movies invalidate pending clicks',async()=>{
 for(const mutation of [(p:Project)=>{p.dialogueLines![0]!.text='Otro texto'},(p:Project)=>{p.dialogueLines=[]},(p:Project)=>{p.id='another'}]){
  const p=make();await assert.rejects(saveDialogueRequest(()=>p,'line',async()=>mutation(p)),/no se envió/);
 }
});
test('an unchanged saved interpretation proceeds once',async()=>{const p=make();let saved=0;await saveDialogueRequest(()=>p,'line',async()=>{saved++;p.updatedAt='now'});assert.equal(saved,1)});
