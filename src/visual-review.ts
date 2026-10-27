import type {VisualComparison,VisualContinuityReport,VisualContinuitySettings,VisualRegion} from './visual-continuity';
export const emptyVisualSettings=():VisualContinuitySettings=>({regions:[],sampleTimes:[]});
export function visualReportReady(report:VisualContinuityReport|undefined,stale:boolean){return !!report&&!stale&&report.status==='completed'&&report.comparisons.length===report.total&&!!report.acknowledgement&&report.comparisons.every(pair=>!!pair.decision)}
export function comparisonNeedsNote(pair:VisualComparison){return pair.checks.some(check=>check.status!=='no-obvious-change')}
export function normalizedRegion(start:{x:number;y:number},end:{x:number;y:number}):VisualRegion{
 const clamp=(n:number)=>Math.max(0,Math.min(1,n));const x1=clamp(start.x),y1=clamp(start.y),x2=clamp(end.x),y2=clamp(end.y);
 return {x:Math.min(x1,x2),y:Math.min(y1,y2),width:Math.abs(x2-x1),height:Math.abs(y2-y1)};
}
export function boundedRegion(region:VisualRegion):VisualRegion{
 const x=Math.max(0,Math.min(.98,region.x)),y=Math.max(0,Math.min(.98,region.y));
 return {x,y,width:Math.max(.02,Math.min(1-x,region.width)),height:Math.max(.02,Math.min(1-y,region.height))};
}
