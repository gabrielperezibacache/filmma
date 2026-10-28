import type {Asset,Project,Scene} from './types';
import {buildGenerationInstructions} from './generation-instructions';

export const GOOGLE_VIDEO_LINKS={gemini:'https://gemini.google.com/app',flow:'https://flow.google.com/',plans:'https://ai.google.dev/gemini-api/docs/google-ai-plans',help:'https://support.google.com/gemini/answer/16126339?hl=es'} as const;
export type GoogleVideoProvider='gemini'|'flow';
export type GoogleVideoProvenance={provider:GoogleVideoProvider;workflow:'subscription-handoff'|'subscription-browser';verification:'user-imported'|'browser-observed';browser?:{automationId:string;pageUrl:string};requestId:string;projectId:string;sceneId:string;sceneTitle:string;createdAt:string;importedAt:string;prompt:string;requestedSeconds:number;requestedFormat:string;characterIds:string[];referenceAssetIds:string[];referenceSha256:Record<string,string>;contextFingerprint:string;outputSha256:string;contextChanged:boolean;media:{width:number;height:number;duration:number;fps:number;frames:number;audioTracks:number}};
export type GoogleVideoRequest=Omit<GoogleVideoProvenance,'importedAt'|'outputSha256'|'contextChanged'|'media'|'verification'> & {id:string;packageUrl:string;importedAssetId?:string;stale:boolean;references:{id:string;name:string;sha256:string;role:string}[]};
export function googleReferenceCandidates(project:Project,scene:Scene){
 const ids=[scene.assetId,scene.endAssetId,...scene.characterIds.flatMap(id=>{const c=project.characters.find(c=>c.id===id);return c?[c.assetId,...c.referenceAssetIds??[]]:[]})];
 return [...new Set(ids.filter((id):id is string=>!!id))].flatMap(id=>{const asset=project.assets.find(a=>a.id===id&&a.type==='image');return asset?[asset]:[]});
}
export function googleReferenceRole(project:Project,scene:Scene,id:string){
 const character=project.characters.find(c=>scene.characterIds.includes(c.id)&&(c.assetId===id||c.referenceAssetIds?.includes(id)));
 return [scene.assetId===id?'Imagen inicial':'',scene.endAssetId===id?'Final previsto':'',character?`Identidad de ${character.name}`:''].filter(Boolean).join(' · ')||'Referencia visual';
}
export function buildGoogleVideoPrompt(project:Project,scene:Scene,seconds:number,referenceAssetIds:string[]){
 return [buildGenerationInstructions(project,scene,{prompt:scene.prompt.trim()||scene.description}),
 `Create one continuous shot of approximately ${seconds} seconds, no longer than 15 seconds. Desired aspect ratio: ${project.format}. Do not freeze, loop or stretch frames to reach the duration. Use the closest duration and aspect ratio supported in your Google account; keep the native output.`,
 scene.dialogue.trim()?`Screenplay dialogue (keep the exact words and speaker identities):\n${scene.dialogue.trim()}\nPreserve character voices across scenes. Local character voice profiles are not uploaded; final dialogue and lip sync can be prepared in Filmma.`:'',
 referenceAssetIds.length?`Reference attachment order:\n${referenceAssetIds.map((id,i)=>`${i+1}. ${googleReferenceRole(project,scene,id)}`).join('\n')}\nMaintain each character\'s face, wardrobe, and props according to the effective continuity above. Reference images guide generation; they do not guarantee visual identity.`:'No reference images attached. Preserve the specified appearance, wardrobe, and props. Visual identity must be reviewed after generation.'
 ].filter(Boolean).join('\n\n');
}
/** The returned context is deliberately independent of selected takes and edit trims. */
export function googleVideoContext(project:Project,scene:Scene,seconds:number,refs:string[]){return JSON.stringify({projectId:project.id,sceneId:scene.id,title:scene.title,format:project.format,characterIds:scene.characterIds,prompt:buildGoogleVideoPrompt(project,scene,seconds,refs),references:refs.map(id=>{const a=project.assets.find(a=>a.id===id);return {id,url:a?.url,size:a?.size}})})}
export function applyGoogleVideoTake<P extends Project>(project:P,sceneId:string,asset:Asset,apply:boolean):P{
 return {...project,assets:[...project.assets.filter(a=>a.id!==asset.id),asset],scenes:project.scenes.map(s=>s.id!==sceneId?s:{...s,takeAssetIds:[...new Set([...(s.takeAssetIds??[]),...(s.videoAssetId?[s.videoAssetId]:[]),asset.id])],...(apply?{videoAssetId:asset.id,trimStart:0,speed:1,clearVideoAsset:undefined}:{})})};
}
