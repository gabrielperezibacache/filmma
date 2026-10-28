import type {Project} from './types';

/** A timestamp or object-key ordering is not an edit. Evaluate this only after
 * earlier queued saves settle, so undoing a pending edit is still persisted. */
export function sameProjectContent(a:Project,b:Project){
 const canonical=(p:Project)=>JSON.stringify({...p,updatedAt:''},(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
 return canonical(a)===canonical(b);
}

/** Three-way merge: server completions may update unchanged clips, never a newer local choice. */
export function mergeProjectMedia(local:Project, remote:Project, base:Project, allowClips=true):Project {
 if(local.id!==remote.id||local.id!==base.id)return local;
 const extra=remote.assets.filter(asset=>!local.assets.some(item=>item.id===asset.id));
 const libraryChanged=JSON.stringify(local.library)!==JSON.stringify(remote.library);
 let changed=extra.length>0||libraryChanged;
 const scenes=local.scenes.map(scene=>{
  const previous=base.scenes.find(item=>item.id===scene.id), next=remote.scenes.find(item=>item.id===scene.id);
  const takeAssetIds=[...new Set([...(scene.takeAssetIds??[]),...(next?.takeAssetIds??[])])];
  const remembered=takeAssetIds.length!==(scene.takeAssetIds??[]).length?{takeAssetIds}:{};
  if('takeAssetIds' in remembered)changed=true;
  const references:Partial<Project['scenes'][number]>={};
  if(allowClips&&previous&&next)for(const field of ['assetId','endAssetId']as const)if(scene[field]===previous[field]&&scene[field]!==next[field]){references[field]=next[field];changed=true}

  if(allowClips&&previous&&next&&!scene.clearVideoAsset&&scene.videoAssetId===previous.videoAssetId&&scene.videoAssetId!==next.videoAssetId){
   changed=true;return {...scene,...references,...remembered,videoAssetId:next.videoAssetId,
    ...((scene.trimStart??0)===(previous.trimStart??0)?{trimStart:next.trimStart}:{}),
    ...((scene.speed??1)===(previous.speed??1)?{speed:next.speed}:{})};
  }
  return 'takeAssetIds' in remembered||Object.keys(references).length?{...scene,...references,...remembered}:scene;
 });
 const characters=local.characters.map(character=>{const previous=base.characters.find(c=>c.id===character.id),next=remote.characters.find(c=>c.id===character.id);if(!allowClips||!previous||!next)return character;const patch:Partial<Project['characters'][number]>={};for(const field of ['assetId','referenceAssetIds']as const)if(JSON.stringify(character[field])===JSON.stringify(previous[field])&&JSON.stringify(character[field])!==JSON.stringify(next[field])){Object.assign(patch,{[field]:next[field]});changed=true}return Object.keys(patch).length?{...character,...patch}:character});
 const tracks=local.tracks?.map(track=>{
  const oldTrack=base.tracks?.find(item=>item.id===track.id),newTrack=remote.tracks?.find(item=>item.id===track.id);
  if(!allowClips||!oldTrack||!newTrack)return track;
  let changedTrack=false;
  const clips=track.clips.map(clip=>{
   const previous=oldTrack.clips.find(item=>item.id===clip.id),next=newTrack.clips.find(item=>item.id===clip.id);
   if(!previous||!next||clip.assetId!==previous.assetId||clip.assetId===next.assetId)return clip;
   changed=true;changedTrack=true;
   // Finishing replaces only the source. Keep newer timing, animation and sound edits.
   return {...clip,assetId:next.assetId};
  });
  return changedTrack?{...track,clips}:track;
 });
 return changed?{...local,assets:[...local.assets,...extra],library:remote.library,scenes,characters,tracks}:local;
}

/** Tell the server which selections this edit did not intentionally replace. */
export function projectSavePayload(snapshot:Project,base:Project|null):Project {
 const same=base?.id===snapshot.id;
 return {...snapshot,library:undefined,
  // Generation provenance is immutable and retained by the server. Do not resend
  // every historical prompt on each edit; keep it in local state and undo history.
  assets:snapshot.assets.map(({googleVideo: _googleVideo,generation: _generation,speech: _speech,lipSync: _lipSync,voiceReference: _voiceReference,...asset})=>asset),
  scenes:snapshot.scenes.map(scene=>({...scene,preserveVideoAsset:same&&scene.videoAssetId===base?.scenes.find(item=>item.id===scene.id)?.videoAssetId})),
  tracks:snapshot.tracks?.map(track=>({...track,clips:track.clips.map(clip=>({...clip,preserveAsset:same&&clip.assetId===base?.tracks?.find(item=>item.id===track.id)?.clips.find(item=>item.id===clip.id)?.assetId}))}))};
}
