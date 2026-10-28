import type{Project,SubtitleCue}from'./types';
import{buildTimeline}from'./timeline';
import{dialogueSourceSignature,MAX_SUBTITLE_CUES,MAX_SUBTITLE_TEXT}from'./subtitles';

export function subtitleImportVersion(p:Project){return JSON.stringify([p.id,p.fps,p.scenes.map(s=>[s.id,s.duration,s.dialogue,s.characterIds]),p.subtitleCues])}
export function importSrt(text:string,project:Project,newId:()=>string=()=>crypto.randomUUID(),offsetSeconds=0){
 if(!Number.isFinite(offsetSeconds)||Math.abs(offsetSeconds)>86400)throw new Error('El desplazamiento del SRT debe estar entre −86400 y 86400 segundos.');
 if(new TextEncoder().encode(text).length>512*1024)throw new Error('El SRT supera 512 KiB. Divide el archivo antes de importarlo.');
 const blocks=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim().split(/\n[\t ]*\n/),layout=buildTimeline(project),cues:SubtitleCue[]=[],warnings:string[]=[];
 const stamp=(h:string,m:string,s:string,ms:string)=>(+h*3600+ +m*60+ +s+ +ms/1000)*layout.fps;
 if(blocks.length>MAX_SUBTITLE_CUES)throw new Error('El SRT supera 1.000 entradas. Divide el archivo antes de importarlo.');
 for(const[index,block]of blocks.entries()){
  const lines=block.split('\n');if(/^\d+$/.test(lines[0]?.trim()??''))lines.shift();
  const time=lines.shift()?.trim().match(/^(\d{1,3}):([0-5]\d):([0-5]\d)[,.](\d{3})\s+-->\s+(\d{1,3}):([0-5]\d):([0-5]\d)[,.](\d{3})$/);
  if(!time)throw new Error(`La entrada ${index+1} no tiene tiempos SRT válidos (hh:mm:ss,mmm).`);
  const start=Math.round(stamp(...time.slice(1,5) as [string,string,string,string])+offsetSeconds*layout.fps),end=Math.round(stamp(...time.slice(5,9) as [string,string,string,string])+offsetSeconds*layout.fps);
  const words=lines.join('\n').trim().replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  if(end<=start||!words){warnings.push(`Entrada ${index+1}: no tiene texto o un intervalo de al menos un fotograma; no se añadirá.`);continue}
  if(words.length>MAX_SUBTITLE_TEXT)throw new Error(`La entrada ${index+1} supera 2.000 caracteres.`);
  const segments=layout.segments.filter(s=>s.startFrame<end&&s.endFrame>start);
  if(!segments.length){warnings.push(`Entrada ${index+1}: queda fuera de la película; no se añadirá.`);continue}
  if(start<0||end>layout.totalFrames)warnings.push(`Entrada ${index+1}: sólo se añadirá el tramo dentro de la película.`);
  if(segments.length>1)warnings.push(`Entrada ${index+1}: cruza ${segments.length} planos; su texto se conservará en cada tramo.`);
  for(const s of segments)cues.push({id:newId(),sceneId:s.scene.id,start:(Math.max(start,s.startFrame)-s.startFrame)/layout.fps,end:(Math.min(end,s.endFrame)-s.startFrame)/layout.fps,text:words,sourceDialogue:dialogueSourceSignature(s.scene.dialogue)});
 }
 if(!cues.length)throw new Error('El SRT no contiene subtítulos visibles dentro de esta película.');
 if(cues.length+(project.subtitleCues?.length??0)>MAX_SUBTITLE_CUES)throw new Error('Añadir el SRT superaría los 1.000 subtítulos. Los actuales se conservan.');
 return{cues,warnings,sourceCount:blocks.length};
}

export type SubtitleTimingKind='move'|'start'|'end';
export type SubtitleGesture={projectId:string;fps:number;durationFrames:number;cue:SubtitleCue};
export function subtitleGesture(project:Project,id:string):SubtitleGesture{
 const cue=project.subtitleCues?.find(c=>c.id===id),scene=project.scenes.find(s=>s.id===cue?.sceneId);
 if(!cue||!scene)throw new Error('El subtítulo o su plano ya no están disponibles.');
 return{projectId:project.id,fps:project.fps,durationFrames:Math.round(scene.duration*project.fps),cue:{...cue}};
}
export function previewSubtitleTiming(s:SubtitleGesture,kind:SubtitleTimingKind,deltaFrames:number):SubtitleCue{
 const a=Math.round(s.cue.start*s.fps),b=Math.round(s.cue.end*s.fps),delta=Math.round(deltaFrames),max=s.durationFrames;
 if(b>max||a<0||b<=a)throw new Error('Corrige los tiempos fuera del plano antes de arrastrar este subtítulo.');
 const clamp=(v:number,low:number,high:number)=>Math.max(low,Math.min(high,v));
 const start=kind==='move'?clamp(a+delta,0,max-(b-a)):kind==='start'?clamp(a+delta,0,b-1):a;
 const end=kind==='move'?start+b-a:kind==='end'?clamp(b+delta,a+1,max):b;
 return{...s.cue,start:start/s.fps,end:end/s.fps};
}
export function commitSubtitleTiming(project:Project,s:SubtitleGesture,cue:SubtitleCue):Project{
 const current=subtitleGesture(project,s.cue.id);
 if(project.id!==s.projectId||project.fps!==s.fps||current.durationFrames!==s.durationFrames||JSON.stringify(current.cue)!==JSON.stringify(s.cue))throw new Error('El subtítulo cambió durante la edición. Vuelve a revisar sus tiempos.');
 if(cue.id!==s.cue.id||cue.sceneId!==s.cue.sceneId||cue.start<0||cue.end*s.fps>s.durationFrames+1e-7||Math.round((cue.end-cue.start)*s.fps)<1)throw new Error('El intervalo del subtítulo no es válido.');
 return{...project,subtitleCues:project.subtitleCues!.map(c=>c.id===cue.id?{...c,start:cue.start,end:cue.end}:c)};
}
export function splitSubtitle(project:Project,id:string,globalSeconds:number,newId:()=>string=()=>crypto.randomUUID()):Project{
 const s=subtitleGesture(project,id),anchor=buildTimeline(project).segments.find(x=>x.scene.id===s.cue.sceneId)!,cut=(Math.round(globalSeconds*project.fps)-anchor.startFrame)/project.fps;
 if(cut<=s.cue.start||cut>=s.cue.end)throw new Error('Sitúa el cabezal dentro del subtítulo para dividirlo.');
 if((project.subtitleCues?.length??0)>=MAX_SUBTITLE_CUES)throw new Error('Se alcanzó el límite de 1.000 subtítulos.');
 return{...project,subtitleCues:project.subtitleCues!.flatMap(c=>c.id===id?[{...c,end:cut},{...c,id:newId(),start:cut}]:[c])};
}

/** Manual word boundary at a user-chosen frame. No transcription/alignment claim. */
export function splitSubtitleAtWord(project:Project,id:string,wordIndex:number,globalSeconds:number,newId:()=>string=()=>crypto.randomUUID()):Project{
 const cue=project.subtitleCues?.find(c=>c.id===id),words=cue?.text.match(/\S+/g)??[];
 if(!cue||!Number.isInteger(wordIndex)||wordIndex<1||wordIndex>=words.length)throw new Error('Elige una palabra posterior a la primera para dividir el texto.');
 const matches=[...cue.text.matchAll(/\S+/g)],cut=matches[wordIndex]!.index!;
 const next=splitSubtitle(project,id,globalSeconds,newId);
 const originalIndex=next.subtitleCues!.findIndex(c=>c.id===id),right=next.subtitleCues![originalIndex+1]!;
 return{...next,subtitleCues:next.subtitleCues!.map(c=>c.id===id?{...c,text:cue.text.slice(0,cut).trimEnd()}:c.id===right.id?{...c,text:cue.text.slice(cut)}:c)};
}
