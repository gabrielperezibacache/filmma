import type{Express}from'express';import{mkdir,writeFile,readFile,readdir,rename,lstat}from'node:fs/promises';import{createReadStream}from'node:fs';import{join}from'node:path';import{createHash,randomUUID}from'node:crypto';import{z}from'zod';
import{MODEL_PRESETS,type ModelPresetId}from'../src/model-presets.js';import{runProcess,parseJsonOutput}from'./process.js';
const route=(fn:any)=>(req:any,res:any,next:any)=>Promise.resolve(fn(req,res)).catch(next);
const fail=(message:string)=>Object.assign(new Error(message),{status:409});
const prompts={product:'A single vintage cinema camera on a wooden table in soft window light. Entire camera visible. Locked static shot. Fine metal detail, natural textures. No people, text or logos.',portrait:'A fictional adult person in a plain jacket, facing the camera in soft daylight. Head and shoulders, neutral expression, slight natural movement. Static camera. No text or logos.',motion:'A single red ceramic cup slowly rotating on a wooden turntable in soft daylight. Entire object visible. Static camera. No people, text or logos.'};
export function registerQualityLab(o:{app:Express;directory:string;root:string;ffmpeg:string;ffprobe:string;getJobs:()=>{status:string}[];status:()=>Promise<any>;enqueue:any;command:(args:string[],signal?:AbortSignal,update?:(message:string,progress?:number)=>void)=>Promise<any>}){
 const base=join(o.directory,'model-quality');let pending:Promise<any>|undefined;
 const idle=()=>{if(o.getJobs().some(j=>['queued','running'].includes(j.status)))throw fail('Espera o cancela las tareas activas antes de iniciar una comparación nativa.')};
 const load=async(id:string)=>{if(!/^[a-f0-9-]{36}$/.test(id))throw fail('Comparación inválida.');const path=join(base,id,'report.json'),s=await lstat(path);if(!s.isFile()||s.isSymbolicLink())throw fail('Informe no disponible.');return JSON.parse(await readFile(path,'utf8'))};
 const writes=new Map<string,Promise<void>>();
 const save=(report:any)=>{const path=join(base,report.id,'report.json'),tmp=path+'.'+randomUUID()+'.tmp',json=JSON.stringify(report,null,2);const task=(writes.get(report.id)??Promise.resolve()).catch(()=>{}).then(async()=>{await writeFile(tmp,json);await rename(tmp,path)});writes.set(report.id,task);return task};
 o.app.get('/api/models/quality',route(async(_req:any,res:any)=>{let dirs:string[]=[];try{dirs=await readdir(base)}catch(e:any){if(e.code!=='ENOENT')throw e}const reports=[];for(const id of dirs)try{reports.push(await load(id))}catch{}res.json({reports:reports.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,20)})}));
 o.app.post('/api/models/quality/compare',route(async(req:any,res:any)=>{
  const input=z.object({presetIds:z.array(z.enum(Object.keys(MODEL_PRESETS) as[ModelPresetId,...ModelPresetId[]])).min(2).max(3),subject:z.enum(['product','portrait','motion']).default('product'),seed:z.number().int().min(0).max(2147483647).default(42)}).strict().parse(req.body);
  if(new Set(input.presetIds).size!==input.presetIds.length)throw fail('Elige al menos dos resoluciones distintas.');
  if(pending)throw fail('Ya se está preparando una comparación.');idle();
  pending=(async()=>{const status=await o.status(),selected=input.presetIds.map(id=>MODEL_PRESETS[id]);
   if(new Set(selected.map(p=>p.model)).size!==1||new Set(selected.map(p=>p.steps)).size!==1)throw fail('Compara resoluciones del mismo motor con los mismos pasos.');
   for(const p of selected){const m=status.models.find((m:any)=>m.id===p.model);if(!m?.available||!m.presets.find((v:any)=>v.id===p.id)?.eligible)throw fail('Conecta el disco y prepara el modelo antes de comparar su resolución nativa.');}
   idle();const id=randomUUID(),directory=join(base,id);await mkdir(directory,{recursive:true});
   const frames=Math.min(...selected.map(p=>p.frames)),report:any={id,createdAt:new Date().toISOString(),model:selected[0].model,status:'queued',subject:input.subject,prompt:prompts[input.subject],seed:input.seed,frames,fps:24,steps:selected[0].steps,outputs:[],note:'Prueba independiente con el mismo prompt, semilla, pasos y fotogramas. No modifica la película ni sus personajes. Una prueba breve no valida duraciones largas.'};
   await save(report);
   const job=await o.enqueue('runtime','Comparando resolución nativa sin modificar la película…',async(signal:AbortSignal,update:any)=>{
    report.status='running';await save(report);
    try{for(const[index,p]of selected.entries()){
     const filename=`quality-${id}-${p.id}.mp4`,outputPath=join(o.directory,'media',filename);await mkdir(join(o.directory,'media'),{recursive:true});
     const request={model:p.model,prompt:report.prompt,width:p.width,height:p.height,numFrames:frames,fps:24,steps:p.steps,memoryProfile:p.memoryProfile,seed:input.seed,outputPath,references:[]},requestPath=join(directory,`${p.id}.json`);await writeFile(requestPath,JSON.stringify(request,null,2));
     const started=Date.now(),result=await o.command(['generate','--request',requestPath],signal,(message,progress)=>update(message,(index*100+(progress??0))/selected.length));
     const probe=await runProcess(o.ffprobe,['-v','error','-count_frames','-show_entries','stream=codec_type,width,height,avg_frame_rate,nb_read_frames,duration','-of','json',outputPath],{signal,timeoutMs:120000});
     if(probe.code!==0)throw new Error('No se pudo verificar el vídeo de comparación.');const metadata=JSON.parse(probe.stdout),video=metadata.streams?.find((s:any)=>s.codec_type==='video'),[n,d]=String(video?.avg_frame_rate??'0/1').split('/').map(Number);
     if(video?.width!==p.width||video?.height!==p.height||Number(video?.nb_read_frames)!==frames||n/d!==24||Math.abs(Number(video?.duration)-frames/24)>.002)throw new Error('La salida no conserva dimensiones, cadencia o duración nativas.');
     const decode=await runProcess(o.ffmpeg,['-v','error','-i',outputPath,'-map','0:v:0','-f','null','-'],{signal,timeoutMs:120000});if(decode.code!==0)throw new Error('El vídeo no se decodificó completamente.');
     const hash=createHash('sha256');for await(const chunk of createReadStream(outputPath))hash.update(chunk);
     report.outputs.push({presetId:p.id,width:p.width,height:p.height,frames,fps:24,seconds:frames/24,url:`/api/media/${filename}`,sha256:hash.digest('hex'),wallSeconds:(Date.now()-started)/1000,metrics:result.metadata?.engineMetrics??null,verified:true});await save(report);
    }report.status='completed';report.completedAt=new Date().toISOString();await save(report);return{qualityReportId:id,text:'Comparación nativa verificada. Revisa detalle, movimiento y artefactos antes de elegir un perfil.'};
    }catch(error){report.status=signal.aborted?'cancelled':'failed';report.error=error instanceof Error?error.message:String(error);await save(report);throw error}
   },{qualityReportId:id});report.jobId=job.id;await save(report);return{job,report};
  })().finally(()=>{pending=undefined});res.status(202).json(await pending);
 }));
 o.app.post('/api/models/quality/:id/review',route(async(req:any,res:any)=>{const input=z.object({preferredPresetId:z.string(),notes:z.string().trim().min(5).max(3000)}).strict().parse(req.body),report=await load(String(req.params.id));if(report.status!=='completed'||!report.outputs.some((v:any)=>v.presetId===input.preferredPresetId&&v.verified))throw fail('Completa la comparación antes de registrar tu elección.');report.review={...input,reviewedAt:new Date().toISOString()};await save(report);res.json({report})}));
}
