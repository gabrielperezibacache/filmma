import {chromium,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseFountain} from '../src/screenplay.ts';
const root='http://127.0.0.1:4317', out='output/qa';
const liveBefore=createHash('sha256').update(await readFile('data/project.json')).digest('hex');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1100},locale:'es-CL',reducedMotion:'reduce',acceptDownloads:true});
const page=await context.newPage(),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
const project=async()=>(await(await fetch(root+'/api/bootstrap')).json()).project;
const saved=async(check)=>expect.poll(async()=>check(await project()),{timeout:10000}).toBeTruthy();
const nav=name=>page.getByRole('navigation',{name:'Secciones del estudio'}).getByRole('button',{name,exact:true});
const undo=()=>page.getByRole('button',{name:'Deshacer cambio',exact:true}).click();
const redo=()=>page.getByRole('button',{name:'Rehacer cambio',exact:true}).click();
const check=async(name,fn)=>{await fn();checks.push({name,passed:true});console.log(name)};
try{
 const reset=JSON.parse(await readFile('data/project.json','utf8'));reset.id='qa-story-workflow';reset.name='Prueba de montaje y continuidad';const response=await fetch(root+'/api/project',{method:'PUT',headers:{'Content-Type':'application/json','X-Filmma-Client':'filmma'},body:JSON.stringify(reset)});if(!response.ok)throw Error('Fixture reset failed');
 await page.goto(root);await page.getByRole('heading',{name:/La sala de montaje/}).waitFor();
 await check('Source trim applies frame range, undo and redo restore source offsets',async()=>{
  const before=await project();await page.locator('.source-trim>summary').click();
  await expect(page.getByLabel('Fotograma de salida')).not.toBeDisabled();
  await page.getByLabel('Fotograma de entrada').fill('24');await page.getByLabel('Fotograma de salida').fill('60');
  await page.getByRole('button',{name:'Aplicar recorte',exact:true}).click();
  await saved(p=>p.scenes[0].trimStart===1&&p.scenes[0].duration===1.5);
  await undo();await saved(p=>p.scenes[0].duration===before.scenes[0].duration&&(p.scenes[0].trimStart||0)===(before.scenes[0].trimStart||0));
  await redo();await saved(p=>p.scenes[0].duration===1.5);await undo();await saved(p=>p.scenes[0].duration===before.scenes[0].duration);
 });
 await check('Frame stepping, split, repeated history and zoom stay connected to the viewer',async()=>{
  const before=await project(),slider=page.getByRole('slider',{name:'Posición del cabezal en el montaje'});
  await slider.press('Home');for(let n=0;n<4;n++)await slider.press('Shift+ArrowRight');for(let n=0;n<8;n++)await slider.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow','48');await page.getByRole('button',{name:'Dividir plano en el cabezal',exact:true}).click();
  await saved(p=>p.scenes.length===before.scenes.length+1&&p.scenes[0].duration===2&&p.scenes[1].trimStart===2&&p.scenes[1].dialogue==='');
  await undo();await saved(p=>p.scenes.length===before.scenes.length);await redo();await saved(p=>p.scenes.length===before.scenes.length+1);await undo();await saved(p=>p.scenes.length===before.scenes.length);
  await page.getByLabel('Zoom del montaje',{exact:true}).fill('65');expect(await page.locator('.tl-scroll').evaluate(n=>n.scrollWidth>n.clientWidth)).toBeTruthy();await page.getByRole('button',{name:'Ajustar toda la película'}).click();
 });
 await check('Character state inherits, warns on change and persists an intentional change',async()=>{
  await nav('Elementos').click();await page.locator('.initial-continuity>summary').click();await page.getByLabel('Vestuario y materiales',{exact:true}).fill('Abrigo ocre cerrado');
  await saved(p=>p.characters[0].continuity?.costume==='Abrigo ocre cerrado');
  await nav('Estudio').click();await page.locator('.shot-card').nth(1).click();await page.getByRole('button',{name:'Continuidad',exact:true}).click();
  await expect(page.getByLabel('Vestuario y materiales',{exact:true})).toHaveValue('Abrigo ocre cerrado');await page.getByLabel('Vestuario y materiales',{exact:true}).fill('Abrigo negro abierto');
  await page.getByRole('tab',{name:/Revisar/}).click();await expect(page.locator('.continuity-issue.warning').first()).toBeVisible();
  await page.getByRole('tab',{name:'En este plano'}).click();await page.getByRole('checkbox',{name:/Cambio intencional/}).check();await page.getByRole('textbox',{name:'Motivo del cambio',exact:true}).fill('Se cambia de abrigo al entrar en la cabina.');
  await saved(p=>p.scenes[1].continuity?.[p.characters[0].id]?.intentionalChange===true&&p.scenes[1].continuity?.[p.characters[0].id]?.changeReason==='Se cambia de abrigo al entrar en la cabina.');
  await page.reload();await page.locator('.shot-card').nth(1).click();await page.getByRole('button',{name:'Continuidad',exact:true}).click();await expect(page.getByLabel('Vestuario y materiales',{exact:true})).toHaveValue('Abrigo negro abierto');
  await expect(page.getByRole('textbox',{name:'Motivo del cambio',exact:true})).toHaveValue('Se cambia de abrigo al entrar en la cabina.');
 });
 await check('Screenplay editing, reading, search and active-shot navigation share saved scenes',async()=>{
  await nav('Guion').click();await expect(page.getByLabel('Acción de escena 2')).toBeVisible();await page.getByRole('navigation',{name:'Escenas del guion',exact:true}).getByRole('button').nth(0).click();
  await page.getByLabel('Acción de escena 1').fill('La puerta QA se abre. Elena observa la pantalla.');await page.getByLabel('Diálogo de escena 1').fill('ELENA\nTodavía queda una historia.');
  await saved(p=>p.scenes[0].description.includes('puerta QA'));await page.getByRole('tab',{name:'Leer',exact:true}).click();await expect(page.locator('.sw-reading-action').first()).toHaveText('La puerta QA se abre. Elena observa la pantalla.');
  await page.getByLabel('Buscar en el guion').fill('puérta QA');await expect(page.getByRole('navigation',{name:'Escenas del guion',exact:true}).getByRole('button')).toHaveCount(1);await page.getByLabel('Buscar en el guion').fill('');
  await page.getByRole('tab',{name:'Escribir',exact:true}).click();await page.getByRole('button',{name:'Ver en el montaje',exact:true}).click();await expect(page.locator('.shot-card.selected .shot-caption strong')).toHaveText((await project()).scenes[0].title);
 });
 await check('Fountain export round-trip and import preview do not overwrite the current film',async()=>{
  await nav('Guion').click();const before=await project(),downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Fountain',exact:true}).click();const download=await downloadEvent;const fountain=await readFile(await download.path(),'utf8');expect(parseFountain(fountain).scenes[0].dialogue).toBe(before.scenes[0].dialogue);await writeFile(out+'/story-export.fountain',fountain);
  const content=Buffer.from('Title: Importación de prueba\n\nINT. CABINA - NOCHE\n\nElena examina una lata.\n\nELENA\nLa encontré.\n\nEXT. MAR - AMANECER\n\nLa luz llega al mar.\n');
  const input=page.locator('input[type=file][accept*=fountain]');await input.setInputFiles({name:'prueba.fountain',mimeType:'text/plain',buffer:content});await expect(page.getByRole('heading',{name:'Revisa antes de añadir.'})).toBeVisible();expect((await project()).scenes.length).toBe(before.scenes.length);
  await page.getByRole('button',{name:'Cancelar importación Fountain'}).click();expect((await project()).scenes.length).toBe(before.scenes.length);
  await input.setInputFiles({name:'prueba.fountain',mimeType:'text/plain',buffer:content});await page.getByRole('button',{name:'Añadir 2 planos',exact:true}).click();await saved(p=>p.scenes.length===before.scenes.length+2&&p.name===before.name);
  await page.getByRole('button',{name:'Deshacer cambio (⌘Z)',exact:true}).click();await saved(p=>p.scenes.length===before.scenes.length);
 });
 const liveAfter=createHash('sha256').update(await readFile('data/project.json')).digest('hex');expect(liveAfter).toBe(liveBefore);expect(errors).toEqual([]);
 await writeFile(out+'/story-workflow.json',JSON.stringify({checks,errors,liveProjectUnchanged:liveAfter===liveBefore},null,2));
}catch(error){await writeFile(out+'/story-workflow.json',JSON.stringify({checks,errors,error:error.stack,visible:await page.locator('body').innerText()},null,2));throw error}finally{await context.close();await browser.close()}
