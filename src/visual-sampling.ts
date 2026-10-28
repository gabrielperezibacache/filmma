import type {Scene,Project} from './types';
import type {VisualCheck,VisualContinuitySettings,VisualMoment,VisualSample,VisualInterval} from './visual-continuity';
export const visualMomentLabels:Record<VisualMoment,string>={start:'Inicio',early:'Primer cuarto',middle:'Medio',late:'Último cuarto',end:'Final'};
export const visualMoments=(count:3|5=3):VisualMoment[]=>count===5?['start','early','middle','late','end']:['start','middle','end'];
export function visualMomentTime(scene:Scene,fps:number,settings:VisualContinuitySettings,moment:VisualMoment){
 const frames=Math.max(1,Math.round(scene.duration*fps)),fractions={start:0,early:.25,middle:.5,late:.75,end:1};
 const override=settings.sampleTimes.find(t=>t.sceneId===scene.id&&(t.sample??'middle')===moment)?.time;
 return Math.min(frames-1,Math.max(0,Math.round((override??(frames-1)/fps*fractions[moment])*fps)))/fps;
}
export function visualRegionAt(settings:VisualContinuitySettings,sceneId:string,characterId:string,category:VisualCheck['category'],sample:VisualMoment='middle'){
 return settings.regions.find(r=>r.sceneId===sceneId&&r.characterId===characterId&&r.category===category&&r.sample===sample)?.rect
 ??settings.regions.find(r=>r.sceneId===sceneId&&r.characterId===characterId&&r.category===category&&!r.sample)?.rect;
}
export function setVisualRegion(settings:VisualContinuitySettings,sceneId:string,characterId:string,category:VisualCheck['category'],sample:VisualMoment,value:ReturnType<typeof visualRegionAt>){
 const common=settings.regions.find(r=>r.sceneId===sceneId&&r.characterId===characterId&&r.category===category&&!r.sample);
 let regions=settings.regions.filter(r=>!(r.sceneId===sceneId&&r.characterId===characterId&&r.category===category&&(!r.sample||r.sample===sample)));
 if(common)for(const moment of visualMoments(5))if(moment!==sample&&!regions.some(r=>r.sceneId===sceneId&&r.characterId===characterId&&r.category===category&&r.sample===moment))regions.push({...common,sample:moment});
 if(value)regions.push({sceneId,characterId,category,sample,rect:value});
 return{...settings,regions};
}
export function reconcileVisualSettings(p:Pick<Project,'scenes'|'characters'>,s:VisualContinuitySettings):VisualContinuitySettings{
 return{...s,regions:s.regions.filter(r=>p.characters.some(c=>c.id===r.characterId)&&p.scenes.some(scene=>scene.id===r.sceneId&&scene.characterIds.includes(r.characterId))),sampleTimes:s.sampleTimes.filter(t=>p.scenes.some(scene=>scene.id===t.sceneId))};
}
export function uniqueVisualSamples(samples:VisualSample[]){
 const seen=new Set<string>();return [...samples].sort((a,b)=>((a.moment==='middle'?0:1)-(b.moment==='middle'?0:1))).filter(s=>{const key=s.sourceKey??`${s.sceneId}:${s.moment}`;if(seen.has(key))return false;seen.add(key);return true}).sort((a,b)=>a.time-b.time);
}
export function visualIntervals(left:VisualSample[],right:VisualSample[],includeLeft=true):Omit<VisualInterval,'checks'>[]{
 const result:Omit<VisualInterval,'checks'>[]=[],seen=new Set<string>();
 const add=(kind:VisualInterval['kind'],a:VisualSample,b:VisualSample)=>{if(a.sceneId===b.sceneId&&a.sourceKey&&a.sourceKey===b.sourceKey)return;const key=JSON.stringify([a.sceneId,a.sourceKey??a.moment,b.sceneId,b.sourceKey??b.moment]);if(seen.has(key))return;seen.add(key);result.push({id:`interval-${result.length}`,kind,left:a,right:b})};
 const moments=[...new Set([...left,...right].map(s=>s.moment))];
 const nearest=(samples:VisualSample[],moment:VisualMoment|undefined)=>samples.find(s=>s.moment===moment)??[...samples].sort((a,b)=>Math.abs(visualMoments(5).indexOf(a.moment??'middle')-visualMoments(5).indexOf(moment??'middle'))-Math.abs(visualMoments(5).indexOf(b.moment??'middle')-visualMoments(5).indexOf(moment??'middle')))[0];
 for(const moment of moments){const a=nearest(left,moment),b=nearest(right,moment);if(a&&b)add('between',a,b)}
 if(!result.length&&left[0]&&right[0])add('between',left[0],right[0]);
 for(const samples of includeLeft?[left,right]:[right])for(let i=1;i<samples.length;i++)add('within',samples[i-1]!,samples[i]!);
 return result;
}
export function aggregateVisualChecks(intervals:VisualInterval[]):VisualCheck[]{
 return(['face','wardrobe','object']as const).map(category=>{
  const checks=intervals.flatMap(i=>i.checks.filter(c=>c.category===category)),changes=checks.filter(c=>c.status==='possible-change').length,uncertain=checks.filter(c=>c.status==='insufficient').length;
  const status=changes?'possible-change':uncertain||!checks.length?'insufficient':'no-obvious-change';
  return{category,status,origin:'unavailable',message:`${changes} de ${checks.length} intervalos con posible diferencia; ${uncertain} no concluyentes. Revisa cada instante y las zonas comparadas. No certifica identidad ni continuidad completa.`};
 });
}
