import type {Express} from 'express';import{z}from'zod';
import{recoveryVersion}from'./recovery.js';import type{Store}from'./store.js';
import{validateEditingReferences,type Asset}from'./types.js';
const route=(fn:any)=>(req:any,res:any,next:any)=>Promise.resolve(fn(req,res)).catch(next);
const fail=(message:string)=>Object.assign(new Error(message),{status:409});
export function registerRecoveryRoutes(o:{app:Express;store:Store;getJobs:()=>{status:string}[];mediaPath:(asset:Asset)=>Promise<string>;onRestore:()=>void}){
 const{app,store}=o;
 const idle=()=>{if(o.getJobs().some(j=>['queued','running'].includes(j.status)))throw fail('Espera o cancela los trabajos activos antes de recuperar una versión.');};
 const selected=async(id:string)=>{const point=await store.recovery.read(store.project.id,id);if(point.projectId!==store.project.id)throw fail('El punto pertenece a otra película.');return point};
 app.get('/api/recovery',route(async(req:any,res:any)=>{
  const{offset,limit}=z.object({offset:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(100).default(30)}).parse(req.query);
  const p=structuredClone(store.project),{entries,damaged}=await store.recovery.list(p);
  res.json({projectId:p.id,fingerprint:recoveryVersion(p),recovered:store.recoveryStatus??null,checkpoints:entries.slice(offset,offset+limit),total:entries.length,damaged,nextOffset:offset+limit<entries.length?offset+limit:null});
 }));
 app.post('/api/recovery/checkpoints',route(async(req:any,res:any)=>{const{label}=z.object({label:z.string().trim().max(120).default('')}).strict().parse(req.body);const point=await store.checkpoint(label);res.status(201).json({id:point!.id,createdAt:point!.createdAt})}));
 app.get('/api/recovery/:id/preview',route(async(req:any,res:any)=>{
  const point=await selected(String(req.params.id));let missing=0;
  for(const asset of point.project.assets)try{await o.mediaPath(asset)}catch{missing++}
  const comparable=(value:unknown)=>JSON.stringify(value);const changes={title:point.project.name!==store.project.name||point.project.logline!==store.project.logline,script:point.project.scenes.filter(s=>{const live=store.project.scenes.find(x=>x.id===s.id);return !live||s.description!==live.description||s.dialogue!==live.dialogue||s.prompt!==live.prompt}).length,characters:point.project.characters.filter(c=>comparable(c)!==comparable(store.project.characters.find(x=>x.id===c.id))).length,removedScenes:store.project.scenes.filter(s=>!point.project.scenes.some(x=>x.id===s.id)).length,format:point.project.format!==store.project.format||point.project.fps!==store.project.fps};
  res.json({current:recoveryVersion(point.project)===recoveryVersion(store.project),changes,id:point.id,projectId:point.projectId,name:point.project.name,label:point.label,reason:point.reason,createdAt:point.createdAt,sceneCount:point.project.scenes.length,characterCount:point.project.characters.length,assetCount:point.project.assets.length,missingAssets:missing,fingerprint:recoveryVersion(store.project),characters:point.project.characters.map(c=>({id:c.id,name:c.name})),scenes:point.project.scenes.map(s=>({id:s.id,title:s.title,duration:s.duration,characterIds:s.characterIds})),message:'Se recuperarán guion, montaje y estados de personajes. Los originales actuales seguirán en la biblioteca y se guardará un punto del estado anterior.'});
 }));
 app.post('/api/recovery/restore',route(async(req:any,res:any)=>{
  idle();const input=z.object({checkpointId:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),expectedFingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(req.body);
  const assertCurrent=()=>{idle();if(recoveryVersion(store.project)!==input.expectedFingerprint)throw fail('La película cambió desde la vista previa. Revisa el punto de recuperación de nuevo.');};
  assertCurrent();const point=await selected(input.checkpointId);
  for(const asset of point.project.assets)try{await o.mediaPath(asset)}catch{throw fail('Hay un original no disponible. Reconecta su disco antes de recuperar; la película actual se conserva.');}
  const current=structuredClone(store.project),known=new Map(current.assets.map(a=>[a.id,a]));
  for(const asset of point.project.assets){const live=known.get(asset.id);if(live&&(live.url!==asset.url||live.type!==asset.type))throw fail('Un recurso cambió de identidad. La película actual se conserva.');}
  const restored={...point.project,assets:[...current.assets,...point.project.assets.filter(a=>!known.has(a.id))],updatedAt:new Date().toISOString()};validateEditingReferences(restored);
  assertCurrent();await store.checkpoint('Estado anterior a la recuperación','before-restore');assertCurrent();
  assertCurrent();store.project=restored;o.onRestore();
  try{await store.save({reason:'restored',label:point.label||'Versión recuperada',force:true})}catch(error){if(store.project===restored)store.project=current;throw error}
  res.json({project:restored});
 }));
 app.post('/api/recovery/acknowledge',(_req,res)=>{store.recoveryStatus=undefined;res.json({ok:true})});
}
