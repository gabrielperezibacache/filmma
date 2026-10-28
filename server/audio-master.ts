import {runProcess} from './process.js';
import type {AudioMix} from '../src/sound-finishing.js';
export type Loudness={integratedLufs:number|null;truePeakDb:number|null;rangeLu:number|null;thresholdLufs:number|null;offsetDb:number|null};
export type AudioMasterReport={before:Loudness;after:Loudness;normalization:boolean;finalGainDb:number;targetLufs:number;truePeakDb:number;method:'linear'|'dynamic'|'unchanged'|'silence';withinTarget:boolean;note:string};
const finite=(v:unknown)=>Number.isFinite(Number(v))?Number(v):null;
export function parseLoudness(stderr:string):Loudness{
  const blocks=stderr.match(/\{[^{}]*"input_i"[^{}]*\}/g),raw=blocks?.length?JSON.parse(blocks.at(-1)!):null;
  if(!raw)throw new Error('FFmpeg no devolvió una medición de sonoridad válida.');
  return{integratedLufs:finite(raw.input_i),truePeakDb:finite(raw.input_tp),rangeLu:finite(raw.input_lra),thresholdLufs:finite(raw.input_thresh),offsetDb:finite(raw.target_offset)};
}
export async function measureLoudness(path:string,settings:AudioMix,ffmpeg:string,signal:AbortSignal):Promise<Loudness>{
  const r=await runProcess(ffmpeg,['-nostdin','-hide_banner','-threads','2','-filter_threads','1','-i',path,'-map','0:a:0','-vn','-af',`loudnorm=I=${settings.targetLufs}:TP=${settings.truePeakDb}:LRA=11:print_format=json`,'-f','null','-'],{signal,timeoutMs:20*60*1000});
  if(r.code!==0)throw new Error(`No se pudo medir la mezcla: ${r.stderr.slice(-700)}`);
  return parseLoudness(r.stderr);
}
export function normalizationFilter(m:Loudness,s:AudioMix):string|undefined{
  if(!s.normalize||m.integratedLufs===null||m.truePeakDb===null||m.rangeLu===null||m.thresholdLufs===null||m.offsetDb===null)return;
  return`loudnorm=I=${s.targetLufs}:TP=${s.truePeakDb}:LRA=11:measured_I=${m.integratedLufs}:measured_TP=${m.truePeakDb}:measured_LRA=${m.rangeLu}:measured_thresh=${m.thresholdLufs}:offset=${m.offsetDb}:linear=true:print_format=json,aresample=48000`;
}
export function masterReport(before:Loudness,after:Loudness,s:AudioMix,method:AudioMasterReport['method'],finalGainDb=0):AudioMasterReport{
  const withinTarget=after.integratedLufs!==null&&after.truePeakDb!==null&&Math.abs(after.integratedLufs-s.targetLufs)<=1&&after.truePeakDb<=s.truePeakDb+.2;
  return{before,after,finalGainDb,normalization:s.normalize,targetLufs:s.targetLufs,truePeakDb:s.truePeakDb,method,withinTarget,note:before.integratedLufs===null?'Silencio o señal insuficiente para medir sonoridad integrada; no se añade ganancia.':withinTarget?'La copia medida está dentro de ±1 LU del objetivo y +0,2 dB del techo.':'Revisa la copia: la duración, dinámica o codificación pueden impedir alcanzar el objetivo. La medición no es una certificación de entrega.'};
}
