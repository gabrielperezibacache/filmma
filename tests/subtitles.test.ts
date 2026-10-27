import assert from 'node:assert/strict';
import test from 'node:test';
import type { Project, Scene, SubtitleCue } from '../src/types.js';
import { cuesFromDialogue, dialogueSourceSignature, escapeSrtText, exportSubtitlesSrt, getProjectSubtitleCues, replaceSceneSubtitleCues, resolveSubtitleCues, subtitleIssues, subtitleSourceChanged } from '../src/subtitles.js';

const scene=(patch:Partial<Scene>={}):Scene=>({id:'one',title:'El cine',description:'',dialogue:'ELENA\n¿Llegaste?\n\nIVÁN: Sí, aquí estoy.',prompt:'',negativePrompt:'',duration:4,seed:42,camera:'',characterIds:['elena','ivan'],...patch});
const project=(patch:Partial<Project>={}):Project=>({id:'film',name:'Mi película',logline:'',format:'16:9',fps:24,scenes:[scene(),scene({id:'two',title:'La calle',duration:3,dialogue:'Un nuevo día.'})],characters:[{id:'elena',name:'Élena',role:'Personaje',description:'',locked:false},{id:'ivan',name:'Iván',role:'Personaje',description:'',locked:false},{id:'other',name:'Otra persona',role:'Personaje',description:'',locked:false}],assets:[],updatedAt:'2026-10-17',...patch});
const cue=(patch:Partial<SubtitleCue>={}):SubtitleCue=>({id:'subtitle',sceneId:'one',start:0,end:2,text:'¿Llegaste?',...patch});

test('undefined subtitles stay out of preview; explicit empty also removes legacy SRT',()=>{
  const original=project();
  assert.deepEqual(resolveSubtitleCues(original),[]);
  assert.ok(exportSubtitlesSrt(original).includes('ELENA\n¿Llegaste?'));
  assert.deepEqual(resolveSubtitleCues({...original,subtitleCues:[]}),[]);
  assert.equal(exportSubtitlesSrt({...original,subtitleCues:[]}), '');
});

test('disabled captions are hidden in preview but remain in downloadable SRT',()=>{
  const original=project({subtitleCues:[cue()],subtitlesEnabled:false});
  assert.deepEqual(resolveSubtitleCues(original),[]);
  assert.equal(resolveSubtitleCues(original,{includeDisabled:true}).length,1);
  assert.ok(exportSubtitlesSrt(original).includes('¿Llegaste?'));
});

test('subtitle resolution clamps on the shared global frame grid without changing saved offsets',()=>{
  const first=cue({start:-.1,end:5}),second=cue({id:'second',sceneId:'two',start:.12,end:8}),outside=cue({id:'outside',sceneId:'two',start:4,end:6});
  const original=project({subtitleCues:[second,outside,first]}),snapshot=structuredClone(original);
  const result=resolveSubtitleCues(original);
  assert.deepEqual(result.map(({cue,startFrame,endFrame})=>[cue.id,startFrame,endFrame]),[['subtitle',0,96],['second',99,168]]);
  assert.equal(result[1]!.cue.end,8);
  assert.deepEqual(original,snapshot);
});

test('reordering scenes moves subtitles with their anchors and preserves half-open cut boundaries',()=>{
  const original=project({subtitleCues:[cue({end:4}),cue({id:'second',sceneId:'two',start:0,end:1})]});
  const result=resolveSubtitleCues({...original,scenes:[original.scenes[1]!,original.scenes[0]!]});
  assert.deepEqual(result.map(({cue,startFrame,endFrame})=>[cue.id,startFrame,endFrame]),[['second',0,24],['subtitle',72,168]]);
  const atCut=resolveSubtitleCues(original).filter((item)=>96>=item.startFrame&&96<item.endFrame);
  assert.deepEqual(atCut.map((item)=>item.cue.id),['second']);
});

test('orphan, reversed, zero-frame and nonfinite cues never enter rendering',()=>{
  const result=resolveSubtitleCues(project({subtitleCues:[cue({sceneId:'gone'}),cue({id:'reverse',start:2,end:1}),cue({id:'zero',start:1,end:1.001}),cue({id:'nan',start:NaN}),cue({id:'inf',end:Infinity}),cue({id:'blank',text:' \n '})]}));
  assert.deepEqual(result,[]);
});

test('dialogue proposals preserve words and associate only characters linked to the scene',()=>{
  const original=project(),target=original.scenes[0]!;let index=0;
  const proposal=cuesFromDialogue(target,24,original.characters,()=>`generated-${++index}`);
  assert.deepEqual(proposal.map((item)=>[item.text,item.characterId]),[['¿Llegaste?','elena'],['Sí, aquí estoy.','ivan']]);
  assert.equal(proposal[0]!.start,0);assert.equal(proposal.at(-1)!.end,4);
  assert.equal(proposal[0]!.end,proposal[1]!.start);
  assert.ok(proposal.every((item)=>Math.abs(item.start*24-Math.round(item.start*24))<1e-7&&Math.abs(item.end*24-Math.round(item.end*24))<1e-7&&item.end-item.start>=1/24));
  const unlinked=cuesFromDialogue({...target,characterIds:['elena']},24,original.characters);
  assert.equal(unlinked[1]!.characterId,undefined);assert.equal(unlinked[1]!.text,'Sí, aquí estoy.');
  assert.equal(original.subtitleCues,undefined);
});

test('dense dialogue remains complete, including punctuation, special characters and parentheticals',()=>{
  const text='(susurra)\n“Café”, dijo… ¿Sí? ¡Sí! 🌒 '.repeat(30).trim(),target=scene({dialogue:`@Élena\n${text}`,duration:1});
  const proposal=cuesFromDialogue(target,24,project().characters);
  assert.ok(proposal.length<=24);
  assert.ok(proposal.every((item)=>item.text.length<=2000&&Math.round((item.end-item.start)*24)>=1));
  assert.equal(proposal.map((item)=>item.text).join(' ').replace(/\s+/g,' '),text.replace(/\s+/g,' '));
  assert.equal(proposal.at(-1)!.end,1);
});

test('proposals do not overwrite manual text until explicit scene replacement',()=>{
  const original=project({subtitleCues:[cue({text:'Texto corregido a mano.'}),cue({id:'keep',sceneId:'two',text:'No tocar.',characterId:'other'})]});
  const snapshot=structuredClone(original);let index=0;
  const proposal=cuesFromDialogue(original.scenes[0]!,24,original.characters,()=>`proposal-${++index}`);
  assert.deepEqual(original,snapshot);
  const result=replaceSceneSubtitleCues(original,'one',proposal);
  assert.equal(result.subtitleCues!.find((item)=>item.id==='keep'),original.subtitleCues![1]);
  assert.deepEqual(result.scenes,original.scenes);
  assert.equal(result.subtitleCues!.filter((item)=>item.sceneId==='one').length,2);
  assert.deepEqual(original,snapshot);
});

test('stale script is flagged without replacing manual subtitle edits or metadata',()=>{
  const target=scene(),subtitle=cue({sourceDialogue:dialogueSourceSignature(target.dialogue),text:'Mi versión manual.'});
  assert.equal(subtitleSourceChanged(subtitle,target),false);
  assert.equal(subtitleSourceChanged({...subtitle,sourceDialogue:target.dialogue},target),false);
  const changed={...target,dialogue:'Otra frase.'},original=project({scenes:[changed],subtitleCues:[subtitle]});
  assert.equal(subtitleSourceChanged(subtitle,changed),true);
  assert.ok(subtitleIssues(original).some((issue)=>issue.kind==='stale'));
  assert.equal(original.subtitleCues![0]!.text,'Mi versión manual.');
  assert.ok(subtitle.sourceDialogue!.length<100);
});

test('readability, overlap, missing speakers and clipped timing each receive actionable warnings',()=>{
  const original=project({subtitleCues:[cue({text:'Este subtítulo es demasiado largo para leerse en un instante y tiene más de cuarenta y dos letras.',end:.2,characterId:'other'}),cue({id:'overlap',start:.1,end:5,text:'Texto.'}),cue({id:'blank',start:0,end:1,text:''}),cue({id:'orphan',sceneId:'missing'})]});
  const kinds=new Set(subtitleIssues(original).map((issue)=>issue.kind));
  for(const expected of ['readability','overlap','speaker','outside','empty','orphan'])assert.ok(kinds.has(expected as any),expected);
  assert.equal(original.subtitleCues![0]!.characterId,'other');
  const touching=project({subtitleCues:[cue({end:1}),cue({id:'next',start:1,end:2})]});
  assert.ok(!subtitleIssues(touching).some((issue)=>issue.kind==='overlap'));
});

test('replacement rejects invalid time/text/speaker/count without mutating the original',()=>{
  const original=project({subtitleCues:[cue({id:'keep',sceneId:'two'})]}),snapshot=structuredClone(original);
  for(const replacement of [[cue({text:'x'.repeat(2001)})],[cue({characterId:'other'})],[cue({id:'keep'})],[cue({sceneId:'two'})],[cue({end:8})],[cue({start:2,end:1})],Array.from({length:1000},(_,index)=>cue({id:`new-${index}`}))])assert.throws(()=>replaceSceneSubtitleCues(original,'one',replacement));
  assert.deepEqual(original,snapshot);
  const emptied=replaceSceneSubtitleCues(original,'one',[]);
  assert.equal(emptied.subtitleCues!.length,1);
});

test('materialized legacy captions clone existing cues and preserve complete legacy dialogue',()=>{
  const original=project(),legacy=getProjectSubtitleCues(original);
  assert.equal(legacy.length,2);
  assert.equal(legacy[0]!.text,'ELENA\n¿Llegaste?\nIVÁN: Sí, aquí estoy.');
  assert.equal(legacy[0]!.start,0);assert.equal(legacy[0]!.end,4);
  assert.equal(legacy[1]!.start,0);assert.equal(legacy[1]!.end,3);
  assert.deepEqual(getProjectSubtitleCues({...original,subtitleCues:[]}),[]);
  const existing=cue();const cloned=getProjectSubtitleCues({...original,subtitleCues:[existing]});
  assert.deepEqual(cloned,[existing]);assert.notEqual(cloned[0],existing);
});

test('SRT export uses frame timing, literal text and no synthetic speaker prefix',()=>{
  const original=project({subtitleCues:[cue({sceneId:'two',start:1/24,end:2/24,text:'<b>Hola & adiós</b>\n\nSegunda línea.',characterId:'elena'})],subtitlesEnabled:false});
  const srt=exportSubtitlesSrt(original);
  assert.equal(srt,'1\n00:00:04,042 --> 00:00:04,083\n&lt;b&gt;Hola &amp; adiós&lt;/b&gt;\nSegunda línea.\n');
  assert.ok(!srt.includes('Élena'));
  assert.equal(escapeSrtText('A\u0000\r\n\nB'),'A\nB');
  assert.equal(escapeSrtText('A\n\n\n\n  \n1\n00:00:00,000 --> 00:00:01,000\nB'),'A\n1\n00:00:00,000 --&gt; 00:00:01,000\nB');
});
