import type { Asset, Project, Scene } from './types';

type RestoredTake={assetId:string;trimStart:number;speed:number;history:string[]};

/** Enhancement does not change the media clock. A lip-sync render bakes it in. */
function restoredTake(project:Project,scene:Scene,lineId:string):RestoredTake|undefined {
  if(!scene.videoAssetId)return undefined;
  const assets=new Map(project.assets.map(asset=>[asset.id,asset]));
  let current:Asset|undefined=assets.get(scene.videoAssetId);
  if(!current)return undefined;
  let trimStart=scene.trimStart??0,speed=scene.speed??1,removed=false;
  const visited=new Set<string>(),history:string[]=[];
  while(current){
    if(visited.has(current.id))throw new Error('La toma tiene un ciclo en sus originales. Selecciona otra toma antes de retirar esta intervención.');
    visited.add(current.id);history.push(current.id);
    if(current.type!=='video')throw new Error('El original de esta toma no es un video. Selecciona otra toma antes de retirar la intervención.');
    let parentId:string|undefined;
    if(current.lipSync){
      if(current.lipSync.projectId!==project.id||current.lipSync.lineId!==lineId)break;
      removed=true;
      // Preserve an additional trim/speed applied after synchronizing, including
      // consecutive synchronized copies of the same intervention.
      trimStart=current.lipSync.trimStart+trimStart*current.lipSync.speed;
      speed*=current.lipSync.speed;
      parentId=current.lipSync.sourceAssetId;
    }else if(current.enhancement){
      parentId=current.enhancement.sourceAssetId;
    }else break;
    const parent=assets.get(parentId);
    if(!parent)throw new Error('Falta la toma original necesaria para retirar la voz incrustada. Recupera el original o selecciona otra toma primero.');
    current=parent;
  }
  if(!removed||!current)return undefined;
  if(!Number.isFinite(trimStart)||trimStart<0||trimStart>86400||!Number.isFinite(speed)||speed<.25||speed>4){
    throw new Error('Los recortes y velocidades acumulados no se pueden restaurar en este editor. Selecciona la toma original y ajusta su recorte antes de retirar la intervención.');
  }
  return {assetId:current.id,trimStart,speed,history};
}

/** Remove a script intervention without deleting any original or generated asset.
 * Selected lip-sync copies (including AI derivatives) return to their underlying
 * source. Current audio controls remain unchanged: provenance has no historical
 * snapshot from which the original volume or mute state could be restored.
 */
export function removeDialogueLine(project:Project,lineId:string):Project {
  if(!project.dialogueLines?.some(line=>line.id===lineId))throw new Error('No se encontró la intervención que quieres retirar.');
  // Resolve every affected scene before changing anything, so corrupt lineage
  // cannot leave a partly removed dialogue or falsely report silence.
  const restores=new Map(project.scenes.flatMap(scene=>{
    const restored=restoredTake(project,scene,lineId);
    return restored?[[scene.id,restored] as const]:[];
  }));
  const next=structuredClone(project);
  next.dialogueLines=next.dialogueLines?.filter(line=>line.id!==lineId);
  next.tracks=next.tracks?.map(track=>({...track,clips:track.clips.filter(clip=>clip.dialogueLineId!==lineId)}));
  next.subtitleCues=next.subtitleCues?.filter(cue=>cue.id!==`dialogue-${lineId}`);
  next.scenes=next.scenes.map(scene=>{
    const restored=restores.get(scene.id);
    return restored?{...scene,videoAssetId:restored.assetId,trimStart:restored.trimStart,speed:restored.speed,clearVideoAsset:false,
      takeAssetIds:[...new Set([...(scene.takeAssetIds??[]),...restored.history,restored.assetId])]}:scene;
  });
  return next;
}
