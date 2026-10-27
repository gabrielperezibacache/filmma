import test from 'node:test';
import assert from 'node:assert/strict';
import {providerReady,type VoiceProviders} from '../src/components/VoiceProviders.js';
import type {Project,QwenVoice} from '../src/types.js';

const hash='a'.repeat(64);
const project:Project={id:'movie',name:'Movie',logline:'',format:'16:9',fps:24,scenes:[],characters:[],updatedAt:'',assets:[{id:'reference',name:'Elena',type:'audio',url:'/api/media/reference.wav',mime:'audio/wav',size:100,voiceReference:{projectId:'movie',characterId:'elena',sourceAssetId:'source',sourceSha256:'b'.repeat(64),outputSha256:hash,start:0,duration:8,sampleRate:24000,createdAt:'2026-10-17',name:'Elena'}}]};
const voice:QwenVoice={engine:'qwen',voiceId:'profile-reference',referenceAssetId:'reference',referenceSha256:hash,language:'es',speed:1};
const providers:VoiceProviders={qwen:{ok:true,ready:false,modelReady:true,voices:[]},eleven:undefined,setEleven:()=>{}};

test('a saved character profile stays usable when the Hermes default reference is unavailable',()=>{
 assert.equal(providerReady(voice,providers,false,project,'elena'),true);
 assert.equal(providerReady(voice,{...providers,qwen:{ok:false,ready:false,modelReady:false}},false,project,'elena'),false);
});
test('the generate button rejects references from another character, movie, missing assets or changed hashes',()=>{
 assert.equal(providerReady(voice,providers,false,project,'other'),false);
 assert.equal(providerReady(voice,providers,false,project),false);
 assert.equal(providerReady(voice,providers,false,{...project,id:'other'},'elena'),false);
 assert.equal(providerReady(voice,providers,false,{...project,assets:[]},'elena'),false);
 assert.equal(providerReady({...voice,referenceSha256:'c'.repeat(64)},providers,false,project,'elena'),false);
 assert.equal(providerReady({...voice,voiceId:'hermes-default'},providers,false,project,'elena'),false);
});
test('Hermes remains available only with its current pinned reference, independent of saved profiles',()=>{
 const connected={...providers,qwen:{ok:true,ready:true,referenceSha256:hash,voices:[{id:'hermes-default',name:'Hermes',language:'es'}]}};
 const hermes:QwenVoice={engine:'qwen',voiceId:'hermes-default',referenceSha256:hash,language:'es',speed:1};
 assert.equal(providerReady(hermes,connected,false,project,'elena'),true);
 assert.equal(providerReady({...hermes,referenceSha256:'c'.repeat(64)},connected,false,project,'elena'),false);
 assert.equal(providerReady(hermes,providers,false,project,'elena'),false);
});
