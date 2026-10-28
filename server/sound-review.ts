import type {Express,Request,Response,NextFunction} from 'express';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm,lstat,statfs} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import type {Project,Asset,Job} from './types.js';
import {audioMixFingerprint,audioMixSettings} from '../src/sound-finishing.js';
import {buildTimeline} from '../src/timeline.js';
import {renderProject} from './render.js';
import {enhancementSha256} from './ai-enhance.js';
import type {AudioMasterReport} from './audio-master.js';
type Work=(signal:AbortSignal,update:(message:string,progress?:number)=>void)=>Promise<Job['result']>;
type Options={app:Express;dataDirectory:string;getProject:()=>Project;getJobs:()=>Job[];mediaPath:(asset:Asset)=>Promise<string>;ffmpeg:string;ffprobe:string;enqueue:(type:Job['type'],message:string,work:Work,result?:Job['result'])=>Promise<Job>};
const fail=(message:string,status=422)=>Object.assign(new Error(message),{status});
const route=(fn:(req:Request,res:Response)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{void fn(req,res).catch(next)};
export async function registerSoundReview(o:Options){
  const directory=join(o.dataDirectory,'sound-review');await mkdir(directory,{recursive:true});
  const pending=new Map<string,Promise<Job>>();
  const relevant=(p:Project)=>p.assets.filter(a=>a.type==='audio'&&(a.id===p.audioAssetId||p.tracks?.some(t=>t.clips.some(c=>c.assetId===a.id)))||a.type==='video'&&(p.scenes.some(s=>s.videoAssetId===a.id)||p.tracks?.some(t=>t.clips.some(c=>c.assetId===a.id))));
  async function fingerprint(p:Project){const sources=[];for(const a of relevant(p)){const path=await o.mediaPath(a),s=await lstat(path,{bigint:true});sources.push([a.id,a.url,String(s.size),String(s.mtimeNs),String(s.ctimeNs),String(s.ino)]);}return createHash('sha256').update(audioMixFingerprint(p)+JSON.stringify(sources)).digest('hex')}
  async function state(p:Project){
    let report:any;
    try{const path=join(directory,p.id+'.json'),info=await lstat(path);if(info.isFile()&&!info.isSymbolicLink()&&info.size<4*1024*1024)report=JSON.parse(await readFile(path,'utf8'));}catch{}
    if(!report)return{report:null,stale:false};
    let stale=true;try{stale=report.fingerprint!==await fingerprint(p)}catch{}
    return{report,stale};
  }
  o.app.get('/api/audio/review',route(async(req,res)=>{const p=o.getProject();if(req.query.projectId&&req.query.projectId!==p.id)throw fail('La película abierta cambió.',409);res.json(await state(p));}));
  o.app.post('/api/audio/review',route(async(req,res)=>{
    const input=z.object({projectId:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)}).strict().parse(req.body),p=o.getProject();if(input.projectId!==p.id)throw fail('Guarda y vuelve a medir la película abierta.',409);
    const existing=o.getJobs().find(j=>j.type==='audio'&&['queued','running'].includes(j.status)&&j.result?.projectId===p.id);
    if(existing)return res.status(202).json({job:existing});
    let promise=pending.get(p.id);
    if(!promise){const snapshot=structuredClone(p);promise=(async()=>{
      if(!snapshot.scenes.length)throw fail('Añade un plano antes de medir la mezcla.');
      const total=buildTimeline(snapshot).totalSeconds;if(total>1800)throw fail('Esta medición admite películas de hasta 30 minutos. Divide la película antes de medir.');
      const disk=await statfs(directory);if(Number(disk.bavail)*Number(disk.bsize)<1024**3+total*48000*8*3)throw fail('Se necesita espacio para la escucha y una reserva de 1 GiB. No se borraron originales.');
      const expected=await fingerprint(snapshot);
      return o.enqueue('audio','Preparando la escucha y medición de la película…',async(signal,update)=>{
        const id=randomUUID(),work=join(o.dataDirectory,'work','sound-'+id),filename='sound-'+id+'.wav',destination=join(o.dataDirectory,'exports',filename);
        await mkdir(work,{recursive:true});
        try{
          const sources=[];for(const a of relevant(snapshot))sources.push({assetId:a.id,sha256:await enhancementSha256(await o.mediaPath(a))});
          let report:AudioMasterReport|undefined;
          await renderProject(snapshot,{destination,workDirectory:work,mediaPath:o.mediaPath,ffmpeg:o.ffmpeg,ffprobe:o.ffprobe,signal,update,dimensions:[160,90],audioOnly:true,onAudioReport:r=>{report=r}});
          if(!report||signal.aborted)throw fail('La medición no terminó.');
          if(await fingerprint(snapshot)!==expected)throw fail('Una fuente cambió durante la medición. Repite el análisis; los originales se conservan.',409);
          const value={editingFingerprint:audioMixFingerprint(snapshot),version:1,projectId:snapshot.id,fingerprint:expected,createdAt:new Date().toISOString(),duration:total,settings:audioMixSettings(snapshot),...report,sources,url:'/api/downloads/'+filename};
          const temporary=join(directory,id+'.tmp');await writeFile(temporary,JSON.stringify(value),{mode:0o600,flag:'wx'});await rename(temporary,join(directory,snapshot.id+'.json'));
          return{projectId:snapshot.id,audioReview:value,url:value.url};
        }catch(error){await rm(destination,{force:true});throw error}finally{await rm(work,{recursive:true,force:true})}
      },{projectId:snapshot.id});
    })();pending.set(p.id,promise)}
    try{res.status(202).json({job:await promise})}finally{if(pending.get(p.id)===promise)pending.delete(p.id)}
  }));
}
