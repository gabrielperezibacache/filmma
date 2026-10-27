import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import sharp from 'sharp';
import type { Asset, Project } from './types.js';
import { parseJsonOutput, runProcess } from './process.js';
import { resolveContinuity } from '../src/continuity.js';
import { colorMatrix, playbackSpeed } from '../src/visual-effects.js';
import type { VisualCategory, VisualComparison, VisualContinuityReport, VisualContinuitySettings, VisualRegion, VisualSample } from '../src/visual-continuity.js';

const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const category = z.enum(['face','wardrobe','object']);
const rect = z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().positive().max(1),height:z.number().positive().max(1)}).refine(v=>v.x+v.width<=1.000001&&v.y+v.height<=1.000001,'La región debe estar dentro de la imagen.');
export const visualSettingsSchema = z.object({regions:z.array(z.object({sceneId:id,characterId:id,category,rect})).max(9000).default([]),sampleTimes:z.array(z.object({sceneId:id,time:z.number().min(0).max(120)})).max(100).default([])}).superRefine((settings,ctx)=>{
  const regions=settings.regions.map(r=>`${r.sceneId}:${r.characterId}:${r.category}`), times=settings.sampleTimes.map(t=>t.sceneId);
  if(new Set(regions).size!==regions.length||new Set(times).size!==times.length)ctx.addIssue({code:'custom',message:'Cada región y tiempo debe ser único por plano y elemento.'});
});
export const emptyVisualSettings = ():VisualContinuitySettings=>({regions:[],sampleTimes:[]});
const categories:VisualCategory[]=['face','wardrobe','object'];
function fail(message:string,status=409):never{throw Object.assign(new Error(message),{status});}
const stamp=()=>new Date().toISOString();
const jsonHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function visualComparisonPlan(project:Project) {
  return project.characters.flatMap(character=>{
    const appearances=project.scenes.filter(scene=>scene.characterIds.includes(character.id));
    return appearances.slice(1).map((right,index)=>({character,left:appearances[index]!,right}));
  });
}
/** Only explicit human roles can claim an automatic face; unknown roles remain ambiguous. */
export function allowsAutomaticVisualMatch(project:Project,scene:Project['scenes'][number],characterId:string) {
  const kind=(role:string|undefined)=>{
    if(!role)return 'unknown';
    if(/objeto|producto|lugar|escenario|animal|mascota/i.test(role))return 'object';
    return /personaje|persona|protagonista|antagonista|actor|actriz/i.test(role)?'person':'unknown';
  };
  const linked=[...new Set(scene.characterIds)].map(id=>({id,kind:kind(project.characters.find(character=>character.id===id)?.role)}));
  return linked.some(item=>item.id===characterId&&item.kind==='person') && !linked.some(item=>item.kind==='unknown') && linked.filter(item=>item.kind==='person').length===1;
}
export function visualSampleTime(scene:Project['scenes'][number],fps:number,settings:VisualContinuitySettings,sourceDuration?:number,sourceFps=fps) {
  const duration=Math.round(scene.duration*fps)/fps;
  const requested=settings.sampleTimes.find(item=>item.sceneId===scene.id)?.time??duration/2;
  const time=Math.min(Math.max(0,Math.round(requested*fps)/fps),Math.max(0,duration-1/fps));
  const source=(scene.trimStart??0)+time*playbackSpeed(scene.speed);
  return {time,sourceTime:sourceDuration===undefined?source:Math.min(source,Math.max(0,sourceDuration-1/sourceFps))};
}
export function visualReviewReady(report:VisualContinuityReport) {
  return report.status==='completed' && report.comparisons.length===report.total && report.comparisons.every(item=>!!item.decision) && !!report.acknowledgement;
}
function validateSettings(project:Project,settings:VisualContinuitySettings) {
  for(const region of settings.regions) if(!project.scenes.find(scene=>scene.id===region.sceneId)?.characterIds.includes(region.characterId))fail('Una región apunta a un elemento que ya no está vinculado al plano.',400);
  for(const time of settings.sampleTimes) if(!project.scenes.some(scene=>scene.id===time.sceneId))fail('El fotograma seleccionado pertenece a un plano inexistente.',400);
}
function visualFilters(scene:Project['scenes'][number]) {
  const filters=['scale=w=1024:h=1024:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos','setsar=1'];
  if(scene.look==='noir')filters.push('hue=s=0','eq=contrast=1.08');
  if(scene.look==='warm')filters.push('eq=saturation=0.85','colorbalance=rs=0.03:bs=-0.03');
  const matrix=colorMatrix(scene.color),identity=colorMatrix();
  if(!matrix.every((value,index)=>value===identity[index])) {
    const channels=['r','g','b'];
    filters.push('format=gbrap',`geq=${channels.map((channel,row)=>`${channel}='clip(${channels.map((source,col)=>`${matrix[row*5+col]}*${source}(X,Y)`).join('+')}+${matrix[row*5+4]!*255},0,255)'`).join(':')}:a='alpha(X,Y)'`);
  }
  filters.push('format=rgb24');return filters.join(',');
}

export function createVisualContinuityService(options:{dataDirectory:string;workerPath:string;python:string;ffmpeg:string;ffprobe:string;mediaPath:(asset:Asset)=>Promise<string>}) {
  const base=join(options.dataDirectory,'continuity'), cache=new Map<string,VisualContinuityReport>(), hashes=new Map<string,{key:string;sha:string}>();
  let writes=Promise.resolve();
  const directory=(projectId:string)=>join(base,id.parse(projectId));
  const reportDir=(projectId:string,reportId:string)=>join(directory(projectId),id.parse(reportId));
  async function atomic(path:string,value:unknown) {
    const data=JSON.stringify(value,null,2);
    writes=writes.catch(()=>{}).then(async()=>{const tmp=`${path}.${randomUUID()}.tmp`;await writeFile(tmp,data,{mode:0o600,flag:'wx'});await rename(tmp,path);});
    return writes;
  }
  async function save(report:VisualContinuityReport){cache.set(report.id,report);await atomic(join(reportDir(report.projectId,report.id),'report.json'),report);}
  async function load(projectId:string,reportId?:string) {
    if(!reportId){try{reportId=JSON.parse(await readFile(join(directory(projectId),'latest.json'),'utf8')).id;}catch(error:any){if(error.code==='ENOENT')return undefined;throw error;}}
    if(!reportId)return undefined;
    const cached=cache.get(reportId);if(cached?.projectId===projectId)return cached;
    try{const report=JSON.parse(await readFile(join(reportDir(projectId,reportId),'report.json'),'utf8')) as VisualContinuityReport;if(report.id!==reportId||report.projectId!==projectId)throw new Error('Informe inválido.');cache.set(report.id,report);return report;}
    catch(error:any){if(error.code==='ENOENT')return undefined;throw error;}
  }
  async function settings(projectId:string) {try{return visualSettingsSchema.parse(JSON.parse(await readFile(join(directory(projectId),'settings.json'),'utf8')));}catch(error:any){if(error.code==='ENOENT')return emptyVisualSettings();throw error;}}
  async function fileSha(asset:Asset) {
    try {
      const path=await options.mediaPath(asset),info=await stat(path),key=[path,info.size,info.mtimeMs,info.ctimeMs].join(':');
      const previous=hashes.get(asset.id);if(previous?.key===key)return previous.sha;
      const hash=createHash('sha256');for await(const data of createReadStream(path))hash.update(data);
      const sha=hash.digest('hex');hashes.set(asset.id,{key,sha});return sha;
    }catch{return 'unavailable';}
  }
  async function fingerprint(project:Project,configuration:VisualContinuitySettings) {
    const selected=new Set([...project.scenes.map(scene=>scene.videoAssetId??scene.assetId),...project.characters.map(character=>character.assetId),...(project.tracks??[]).filter(track=>track.type==='video').flatMap(track=>track.clips.map(clip=>clip.assetId))].filter(Boolean));
    const assets=[];for(const assetId of [...selected].sort()){const asset=project.assets.find(item=>item.id===assetId);assets.push(asset?{...asset,sha256:await fileSha(asset)}:{id:assetId,missing:true});}
    // updatedAt, unrelated library additions and audio do not change these pictures.
    return jsonHash({version:1,id:project.id,format:project.format,fps:project.fps,scenes:project.scenes.map(({audio,clearVideoAsset,preserveVideoAsset,takeAssetIds,...scene})=>scene),characters:project.characters,tracks:project.tracks?.filter(track=>track.type==='video').map(({muted,volume,...track})=>track),aiFinishing:project.aiFinishing,settings:configuration,assets});
  }
  let availableCache:{at:number;value:boolean}|undefined;
  async function available() {
    if(availableCache&&Date.now()-availableCache.at<30000)return availableCache.value;
    let value=false;try{const result=await runProcess(options.python,[options.workerPath,'--doctor','--json'],{timeoutMs:10000});value=result.code===0&&parseJsonOutput(result.stdout).ready===true;}catch{}
    availableCache={at:Date.now(),value};return value;
  }
  async function state(project:Project) {
    const configuration=await settings(project.id),report=await load(project.id),currentFingerprint=await fingerprint(project,configuration);
    return {report,currentFingerprint,stale:!!report&&report.fingerprint!==currentFingerprint,settings:configuration,available:await available()};
  }
  async function create(project:Project,configuration:VisualContinuitySettings) {
    validateSettings(project,configuration);
    await mkdir(directory(project.id),{recursive:true,mode:0o700});
    const report:VisualContinuityReport={id:randomUUID(),projectId:project.id,fingerprint:await fingerprint(project,configuration),createdAt:stamp(),status:'running',engine:'apple-vision-cpu',settings:configuration,comparisons:[],total:visualComparisonPlan(project).length,warnings:['Se compara un fotograma por aparición con su color y aspecto. Los cambios entre fotogramas, las transiciones y los subtítulos necesitan revisión de la reproducción.','Estas señales visuales no reconocen identidades ni certifican que el rostro, el vestuario o el objeto sean los mismos.']};
    if((project.tracks??[]).some(track=>track.type==='video'&&track.clips.length))report.warnings.push('Las capas superpuestas y sus animaciones no se analizan: revisa también la composición final en el visor.');
    if(!report.total)report.warnings.push('No hay elementos vinculados a más de un plano. No se han realizado comparaciones entre apariciones.');
    if(project.scenes.some(scene=>!scene.characterIds.length))report.warnings.push('Hay planos sin personajes u objetos vinculados; su contenido no está cubierto por estas comparaciones.');
    await mkdir(reportDir(project.id,report.id),{recursive:true,mode:0o700});await save(report);
    await atomic(join(directory(project.id),'settings.json'),configuration);await atomic(join(directory(project.id),'latest.json'),{id:report.id});
    return report;
  }
  async function execute(project:Project,report:VisualContinuityReport,signal:AbortSignal,update:(message:string,progress:number)=>void) {
    const samples=new Map<string,Promise<VisualSample>>();
    const sample=(scene:Project['scenes'][number])=>{
      let pending=samples.get(scene.id);if(pending)return pending;
      pending=(async()=>{
        const assetId=scene.videoAssetId??scene.assetId,asset=project.assets.find(item=>item.id===assetId);
        const result:VisualSample={sceneId:scene.id,sceneTitle:scene.title,assetId,time:visualSampleTime(scene,project.fps,report.settings).time};
        try {
          if(!asset||asset.type==='audio')throw new Error('El plano no tiene una imagen o video disponible.');
          const path=await options.mediaPath(asset),filename=`${randomUUID()}.png`,destination=join(reportDir(project.id,report.id),filename);
          let input=path,args:string[]=[];
          if(asset.type==='video') {
            const probed=await runProcess(options.ffprobe,['-v','error','-select_streams','v:0','-show_entries','stream=duration,avg_frame_rate:format=duration','-of','json',path],{signal,timeoutMs:30000});
            if(probed.code!==0)throw new Error('No se pudo leer la duración del clip.');
            const probe=JSON.parse(probed.stdout),stream=probe.streams?.[0],parts=String(stream?.avg_frame_rate??'').split('/').map(Number),fps=parts.length===2?parts[0]/parts[1]:Number(stream?.avg_frame_rate),duration=Number(stream?.duration??probe.format?.duration);
            if(!Number.isFinite(duration)||duration<=0)throw new Error('El clip no informa una duración válida.');
            const timing=visualSampleTime(scene,project.fps,report.settings,duration,Number.isFinite(fps)&&fps>0?fps:project.fps);result.time=timing.time;result.sourceTime=timing.sourceTime;
            args=['-ss',String(timing.sourceTime)];
          } else {
            input=join(reportDir(project.id,report.id),`oriented-${filename}`);await sharp(path,{limitInputPixels:120000000}).rotate().resize(1024,1024,{fit:'inside',withoutEnlargement:true}).png().toFile(input);
          }
          const extracted=await runProcess(options.ffmpeg,['-y','-hide_banner','-loglevel','error','-threads','2',...args,'-i',input,'-map','0:v:0','-frames:v','1','-an','-vf',visualFilters(scene),'-threads','1',destination],{signal,timeoutMs:60000});
          if(extracted.code!==0)throw new Error(`No se pudo extraer el fotograma: ${extracted.stderr.slice(-300)}`);
          const info=await stat(destination);if(!info.size)throw new Error('El fotograma está vacío.');
          result.url=`/api/continuity/media/${project.id}/${report.id}/${filename}`;
        }catch(error){if(signal.aborted)throw error;result.error=error instanceof Error?error.message:String(error);}
        return result;
      })();samples.set(scene.id,pending);return pending;
    };
    try {
      for(const [index,entry] of visualComparisonPlan(project).entries()) {
        if(signal.aborted)throw new Error('Revisión cancelada.');
        const left=await sample(entry.left),right=await sample(entry.right),state=resolveContinuity(project,entry.right.id,entry.character.id)!;
        const comparison:VisualComparison={id:`pair-${index}`,characterId:entry.character.id,characterName:entry.character.name,left:{...left},right:{...right},checks:[],intentionalChange:state.intentionalChange,changeReason:state.changeReason,expected:{face:state.values.appearance,wardrobe:state.values.costume,object:state.values.props}};
        update(`Comparando ${entry.character.name}: ${entry.left.title} → ${entry.right.title}…`,Math.round(index/Math.max(1,report.total)*95));
        if(left.error||right.error)comparison.checks=categories.map(category=>({category,status:'insufficient',origin:'unavailable',message:[left.error,right.error].filter(Boolean).join(' ')}));
        else {
          const regions:Partial<Record<VisualCategory,{left?:VisualRegion;right?:VisualRegion}>>={};
          for(const category of categories){const l=report.settings.regions.find(r=>r.sceneId===entry.left.id&&r.characterId===entry.character.id&&r.category===category)?.rect,r=report.settings.regions.find(r=>r.sceneId===entry.right.id&&r.characterId===entry.character.id&&r.category===category)?.rect;if(l||r)regions[category]={left:l,right:r};}
          const request={leftPath:join(reportDir(project.id,report.id),left.url!.split('/').at(-1)!),rightPath:join(reportDir(project.id,report.id),right.url!.split('/').at(-1)!),regions,allowAutomatic:allowsAutomaticVisualMatch(project,entry.left,entry.character.id)&&allowsAutomaticVisualMatch(project,entry.right,entry.character.id)};
          const requestPath=join(reportDir(project.id,report.id),`request-${index}.json`);await writeFile(requestPath,JSON.stringify(request),{mode:0o600});
          const result=await runProcess(options.python,[options.workerPath,'--input',requestPath],{signal,timeoutMs:120000});
          if(result.code!==0)throw new Error(`El análisis local no pudo continuar: ${result.stderr.slice(-700)||result.stdout.slice(-700)}`);
          const analysis=parseJsonOutput(result.stdout);
          if(!Array.isArray(analysis.checks)||analysis.checks.length!==3||categories.some(category=>!analysis.checks.some((check:any)=>check.category===category&&['possible-change','no-obvious-change','insufficient'].includes(check.status))))throw new Error('El motor visual devolvió un análisis incompleto.');
          comparison.checks=analysis.checks;comparison.faces=analysis.faces;comparison.elapsedMs=analysis.elapsedMs;
        }
        report.comparisons.push(comparison);await save(report);
        update(`Comparación ${index+1} de ${report.total} guardada.`,Math.round((index+1)/Math.max(1,report.total)*95));
      }
      if(await fingerprint(project,report.settings)!==report.fingerprint)throw new Error('Un archivo cambió durante el análisis. Vuelve a revisar las fuentes actuales.');
      report.status='completed';report.completedAt=stamp();await save(report);return report;
    }catch(error){report.status=signal.aborted?'cancelled':'failed';report.error=error instanceof Error?error.message:String(error);await save(report);throw error;}
  }
  async function review(project:Project,input:{reportId:string;fingerprint:string;comparisonId?:string;decision?:'reviewed'|'intentional'|'pending';note:string}) {
    const report=await load(project.id,input.reportId);if(!report)fail('No se encuentra ese informe.',404);
    if(report.status!=='completed')fail('Espera a que termine el análisis.');
    if(report.fingerprint!==input.fingerprint||await fingerprint(project,await settings(project.id))!==report.fingerprint)fail('El montaje cambió. Analiza de nuevo antes de aprobar la continuidad.');
    if(input.comparisonId){const comparison=report.comparisons.find(item=>item.id===input.comparisonId);if(!comparison)fail('No se encuentra la comparación.',404);
      if(input.decision==='pending')delete comparison.decision;
      else {if(!input.decision)fail('Selecciona cómo resolver la comparación.',400);if((comparison.checks.some(check=>check.status!=='no-obvious-change')||input.decision==='intentional')&&!input.note.trim())fail('Añade una nota para dejar constancia de las diferencias o límites revisados.',400);comparison.decision={decision:input.decision,note:input.note.trim(),reviewedAt:stamp()};}
      delete report.acknowledgement;
    } else {if(!input.note.trim())fail('Añade una nota de revisión sobre la cobertura del análisis.',400);report.acknowledgement={note:input.note.trim(),reviewedAt:stamp()};}
    await save(report);return report;
  }
  async function requireReview(project:Project,reportId?:string,expectedFingerprint?:string) {
    if(!reportId||!expectedFingerprint)fail('Revisa la continuidad visual antes de exportar en 4K.');
    const report=await load(project.id,reportId);
    if(!report||report.fingerprint!==expectedFingerprint||report.fingerprint!==await fingerprint(project,await settings(project.id)))fail('El informe de continuidad está desactualizado. Analiza y revisa las fuentes seleccionadas antes de exportar.');
    if(!visualReviewReady(report))fail('Resuelve las comparaciones y confirma la revisión de los límites antes de exportar.');
    return report;
  }
  async function media(projectId:string,reportId:string,filename:string) {
    if(!/^[a-f0-9-]+\.png$/.test(filename))fail('Fotograma no encontrado.',404);
    const report=await load(projectId,reportId);if(!report||!report.comparisons.some(comparison=>[comparison.left.url,comparison.right.url].some(url=>url?.endsWith(`/${filename}`))))fail('Fotograma no encontrado.',404);
    const path=join(reportDir(projectId,reportId),filename),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())fail('Fotograma no disponible.',404);return path;
  }
  async function interrupt(projectId:string,reportId:string,status:'failed'|'cancelled',message:string) { const report=await load(projectId,reportId);if(report?.status==='running'){report.status=status;report.error=message;await save(report);} }
  return {state,create,execute,review,requireReview,media,fingerprint,settings,load,interrupt};
}
