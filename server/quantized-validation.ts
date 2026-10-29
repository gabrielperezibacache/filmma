import type {Express} from 'express';
import {mkdir,readFile,realpath} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {runProcess} from './process.js';

const variant=z.enum(['gguf-q4','gguf-q8']);
const route=(fn:any)=>(req:any,res:any,next:any)=>Promise.resolve(fn(req,res)).catch(next);
export function registerQuantizedValidation(o:{app:Express;root:string;dataDirectory:string;python:string;idle:()=>void;command:any;enqueue:any;invalidate:()=>void;characterReference?:(id:string)=>Promise<{path:string;projectId:string;characterId:string}>}){
 o.app.post('/api/models/quantized/test',route(async(req:any,res:any)=>{
  o.idle();
  const input=z.object({variant,characterId:z.string().min(1).max(100)}).strict().parse(req.body);
  if(!o.characterReference)throw new Error('Abre un proyecto con un personaje y su imagen de referencia.');
  const reference=await o.characterReference(input.characterId),state=await o.command(['quantized-status','--json']);
  const model=state.variants.find((v:any)=>v.id===input.variant);
  if(!model?.weights.complete||!state.engineInstalled)throw new Error('Descarga y verifica todos los pesos antes de probar la variante.');
  const port=req.socket.localPort??4318;
  const marker=randomUUID(),directory=join(o.dataDirectory,'model-validation','quantized',marker);
  o.idle();
  const job=await o.enqueue('runtime','Probando la variante con la referencia del personaje…',async(signal:AbortSignal,update:any)=>{
   await mkdir(resolve(directory,'..'),{recursive:true});
   const result=await runProcess(o.python,[join(o.root,'runtime/h3_quant_benchmark.py'),
    '--model',model.weights.directory,'--output',directory,'--variant',input.variant,
    '--reference',reference.path,'--project-id',reference.projectId,'--character-id',reference.characterId,
    '--job-marker',marker,'--api-port',String(port),
    '--prompt','Preserve the exact identity, face, hair, clothing and accessories of the person in the reference image. A cinematic medium shot in the same environment, subtle breathing and a small natural head movement. Static camera, consistent identity, no cuts, no text.'],
    {cwd:o.root,signal,timeoutMs:24*3600000,terminationGraceMs:12000,onLine(line){try{const e=JSON.parse(line);if(e.type==='progress')update(e.message??'Prueba local en curso.',e.progress);else if(e.type==='log'&&e.stage==='memory')update('Prueba local en curso; memoria supervisada.')}catch{}}});
   if(result.code!==0){let message='La toma de validación falló; se conservaron los archivos y no se reintenta.';try{const e=JSON.parse(await readFile(join(directory,'result.json'),'utf8'));message=e.error??message}catch{}throw new Error(message)}
   const trial=await o.command(['record-quantized-trial','--variant',input.variant,'--result',join(directory,'result.json')],signal);
   o.invalidate();return{...trial,quantizedTestId:marker,text:'Toma verificada. Revisa el video y aprueba su calidad antes de activar esta variante.'};
  },{quantizedTestId:marker,projectId:reference.projectId,characterId:reference.characterId});
  res.status(202).json({job});
 }));
 o.app.post('/api/models/quantized/review',route(async(req:any,res:any)=>{
  o.idle();const input=z.object({variant,trialId:z.string().uuid(),accepted:z.boolean()}).strict().parse(req.body);
  const result=await o.command(['review-quantized-trial','--variant',input.variant,'--trial-id',input.trialId,...(input.accepted?['--accept']:[])]);
  o.invalidate();res.json(result);
 }));
 o.app.get('/api/models/quantized/trial-media/:variant',route(async(req:any,res:any)=>{
  const id=variant.parse(req.params.variant),state=await o.command(['quantized-status','--json']);
  const model=state.variants.find((v:any)=>v.id===id),trial=model?.trial??model?.validation;
  if(!trial?.request?.outputPath)return res.status(404).json({error:'Todavía no hay una toma de prueba.'});
  const file=await realpath(trial.request.outputPath),roots=[o.dataDirectory,join(o.root,'output/qa/h3-quantized')];
  if(!file.endsWith('.mp4')||!roots.some(root=>{const path=relative(resolve(root),file);return path!==''&&!path.startsWith('..')&&!isAbsolute(path)}))return res.status(403).json({error:'La toma está fuera de las carpetas de validación.'});
  res.type('video/mp4').sendFile(file);
 }));
}
