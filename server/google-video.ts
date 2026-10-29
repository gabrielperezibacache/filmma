import type {Express,Request,Response,NextFunction} from 'express';
import multer from 'multer';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {z} from 'zod';
import type {Store} from './store.js';
import type {Asset,Project,Job} from './types.js';
import {libraryFileHash,uploadFileName} from './library.js';
import {inspectEnhancementMedia} from './enhance.js';
import {runProcess} from './process.js';
import {writeZip} from './zip.js';
import {applyGoogleVideoTake,buildGoogleVideoPrompt,googleReferenceCandidates,googleReferenceRole,googleVideoContext} from '../src/google-video.js';
const id=z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),sha=z.string().regex(/^[a-f0-9]{64}$/);
const base={provider:z.enum(['gemini','flow']),workflow:z.enum(['subscription-handoff','subscription-browser']),requestId:z.string().uuid(),projectId:id,sceneId:id,sceneTitle:z.string().max(250),createdAt:z.string().max(100),prompt:z.string().max(64000),sourcePrompt:z.string().max(64000).optional(),requestedSeconds:z.number().min(1).max(15),requestedFormat:z.string().max(12),characterIds:z.array(id).max(30),referenceAssetIds:z.array(id).max(5),referenceSha256:z.record(id,sha),contextFingerprint:sha};
export const googleVideoProvenanceSchema=z.object({...base,verification:z.enum(['user-imported','browser-observed']),browser:z.object({automationId:z.string().uuid(),pageUrl:z.string().url().max(500),profileId:z.string().uuid().optional(),modelLabel:z.string().min(1).max(120).optional()}).optional(),importedAt:z.string().max(100),outputSha256:sha,contextChanged:z.boolean(),media:z.object({width:z.number().int().min(2).max(4096),height:z.number().int().min(2).max(4096),duration:z.number().positive().max(15.01),fps:z.number().positive().max(60.1),frames:z.number().int().positive().max(901),audioTracks:z.number().int().min(0).max(8)})});
const storedSchema=z.object({...base,id:z.string().uuid(),packageUrl:z.string().max(180),references:z.array(z.object({id,name:z.string().max(250),sha256:sha,role:z.string().max(1000)})).max(5)});
type Stored=z.infer<typeof storedSchema>;
const route=(fn:(req:Request,res:Response)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>void fn(req,res).catch(next);
const fail=(message:string,status=409)=>Object.assign(new Error(message),{status});
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
export async function registerGoogleVideo(o:{app:Express;store:Store;dataDirectory:string;ffmpeg:string;ffprobe:string;mediaPath:(asset:Asset)=>Promise<string>;detectMedia:(buffer:Buffer)=>{extension:string;mime:string;type:string}|undefined}){
 const {app,store}=o,directory=join(o.dataDirectory,'google-video'),active=new Set<string>();await mkdir(directory,{recursive:true,mode:0o700});
 const current=(projectId:string,sceneId?:string)=>{const p=store.project;if(p.id!==projectId)throw fail('La película abierta cambió. Vuelve al plano de origen.');if(sceneId&&!p.scenes.some(s=>s.id===sceneId))throw fail('El plano de origen ya no está en el guion. El paquete se conserva.');return p};
 const fingerprint=(p:Project,r:Pick<Stored,'sceneId'|'requestedSeconds'|'referenceAssetIds'>)=>{const s=p.scenes.find(s=>s.id===r.sceneId);return s?hash(googleVideoContext(p,s,r.requestedSeconds,r.referenceAssetIds)):''};
 async function load(requestId:unknown){const request=storedSchema.parse(JSON.parse(await readFile(join(directory,`${z.string().uuid().parse(requestId)}.json`),'utf8')));current(request.projectId,request.sceneId);return request}
 const status=(r:Stored)=>({...r,stale:fingerprint(store.project,r)!==r.contextFingerprint,importedAssetId:store.project.assets.find(a=>a.googleVideo?.requestId===r.id)?.id});
 app.get('/api/google-video/requests',route(async(req,res)=>{const p=current(id.parse(req.query.projectId));const requests:Stored[]=[];for(const file of (await readdir(directory)).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n))){try{const r=storedSchema.parse(JSON.parse(await readFile(join(directory,file),'utf8')));if(r.projectId===p.id&&(!req.query.sceneId||r.sceneId===req.query.sceneId))requests.push(r)}catch{/* A malformed unfinished package does not hide other requests. */}}current(p.id);res.json({requests:requests.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(status)})}));
 app.post('/api/google-video/requests',route(async(req,res)=>{
  const input=z.object({projectId:id,sceneId:id,provider:z.enum(['gemini','flow']),promptOverride:z.string().trim().min(1).max(32000).optional(),seconds:z.number().min(1).max(15),referenceAssetIds:z.array(id).max(5)}).strict().parse(req.body),p=structuredClone(current(input.projectId,input.sceneId)),s=p.scenes.find(s=>s.id===input.sceneId)!;
  if(!s.prompt.trim()&&!s.description.trim())throw fail('Escribe la acción del plano antes de preparar la toma.',400);
  if(new Set(input.referenceAssetIds).size!==input.referenceAssetIds.length)throw fail('Hay referencias repetidas.',400);
  const eligible=new Set(googleReferenceCandidates(p,s).map(a=>a.id));if(input.referenceAssetIds.some(id=>!eligible.has(id)))throw fail('Una referencia ya no pertenece al plano o sus personajes. Actualiza la selección.');
  const requestId=randomUUID(),references:Stored['references']=[],entries:{name:string;data:Buffer}[]=[],referenceSha256:Record<string,string>={};let total=0;
  for(const [index,assetId] of input.referenceAssetIds.entries()){
   const a=p.assets.find(a=>a.id===assetId)!,path=await o.mediaPath(a),checked=await libraryFileHash(path);total+=checked.size;if(checked.size>20*1024**2||total>50*1024**2)throw fail('Las referencias admiten hasta 20 MB por imagen y 50 MB en total. Elige imágenes más ligeras.',400);
   const bytes=await readFile(path);if(bytes.length!==checked.size||hashBytes(bytes)!==checked.sha256)throw fail('Una imagen cambió mientras se preparaba. Vuelve a preparar el plano.');
   const detected=o.detectMedia(bytes);if(detected?.type!=='image')throw fail('Una referencia no contiene una imagen válida.',422);
   references.push({id:assetId,name:a.name,role:googleReferenceRole(p,s,assetId),sha256:checked.sha256});referenceSha256[assetId]=checked.sha256;
   entries.push({name:`references/${index+1}-${assetId}${extname(path).toLowerCase()}`,data:bytes});
  }
  const request=storedSchema.parse({id:requestId,requestId,provider:input.provider,workflow:'subscription-handoff',projectId:p.id,sceneId:s.id,sceneTitle:s.title,createdAt:new Date().toISOString(),prompt:input.promptOverride??buildGoogleVideoPrompt(p,s,input.seconds,input.referenceAssetIds),...(input.promptOverride?{sourcePrompt:buildGoogleVideoPrompt(p,s,input.seconds,input.referenceAssetIds)}:{}),requestedSeconds:input.seconds,requestedFormat:p.format,characterIds:[...s.characterIds],referenceAssetIds:input.referenceAssetIds,referenceSha256,contextFingerprint:hash(googleVideoContext(p,s,input.seconds,input.referenceAssetIds)),packageUrl:`/api/downloads/google-${requestId}.zip`,references});
  const assertSame=()=>{const latest=current(p.id,s.id);if(fingerprint(latest,request)!==request.contextFingerprint)throw fail('El guion o las referencias cambiaron. Revisa y vuelve a preparar el paquete.')};assertSame();
  const zip=join(o.dataDirectory,'exports',`google-${requestId}.zip`),record=join(directory,`${requestId}.json`);
  try{await writeZip(zip,[{name:'prompt.txt',data:Buffer.from(request.prompt)},{name:'filmma-request.json',data:Buffer.from(JSON.stringify(request,null,2))},{name:'README.txt',data:Buffer.from('1. Open Gemini or Flow using your Google AI Pro account.\n2. Paste prompt.txt and attach only the selected reference images, in numbered order.\n3. Review supported duration, aspect ratio and credit cost in Google before generating. Filmma cannot read your account balance.\n4. Download the original video.\n5. Return to the same request in Filmma and import the download (maximum 15 seconds).\nThe package is local; preparing it does not send anything to Google. Cloud generation and download are manual. API billing is separate from subscription usage.\n')},...entries]);assertSame();await writeFile(record,JSON.stringify(request),{flag:'wx',mode:0o600})}catch(e){await rm(zip,{force:true});await rm(record,{force:true});throw e}
  res.status(201).json({request:status(request)});
 }));
 const upload=multer({dest:join(o.dataDirectory,'work'),limits:{fileSize:512*1024**2,files:1,fields:3}}).single('file');
 async function importFile(params:{requestId:string;projectId:string;uploadProjectId:string;apply:boolean;file?:Pick<Express.Multer.File,'path'|'originalname'|'size'>;browser?:{automationId:string;pageUrl:string;profileId?:string;modelLabel?:string}}){
  const {file}=params;let destination:string|undefined,requestId:string|undefined,acquired=false;
  try{
   const input={projectId:params.projectId,apply:String(params.apply)},r=await load(params.requestId);requestId=r.id;
   if(input.projectId!==params.uploadProjectId||input.projectId!==r.projectId)throw fail('La película cambió durante la carga. Vuelve al proyecto de origen.');if(!file)throw fail('Selecciona el video descargado de Google.',400);
   if(active.has(r.id))throw fail('Esta toma ya se está comprobando. Espera a que termine.');active.add(r.id);acquired=true;
   const existing=store.project.assets.find(a=>a.googleVideo?.requestId===r.id);if(existing)return {asset:existing,library:store.project.library,applied:false,alreadyImported:true};
   const handle=await open(file.path,'r'),buffer=Buffer.alloc(128);try{await handle.read(buffer,0,128,0)}finally{await handle.close()};const detected=o.detectMedia(buffer);if(detected?.type!=='video'||!['mp4','webm'].includes(detected.extension))throw fail('El archivo no contiene un MP4 o WebM. Descarga el video original, no una página o un enlace.',422);
   const signal=AbortSignal.timeout(150000),quick=await inspectEnhancementMedia(file.path,o.ffprobe,signal,false);
   if(quick.duration>15.01||quick.containerDuration>15.25||quick.fps>60.1||Math.max(quick.width,quick.height)>4096||quick.width*quick.height>4096*2160||quick.audio.length>8)throw fail('La toma admite hasta 15 segundos, 4K y 60 fps. Ajusta la generación en Google; Filmma no recorta ni ralentiza el original.',422);
   const media=await inspectEnhancementMedia(file.path,o.ffprobe,signal),decode=await runProcess(o.ffmpeg,['-v','error','-xerror','-nostdin','-protocol_whitelist','file,pipe','-threads','2','-i',file.path,'-map',`0:${media.video.index}`,'-map','0:a?','-f','null','-'],{signal,timeoutMs:120000});if(decode.code!==0)throw fail('El video no pudo decodificarse completo. Vuelve a descargarlo; el original de Google no se ha modificado.',422);
   const checked=await libraryFileHash(file.path);let changed=fingerprint(current(r.projectId,r.sceneId),r)!==r.contextFingerprint;
   for(const assetId of r.referenceAssetIds){const a=store.project.assets.find(a=>a.id===assetId);try{if(!a||(await libraryFileHash(await o.mediaPath(a))).sha256!==r.referenceSha256[assetId])changed=true}catch{changed=true}}
   current(r.projectId,r.sceneId);changed ||= fingerprint(store.project,r)!==r.contextFingerprint;
   if(changed&&input.apply==='true')throw fail('Cambió el guion, un personaje o una referencia. Desmarca «Usar en el montaje» para conservar la toma como alternativa y revisarla.');
   if(store.project.assets.length>=2000)throw fail('La película alcanzó el máximo de 2.000 archivos. Conserva esta toma fuera del proyecto o crea otra película.',400);
   const stamp=new Date().toISOString(),assetId=randomUUID(),meta=googleVideoProvenanceSchema.parse({...r,workflow:params.browser?'subscription-browser':r.workflow,verification:params.browser?'browser-observed':'user-imported',browser:params.browser,importedAt:stamp,outputSha256:checked.sha256,contextChanged:changed,media:{width:media.width,height:media.height,duration:media.duration,fps:media.fps,frames:media.frames,audioTracks:media.audio.length}}),asset:Asset={id:assetId,name:uploadFileName(file.originalname),type:'video',mime:detected.mime,size:checked.size,url:`/api/media/${assetId}.${detected.extension}`,googleVideo:meta};
   destination=join(o.dataDirectory,'media',`${assetId}.${detected.extension}`);await rename(file.path,destination);
   // No await between the final context check and the project mutation.
   const before=current(r.projectId,r.sceneId);if(input.apply==='true'&&fingerprint(before,r)!==r.contextFingerprint)throw fail('El plano cambió durante la comprobación. Vuelve a importar para revisarlo.');
   const next=applyGoogleVideoTake(before,r.sceneId,asset,input.apply==='true');next.library={...before.library,[asset.id]:{tags:['Google',r.provider==='gemini'?'Gemini':'Flow'],favorite:false,sha256:checked.sha256,fileSize:checked.size,observedAt:stamp,imported:{name:asset.name,at:stamp}}};next.updatedAt=stamp;
   const job:Job={id:randomUUID(),type:'google-video',status:'completed' as const,progress:100,message:params.browser?'Video descargado desde Chrome y verificado; conserva el original y sus referencias.':'Video importado y verificado; procedencia de Google declarada por el usuario.',createdAt:stamp,updatedAt:stamp,context:{projectId:before.id,projectName:before.name,sceneId:r.sceneId,sceneTitle:r.sceneTitle,assetId:asset.id,assetName:asset.name},result:{projectId:before.id,sceneId:r.sceneId,assetId:asset.id}};
   const oldJobs=store.jobs;store.project=next;store.jobs=[...store.jobs,job].slice(-300);try{await store.save()}catch(e){if(store.project===next)store.project=before;store.jobs=oldJobs;throw e}destination=undefined;
   return {asset,library:next.library,applied:input.apply==='true',job,alreadyImported:false};
  }finally{if(requestId&&acquired)active.delete(requestId);if(file)await rm(file.path,{force:true});if(destination)await rm(destination,{force:true})}
 }
 app.post('/api/google-video/requests/:id/import',(req,res,next)=>{res.locals.projectId=store.project.id;upload(req,res,e=>e?next(fail('No se pudo recibir la toma. Elige un MP4 o WebM de hasta 512 MB.',400)):next())},route(async(req,res)=>{
  try{const input=z.object({projectId:id,apply:z.enum(['true','false'])}).strict().parse(req.body);const result=await importFile({requestId:String(req.params.id),projectId:input.projectId,uploadProjectId:String(res.locals.projectId),apply:input.apply==='true',file:req.file});res.status(result.alreadyImported?200:201).json(result)}finally{if(req.file)await rm(req.file.path,{force:true})}
 }));
 return {load,status,importFile,fingerprint};

}
const hashBytes=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
