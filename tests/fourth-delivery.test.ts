import type { Project } from '../src/types';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedProject } from '../server/seed';
import { projectSchema, validateEditingReferences } from '../server/types';
import { applyDirectionSnapshot, applyReviewedDirection, directionSnapshot, directionDecisionRows, saveDirectionAlternative, removeDirectionAlternative, updateShotPlanning } from '../src/shot-planning';
import { buildGenerationInstructions, instructionReferenceIds } from '../src/generation-instructions';
import { buildStoryboard, storyboardFrameTasks, storyboardFrameEntries, collectStoryboardFrames, storyboardSampleTime, storyboardHtml, storyboardCsv } from '../src/storyboard';

test('shot planning and alternatives are independent snapshots; reviewed application preserves story, cast, voices, source and editing', () => {
  let p:Project=createSeedProject(), shot=p.scenes[0]!, id=shot.id;
  p=updateShotPlanning(p,id,{opening:'Elena sostiene la llave.',closing:'La llave queda sobre la mesa.',notes:'Rodar el sonido de la llave por separado.'});
  p.scenes[0]!.cinematography={framing:'close-up',movement:'locked'};
  p=saveDirectionAlternative(p,id,'Cercanía','close');
  const saved=structuredClone(p.scenes[0]!.planning!.alternatives![0]!);
  p.scenes[0]!.cinematography!.framing='wide';p.scenes[0]!.prompt='Una nueva intención';
  assert.equal(saved.cinematography!.framing,'close-up');
  const before=structuredClone(p), out=applyReviewedDirection(p,structuredClone(p),id,saved);
  assert.equal(out.scenes[0]!.cinematography!.framing,'close-up');
  const {prompt,negativePrompt,camera,cinematography,planning,...rest}=out.scenes[0]!;
  const {prompt:a,negativePrompt:b,camera:c,cinematography:d,planning:e,...old}=before.scenes[0]!;
  assert.deepEqual(rest,old);assert.deepEqual(out.characters,before.characters);assert.deepEqual(out.dialogueLines,before.dialogueLines);assert.deepEqual(out.assets,before.assets);assert.deepEqual(out.story,before.story);
  assert.equal(planning!.notes,e!.notes);assert.deepEqual(planning!.alternatives,e!.alternatives);assert.deepEqual(p,before);
  assert.equal(removeDirectionAlternative(out,id,'close').scenes[0]!.planning!.alternatives!.length,0);
  const changed=updateShotPlanning(p,id,{notes:'Cambio después de abrir la revisión'});
  assert.throws(()=>applyReviewedDirection(changed,p,id,saved),/proyecto cambió/);
  assert.deepEqual(applyReviewedDirection({...p,updatedAt:'2030-01-01T00:00:00Z'},p,id,saved).scenes,out.scenes);
});

test('planning limits and schema reject overlong text, duplicate IDs and a seventh alternative',()=>{
  let p:Project=createSeedProject(),id=p.scenes[0]!.id;
  assert.throws(()=>updateShotPlanning(p,id,{opening:'x'.repeat(1201)}),/límite/);
  assert.throws(()=>updateShotPlanning(p,id,{notes:'x'.repeat(4001)}),/límite/);
  assert.throws(()=>saveDirectionAlternative(p,id,' '),/nombre/);
  for(let i=0;i<6;i++)p=saveDirectionAlternative(p,id,`Opción ${i}`,`alt-${i}`);
  assert.throws(()=>saveDirectionAlternative(p,id,'Siete'),/seis/);
  assert.equal(projectSchema.safeParse(p).success,true);
  const invalid=structuredClone(p);invalid.scenes[0]!.planning!.alternatives![1]!.id='alt-0';
  assert.throws(()=>validateEditingReferences(projectSchema.parse(invalid)),/alternativ/i);
  invalid.scenes[0]!.planning!.opening='x'.repeat(1201);assert.equal(projectSchema.safeParse(invalid).success,false);
});

test('final instructions include explicit opening and ending, effective cinema, story and cast, but exclude production notes',()=>{
  let p:Project=createSeedProject(),id=p.scenes[0]!.id;
  p=updateShotPlanning(p,id,{opening:'Inicio QA inequívoco',closing:'Final QA inequívoco',notes:'NOTAS PRIVADAS QA NO PROMPT'});
  const s=p.scenes[0]!;s.cinematography={framing:'close-up',movement:'locked'};
  const text=buildGenerationInstructions(p,s);
  assert.match(text,/Planned opening: Inicio QA inequívoco/);assert.match(text,/Intended ending: Final QA inequívoco/);assert.match(text,/Effective continuity/);assert.doesNotMatch(text,/NOTAS PRIVADAS/);
  const override=buildGenerationInstructions(p,s,{prompt:'OVERRIDE',negativePrompt:'NEGATIVE'});assert.ok(override.startsWith('OVERRIDE\n'));assert.match(override,/Avoid: NEGATIVE/);
  assert.deepEqual(instructionReferenceIds(p,s,'text'),[]);assert.ok(instructionReferenceIds(p,s,'references').every(id=>s.characterIds.includes(id)));
  assert.deepEqual(directionSnapshot(applyDirectionSnapshot(p,s.id,directionSnapshot(s)).scenes[0]!).opening,s.planning!.opening);
});

test('bookends follow the edited frame grid, trim, playback speed and original EOF; still references appear once',()=>{
  const p=createSeedProject(),s=p.scenes[0]!;s.duration=4;s.trimStart=1;s.speed=2;
  assert.equal(storyboardSampleTime(s,24,20,24,'opening'),1);
  assert.equal(storyboardSampleTime(s,24,20,24,'closing'),1+95/24*2);
  assert.equal(storyboardSampleTime(s,30,20,24,'closing'),1+119/30*2);
  assert.equal(storyboardSampleTime(s,24,3,24,'closing'),2.9999);
  s.speed=.5;assert.equal(storyboardSampleTime(s,24,20,24,'closing'),1+95/24*.5);
  p.scenes=p.scenes.slice(0,2);assert.equal(storyboardFrameTasks(buildStoryboard(p)).length,2);
  s.videoAssetId='missing';const tasks=storyboardFrameTasks(buildStoryboard(p));assert.deepEqual(tasks.slice(0,2).map(t=>t.role),['opening','closing']);assert.equal(tasks.length,3);
});

test('bookend decoding is serial, handles a missing source explicitly and never publishes an aborted result',async()=>{
  const p=createSeedProject();p.scenes=p.scenes.slice(0,2);p.scenes[0]!.videoAssetId='take';p.assets.push({id:'take',name:'Technical QA',type:'video',mime:'video/mp4',url:'/api/media/take.mp4',size:1});
  const tasks=storyboardFrameTasks(buildStoryboard(p));let active=0,maximum=0;const roles:string[]=[];
  const result=await collectStoryboardFrames(tasks,async(_s,_signal,role)=>{active++;maximum=Math.max(maximum,active);roles.push(role);await new Promise(r=>setTimeout(r,2));active--;return{status:'ready',sampleRole:role}},new AbortController().signal);
  assert.equal(maximum,1);assert.deepEqual(roles,['opening','closing','middle']);assert.equal(storyboardFrameEntries(tasks[0]!.shot,result).length,2);assert.equal(storyboardFrameEntries(tasks[0]!.shot,{},'bookends').length,2);assert.equal(storyboardFrameEntries(tasks[0]!.shot,result,'middle').length,1);
  const stop=new AbortController();let published=0;const cancelled=await collectStoryboardFrames(tasks,async()=>{stop.abort();return{status:'ready'}},stop.signal,()=>published++);assert.deepEqual(cancelled,{});assert.equal(published,0);
  p.scenes[0]!.videoAssetId='absent';const missing=await collectStoryboardFrames(storyboardFrameTasks(buildStoryboard(p)),async()=>({status:'ready'}),new AbortController().signal);assert.equal(missing[`${p.scenes[0]!.id}:opening`]!.status,'failed');
});

test('standalone storyboard exports planning and two source times safely without pretending references are generated frames',()=>{
 let p:Project=createSeedProject();p.scenes=p.scenes.slice(0,1);const id=p.scenes[0]!.id;
 p=updateShotPlanning(p,id,{opening:'<script>opening</script>',closing:'=end',notes:'<img src=x onerror=alert(1)>'});p=saveDirectionAlternative(p,id,'<b>alternativa</b>','alt');p.scenes[0]!.videoAssetId='take';p.assets.push({id:'take',name:'Original QA',type:'video',mime:'video/mp4',url:'/api/media/take.mp4',size:1});
 const thumbs={ [`${id}:opening`]:{status:'ready' as const,dataUrl:'data:image/jpeg;base64,AAAA',sourceTime:.5},[`${id}:closing`]:{status:'ready' as const,dataUrl:'data:image/jpeg;base64,BBBB',sourceTime:2.25}};
 const html=storyboardHtml(p,thumbs);assert.match(html,/Inicio editado/);assert.match(html,/Último instante editado/);assert.match(html,/fuente 0.5000 s/);assert.match(html,/fuente 2.2500 s/);assert.match(html,/&lt;script&gt;opening/);assert.doesNotMatch(html,/<script>|<img src=x/);assert.match(html,/&lt;b&gt;alternativa/);
 const csv=storyboardCsv(p,thumbs);assert.equal(csv.split('\r\n')[0]!.split(',').length,24);assert.match(csv,/"0.5000","2.2500"/);assert.ok(csv.includes('Inicio editado: Disponible\nÚltimo instante editado: Disponible'));assert.match(csv,/"'=end"/);
});

test('alternative comparison reveals changed period notes, including dormant historical context',()=>{const p=createSeedProject(),s=p.scenes[0]!;s.cinematography={era:'1980s',historicalContext:{notes:'A',location:'Valparaíso'}};const a=directionDecisionRows(s).find(r=>r.key==='historicalNotes')!;assert.equal(a.value,'A');delete s.cinematography.era;const b=directionDecisionRows(s).find(r=>r.key==='historicalNotes')!;assert.equal(b.value,'');assert.match(b.stored!,/Valparaíso/);});
