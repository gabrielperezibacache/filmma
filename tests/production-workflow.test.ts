import test from 'node:test';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {GoogleProfiles} from '../server/google-profiles';
import {defaultProduction,productionStarter,PRODUCTION_TEMPLATES,suggestProductionKind} from '../src/production';
import {buildGenerationInstructions} from '../src/generation-instructions';
import {buildGoogleVideoPrompt} from '../src/google-video';
import {dialogueLinesFromScene,dialogueVoice} from '../src/dialogue';
import {projectSchema} from '../server/types';
import {createSeedProject} from '../server/seed';

const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
test('production types supply distinct structures without inventing facts, assets or characters',()=>{
 for(const t of PRODUCTION_TEMPLATES){const settings=defaultProduction(t.id),starter=productionStarter(t.id,randomUUID);assert(starter.scenes.length<=100);assert.equal(settings.kind,t.id);assert(starter.scenes.every(s=>!s.prompt&&!s.description&&!s.characterIds.length&&!s.videoAssetId&&s.duration<=15));assert.equal(starter.story.sequences.length,t.id==='social-series'?5:1);assert.equal(new Set(starter.scenes.map(s=>s.id)).size,starter.scenes.length);}
 assert.equal(suggestProductionKind('Serie de reels en Instagram con cinco episodios'),'social-series');assert.equal(suggestProductionKind('Un documental con entrevistas'),'documentary');assert.equal(suggestProductionKind('Un tren y un actor'),undefined);
});
test('the production brief survives validation and reaches local and Google prompts without changing originals',()=>{
 const p=createSeedProject(),before=structuredClone(p),scene=p.scenes[0]!;p.production={...defaultProduction('documentary'),objective:'Memoria de la estación',audience:'Público local',notes:'Recreaciones identificadas'};
 const saved=projectSchema.parse(p);assert.deepEqual(saved.production,p.production);const local=buildGenerationInstructions(p,scene),google=buildGoogleVideoPrompt(p,scene,8,[]);assert(local.includes('Do not invent factual events'));assert(google.includes('Recreaciones identificadas'));assert(!google.includes('engine-registry'));assert.deepEqual(p.assets,before.assets);assert.deepEqual(p.characters,before.characters);assert.deepEqual(p.scenes,before.scenes);
 const changed={...p,production:{...p.production,kind:'commercial' as const}};assert.notEqual(buildGenerationInstructions(changed,scene),local);assert.equal(projectSchema.safeParse({...p,production:{...p.production,episodes:1000}}).success,false);
});
test('new narration uses the selected voice engine while existing character voices remain stable',()=>{
 const p=createSeedProject();p.production={...defaultProduction('short'),voiceEngine:'qwen'};const scene=p.scenes[0]!;scene.dialogue='Una nueva narración.';const lines=dialogueLinesFromScene(p,scene.id);assert.equal(lines[0]!.voice?.engine,'qwen');const character=p.characters[0]!;character.voice={engine:'kokoro',voiceId:'ef_dora',language:'es',speed:1};assert.equal(dialogueVoice(p,{...lines[0]!,characterId:character.id}).engine,'kokoro');
});
test('legacy Chrome pairing migrates without exposing tokens and reconnecting a revoked profile keeps its identity',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'filmma-profiles-')),file=join(dir,'google-browser.json'),ext='a'.repeat(32),secret='fixture-private-token';
 try{await writeFile(file,JSON.stringify({extensionId:ext,tokenSha256:hash(secret),connectedAt:new Date().toISOString(),version:'0.2.0'}),{mode:0o600});const profiles=new GoogleProfiles(file);await profiles.init();const legacy=profiles.authenticate(ext,secret);assert.equal(profiles.public().length,1);assert.equal(JSON.parse(await readFile(file+'.v1-backup','utf8')).tokenSha256,hash(secret));assert(!JSON.stringify(profiles.public()).includes(hash(secret)));
 const clientId=randomUUID(),p=await profiles.add({extensionId:ext,clientId,tokenSha256:hash('first'),connectedAt:new Date().toISOString(),alias:'Producción'});await profiles.revoke(p.id);assert.throws(()=>profiles.authenticate(ext,'first'));const restarted=new GoogleProfiles(file);await restarted.init();const next=await restarted.add({extensionId:ext,clientId,tokenSha256:hash('second'),connectedAt:new Date().toISOString()});assert.equal(next.id,p.id);assert.equal(next.alias,'Producción');assert.equal(restarted.authenticate(ext,'second').id,p.id);assert.equal(restarted.authenticate(ext,secret).id,legacy.id);assert(!JSON.stringify(restarted.public()).includes('second'));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('isolated desktop ports accept their own resources while rejecting unrelated local and external origins',async()=>{
 const {isLocalOrigin}=await import('../server/app');assert(isLocalOrigin('http://127.0.0.1:4351','4351'));assert(!isLocalOrigin('http://127.0.0.1:4352','4351'));assert(!isLocalOrigin('https://example.com:4351','4351'));assert(!isLocalOrigin('http://name@127.0.0.1:4351','4351'));assert(!isLocalOrigin('http://127.0.0.1:4351','garbage'));
});

test('engine registry reuses local weights and gives each remote model its own metadata directory',async()=>{
 const {default:express}=await import('express'),{registerEngineRegistry,recordGoogleModel}=await import('../server/engine-registry');
 const directory=await mkdtemp(join(tmpdir(),'filmma-engines-')),root=join(directory,'app'),dataDirectory=join(directory,'data'),modelDirectory=join(directory,'existing-hermes'),modelFile=join(modelDirectory,'qwen.gguf');await mkdir(join(root,'runtime'),{recursive:true});await mkdir(modelDirectory);await writeFile(modelFile,'original-fixture-weights');
 const app=express();registerEngineRegistry({app,root,dataDirectory,system:async()=>({runtime:{models:[]}}),voices:async()=>({qwen:{modelReady:true,connection:{modelPath:modelFile}},eleven:{ready:true,models:[{id:'eleven_multilingual_v2',name:'Multilingual v2'},{id:'eleven_v3',name:'Eleven v3'}]}})});const server=app.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as any).port}/api/workflow/engines`;
 try{const first=await (await fetch(url)).json();assert.equal(new Set(first.engines.map((e:any)=>e.directory)).size,first.engines.length);assert.equal(first.engines.find((e:any)=>e.id==='qwen').modelDirectory,modelDirectory);assert.equal(first.engines.filter((e:any)=>e.id.startsWith('elevenlabs-')).length,2);assert(!JSON.stringify(first).includes('apiKey'));assert.equal(await readFile(modelFile,'utf8'),'original-fixture-weights');await recordGoogleModel(dataDirectory,'flow','Omni · fixture');const second=await (await fetch(url+'?refresh=true')).json();const remote=second.engines.find((e:any)=>e.modelLabel==='Omni · fixture');assert.equal(remote.location,'remote');assert.equal(remote.ready,false);assert.equal(JSON.parse(await readFile(join(remote.directory,'engine.json'),'utf8')).modelLabel,'Omni · fixture');assert.equal(await readFile(modelFile,'utf8'),'original-fixture-weights');}
 finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await rm(directory,{recursive:true,force:true});}
});
