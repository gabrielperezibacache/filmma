import type {Job} from '../types';
import type {AudioMasterReport} from '../../server/audio-master';
import {tr} from '../i18n';
import './job-audio-report.css';
export default function JobAudioReport({job}:{job:Job}){
 const report=job.result?.audioReport as AudioMasterReport|undefined;
 if(!report?.after||job.type!=='export')return null;
 const missing=report.after.integratedLufs===null,needsReview=missing||report.normalization&&!report.withinTarget;
 const value=(n:number|null,unit:string)=>n===null?tr('Sin medida','No reading'):`${n.toFixed(1)} ${unit}`;
 return <section className="job-audio-report" aria-label={tr('Sonido del máster exportado','Exported master audio')}>
  <h4>{tr('Sonido del máster MP4','MP4 master audio')}</h4>
  <p className={needsReview?'job-audio-warning':''} role={needsReview?'alert':'status'}>{missing?tr('Sin medida integrada: silencio o señal insuficiente. Revisa el archivo.','No integrated reading: silence or insufficient signal. Review the file.'):report.normalization?(report.withinTarget?tr('Dentro de la tolerancia configurada. Escucha también el máster.','Within the configured tolerance. Listen to the master too.'):tr('Fuera del objetivo: revisa la sonoridad antes de entregar.','Outside target: review loudness before delivery.')):tr('Copia sin normalización. Revisa los niveles medidos.','Copy without normalization. Review measured levels.')}</p>
  <dl><div><dt>{tr('Sonoridad integrada','Integrated loudness')}</dt><dd>{value(report.after.integratedLufs,'LUFS')}</dd></div><div><dt>{tr('Pico real','True peak')}</dt><dd>{value(report.after.truePeakDb,'dBTP')}</dd></div><div><dt>{tr('Rango','Range')}</dt><dd>{value(report.after.rangeLu,'LU')}</dd></div></dl>
  <p>{report.normalization?tr('Normalización activada','Normalization enabled'):tr('Normalización desactivada','Normalization disabled')} · {tr('Objetivo','Target')}: {report.targetLufs} LUFS · {tr('Techo','Ceiling')}: {report.truePeakDb} dBTP</p>
  <small>{tr('Medición del AAC decodificado de este archivo, después del acabado. Tolerancia: ±1 LU y +0,2 dB sobre el techo. Es un registro de esta exportación; cambios posteriores del proyecto no lo actualizan.','Measurement of this file’s decoded AAC after finishing. Tolerance: ±1 LU and +0.2 dB above the ceiling. This records this export; later project changes do not update it.')}</small>
 </section>;
}
