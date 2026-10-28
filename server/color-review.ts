import type {Express,Request,Response,NextFunction} from 'express';
import {z} from 'zod';import {mkdtemp,rm,lstat} from 'node:fs/promises';import {join} from 'node:path';import sharp from 'sharp';
import type {Project,Asset} from './types.js';import {colorFilters} from './render.js';import {parseJsonOutput,runProcess} from './process.js';
const fail=(message:string,status=422)=>Object.assign(new Error(message),{status});
const stamp=(s:any)=>[s.size,s.mtimeNs,s.ctimeNs,s.ino].join(':');
export function registerColorReview(o:{app:Express;getProject:()=>Project;dataDirectory:string;mediaPath:(a:Asset)=>Promise<string>;ffmpeg:string;ffprobe:string}){
 let active=false;
 o.app.post('/api/color/sample',(req:Request,res:Response,next:NextFunction)=>{void(async()=>{
  const input=z.object({projectId:z.string().max(100),sceneId:z.string().max(100),frame:z.number().int().min(0).max(7200),bypass:z.boolean().default(false)}).strict().parse(req.body),p=o.getProject();
  if(input.projectId!==p.id)throw fail('La película abierta cambió. Vuelve a capturar.',409);
  const scene=p.scenes.find(s=>s.id===input.sceneId);if(!scene)throw fail('El plano ya no existe.',404);
  const a=p.assets.find(a=>a.id===(scene.videoAssetId||scene.assetId));if(!a||!['video','image'].includes(a.type))throw fail('Asigna una imagen o toma al plano antes de capturar.');
  if(input.frame>=Math.round(scene.duration*p.fps))throw fail('El instante debe quedar dentro del plano.');
  if(active)throw fail('Se está leyendo otra muestra. Espera y vuelve a intentarlo.',409);
  active=true;const controller=new AbortController();res.once('close',()=>{if(!res.writableEnded)controller.abort()});let work:string|undefined;
  try{
   const original=await o.mediaPath(a),before=await lstat(original,{bigint:true}),probe=await runProcess(o.ffprobe,['-v','error','-show_streams','-show_format','-of','json',original],{signal:controller.signal,timeoutMs:15000});
   if(probe.code!==0)throw fail('No se pudo leer el archivo seleccionado. Compruébalo en Biblioteca.');
   const info=parseJsonOutput(probe.stdout),v=info.streams?.find((s:any)=>s.codec_type==='video');
   if(!v||Number(v.width)*Number(v.height)>120000000)throw fail('La fuente no tiene una imagen compatible de hasta 120 megapíxeles.');
   if(['smpte2084','arib-std-b67'].includes(v.color_transfer)||String(v.color_primaries??'').includes('2020')||String(v.color_space??'').includes('2020'))throw fail('La fuente es HDR o BT.2020. Estos scopes son SDR/sRGB; usa una copia con conversión de color revisada. No se aplica tone mapping implícito.');
   const requested=(scene.trimStart??0)+input.frame/p.fps*(scene.speed??1),duration=Number(v.duration??info.format?.duration),parts=String(v.avg_frame_rate??'').split('/').map(Number),sourceFps=parts[0]!/(parts[1]||1);
   if(a.type==='video'&&(!Number.isFinite(duration)||duration<=0))throw fail('No se pudo determinar la duración de la toma.');
   const time=a.type==='video'?Math.min(requested,Math.max(0,duration-1/(sourceFps>0?sourceFps:p.fps))):0;
   work=await mkdtemp(join(o.dataDirectory,'work','color-'));const output=join(work,'frame.png');let inputPath=original;if(a.type==='image'){inputPath=join(work,'input.png');await sharp(original,{limitInputPixels:120000000}).rotate().flatten({background:'#000000'}).png().toFile(inputPath);}
   const look=input.bypass?[]:scene.look==='noir'?['hue=s=0','eq=contrast=1.08']:scene.look==='warm'?['eq=saturation=0.85','colorbalance=rs=0.03:bs=-0.03']:[];
   const filters=["scale=w='min(640,iw)':h='min(640,ih)':force_original_aspect_ratio=decrease:flags=lanczos",...look,...(input.bypass?[]:colorFilters(scene.color)),'format=rgba'];
   const result=await runProcess(o.ffmpeg,['-nostdin','-v','error','-threads','2','-filter_threads','1',...(a.type==='video'?['-ss',String(time)]:[]),'-i',inputPath,'-vf',filters.join(','),'-frames:v','1','-update','1',output],{signal:controller.signal,timeoutMs:30000});
   if(result.code!==0)throw fail(`No se pudo capturar el fotograma: ${result.stderr.slice(-500)}`);
   const {data,info:image}=await sharp(output).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
   if(stamp(await lstat(original,{bigint:true}))!==stamp(before))throw fail('El archivo cambió durante la captura. Vuelve a intentarlo.',409);
   res.json({projectId:p.id,sceneId:scene.id,assetId:a.id,assetName:a.name,sourceUrl:a.url,sourceStamp:stamp(before),frame:input.frame,sourceTime:time,requestedSourceTime:requested,limited:a.type==='video'&&time+1e-5<requested,bypass:input.bypass,color:scene.color??{},look:scene.look??'original',trimStart:scene.trimStart??0,speed:scene.speed??1,fps:p.fps,duration:scene.duration,width:image.width,height:image.height,rgba:data.toString('base64'),png:(await sharp(data,{raw:{width:image.width,height:image.height,channels:4}}).png().toBuffer()).toString('base64')});
  }finally{active=false;if(work)await rm(work,{recursive:true,force:true})}
 })().catch(next)});
}
