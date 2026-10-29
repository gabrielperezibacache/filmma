import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProviderCredentialCodec} from '../server/provider-credential-codec.js';
import {createElevenLabsProvider} from '../server/speech-providers.js';

test('Unix credential format stays backwards compatible and never invokes Windows tools',async()=>{
 const codec=createProviderCredentialCodec({platform:'darwin',run:async()=>{throw new Error('Unexpected Windows tool');}}),value='{"apiKey":"fictional-private-value"}';
 assert.equal(await codec.encode(value),value);assert.equal(await codec.decode(value),value);
});
test('Windows credentials use a user-bound envelope and reject plaintext or corrupt files',async()=>{
 const calls:string[]=[],value='{"apiKey":"fixture-never-log","voice":"voz española"}';
 const codec=createProviderCredentialCodec({platform:'win32',run:async(mode,text)=>{calls.push(mode);if(mode==='protect'){assert.equal(text,value);return 'AQIDBA==';}assert.equal(text,'AQIDBA==');return value;}});
 const encoded=await codec.encode(value);assert(!encoded.includes('fixture-never-log'));assert.equal(JSON.parse(encoded).format,'filmma-dpapi-v1');assert.equal(await codec.decode(encoded),value);
 await assert.rejects(codec.decode(value));await assert.rejects(codec.decode('{"format":"filmma-dpapi-v1","ciphertext":"not$base64"}'));assert.deepEqual(calls,['protect','unprotect']);
});
test('native Windows DPAPI and ElevenLabs roundtrip keep the key out of the credential file',{skip:process.platform!=='win32',timeout:60000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'filmma-dpapi-')),key='sk_windows_fixture_only_not_a_real_key';
 const fetcher=(async(url:string|URL|Request)=>{
  const path=new URL(String(url)).pathname;
  if(path==='/v2/voices')return Response.json({voices:[{voice_id:'fixture-voice',name:'Fixture'}],has_more:false});
  if(path==='/v1/models')return Response.json([{model_id:'eleven_multilingual_v2',name:'Fixture model',can_do_text_to_speech:true,languages:[{language_id:'es'}]}]);
  if(path==='/v1/user/subscription')return Response.json({}, {status:403});
  if(path==='/v1/text-to-speech/fixture-voice')return new Response(new Uint8Array(48000),{headers:{'content-type':'audio/pcm'}});
  throw new Error('Unexpected fixture endpoint');
 }) as typeof fetch;
 try{
  const provider=createElevenLabsProvider({credentialsDirectory:directory,fetch:fetcher});await provider.connect(key);
  const serialized=await readFile(join(directory,'elevenlabs.json'),'utf8');assert(!serialized.includes(key));assert.equal(JSON.parse(serialized).format,'filmma-dpapi-v1');assert.equal((await provider.status()).ready,true);
  await provider.synthesize({text:'Referencia ficticia.',voiceId:'fixture-voice',modelId:'eleven_multilingual_v2',language:'es',speed:1,outputPath:join(directory,'copy.wav')});
  await provider.disconnect();assert.equal((await readFile(join(directory,'copy.wav'))).length,48044);
 }finally{await rm(directory,{recursive:true,force:true});}
});
