import type{Asset,Project,Job}from'./types';
export type LibraryEntry={tags:string[];favorite:boolean;sha256?:string;fileSize?:number;observedAt?:string;imported?:{name:string;at:string};reconnections?:{name:string;at:string;sha256:string}[]};
export type LibraryFile={assetId:string;state:'available'|'missing'|'changed'|'unverified'|'unreadable';size?:number;sha256?:string;expectedSha256?:string;message?:string;canReconnect:boolean};
export type LibraryState={projectId:string;files:LibraryFile[];checkedAt:string;verified:boolean};
export type AssetUse={kind:'scene'|'character'|'track'|'dialogue'|'source'|'soundtrack';id:string;label:string;detail:string;sceneId?:string;characterId?:string};
export function assetUses(p:Project,id:string):AssetUse[]{
 const rows:AssetUse[]=[];
 for(const s of p.scenes){const roles=[s.assetId===id?'Imagen inicial':'',s.endAssetId===id?'Imagen final':'',s.videoAssetId===id?'Toma seleccionada':'',s.takeAssetIds?.includes(id)?'Toma conservada':''].filter(Boolean);if(roles.length)rows.push({kind:'scene',id:s.id,label:s.title,detail:roles.join(' · '),sceneId:s.id})}
 for(const c of p.characters){const roles=[c.assetId===id?'Referencia principal':'',c.referenceAssetIds?.includes(id)?'Referencia de apoyo':'',c.voice?.engine==='qwen'&&c.voice.referenceAssetId===id?'Referencia de voz':''].filter(Boolean);if(roles.length)rows.push({kind:'character',id:c.id,label:c.name,detail:roles.join(' · '),characterId:c.id})}
 for(const t of p.tracks??[])for(const c of t.clips)if(c.assetId===id)rows.push({kind:'track',id:c.id,label:t.name,detail:p.scenes.find(s=>s.id===c.sceneId)?.title??'Plano no disponible',sceneId:c.sceneId});
 for(const l of p.dialogueLines??[])if(l.audioAssetId===id)rows.push({kind:'dialogue',id:l.id,label:p.characters.find(c=>c.id===l.characterId)?.name??'Narración',detail:l.text,sceneId:l.sceneId,characterId:l.characterId});
 if(p.audioAssetId===id)rows.push({kind:'soundtrack',id,label:'Banda sonora',detail:'Mezcla de la película'});
 for(const a of p.assets){const source=a.enhancement?.sourceAssetId===id||a.lipSync?.sourceAssetId===id||a.lipSync?.audioAssetId===id||a.voiceReference?.sourceAssetId===id||a.generation?.referenceAssetIds.includes(id);if(source)rows.push({kind:'source',id:a.id,label:a.name,detail:'Fuente de una versión conservada'})}
 return rows;
}
export function assetOrigin(a:Asset,entry?:LibraryEntry){
 if(a.enhancement)return{kind:'enhancement',label:'Copia mejorada',model:a.enhancement.model??a.enhancement.method,at:a.enhancement.createdAt,sources:[a.enhancement.sourceAssetId]};
 if(a.lipSync)return{kind:'lipsync',label:'Sincronización labial',model:a.lipSync.model,at:a.lipSync.createdAt,sources:[a.lipSync.sourceAssetId,a.lipSync.audioAssetId]};
 if(a.voiceReference)return{kind:'voice-reference',label:'Referencia de voz preparada',model:'Qwen',at:a.voiceReference.createdAt,sources:[a.voiceReference.sourceAssetId]};
 if(a.speech)return{kind:'speech',label:'Voz del guion',model:a.speech.model,at:a.speech.createdAt,sources:a.speech.voice.engine==='qwen'&&a.speech.voice.referenceAssetId?[a.speech.voice.referenceAssetId]:[]};
 if(a.generation)return{kind:'generation',label:'Toma generada',model:a.generation.model,at:a.generation.createdAt,sources:a.generation.referenceAssetIds};
 if(entry?.imported)return{kind:'import',label:'Original importado',at:entry.imported.at,sources:[]};
 if(a.url.startsWith('/demo/'))return{kind:'demo',label:'Material de ejemplo',sources:[]};
 return{kind:'unknown',label:'Procedencia no registrada',sources:[]};
}
export function recordedAssetSha(a:Asset,entry?:LibraryEntry){return entry?.sha256??a.enhancement?.outputSha256??a.lipSync?.outputSha256??a.speech?.outputSha256??a.voiceReference?.outputSha256}
export const normalizeTags=(value:string[])=>[...new Map(value.map(t=>t.trim().replace(/\s+/g,' ')).filter(Boolean).map(t=>[t.toLocaleLowerCase(),t])).values()];
export function jobProjectId(j:Job){return j.context?.projectId??j.result?.projectId}
export function jobSceneId(j:Job){return j.context?.sceneId??(typeof j.result?.sceneId==='string'?j.result.sceneId:undefined)}
export const jobNames:Record<string,string>={library:'Comprobación de archivos',generation:'Generación de plano',generate:'Generación de plano',export:'Exportación',codex:'Asistente Codex',runtime:'Preparación del motor',audio:'Medición de sonido',proxy:'Copias ligeras de reproducción',enhance:'Acabado y mejora de imagen',continuity:'Revisión de continuidad visual',speech:'Voces del guion',lipsync:'Sincronización labial'};
