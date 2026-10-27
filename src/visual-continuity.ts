/** Local visual signals, not face recognition or proof of identity. */
export type VisualCategory = 'face'|'wardrobe'|'object';
export type VisualRegion = {x:number;y:number;width:number;height:number};
export type VisualContinuitySettings = {
  regions:{sceneId:string;characterId:string;category:VisualCategory;rect:VisualRegion}[];
  /** Seconds within the edited shot, before converting to source time. */
  sampleTimes:{sceneId:string;time:number}[];
};
export type VisualCheck = {category:VisualCategory;status:'possible-change'|'no-obvious-change'|'insufficient';distance?:number;colorDelta?:number;threshold?:number;regions?:{left:VisualRegion;right:VisualRegion};origin:'manual'|'single-face'|'unavailable';message:string};
export type VisualSample = {sceneId:string;sceneTitle:string;assetId?:string;url?:string;time:number;sourceTime?:number;error?:string};
export type VisualDecision = {decision:'reviewed'|'intentional';note:string;reviewedAt:string};
export type VisualComparison = {id:string;characterId:string;characterName:string;left:VisualSample;right:VisualSample;checks:VisualCheck[];faces?:{left:VisualRegion[];right:VisualRegion[]};intentionalChange:boolean;changeReason:string;expected:{face:string;wardrobe:string;object:string};decision?:VisualDecision;elapsedMs?:number};
export type VisualContinuityReport = {id:string;projectId:string;fingerprint:string;createdAt:string;completedAt?:string;status:'running'|'completed'|'cancelled'|'failed';engine:string;settings:VisualContinuitySettings;comparisons:VisualComparison[];total:number;warnings:string[];acknowledgement?:{note:string;reviewedAt:string};error?:string};
export type VisualContinuityState = {report?:VisualContinuityReport;currentFingerprint:string;stale:boolean;settings:VisualContinuitySettings;available:boolean};
export const visualCategories:VisualCategory[]=['face','wardrobe','object'];
export const visualCategoryLabels:Record<VisualCategory,string>={face:'Rostro',wardrobe:'Vestuario',object:'Objetos'};
