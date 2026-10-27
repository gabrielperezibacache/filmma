import type {Asset,Project} from './types';
import {defaultAiStrength} from './ai-processing';

export function aiCopyMatchesSettings(asset:Asset|undefined,settings:Project['aiFinishing']):boolean{
 const profile=settings?.processingProfile??'conservative';
 return asset?.enhancement?.preset==='ai-4k'&&
  (asset.enhancement.profile??'conservative')===profile&&
  Math.abs((asset.enhancement.strength??-1)-(settings?.strength??defaultAiStrength(profile)))<1e-6;
}

export function originalAssetId(id:string,assets:Asset[]):string {
 const visited=new Set<string>();let current=id;
 while(!visited.has(current)){visited.add(current);const parent=assets.find(asset=>asset.id===current)?.enhancement?.sourceAssetId;if(!parent||!assets.some(asset=>asset.id===parent))return current;current=parent}
 return id;
}

/** One reversible edit restores selected AI copies, without changing their clocks. */
export function restoreFilmOriginals(project:Project):Project {
 let changed=false;
 const original=(id:string)=>{if(project.assets.find(asset=>asset.id===id)?.enhancement?.preset!=='ai-4k')return id;const next=originalAssetId(id,project.assets);changed ||= next!==id;return next};
 const scenes=project.scenes.map(scene=>scene.videoAssetId?{...scene,videoAssetId:original(scene.videoAssetId)}:scene);
 const tracks=project.tracks?.map(track=>track.type==='video'?{...track,clips:track.clips.map(clip=>({...clip,assetId:original(clip.assetId)}))}:track);
 return changed?{...project,scenes,tracks}:project;
}
