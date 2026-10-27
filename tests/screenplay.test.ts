import assert from 'node:assert/strict';
import test from 'node:test';
import type { Project, Scene } from '../src/types.js';
import { appendFountainScenes, exportFountain, formatScriptTime, MAX_FOUNTAIN_BYTES, normalizeScriptSearch, parseFountain, sceneTimings } from '../src/screenplay.js';

function scene(patch: Partial<Scene> = {}): Scene {
  return { id:'scene-original', title:'INT. CINE - NOCHE', description:'Elena entra al cine.', dialogue:'ELENA\nTodavía queda tiempo.', prompt:'Un cine iluminado.', negativePrompt:'Sin letras.', duration:5, seed:42, camera:'Travelling lento', characterIds:['elena'], assetId:'image-original', videoAssetId:'video-original', trimStart:2, look:'warm', transition:'fade', continuity:{elena:{costume:'Abrigo verde'}}, ...patch };
}
function project(patch: Partial<Project> = {}): Project {
  return { id:'film-original', name:'La última función', logline:'Una despedida entre fotogramas.', format:'16:9', fps:24, scenes:[scene()], characters:[{id:'elena',name:'Elena',role:'Personaje',description:'Proyeccionista',locked:true}], assets:[{id:'image-original',name:'Original',type:'image',mime:'image/png',size:10,url:'/api/media/original.png'}], updatedAt:'2026-10-17T12:00:00.000Z', audioAssetId:'original-score', audioVolume:.5, ...patch };
}
const fields = (item: Scene) => ({ title:item.title, description:item.description, dialogue:item.dialogue, duration:item.duration, camera:item.camera });

test('Fountain distinguishes its title page from scene headings, action and dialogue', () => {
  const parsed = parseFountain('\uFEFFTitle: La última función\r\nCredit: Un guion de\r\nAuthor: María Pérez\r\nSynopsis:\r\n   Una sala espera.\r\n\r\n# Acto uno\r\n\r\nINT. CINE - NOCHE #1#\r\n\r\nLa sala está vacía.\r\n\r\nELENA\r\n(en voz baja)\r\n¿Alguien sigue aquí?\r\n\r\nEXT. CALLE - AMANECER\r\n\r\n@Iván (V.O.)\r\nYo.\r\n');
  assert.equal(parsed.title,'La última función');
  assert.equal(parsed.logline,'Una sala espera.');
  assert.equal(parsed.scenes.length,2);
  assert.equal(parsed.scenes[0]!.title,'INT. CINE - NOCHE');
  assert.equal(parsed.scenes[0]!.description,'La sala está vacía.');
  assert.equal(parsed.scenes[0]!.dialogue,'ELENA\n(en voz baja)\n¿Alguien sigue aquí?');
  assert.deepEqual(parsed.scenes[0]!.characterNames,['ELENA']);
  assert.equal(parsed.scenes[1]!.dialogue,'Iván (V.O.)\nYo.');
  assert.deepEqual(parsed.scenes[1]!.characterNames,['Iván']);
  assert.equal(parsed.scenes[1]!.duration,5);
  assert.ok(parsed.warnings.some((warning)=>warning.includes('portada')));
});

test('cover-only and structure-only files never create empty scenes', () => {
  for (const source of ['Title: Sólo portada\nAuthor: Elena\n\n','# ACTO UNO\n\n= Sinopsis\n\n===\n\n[[Comentario]]\n','/* omitido */\n', '']) assert.deepEqual(parseFountain(source).scenes,[]);
});

test('standard notes, sections and boneyards are omitted with explicit warnings', () => {
  const parsed = parseFountain('INT. CINE - NOCHE\n\n!SILENCIO\n\n[[Nota para producción]]\n\n/*\nEXT. ESCENA DESCARTADA\n\nNo debe aparecer.\n*/\n\n# Una sección\n\n= Una sinopsis\n\n@Elena\nUno.\n\n@Iván ^\nDos.\n\n> CORTE A:\n\n~Una canción escrita.\n');
  assert.equal(parsed.scenes.length,1);
  assert.ok(parsed.scenes[0]!.description.includes('SILENCIO'));
  assert.ok(parsed.scenes[0]!.description.includes('> CORTE A:'));
  assert.ok(!parsed.scenes[0]!.description.includes('No debe aparecer'));
  assert.ok(!parsed.scenes[0]!.dialogue.includes('^'));
  assert.ok(parsed.warnings.some((warning)=>warning.includes('simultáneo')));
  assert.ok(parsed.warnings.some((warning)=>warning.includes('Secciones')));
  assert.ok(parsed.warnings.some((warning)=>warning.includes('comentados')));
  assert.ok(parsed.warnings.some((warning)=>warning.includes('notas')));
  assert.ok(parsed.warnings.some((warning)=>warning.includes('canción')));
});

test('two-space blank lines keep a multiline dialogue block together', () => {
  const parsed = parseFountain('.Una pausa\n\n@Elena\nPrimero.\n  \nDespués.\n\nUna mirada.\n');
  assert.equal(parsed.scenes[0]!.dialogue,'Elena\nPrimero.\n\nDespués.');
  assert.equal(parsed.scenes[0]!.description,'Una mirada.');
});

test('plain text is previewed as one scene without inventing a speaker', () => {
  const parsed = parseFountain('Un hilo de luz atraviesa el polvo.\n\nTodavía no hay un nombre para esta escena.');
  assert.equal(parsed.scenes.length,1);
  assert.equal(parsed.scenes[0]!.title,'Escena importada');
  assert.equal(parsed.scenes[0]!.dialogue,'');
  assert.deepEqual(parsed.scenes[0]!.characterNames,[]);
  assert.ok(parsed.warnings.some((warning)=>warning.includes('No se encontraron')));
});

test('Filmma Fountain round trip preserves every written field and named elements exactly', () => {
  const original = project({name:'La última\nfunción',logline:'Una sala.\nOtra noche.',scenes:[
    scene({title:'Apertura [[literal]] /* literal */ #no-número#',description:'\n¡Atención!\n\nEl letrero dice: **CAFÉ**.\nUna barra \\ y un / lugar.\n[[Esto sí es parte de la acción.]]\n/* También esto. */\n',dialogue:'ELENA: “¿Estás ahí?”\nIVÁN: Sí… 🌒\n\nVoz sin nombre\n  \nÚltima línea.  ',duration:5.125}),
    scene({id:'second',title:'Una línea\npartida',description:'',dialogue:'Una voz escrita sin inventar su identidad.\n\n',duration:3,camera:'',characterIds:[]}),
    scene({id:'third',title:'',description:'Sólo acción.\r\nOtra línea.',dialogue:'',duration:1,camera:'Cámara fija',characterIds:[]}),
  ]});
  const exported = exportFountain(original), parsed = parseFountain(exported);
  assert.equal(parsed.title,original.name);
  assert.equal(parsed.logline,original.logline);
  assert.deepEqual(parsed.scenes.map(({characterNames:_,...item})=>item),original.scenes.map(fields));
  assert.deepEqual(parsed.scenes.map((item)=>item.characterNames),[['Elena'],[],[]]);
  assert.deepEqual(parsed.warnings,[]);
  assert.ok(exported.includes('@ELENA\n“¿Estás ahí?”'));
  assert.ok(!exported.includes('/api/media/'));
  assert.ok(!exported.includes('video-original'));
  assert.ok(!exported.includes('Un cine iluminado.'));
});

test('edited visible Fountain invalidates the text copy while retaining duration and camera', () => {
  const original=project();
  const edited=exportFountain(original).replace('Todavía queda tiempo.','Se acabó el tiempo.');
  const parsed=parseFountain(edited);
  assert.equal(parsed.scenes[0]!.dialogue,'ELENA\nSe acabó el tiempo.');
  assert.equal(parsed.scenes[0]!.duration,5);
  assert.equal(parsed.scenes[0]!.camera,'Travelling lento');
  assert.ok(parsed.warnings.some((warning)=>warning.includes('fue editado')));
});

test('malformed or oversized preservation notes fall back to visible text without trusting fields', () => {
  const broken=parseFountain('.Una escena\n[[filmma-scene-v1 %GG]]\n\n!Texto que se ve.\n');
  assert.equal(broken.scenes[0]!.description,'Texto que se ve.');
  assert.ok(broken.warnings.some((warning)=>warning.includes('no es válida')));
  const bad=encodeURIComponent(JSON.stringify({title:'Otro título',description:'',dialogue:'',duration:999,camera:'',characterNames:[]}));
  assert.equal(parseFountain(`.Una escena\n[[filmma-scene-v1 ${bad}]]\n\n!Texto que se ve.\n`).scenes[0]!.duration,5);
});

test('previewing imports never mutates a project; confirmation appends selected scenes in source order', () => {
  const original=project(), snapshot=structuredClone(original);
  Object.freeze(original.scenes); Object.freeze(original.assets); Object.freeze(original.characters); Object.freeze(original);
  const document=parseFountain('.Primera\n\n@ELENA\n¡Hola!\n\n.Segunda\n\nUn objeto.\n\n.Tercera\n\n@Una persona nueva\nAdiós.\n');
  assert.deepEqual(original,snapshot);
  let identifier=0;
  const appended=appendFountainScenes(original,document,[2,0],()=>`imported-${++identifier}`);
  assert.deepEqual(original,snapshot);
  assert.equal(appended.scenes.length,3);
  assert.equal(appended.scenes[0],original.scenes[0]);
  assert.deepEqual(appended.scenes.slice(1).map((item)=>item.title),['Primera','Tercera']);
  assert.deepEqual(appended.scenes[1]!.characterIds,['elena']);
  assert.deepEqual(appended.scenes[2]!.characterIds,[]);
  assert.equal(appended.assets,original.assets);
  assert.equal(appended.characters,original.characters);
  assert.equal(appended.name,original.name);
  assert.equal(appended.logline,original.logline);
  assert.equal(appended.audioAssetId,original.audioAssetId);
  assert.equal(appended.scenes[1]!.assetId,undefined);
  assert.equal(appended.scenes[1]!.videoAssetId,undefined);
  assert.equal(appended.scenes[1]!.continuity,undefined);
  assert.deepEqual(appended.scenes[0]!.continuity,{elena:{costume:'Abrigo verde'}});
});

test('import snaps durations to the destination frame rate and matches accented names', () => {
  const original=project({fps:24,characters:[{id:'elena',name:'Élena',role:'Personaje',description:'',locked:true}]});
  const document=parseFountain(exportFountain(project({scenes:[scene({duration:2.13})]})));
  const imported=appendFountainScenes(original,document,[0],()=> 'new-scene');
  assert.equal(imported.scenes[1]!.duration,51/24);
  assert.deepEqual(imported.scenes[1]!.characterIds,['elena']);
});

test('imports reject overflowing scene count and invalid selection atomically', () => {
  const original=project({scenes:Array.from({length:99},(_,index)=>scene({id:`old-${index}`}))});
  const document=parseFountain('.Uno\n\nAcción.\n\n.Dos\n\nOtra acción.\n');
  assert.throws(()=>appendFountainScenes(original,document,[0,1]),/100 planos/);
  assert.equal(original.scenes.length,99);
  for (const selection of [[],[0,0],[-1],[2],[0.5]]) assert.throws(()=>appendFountainScenes(project(),document,selection),/Selecciona|selección/);
  assert.equal(appendFountainScenes(original,document,[1],()=> 'last-scene').scenes.length,100);
  assert.throws(()=>parseFountain(Array.from({length:101},(_,index)=>`.Plano ${index}\n\nAcción.\n`).join('\n')),/más de 100/);
});

test('imports reject duplicated identities and excessive element links without partial changes', () => {
  const document=parseFountain('.Uno\n\n@Elena\nHola.\n\n.Dos\n\nAdiós.\n');
  const original=project();
  assert.throws(()=>appendFountainScenes(original,document,[0],()=> 'scene-original'),/identificador único/);
  assert.throws(()=>appendFountainScenes(original,document,[0,1],()=> 'same-id'),/identificador único/);
  assert.equal(original.scenes.length,1);
  const crowded=project({characters:Array.from({length:31},(_,index)=>({id:`element-${index}`,name:'Elena',role:'Personaje',description:'',locked:false}))});
  assert.throws(()=>appendFountainScenes(crowded,document,[0],()=> 'new-id'),/más de 30 elementos/);
  assert.equal(crowded.scenes.length,1);
});

test('invalid files and schema overflow are rejected before preview/apply', () => {
  assert.throws(()=>parseFountain('binary\0data'),/guion de texto/);
  assert.throws(()=>parseFountain('a'.repeat(MAX_FOUNTAIN_BYTES+1)),/8 MB/);
  assert.throws(()=>parseFountain(`.${'T'.repeat(251)}\n\nAcción.`),/título/);
  assert.throws(()=>parseFountain(`.Plano\n\n!${'a'.repeat(12001)}`),/acción/);
  assert.throws(()=>parseFountain(`.Plano\n\n@Elena\n${'a'.repeat(12000)}`),/diálogo/);
});

test('timings follow current scene order and search is accent insensitive', () => {
  const scenes=[scene({id:'one',duration:2.5}),scene({id:'two',duration:60}),scene({id:'three',duration:1.5})];
  assert.deepEqual(sceneTimings(scenes),[{id:'one',index:0,start:0,end:2.5},{id:'two',index:1,start:2.5,end:62.5},{id:'three',index:2,start:62.5,end:64}]);
  assert.equal(formatScriptTime(64),'01:04');
  assert.equal(normalizeScriptSearch('ÉLENA / Café'),'elena / cafe');
});
