import type { Character, Project, Scene, SubtitleCue } from './types';
import { buildTimeline } from './timeline';
import { DEFAULT_PROJECT_FPS, isProjectFrameRate } from './export-resolution';

export const MAX_SUBTITLE_CUES = 1000;
export const MAX_SUBTITLE_TEXT = 2000;
export type ResolvedSubtitleCue = { cue: SubtitleCue; startFrame: number; endFrame: number };
export type SubtitleIssue = { kind:'stale'|'overlap'|'readability'|'outside'|'empty'|'orphan'|'speaker'; cueId:string; sceneId:string; message:string };
const normalized = (text: string) => text.replace(/\r\n?/g, '\n');
const nameKey = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').trim().toLocaleLowerCase('es');
const fpsOf = (fps: number) => isProjectFrameRate(fps) ? fps : DEFAULT_PROJECT_FPS;

/** Compact provenance, not authentication. Avoid repeating a 12 kB script in every cue. */
export function dialogueSourceSignature(dialogue: string) {
  let hash = 2166136261;
  for (const character of normalized(dialogue)) { hash ^= character.codePointAt(0)!; hash = Math.imul(hash, 16777619); }
  return `filmma-dialogue-v1:${normalized(dialogue).length}:${(hash >>> 0).toString(16)}`;
}
export function subtitleSourceChanged(cue: SubtitleCue, scene: Scene) {
  return cue.sourceDialogue !== undefined && cue.sourceDialogue !== scene.dialogue && cue.sourceDialogue !== dialogueSourceSignature(scene.dialogue);
}

function splitText(text: string, limit: number) {
  const result: string[] = [];
  let remaining = text.trim();
  while (remaining.length > limit) {
    // Prefer a complete sentence/line, then a word boundary. Never drop punctuation.
    const candidates = [...remaining.slice(0, limit + 1).matchAll(/(?:[.!?…](?:[”"']?))\s+|\n|\s+/gu)];
    const boundary = candidates.filter((match) => match.index! >= limit * .45).at(-1);
    let cut = boundary ? boundary.index! + (/[.!?…]/.test(boundary[0]) ? boundary[0].trimEnd().length : 0) : limit;
    // Keep a UTF-16 surrogate pair together when a very long token must be split.
    if (cut > 0 && /[\uD800-\uDBFF]/.test(remaining[cut - 1]!)) cut--;
    result.push(remaining.slice(0, cut).trim()); remaining = remaining.slice(cut).trim();
  }
  if (remaining) result.push(remaining);
  return result;
}

function allocate(scene: Scene, fps: number, parts: {text:string;characterId?:string}[], newId:()=>string): SubtitleCue[] {
  const rate=fpsOf(fps), total=Math.max(1,Math.round(scene.duration*rate));
  // When speech is too dense, keep all text and expose readability warnings.
  while (parts.length > total) {
    let shortest=-1, length=Infinity;
    for (let index=0;index<parts.length-1;index++) {
      const size=parts[index]!.text.length+parts[index+1]!.text.length+1;
      if (size<=MAX_SUBTITLE_TEXT && size<length) { shortest=index;length=size; }
    }
    if (shortest<0) throw new Error('El diálogo no cabe en la duración del plano. Amplía su duración antes de crear subtítulos.');
    const first=parts[shortest]!,second=parts[shortest+1]!;
    parts.splice(shortest,2,{text:`${first.text}\n${second.text}`,characterId:first.characterId===second.characterId?first.characterId:undefined});
  }
  const weight=parts.reduce((sum,part)=>sum+Math.max(1,Array.from(part.text).length),0), extra=total-parts.length;
  let cursor=0,usedWeight=0;
  return parts.map((part,index)=>{
    usedWeight+=Math.max(1,Array.from(part.text).length);
    const end=index===parts.length-1?total:index+1+Math.round(extra*usedWeight/weight);
    const cue:SubtitleCue={id:newId(),sceneId:scene.id,start:cursor/rate,end:end/rate,text:part.text,sourceDialogue:dialogueSourceSignature(scene.dialogue),...(part.characterId?{characterId:part.characterId}:{})};
    cursor=end;return cue;
  });
}

/** A deterministic text breakdown, not transcription or speech synthesis.
 * Speaker names are metadata; words and parentheticals remain editable visible text.
 * This function returns a proposal. It never changes existing subtitles. */
export function cuesFromDialogue(scene: Scene, fps: number, characters: Character[], newId:()=>string=()=>crypto.randomUUID()): SubtitleCue[] {
  const linked=characters.filter((character)=>scene.characterIds.includes(character.id));
  const findSpeaker=(name:string)=>linked.find((character)=>nameKey(character.name)===nameKey(name.replace(/\s*\([^)]*\)\s*$/, '')))?.id;
  const lines=normalized(scene.dialogue).split('\n'), blocks:{text:string;characterId?:string}[]=[];
  let buffer:string[]=[],speaker:string|undefined;
  const flush=()=>{const text=buffer.join('\n').trim();if(text)blocks.push({text,characterId:speaker});buffer=[];};
  for(let index=0;index<lines.length;index++) {
    const line=lines[index]!.trim();
    if(!line){flush();continue;}
    const inline=line.match(/^([^:\n]{1,100}):\s*(.+)$/u);
    if(inline && (findSpeaker(inline[1]!) || (inline[1]===inline[1]!.toLocaleUpperCase() && /\p{L}/u.test(inline[1]!)))) {
      flush();speaker=findSpeaker(inline[1]!);buffer.push(inline[2]!);continue;
    }
    const isSpeaker=(index===0||!lines[index-1]?.trim()) && !!lines[index+1]?.trim() && (line.startsWith('@') || !!findSpeaker(line) || (line.length<=100 && /\p{L}/u.test(line) && line===line.toLocaleUpperCase() && !/[.!?…:]$/.test(line)));
    if(isSpeaker){flush();speaker=findSpeaker(line.replace(/^@/,''));continue;}
    buffer.push(line);
  }
  flush();
  const parts=blocks.flatMap((block)=>splitText(block.text,84).map((text)=>({text,characterId:block.characterId})));
  return allocate(scene,fps,parts,newId);
}

/** Explicit list, or a materialized legacy SRT representation when requested by
 * an editing operation. Returned cue times are relative to their anchor scene.
 * Merely resolving a preview does NOT call this fallback. */
export function getProjectSubtitleCues(project: Project): SubtitleCue[] {
  if(project.subtitleCues!==undefined)return project.subtitleCues.map((cue)=>({...cue}));
  return project.scenes.flatMap((scene,sceneIndex)=>{
    let index=0;
    const parts=splitText(normalized(scene.dialogue).replace(/\n\s*\n/g,'\n'),MAX_SUBTITLE_TEXT).map((text)=>({text}));
    return allocate(scene,project.fps,parts,()=>`legacy-${sceneIndex}-${++index}-${scene.id.slice(0,60)}`);
  });
}

/** Global frame intervals, [startFrame,endFrame), clamped to each anchor scene.
 * Undefined subtitles are not automatically burned into an existing project.
 * Exporters can opt into disabled cues and the historical dialogue-based SRT. */
export function resolveSubtitleCues(project: Project, options:{includeDisabled?:boolean;legacyDialogue?:boolean}={}): ResolvedSubtitleCue[] {
  if(project.subtitlesEnabled===false&&!options.includeDisabled)return [];
  const layout=buildTimeline(project),anchors=new Map(layout.segments.map((segment)=>[segment.scene.id,segment]));
  const cues=project.subtitleCues??(options.legacyDialogue?getProjectSubtitleCues(project):[]);
  const result:ResolvedSubtitleCue[]=[];
  for(const cue of cues) {
    const anchor=anchors.get(cue.sceneId);
    if(!anchor||!Number.isFinite(cue.start)||!Number.isFinite(cue.end)||!cue.text.trim())continue;
    const start=Math.max(0,Math.min(anchor.durationFrames,Math.round(cue.start*layout.fps)));
    const end=Math.max(0,Math.min(anchor.durationFrames,Math.round(cue.end*layout.fps)));
    if(end>start)result.push({cue,startFrame:anchor.startFrame+start,endFrame:anchor.startFrame+end});
  }
  return result.sort((left,right)=>left.startFrame-right.startFrame||left.endFrame-right.endFrame);
}

/** Only an explicit, reviewed replacement can overwrite the selected scene. */
export function replaceSceneSubtitleCues(project:Project,sceneId:string,replacement:SubtitleCue[]):Project {
  const scene=project.scenes.find((item)=>item.id===sceneId);
  if(!scene)throw new Error('El plano ya no está en este proyecto.');
  const other=(project.subtitleCues??[]).filter((cue)=>cue.sceneId!==sceneId),ids=new Set(other.map((cue)=>cue.id));
  if(other.length+replacement.length>MAX_SUBTITLE_CUES)throw new Error('El proyecto admite hasta 1.000 subtítulos. Reduce la selección antes de continuar.');
  const rate=fpsOf(project.fps),durationFrames=Math.round(scene.duration*rate);
  for(const cue of replacement){
    if(cue.sceneId!==sceneId||!/^[a-zA-Z0-9_-]{1,100}$/.test(cue.id)||ids.has(cue.id))throw new Error('Los subtítulos necesitan identificadores únicos y un plano válido.');
    if(cue.text.length>MAX_SUBTITLE_TEXT)throw new Error('Cada subtítulo admite hasta 2.000 caracteres.');
    if(!Number.isFinite(cue.start)||!Number.isFinite(cue.end)||cue.start<0||Math.round(cue.end*rate)<=Math.round(cue.start*rate)||Math.round(cue.end*rate)>durationFrames)throw new Error('Revisa los tiempos: cada subtítulo debe caber en su plano.');
    if(cue.characterId&&!scene.characterIds.includes(cue.characterId))throw new Error('Vincula el personaje al plano antes de asociarlo al subtítulo.');
    ids.add(cue.id);
  }
  return {...project,subtitleCues:[...other,...replacement.map((cue)=>({...cue,start:Math.round(cue.start*rate)/rate,end:Math.round(cue.end*rate)/rate}))]};
}

export function subtitleIssues(project:Project):SubtitleIssue[] {
  const issues:SubtitleIssue[]=[],seen=new Set<string>(),layout=buildTimeline(project),anchors=new Map(layout.segments.map((segment)=>[segment.scene.id,segment]));
  const add=(cue:SubtitleCue,kind:SubtitleIssue['kind'],message:string)=>{const key=`${cue.id}:${kind}`;if(!seen.has(key)){seen.add(key);issues.push({kind,cueId:cue.id,sceneId:cue.sceneId,message});}};
  for(const cue of project.subtitleCues??[]){
    const anchor=anchors.get(cue.sceneId);
    if(!anchor){add(cue,'orphan','El plano de este subtítulo ya no existe.');continue;}
    if(cue.characterId&&!anchor.scene.characterIds.includes(cue.characterId))add(cue,'speaker','El personaje ya no está vinculado a este plano. Su asociación y el texto se conservan para revisión.');
    if(subtitleSourceChanged(cue,anchor.scene))add(cue,'stale','El diálogo del guion cambió. Tu edición se conserva; compárala antes de reemplazar.');
    if(!cue.text.trim())add(cue,'empty','Este subtítulo está vacío y no aparecerá en la película.');
    if(!Number.isFinite(cue.start)||!Number.isFinite(cue.end)||cue.start<0||cue.end>anchor.durationFrames/layout.fps||cue.end<=cue.start||cue.start>=anchor.durationFrames/layout.fps)add(cue,'outside','Parte del tiempo queda fuera del plano; sólo se mostrará el tramo que cabe.');
  }
  const resolved=resolveSubtitleCues(project,{includeDisabled:true});
  for(let index=0;index<resolved.length;index++){
    const current=resolved[index]!,length=Array.from(current.cue.text.replace(/\s/g,'')).length,seconds=(current.endFrame-current.startFrame)/layout.fps,lines=current.cue.text.split('\n');
    if(length/seconds>20||lines.length>2||lines.some((line)=>Array.from(line).length>42))add(current.cue,'readability','Lectura exigente: prueba menos texto, hasta dos líneas, o más tiempo.');
    for(let next=index+1;next<resolved.length&&resolved[next]!.startFrame<current.endFrame;next++){
      add(current.cue,'overlap','Se superpone con otro subtítulo. Revisa su entrada y salida.');add(resolved[next]!.cue,'overlap','Se superpone con otro subtítulo. Revisa su entrada y salida.');
    }
  }
  return issues;
}

/** Escape SRT markup; blank lines cannot introduce another subtitle block.
 * ASS burn-in needs its own ASS escaping in addition to this plain SRT helper. */
export function escapeSrtText(text:string){return normalized(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n(?:[\t ]*\n)+/g,'\n').trim();}
export function exportSubtitlesSrt(project:Project){
  const fps=fpsOf(project.fps);
  const clock=(frame:number)=>{const ms=Math.round(frame*1000/fps);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};
  const cues=resolveSubtitleCues(project,{includeDisabled:true,legacyDialogue:true});
  return cues.map(({cue,startFrame,endFrame},index)=>`${index+1}\n${clock(startFrame)} --> ${clock(endFrame)}\n${escapeSrtText(cue.text)}\n`).join('\n');
}
