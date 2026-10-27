import{MODEL_PRESETS,type ModelPresetId}from'./model-presets';
export type RecommendationIntent='quality'|'continuity'|'preview';
type Evidence={status?:string;outputAvailable?:boolean;mode?:string;model?:string;parameters?:{width?:number;height?:number;numFrames?:number;fps?:number;steps?:number;memoryProfile?:string}};
export type ModelDiagnostic={id:string;available?:boolean;engineInstalled?:boolean;weights?:{complete?:boolean};downloadPlan?:{volumeMounted?:boolean};validationHistory?:Evidence[]};
export function recommendModels(hardware:{appleSilicon?:boolean;memoryGB?:number;chip?:string},models:ModelDiagnostic[],intent:RecommendationIntent='quality'){
 const presets=Object.values(MODEL_PRESETS).map(p=>{
  const m=models.find(m=>m.id===p.model),textOnly=p.memoryProfile!=='conservative',eligible=!!hardware.appleSilicon&&(hardware.memoryGB??0)>=p.minimumMemoryGB;
  const readiness=!m?'unknown':m.downloadPlan?.volumeMounted===false?'connect-disk':!m.engineInstalled?'prepare-engine':!m.weights?.complete?'download-weights':!m.available?'diagnose':'ready';
  const verified=(m?.validationHistory??[]).some(v=>v.status==='media-verified'&&v.outputAvailable!==false&&(!v.model||v.model===p.model)&&(!textOnly||v.mode==='text-to-video')&&v.parameters?.width===p.width&&v.parameters?.height===p.height&&v.parameters?.numFrames===p.frames&&v.parameters?.fps===p.fps&&v.parameters?.steps===p.steps&&(v.parameters?.memoryProfile??'conservative')===p.memoryProfile);
  const identityReferences=p.model==='minimax-h3'&&!textOnly;
  const score=intent==='preview'?(p.id==='ltx-preview'?1000:100-p.width):intent==='continuity'?(identityReferences?10000:!textOnly?1000:0):p.width*p.height;
  return{...p,eligible,verified,readiness,textOnly,identityReferences,score,compatible:intent!=='continuity'||identityReferences};
 });
 const ranked=presets.filter(p=>p.eligible&&p.compatible).sort((a,b)=>b.score-a.score||Number(b.verified)-Number(a.verified));
 return{intent,presets,recommendedPresetId:ranked.find(p=>p.readiness==='ready')?.id??null,targetPresetId:ranked[0]?.id??null,maximumClipSeconds:15,nativeFps:24,qualityNote:'La resolución nativa y las referencias se eligen antes de generar; el acabado 4K conserva la fuente y no sustituye el detalle nativo.'};
}
export function projectNeedsIdentityReferences(project:{scenes:{characterIds:string[]}[];characters:{id:string;assetId?:string}[]}){return project.characters.some(c=>!!c.assetId&&project.scenes.some(s=>s.characterIds.includes(c.id)))}
