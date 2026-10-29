import type {Project,TimelineClip,EditorTrack} from './types';
import {buildTimeline} from './timeline';
import {resolveTimelineClips} from './multitrack';
import {rebaseLayerKeyframes} from './layer-editing';
import {playbackSpeed} from './visual-effects';
/** A render-only view. Originals, identities and voice provenance keep their IDs. */
export function exportScope<P extends Project>(project:P,sequenceIds?:string[]):P{
 if(sequenceIds===undefined)return structuredClone(project);
 if(!sequenceIds.length||new Set(sequenceIds).size!==sequenceIds.length||sequenceIds.some(id=>!project.story?.sequences.some(s=>s.id===id)))throw new Error('Selecciona episodios existentes y sin repeticiones.');
 const story=project.story!,stories=story.scenes.filter(s=>sequenceIds.includes(s.sequenceId)),storyIds=new Set(stories.map(s=>s.id)),scenes=project.scenes.filter(s=>s.storySceneId&&storyIds.has(s.storySceneId)),ids=new Set(scenes.map(s=>s.id));
 if(sequenceIds.some(id=>!scenes.some(s=>stories.find(t=>t.id===s.storySceneId)?.sequenceId===id)))throw new Error('Cada episodio seleccionado necesita al menos un plano.');
 const layout=buildTimeline(project),segments=layout.segments.filter(s=>ids.has(s.scene.id)),windows:{start:number;end:number}[]=[];
 for(const segment of segments){const last=windows.at(-1);if(last?.end===segment.startFrame)last.end=segment.endFrame;else windows.push({start:segment.startFrame,end:segment.endFrame});}
 const replacements=new Map<string,string[]>(),used=new Set(project.tracks?.flatMap(t=>t.clips.map(c=>c.id))),resolved=resolveTimelineClips(project);
 const tracks=project.tracks?.map(t=>({...t,clips:t.clips.flatMap(clip=>{
  const item=resolved.find(r=>r.track.id===t.id&&r.clip.id===clip.id);if(!item)return [];
  const pieces:TimelineClip[]=[];
  for(const w of windows){const start=Math.max(w.start,item.startFrame),end=Math.min(w.end,item.endFrame);if(end<=start)continue;
   const anchor=segments.find(s=>s.startFrame<=start&&s.endFrame>start)!,delta=(start-item.startFrame)/layout.fps;
   let id=clip.id;if(pieces.length){let n=pieces.length;do{id=clip.id.slice(0,75)+'-export-'+n++;}while(used.has(id));used.add(id);}
   const envelope=clip.envelope??{offset:0,duration:Math.round(clip.duration*layout.fps)/layout.fps};
   pieces.push({...clip,id,sceneId:anchor.scene.id,offset:(start-anchor.startFrame)/layout.fps,duration:(end-start)/layout.fps,trimStart:item.asset.type==='image'?clip.trimStart:clip.trimStart+delta*playbackSpeed(clip.speed),keyframes:rebaseLayerKeyframes(clip,delta),envelope:{...envelope,offset:envelope.offset+delta}});
  }
  replacements.set(clip.id,pieces.map(c=>c.id));return pieces;
 })}));
 let renderTracks:EditorTrack[]|undefined=tracks;
 // The legacy full-film soundtrack also starts at its original source time.
 if(project.audioAssetId&&!project.audioMuted&&(project.audioVolume??.5)>0){const scoreId='filmma-export-score';renderTracks=[...(tracks??[]),{id:scoreId,name:'Banda sonora del proyecto',type:'audio',muted:false,volume:1,clips:windows.map((w,i)=>({id:scoreId+'-'+i,assetId:project.audioAssetId!,sceneId:segments.find(s=>s.startFrame===w.start)!.scene.id,offset:0,duration:(w.end-w.start)/layout.fps,trimStart:w.start/layout.fps,volume:project.audioVolume??.5}))}];}
 const lines=new Set(renderTracks?.flatMap(t=>t.clips.map(c=>c.dialogueLineId)).filter(Boolean));
 return structuredClone({...project,scenes,story:{sequences:story.sequences.filter(s=>sequenceIds.includes(s.id)),scenes:stories},audioAssetId:undefined,tracks:renderTracks,...(project.audioMix?{audioMix:{...project.audioMix,musicTrackIds:[...project.audioMix.musicTrackIds,...(renderTracks?.some(t=>t.id==='filmma-export-score')?['filmma-export-score']:[])]}}:{}),dialogueLines:project.dialogueLines?.filter(l=>ids.has(l.sceneId)||lines.has(l.id)),subtitleCues:project.subtitleCues?.filter(c=>ids.has(c.sceneId)),markers:project.markers?.filter(m=>ids.has(m.sceneId)),clipGroups:project.clipGroups?.map(g=>({...g,clipIds:g.clipIds.flatMap(id=>replacements.get(id)??[])})).filter(g=>g.clipIds.length>=2)});
}
