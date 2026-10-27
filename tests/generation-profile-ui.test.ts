import assert from 'node:assert/strict';
import test from 'node:test';
import {generationFrames} from '../server/generation-limits.js';
import {createSeedProject} from '../server/seed.js';
import {generationDimensions,generationDurationMaximum,generationMontageDuration,generationPreview,longProfileReferenceConflict,longProfileValidationMessage,RECOMMENDED_GENERATION_SECONDS,sourceCoverage,H3_NATIVE_MAX_FRAMES,H3_NATIVE_MAX_VIDEO_TOKENS,H3_NATIVE_PROFILE,H3_HD_PROFILE,H3_HD_MAX_FRAMES,H3_HD_MAX_VIDEO_TOKENS,h3NativeMaximumFrames,h3NativeVideoTokens,type H3LongValidation} from '../src/generation-profile.js';
import {parseNumberDraft} from '../src/components/number-input.js';

test('long validation copy requires the matching local MiniMax evidence',()=>{
 const validation:H3LongValidation={status:'media-verified',model:'minimax-h3',mode:'text-to-video',parameters:{width:512,height:320,numFrames:345,fps:24,steps:20,memoryProfile:'h3-long-ssd'}};
 const confirmed='Prueba de 14,375 s completada en este Mac.';
 const unverified='Sin una prueba larga verificada en el diagnóstico de este Mac.';
 assert.equal(longProfileValidationMessage(validation),confirmed);
 for(const missing of [undefined,null,{}])assert.equal(longProfileValidationMessage(missing),unverified);
 for(const patch of [{status:'running'},{status:'failed'},{model:'ltx-2b'},{mode:'image-to-video'},{parameters:undefined}]){
  assert.equal(longProfileValidationMessage({...validation,...patch}),unverified);
 }
 for(const patch of [{numFrames:22},{numFrames:344},{fps:30},{width:320,height:512},{width:768},{height:288},{steps:4},{memoryProfile:'conservative'}]){
  assert.equal(longProfileValidationMessage({...validation,parameters:{...validation.parameters,...patch}}),unverified);
 }
});

test('native budget permits balanced long takes and detail eight seconds without changing timing or resolution',()=>{
 assert.equal(H3_NATIVE_MAX_FRAMES,345);assert.equal(H3_NATIVE_MAX_VIDEO_TOKENS,35000);
 const pilot=generationPreview('minimax-h3',1,15,'16:9','draft',2,'detail');
 assert.equal(pilot.width,1024);assert.equal(pilot.height,576);assert.equal(pilot.numFrames,22);
 assert.equal(pilot.steps,20);assert.equal(pilot.memoryProfile,H3_NATIVE_PROFILE);
 assert.equal(pilot.supervised,true);assert.equal(pilot.long,false);assert.equal(pilot.native,true);assert.equal(pilot.blockedReason,undefined);
 const balanced=generationPreview('minimax-h3',15,15,'16:9','quality',20,'balanced');
 assert.equal(balanced.numFrames,345);assert.equal(balanced.seconds,14.375);assert.equal(balanced.width,768);assert.equal(balanced.height,448);assert.equal(balanced.videoTokens,34272);assert.equal(balanced.blockedReason,undefined);
 const eight=generationPreview('minimax-h3',8,15,'16:9','quality',20,'detail');
 assert.equal(eight.numFrames,192);assert.equal(eight.videoTokens,32832);assert.equal(eight.blockedReason,undefined);assert.equal(eight.maximumNativeSeconds,8);
 for(const duration of [209/24,12,15]){
  const preview=generationPreview('minimax-h3',duration,15,'16:9','quality',20,'detail');
  assert.equal(preview.numFrames,generationFrames(duration,'minimax-h3'));
  assert.equal(preview.limit,duration,'Duration is preserved; the budget never substitutes fewer frames');
  assert.match(preview.blockedReason!,/hasta 8 s nativos/);
  assert.equal(preview.width,1024);assert.equal(preview.height,576);
 }
 const legacy=generationPreview('minimax-h3',15,15,'16:9','quality');
 assert.equal(legacy.width,512);assert.equal(legacy.height,320);assert.equal(legacy.numFrames,345);assert.equal(legacy.blockedReason,undefined);
 for(const resolution of ['balanced','detail','hd720'] as const){
  const ltx=generationPreview('ltx-2b',3,15,'16:9','quality',20,resolution);
  assert.equal(ltx.native,false);assert.equal(ltx.steps,4);assert.equal(ltx.memoryProfile,undefined);assert.equal(ltx.width,768);
 }
});

test('all native geometries and per-proportion duration caps respect the visual-token budget',()=>{
 for(const resolution of ['balanced','detail','hd720'] as const)for(const format of ['16:9','9:16','1:1','4:3','4:5','2.39:1'])for(const long of [false,true]){
  const size=generationDimensions(format,long,'quality',resolution),max=h3NativeMaximumFrames(size.width,size.height);
  assert(size.width*size.height<=(resolution==='balanced'?768*448:resolution==='hd720'?1280*736:1024*576));assert(Math.max(size.width,size.height)<=(resolution==='balanced'?768:resolution==='hd720'?1280:1024));
  assert(size.width>=256&&size.height>=256);assert.equal(size.width%32,0);assert.equal(size.height%32,0);
  assert.equal((max-5)%17,0);assert(max<=345);assert(h3NativeVideoTokens(size.width,size.height,max)<=35000);
  if(max<345)assert(h3NativeVideoTokens(size.width,size.height,max+17)>35000);
  if(resolution==='balanced')assert.equal(max,345);
 }
 assert.deepEqual(generationDimensions('16:9',true,'quality','detail'),{width:1024,height:576});
 assert.deepEqual(generationDimensions('9:16',true,'quality','detail'),{width:576,height:1024});
 assert.deepEqual(generationDimensions('1:1',true,'quality','detail'),{width:768,height:768});
 assert.deepEqual(generationDimensions('16:9',true,'quality','balanced'),{width:768,height:448});
 assert.deepEqual(generationDimensions('9:16',true,'quality','balanced'),{width:448,height:768});
 assert.deepEqual(generationDimensions('1:1',true,'quality','balanced'),{width:576,height:576});
 assert.deepEqual(generationDimensions('16:9',true,'quality','hd720'),{width:1280,height:736});
 assert.deepEqual(generationDimensions('9:16',true,'quality','hd720'),{width:736,height:1280});
 assert.deepEqual(generationDimensions('1:1',true,'quality','hd720'),{width:960,height:960});
});

test('HD720 selects the separate long profile only beyond the short budget and in supported orientations',()=>{
 const five=generationPreview('minimax-h3',5,15,'16:9','quality',20,'hd720');
 assert.equal(five.width,1280);assert.equal(five.height,736);assert.equal(five.numFrames,107);assert.equal(five.blockedReason,undefined);
 assert.equal(five.maximumNativeFrames,124);assert.equal(five.maximumNativeSeconds,124/24);
 for(const duration of [124/24,5.167]){
  const edge=generationPreview('minimax-h3',duration,15,'16:9','quality',20,'hd720');
  assert.equal(edge.numFrames,124);assert.equal(edge.videoTokens,34040);assert.equal(edge.blockedReason,undefined);
 }
 assert.equal(five.memoryProfile,H3_NATIVE_PROFILE);assert.equal(five.hdLong,false);
 assert.equal(H3_HD_MAX_FRAMES,345);assert.equal(H3_HD_MAX_VIDEO_TOKENS,93840);
 for(const format of ['16:9','9:16'])for(const duration of [141/24,8,15]){
  const long=generationPreview('minimax-h3',duration,15,format,'draft',2,'hd720');
  assert.equal(long.limit,duration);assert.equal(long.width,format==='16:9'?1280:736);assert.equal(long.height,format==='16:9'?736:1280);
  assert.equal(long.numFrames,generationFrames(duration,'minimax-h3'));assert.equal(long.blockedReason,undefined);
  assert.equal(long.memoryProfile,H3_HD_PROFILE);assert.equal(long.hdLong,true);assert.equal(long.steps,20);assert.equal(long.fps,24);
  assert.equal(long.maximumNativeFrames,345);assert(long.videoTokens<=93840);
  if(duration===15){assert.equal(long.numFrames,345);assert.equal(long.seconds,14.375);assert.equal(long.videoTokens,93840)}
 }
 for(const format of ['1:1','4:3','4:5','2.39:1']){
  const blocked=generationPreview('minimax-h3',15,15,format,'quality',20,'hd720');
  assert.equal(blocked.limit,15);assert.equal(blocked.numFrames,345);assert.equal(blocked.memoryProfile,H3_NATIVE_PROFILE);assert.equal(blocked.hdLong,false);
  assert.match(blocked.blockedReason!,/perfil HD largo sólo admite 16:9 o 9:16/);
  assert.deepEqual({width:blocked.width,height:blocked.height},generationDimensions(format,true,'quality','hd720'));
 }
 const short1024:H3LongValidation={status:'media-verified',model:'minimax-h3',mode:'text-to-video',parameters:{memoryProfile:H3_NATIVE_PROFILE,width:1024,height:576,numFrames:22,fps:24,steps:20}};
 assert.match(longProfileValidationMessage([short1024],generationPreview('minimax-h3',1,15,'16:9','quality',20,'hd720')),/^Sin una prueba verificada/);
 const shortHD:H3LongValidation={...short1024,parameters:{...short1024.parameters,width:1280,height:736}};
 const longHD=generationPreview('minimax-h3',15,15,'16:9','quality',20,'hd720');
 assert.match(longProfileValidationMessage([shortHD],longHD),/^Todavía sin prueba verificada/);
 const exactHD:H3LongValidation={...shortHD,parameters:{...shortHD.parameters,memoryProfile:H3_HD_PROFILE,numFrames:345}};
 assert.match(longProfileValidationMessage([shortHD,exactHD],longHD),/14,375 s a 1280 × 736 completada/);
 assert.match(longProfileValidationMessage([exactHD],generationPreview('minimax-h3',8,15,'16:9','quality',20,'hd720')),/^Todavía sin prueba verificada/);

});

test('validation copy is bound to the selected resolution, profile, duration and steps',()=>{
 const selected=generationPreview('minimax-h3',1,15,'16:9','quality',20,'detail');
 const matching:H3LongValidation={status:'media-verified',model:'minimax-h3',mode:'text-to-video',parameters:{memoryProfile:H3_NATIVE_PROFILE,width:1024,height:576,numFrames:22,fps:24,steps:20}};
 assert.match(longProfileValidationMessage(matching,selected),/1024 × 576 completada/);
 for(const patch of [{memoryProfile:'h3-long-ssd'},{width:512,height:320},{numFrames:345},{steps:4},{fps:25}]){
  assert.match(longProfileValidationMessage({...matching,parameters:{...matching.parameters,...patch}},selected),/^Sin una prueba verificada/);
 }
 const old:H3LongValidation={...matching,parameters:{memoryProfile:'h3-long-ssd',width:512,height:320,numFrames:345,fps:24,steps:20}};
 assert.match(longProfileValidationMessage(old,selected),/^Sin una prueba verificada/);
 assert.match(longProfileValidationMessage([old,matching],selected),/1024 × 576 completada/);
 assert.match(longProfileValidationMessage([{...matching,outputAvailable:false}],selected),/^Sin una prueba verificada/);
 assert.match(longProfileValidationMessage([old,matching],generationPreview('minimax-h3',15,15,'16:9','quality',20,'balanced')),/^Sin una prueba verificada/);
 assert.match(longProfileValidationMessage([old,matching],generationPreview('minimax-h3',8,15,'16:9','quality',20,'detail')),/^Sin una prueba verificada/);
 assert.match(longProfileValidationMessage(matching,generationPreview('minimax-h3',15,15,'16:9','quality',20,'detail')),/^Sin una prueba verificada/);
});

test('UI native frame clock matches generation and never promises 15 exact seconds for H3',()=>{
 for(const model of ['minimax-h3','ltx-2b'] as const)for(const duration of [1,2,3,4,8,12,14.375,15]){
  const preview=generationPreview(model,duration,15,'16:9','draft');
  assert.equal(preview.numFrames,generationFrames(model==='ltx-2b'?Math.min(duration,4):duration,model));
  assert(preview.seconds<=Math.min(duration,15));
 }
 const maximum=generationPreview('minimax-h3',15,20,'16:9','quality');
 assert.equal(maximum.seconds,14.375);assert.equal(maximum.numFrames,345);assert.equal(maximum.memoryProfile,'h3-long-ssd');
 assert.equal(generationPreview('minimax-h3',15,3,'16:9','quality').seconds,14.375);
});
test('long profile uses bounded orientation, steps and text reference blocking without changing project',()=>{
 for(const [format,width,height]of [['16:9',512,320],['9:16',320,512],['1:1',384,384]] as const){
  const profile=generationPreview('minimax-h3',15,15,format,'quality',200);assert.equal(profile.width,width);assert.equal(profile.height,height);assert.equal(profile.steps,20);
 }
 assert.equal(generationPreview('minimax-h3',3,15,'16:9','draft').memoryProfile,undefined);
 const project=createSeedProject(),snapshot=JSON.stringify(project),scene=project.scenes[0];
 assert.equal(longProfileReferenceConflict(scene,project),true);assert.equal(JSON.stringify(project),snapshot);
 const textScene={...scene,assetId:undefined,characterIds:[],endAssetId:undefined};
 assert.equal(longProfileReferenceConflict(textScene,project),false);
 assert.equal(longProfileReferenceConflict({...textScene,endAssetId:'end'},project),true);
});
test('coverage respects source trimming and speed before offering to shorten montage',()=>{
 const scene=createSeedProject().scenes[0];
 assert.deepEqual(sourceCoverage({...scene,duration:15},14.375,24),{available:14.375,fitted:14.375,short:true,canFit:true});
 assert.equal(sourceCoverage({...scene,duration:4,trimStart:2,speed:2},10,24).short,false);
 const exhausted=sourceCoverage({...scene,trimStart:10},1,24);assert.equal(exhausted.canFit,false);assert.equal(exhausted.fitted,0);
});
test('pre-generation montage fit preserves the native clock across 25/30 fps projects and repeated clicks',()=>{
 for(const fps of [25,30]){
  const project={...createSeedProject(),fps};let duration=15;
  for(let click=0;click<2;click++){
   const preview=generationPreview('minimax-h3',15,duration,project.format,'draft');
   assert.equal(preview.numFrames,345);
   duration=generationMontageDuration(preview)!;
   assert.equal(duration,14.375);
   assert.equal(generationFrames(duration,'minimax-h3'),345);
  }
 }
 assert.equal(generationMontageDuration({seconds:22/24}),undefined);
});

test('duration edits accept fractional seconds and preserve the cap on the native frame clock',()=>{
 assert.equal(RECOMMENDED_GENERATION_SECONDS,3);
 assert.equal(generationDurationMaximum('minimax-h3'),15);assert.equal(generationDurationMaximum('ltx-2b'),4);
 for(const duration of [1.1,2.5,3.75,4.001,8.25,14.375,14.999,15]){
  const native=generationPreview('minimax-h3',duration,120,'4:3','draft');
  assert.equal(native.numFrames,generationFrames(duration,'minimax-h3'));
  assert(native.seconds<=duration);
 }
 assert.equal(generationPreview('minimax-h3',15,5,'16:9','quality').seconds,14.375);
 assert.equal(generationPreview('minimax-h3',3,120,'16:9','draft').seconds,56/24);
 assert.equal(generationPreview('ltx-2b',4,1,'16:9','draft').limit,4);
});

test('numeric drafts support replacing a value, comma decimals and explicit errors without coercion',()=>{
 for(const draft of ['', ' ', '.', ',', '16', '0', '-1', 'NaN', 'Infinity', '2.5.3', '1e1'])assert.equal(parseNumberDraft(draft,1,15).valid,false,draft);
 assert.deepEqual(parseNumberDraft('2,5',1,15),{valid:true,value:2.5});
 assert.deepEqual(parseNumberDraft(' 14.375 ',1,15),{valid:true,value:14.375});
 assert.deepEqual(parseNumberDraft('3.',1,15),{valid:true,value:3});
 assert.deepEqual(parseNumberDraft('15',1,15),{valid:true,value:15});
 assert.equal(parseNumberDraft('4.001',1,4).valid,false);
 assert.equal(parseNumberDraft('2.5',2,20,true).valid,false);
 assert.deepEqual(parseNumberDraft('20',2,20,true),{valid:true,value:20});
});

test('all output proportions use native dimensions within the selected memory budget',()=>{
 for(const format of ['16:9','9:16','1:1','4:3','4:5','2.39:1'])for(const long of [false,true])for(const quality of ['draft','quality']){
  const {width,height}=generationDimensions(format,long,quality);
  assert(width>=256&&height>=256,`${format}: minimum edge`);
  assert.equal(width%32,0);assert.equal(height%32,0);
  assert(width*height<=(long?512*320:864*480),`${format}: area`);
  assert(Math.max(width,height)<=(long?512:quality==='quality'?768:512),`${format}: maximum edge`);
  if(format==='4:5'||format==='9:16')assert(height>width);
  else if(format!=='1:1')assert(width>height);
 }
 assert.deepEqual(generationDimensions('4:3',false,'draft'),{width:512,height:384});
 assert.deepEqual(generationDimensions('2.39:1',false,'quality'),{width:768,height:320});
});
