import type {Project} from './types';
import {isProjectFrameRate} from './export-resolution';
import {resolveTimelineClips} from './multitrack';
import {resolveSubtitleCues} from './subtitles';

/** Output FPS changes the display grid, never the seconds or source playback rate.
 * Refuse a lower rate when it would erase an existing cue or merge animation keys. */
export function validateProjectFrameRateChange(project:Project,previous?:Project) {
 if(!isProjectFrameRate(project.fps))throw new Error('Elige 24, 25, 30, 48, 50 o 60 fps para la salida.');
 const frame=(seconds:number)=>Math.round(seconds*project.fps);
 for(const track of project.tracks??[])for(const clip of track.clips){
  if(frame(clip.duration)<1)throw new Error(`No se cambió la salida: un clip de «${track.name}» dura menos de un fotograma a ${project.fps} fps. Amplía ese clip o conserva los FPS anteriores.`);
  const frames=(clip.keyframes??[]).map(key=>frame(key.time));
  if(new Set(frames).size!==frames.length)throw new Error(`No se cambió la salida: dos fotogramas clave de «${track.name}» coincidirían a ${project.fps} fps. Sepáralos o conserva los FPS anteriores.`);
 }
 for(const cue of project.subtitleCues??[]){
  if(frame(cue.end)<=frame(cue.start))throw new Error(`No se cambió la salida: el subtítulo «${cue.text.slice(0,60)}» duraría menos de un fotograma a ${project.fps} fps. Amplíalo o conserva los FPS anteriores.`);
 }
 if(previous&&previous.id===project.id){
  const visibleClips=new Set(resolveTimelineClips(project).map(item=>item.clip.id));
  const existingClips=new Set((project.tracks??[]).flatMap(track=>track.clips.map(clip=>clip.id)));
  for(const item of resolveTimelineClips(previous))if(existingClips.has(item.clip.id)&&!visibleClips.has(item.clip.id))throw new Error(`No se cambió la salida: un clip de «${item.track.name}» quedaría fuera del montaje a ${project.fps} fps. Adelanta su entrada o conserva los FPS anteriores.`);
  const visibleCues=new Set(resolveSubtitleCues(project,{includeDisabled:true}).map(item=>item.cue.id));
  const existingCues=new Set((project.subtitleCues??[]).map(cue=>cue.id));
  for(const item of resolveSubtitleCues(previous,{includeDisabled:true}))if(existingCues.has(item.cue.id)&&!visibleCues.has(item.cue.id))throw new Error(`No se cambió la salida: el subtítulo «${item.cue.text.slice(0,60)}» quedaría fuera de su plano a ${project.fps} fps. Adelanta su entrada o conserva los FPS anteriores.`);
 }
}
