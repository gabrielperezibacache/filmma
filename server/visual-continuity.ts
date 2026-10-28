import {reconcileVisualSettings,visualMoments,visualMomentTime,visualRegionAt,uniqueVisualSamples,visualIntervals,aggregateVisualChecks} from '../src/visual-sampling.js';
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
import type { VisualCategory, VisualComparison, VisualContinuityReport, VisualContinuitySettings, VisualRegion, VisualSample, VisualMoment, VisualInterval } from '../src/visual-continuity.js';

const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const category = z.enum(['face','wardrobe','object']);
const rect = z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().positive().max(1),height:z.number().positive().max(1)}).refine(v=>v.x+v.width<=1.000001&&v.y+v.height<=1.000001,'La región debe estar dentro de la imagen.');
const moment=z.enum(['start','early','middle','late','end']);
export const visualSettingsSchema = z.object({sampleCount:z.union([z.literal(3),z.literal(5)]).optional(),regions:z.array(z.object({sceneId:id,characterId:id,category,rect,sample:moment.optional()}).strict()).max(9000).default([]),sampleTimes:z.array(z.object({sceneId:id,time:z.number().min(0).max(120),sample:moment.optional()}).strict()).max(500).default([])}).strict().superRefine((settings,ctx)=>{
 const regions=settings.regions.map(r=>`${r.sceneId}:${r.characterId}:${r.category}:${r.sample??'all'}`),times=settings.sampleTimes.map(t=>`${t.sceneId}:${t.sample??'middle'}`);
 if(new Set(regions).size!==regions.length||new Set(times).size!==times.length)ctx.addIssue({code:'custom',message:'Cada región y tiempo debe ser único por plano, elemento e instante.'});
});
export const emptyVisualSettings = ():VisualContinuitySettings=>({regions:[],sampleTimes:[]});
const categories:VisualCategory[]=['face','wardrobe','object'];
function fail(message:string,status=409):never{throw Object.assign(new Error(message),{status});}
const stamp=()=>new Date().toISOString();
const jsonHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function visualComparisonPlan(project:Project) {
  return project.characters.flatMap(character=>{
    const appearances=project.scenes.filter(scene=>scene.characterIds.includes(character.id));
    if(appearances.length===1&&appearances[0]!.videoAssetId)return[{character,left:appearances[0]!,right:appearances[0]!}];
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
    const selected=new Set([...project.scenes.map(scene=>scene.videoAssetId??scene.assetId),...project.characters.flatMap(character=>[character.assetId,...character.referenceAssetIds??[]]),...(project.tracks??[]).filter(track=>track.type==='video').flatMap(track=>track.clips.map(clip=>clip.assetId))].filter(Boolean));
    const assets=[];for(const assetId of [...selected].sort()){const asset=project.assets.find(item=>item.id===assetId);assets.push(asset?{...asset,sha256:await fileSha(asset)}:{id:assetId,missing:true});}
    // updatedAt, unrelated library additions and audio do not change these pictures.
    return jsonHash({version:2,id:project.id,format:project.format,fps:project.fps,story:project.story,scenes:project.scenes.map(({audio,clearVideoAsset,preserveVideoAsset,takeAssetIds,...scene})=>scene),characters:project.characters,tracks:project.tracks?.filter(track=>track.type==='video').map(({muted,volume,...track})=>track),aiFinishing:project.aiFinishing,settings:configuration,assets});
  }
  let availableCache:{at:number;value:boolean}|undefined;
  async function available() {
    if(availableCache&&Date.now()-availableCache.at<30000)return availableCache.value;
    let value=false;try{const result=await runProcess(options.python,[options.workerPath,'--doctor','--json'],{timeoutMs:10000});value=result.code===0&&parseJsonOutput(result.stdout).ready===true;}catch{}
    availableCache={at:Date.now(),value};return value;
  }
  async function state(project:Project) {
    const configuration=reconcileVisualSettings(project,await settings(project.id)),report=await load(project.id),currentFingerprint=await fingerprint(project,configuration);
    return {report,currentFingerprint,stale:!!report&&report.fingerprint!==currentFingerprint,settings:configuration,available:await available()};
  }
  async function create(project:Project,configuration:VisualContinuitySettings,force=false) {
    validateSettings(project,configuration);
    if(visualComparisonPlan(project).length*((configuration.sampleCount??3)*3-2)>3000)fail('Esta revisión supera 3.000 intervalos previstos. Divide la película o reduce las apariciones antes de analizar.',422);
    await mkdir(directory(project.id),{recursive:true,mode:0o700});
    const previous=await load(project.id);
    const report:VisualContinuityReport={previousReportId:previous?.id,samplingVersion:2,force,summary:{analyzed:0,reused:0,frames:0,intervals:0},id:randomUUID(),projectId:project.id,fingerprint:await fingerprint(project,configuration),createdAt:stamp(),status:'running',engine:'apple-vision-cpu',settings:configuration,comparisons:[],total:visualComparisonPlan(project).length,warnings:[`Se solicitan ${configuration.sampleCount??3} instantes por aparición, con comparaciones entre planos y dentro de cada plano. Las imágenes fijas y los fotogramas repetidos por final agotado cuentan una sola vez. El muestreo no inspecciona toda la duración.`,'Estas señales visuales no reconocen identidades ni certifican que el rostro, el vestuario o el objeto sean los mismos.']};
    if((project.tracks??[]).some(track=>track.type==='video'&&track.clips.length))report.warnings.push('Las capas superpuestas y sus animaciones no se analizan: revisa también la composición final en el visor.');
    if(!report.total)report.warnings.push('No hay elementos vinculados a más de un plano. No se han realizado comparaciones entre apariciones.');
    if(project.scenes.some(scene=>!scene.characterIds.length))report.warnings.push('Hay planos sin personajes u objetos vinculados; su contenido no está cubierto por estas comparaciones.');
    await mkdir(reportDir(project.id,report.id),{recursive:true,mode:0o700});await save(report);
    await atomic(join(directory(project.id),'settings.json'),configuration);await atomic(join(directory(project.id),'latest.json'),{id:report.id});
    return report;
  }
  async function pairFingerprint(project:Project,entry:ReturnType<typeof visualComparisonPlan>[number],configuration:VisualContinuitySettings,includeLeft:boolean){
    const sceneData=async(scene:Project['scenes'][number])=>{const {audio,clearVideoAsset,preserveVideoAsset,takeAssetIds,...shot}=scene;const asset=project.assets.find(a=>a.id===(scene.videoAssetId??scene.assetId));const narrative=project.story?.scenes.find(s=>s.id===scene.storySceneId);return{shot,narrative,sequence:project.story?.sequences.find(s=>s.id===narrative?.sequenceId),asset:asset?{...asset,sha256:await fileSha(asset)}:null,expected:resolveContinuity(project,scene.id,entry.character.id),automatic:allowsAutomaticVisualMatch(project,scene,entry.character.id)}};
    const ids=new Set([entry.left.id,entry.right.id]),{voice,...character}=entry.character,referenceAssets=[];
    for(const assetId of [character.assetId,...character.referenceAssetIds??[]].filter(Boolean)){const asset=project.assets.find(a=>a.id===assetId);referenceAssets.push(asset?{...asset,sha256:await fileSha(asset)}:{id:assetId,missing:true})}
    return jsonHash({version:2,engine:'apple-vision-cpu-feature-revision-2',fps:project.fps,format:project.format,character,referenceAssets,includeLeft,left:await sceneData(entry.left),right:await sceneData(entry.right),sampleCount:configuration.sampleCount??3,regions:configuration.regions.filter(r=>ids.has(r.sceneId)&&r.characterId===entry.character.id).slice().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),sampleTimes:configuration.sampleTimes.filter(t=>ids.has(t.sceneId)).slice().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))});
  }
  async function sampleFilesPresent(comparison:VisualComparison){
    for(const url of new Set([comparison.left,comparison.right,...(comparison.intervals??[]).flatMap(i=>[i.left,i.right])].flatMap(s=>s.url?[s.url]:[]))){
      const match=url.match(/^\/api\/continuity\/media\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\/([a-f0-9-]+\.png)$/);if(!match)return false;
      try{const s=await lstat(join(reportDir(match[1]!,match[2]!),match[3]!));if(!s.isFile()||s.isSymbolicLink()||!s.size)return false}catch{return false}
    }
    return true;
  }
  async function execute(project:Project,report:VisualContinuityReport,signal:AbortSignal,update:(message:string,progress:number)=>void) {
    const previous=report.previousReportId?await load(project.id,report.previousReportId):undefined;
    const samples=new Map<string,Promise<VisualSample[]>>();
    const sample=(scene:Project['scenes'][number])=>{
      let pending=samples.get(scene.id);if(pending)return pending;
      pending=(async()=>{
        const assetId=scene.videoAssetId??scene.assetId,asset=project.assets.find(item=>item.id===assetId),roles=asset?.type==='image'?['middle']as const:visualMoments(report.settings.sampleCount??3);
        const result:VisualSample[]=[];let path:string|undefined,duration:number|undefined,sourceFps:number=project.fps,readError:string|undefined,oriented:string|undefined;
        try{
          if(!asset||asset.type==='audio')throw new Error('El plano no tiene una imagen o video disponible.');
          path=await options.mediaPath(asset);
          if(asset.type==='video'){
            const probed=await runProcess(options.ffprobe,['-v','error','-select_streams','v:0','-show_entries','stream=duration,avg_frame_rate,color_transfer,color_primaries,color_space:format=duration','-of','json',path],{signal,timeoutMs:30000});
            if(probed.code!==0)throw new Error('No se pudo leer la duración del clip.');
            const probe=parseJsonOutput(probed.stdout),stream=probe.streams?.[0],parts=String(stream?.avg_frame_rate??'').split('/').map(Number),fps=parts[0]!/(parts[1]||1);duration=Number(stream?.duration??probe.format?.duration);
            if(!Number.isFinite(duration)||duration<=0)throw new Error('El clip no informa una duración válida.');
            if(['smpte2084','arib-std-b67'].includes(stream?.color_transfer)||String(stream?.color_primaries??'').includes('2020')||String(stream?.color_space??'').includes('2020'))throw new Error('La comparación requiere muestras SDR. No se aplica conversión HDR o BT.2020 implícita.');
            sourceFps=Number.isFinite(fps)&&fps>0?fps:project.fps;
          }else{
            oriented=join(reportDir(project.id,report.id),`oriented-${randomUUID()}.png`);
            await sharp(path,{limitInputPixels:120000000}).rotate().flatten({background:'#000000'}).resize(1024,1024,{fit:'inside',withoutEnlargement:true}).png().toFile(oriented);
          }
        }catch(error){if(signal.aborted)throw error;readError=error instanceof Error?error.message:String(error)}
        const decoded=new Map<string,{url:string;sourceTime?:number}>();
        for(const role of roles){
          if(signal.aborted)throw new Error('Revisión cancelada.');
          const time=visualMomentTime(scene,project.fps,report.settings,role),requested=(scene.trimStart??0)+time*playbackSpeed(scene.speed),sourceTime=duration===undefined?undefined:Math.min(requested,Math.max(0,duration-1/sourceFps));
          const sourceKey=asset?.type==='image'?`${assetId}:still`:`${assetId}:frame:${sourceTime===undefined?role:Math.floor(sourceTime*sourceFps+1e-6)}`;
          const item:VisualSample={sceneId:scene.id,sceneTitle:scene.title,assetId,time,sourceTime,moment:role,sourceKey,still:asset?.type==='image',limited:sourceTime!==undefined&&sourceTime+1e-7<requested};
          if(readError){item.error=readError;result.push(item);continue}
          try{
            const previous=decoded.get(sourceKey);if(previous){Object.assign(item,previous);result.push(item);continue}
            const filename=`${randomUUID()}.png`,destination=join(reportDir(project.id,report.id),filename);
            const extracted=await runProcess(options.ffmpeg,['-y','-hide_banner','-loglevel','error','-threads','2','-filter_threads','1',...(sourceTime!==undefined?['-ss',String(sourceTime)]:[]),'-i',oriented??path!,'-map','0:v:0','-frames:v','1','-an','-vf',visualFilters(scene),'-threads','1',destination],{signal,timeoutMs:60000});
            if(extracted.code!==0)throw new Error(`No se pudo extraer el fotograma: ${extracted.stderr.slice(-300)}`);
            const info=await stat(destination);if(!info.size)throw new Error('El fotograma está vacío.');
            item.url=`/api/continuity/media/${project.id}/${report.id}/${filename}`;decoded.set(sourceKey,{url:item.url,sourceTime});
          }catch(error){if(signal.aborted)throw error;item.error=error instanceof Error?error.message:String(error)}
          result.push(item);
        }
        return result;
      })();samples.set(scene.id,pending);return pending;
    };
    try {
      for(const [index,entry] of visualComparisonPlan(project).entries()) {
        if(signal.aborted)throw new Error('Revisión cancelada.');
        const includeLeft=!project.scenes.slice(0,project.scenes.indexOf(entry.left)).some(s=>s.characterIds.includes(entry.character.id)),key=await pairFingerprint(project,entry,report.settings,includeLeft);
        const old=previous?.samplingVersion===2&&!report.force?previous.comparisons.find(c=>c.fingerprint===key&&c.intervals?.length):undefined;
        if(old&&await sampleFilesPresent(old)){
          report.comparisons.push({...structuredClone(old),id:`pair-${index}`,reusedFrom:previous!.id});report.summary!.reused++;
          report.summary!.intervals+=old.intervals!.length;await save(report);update(`Reutilizada sin cambios: ${entry.character.name}, ${entry.left.title} → ${entry.right.title}.`,Math.round((index+1)/Math.max(1,report.total)*95));continue;
        }
        update(`Leyendo ${report.settings.sampleCount??3} instantes: ${entry.left.title} → ${entry.right.title}…`,Math.round(index/Math.max(1,report.total)*95));
        const allLeft=await sample(entry.left),allRight=await sample(entry.right),left=uniqueVisualSamples(allLeft),right=uniqueVisualSamples(allRight),state=resolveContinuity(project,entry.right.id,entry.character.id)!;
        const primary=(all:VisualSample[])=>all.find(s=>s.moment==='middle')??all[0]!;
        const comparison:VisualComparison={id:`pair-${index}`,characterId:entry.character.id,characterName:entry.character.name,left:{...primary(allLeft)},right:{...primary(allRight)},checks:[],intervals:[],fingerprint:key,coverage:{left:{requested:report.settings.sampleCount??3,unique:left.filter(s=>!s.error).length,still:allLeft.some(s=>s.still),limited:allLeft.filter(s=>s.limited).length},right:{requested:report.settings.sampleCount??3,unique:right.filter(s=>!s.error).length,still:allRight.some(s=>s.still),limited:allRight.filter(s=>s.limited).length}},intentionalChange:state.intentionalChange,changeReason:state.changeReason,expected:{face:state.values.appearance,wardrobe:state.values.costume,object:state.values.props}};
        const intervals=visualIntervals(left,right,includeLeft);
        for(const [position,interval] of intervals.entries()){
          if(signal.aborted)throw new Error('Revisión cancelada.');
          const {left:l,right:r}=interval;
          update(`Comparando ${entry.character.name}: intervalo ${position+1}/${intervals.length} · aparición ${index+1}/${report.total}…`,Math.round((index+(position+1)/intervals.length)/Math.max(1,report.total)*95));
          const value:VisualInterval={...interval,checks:[]};
          if(l.error||r.error)value.checks=categories.map(category=>({category,status:'insufficient',origin:'unavailable',message:[l.error,r.error].filter(Boolean).join(' ')}));
          else{
            const regions:Partial<Record<VisualCategory,{left?:VisualRegion;right?:VisualRegion}>>={};
            for(const category of categories){const a=visualRegionAt(report.settings,l.sceneId,entry.character.id,category,l.moment),b=visualRegionAt(report.settings,r.sceneId,entry.character.id,category,r.moment);if(a||b)regions[category]={left:a,right:b}}
            const sceneLeft=project.scenes.find(s=>s.id===l.sceneId)!,sceneRight=project.scenes.find(s=>s.id===r.sceneId)!;
            const request={leftPath:join(reportDir(project.id,report.id),l.url!.split('/').at(-1)!),rightPath:join(reportDir(project.id,report.id),r.url!.split('/').at(-1)!),regions,allowAutomatic:allowsAutomaticVisualMatch(project,sceneLeft,entry.character.id)&&allowsAutomaticVisualMatch(project,sceneRight,entry.character.id)};
            const requestPath=join(reportDir(project.id,report.id),`request-${index}-${position}.json`);await writeFile(requestPath,JSON.stringify(request),{mode:0o600});
            const analyzed=await runProcess(options.python,[options.workerPath,'--input',requestPath],{signal,timeoutMs:120000});
            if(analyzed.code!==0)throw new Error(`El análisis local no pudo continuar: ${analyzed.stderr.slice(-700)||analyzed.stdout.slice(-700)}`);
            const analysis=parseJsonOutput(analyzed.stdout);
            if(!Array.isArray(analysis.checks)||analysis.checks.length!==3||categories.some(category=>!analysis.checks.some((check:any)=>check.category===category&&['possible-change','no-obvious-change','insufficient'].includes(check.status))))throw new Error('El motor visual devolvió un análisis incompleto.');
            value.checks=analysis.checks;value.faces=analysis.faces;value.elapsedMs=analysis.elapsedMs;
          }
          comparison.intervals!.push(value);
        }
        comparison.checks=aggregateVisualChecks(comparison.intervals!);comparison.elapsedMs=comparison.intervals!.reduce((n,i)=>n+(i.elapsedMs??0),0);
        const middle=comparison.intervals!.find(i=>i.kind==='between'&&i.left.moment==='middle')??comparison.intervals![0];comparison.faces=middle?.faces;
        report.comparisons.push(comparison);report.summary!.analyzed++;report.summary!.intervals+=comparison.intervals!.length;
        report.summary!.frames=new Set(report.comparisons.flatMap(c=>[c.left,c.right,...(c.intervals??[]).flatMap(i=>[i.left,i.right])]).filter(s=>s.url&&!s.error).map(s=>JSON.stringify([s.sceneId,s.sourceKey??s.url]))).size;
        await save(report);
      }
      report.summary!.frames=new Set(report.comparisons.flatMap(c=>[c.left,c.right,...(c.intervals??[]).flatMap(i=>[i.left,i.right])]).filter(s=>s.url&&!s.error).map(s=>JSON.stringify([s.sceneId,s.sourceKey??s.url]))).size;
      if(await fingerprint(project,report.settings)!==report.fingerprint)throw new Error('Un archivo cambió durante el análisis. Vuelve a revisar las fuentes actuales.');
      report.status='completed';report.completedAt=stamp();await save(report);return report;
    }catch(error){report.status=signal.aborted?'cancelled':'failed';report.error=error instanceof Error?error.message:String(error);await save(report);throw error;}
  }
  async function review(project:Project,input:{reportId:string;fingerprint:string;comparisonId?:string;decision?:'reviewed'|'intentional'|'pending';note:string;allSamplesReviewed?:boolean}) {
    const report=await load(project.id,input.reportId);if(!report)fail('No se encuentra ese informe.',404);
    if(report.status!=='completed')fail('Espera a que termine el análisis.');
    if(report.fingerprint!==input.fingerprint||await fingerprint(project,await settings(project.id))!==report.fingerprint)fail('El montaje cambió. Analiza de nuevo antes de aprobar la continuidad.');
    if(input.comparisonId){const comparison=report.comparisons.find(item=>item.id===input.comparisonId);if(!comparison)fail('No se encuentra la comparación.',404);
      if(input.decision==='pending')delete comparison.decision;
      else {if(report.samplingVersion===2&&!input.allSamplesReviewed)fail('Confirma que revisaste todos los intervalos de esta aparición.',400);if(!input.decision)fail('Selecciona cómo resolver la comparación.',400);if((comparison.checks.some(check=>check.status!=='no-obvious-change')||input.decision==='intentional')&&!input.note.trim())fail('Añade una nota para dejar constancia de las diferencias o límites revisados.',400);comparison.decision={decision:input.decision,note:input.note.trim(),reviewedAt:stamp()};}
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
    const report=await load(projectId,reportId);if(!report||!report.comparisons.some(comparison=>[comparison.left.url,comparison.right.url,...(comparison.intervals??[]).flatMap(i=>[i.left.url,i.right.url])].some(url=>url?.endsWith(`/${filename}`))))fail('Fotograma no encontrado.',404);
    const path=join(reportDir(projectId,reportId),filename),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())fail('Fotograma no disponible.',404);return path;
  }
  async function interrupt(projectId:string,reportId:string,status:'failed'|'cancelled',message:string) { const report=await load(projectId,reportId);if(report?.status==='running'){report.status=status;report.error=message;await save(report);} }
  return {state,create,execute,review,requireReview,media,fingerprint,settings,load,interrupt};
}
