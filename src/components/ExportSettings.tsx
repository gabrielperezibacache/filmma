import {maxAiStrength} from '../ai-processing';
import { exportDimensions, type ExportResolution } from '../export-resolution';

type Props = {
  format: string;
  resolution: ExportResolution;
  onChange: (value: ExportResolution) => void;
  disabled: boolean;
  aiEnhance: boolean;
  onAiEnhance: (value:boolean)=>void;
  strength: number;
  onStrength: (value:number)=>void;
  processingProfile?:'conservative'|'restore'|'temporal';
  onProcessingProfile?:(value:'conservative'|'restore'|'temporal')=>void;
};

export default function ExportSettings({ format, resolution, onChange, disabled,aiEnhance,onAiEnhance,strength,onStrength,processingProfile='conservative',onProcessingProfile }: Props) {
  const dimensions = (value: ExportResolution) => exportDimensions(format, value).join(' × ');
  const highLabel = format === '16:9' ? '4K UHD' : format === '9:16' ? '4K vertical' : format === '2.39:1' ? '4K panorámico' : 'Alta resolución';
  return <><label className="field export-resolution">
    <span id="export-resolution-label">Resolución de la película</span>
    <select value={resolution} onChange={event => onChange(event.target.value as ExportResolution)} disabled={disabled} aria-labelledby="export-resolution-label" aria-describedby="export-resolution-note">
      <option value="720p">HD 720p · {dimensions('720p')}</option>
      <option value="1080p">{['16:9','9:16'].includes(format) ? 'Full HD' : 'Estándar'} · {dimensions('1080p')}</option>
      <option value="2160p">{highLabel} · {dimensions('2160p')}</option>
    </select>
    <small id="export-resolution-note">{resolution === '2160p'
      ? '4K describe las dimensiones de salida. El detalle depende de los originales: ampliar una toma pequeña o borrosa no recupera la información que falta. Se conservan el encuadre, los textos y las capas a tamaño final.'
      : resolution === '720p' ? 'Entrega HD 720p. Ajusta los originales al encuadre sin recortarlos; conserva audio, subtítulos y capas. No añade otra pasada de IA.'
      : 'Una copia más ligera para revisar y compartir. Conserva el encuadre y la sincronía del montaje.'}</small>
  </label>{resolution==='2160p'&&<div className="export-ai-options">
    <label className="film-finishing-toggle"><input type="checkbox" checked={aiEnhance} onChange={event=>onAiEnhance(event.target.checked)} disabled={disabled}/><span>Usar versiones con IA revisadas<small>Comprueba las copias seleccionadas de planos y capas. Exporta exactamente esas versiones, sin otra pasada de IA.</small></span></label>
    {aiEnhance&&<><label className="field"><span>Tratamiento de IA revisado</span><select aria-label="Tratamiento de IA revisado" value={processingProfile} onChange={event=>onProcessingProfile?.(event.target.value as 'conservative'|'restore'|'temporal')} disabled={disabled||!onProcessingProfile}><option value="conservative">Conservar textura</option><option value="restore">Restaurar definición</option><option value="temporal">Restauración estable · entre fotogramas</option></select></label><label className="film-finishing-strength"><span>Intensidad de toda la película<output>{Math.round(strength*100)} %</output></span><input aria-label="Intensidad de IA para exportar" type="range" min="15" max={maxAiStrength(processingProfile)*100} step="5" value={Math.round(strength*100)} onChange={event=>onStrength(Number(event.target.value)/100)} disabled={disabled}/></label><p>Las copias deben estar preparadas, seleccionadas y revisadas con este tratamiento e intensidad. Si cambias el ajuste, vuelve a preparar y revisar las versiones antes de exportar. Los originales permanecen intactos.</p><p>Fuentes de hasta 15 s, SDR y Full HD. Las imágenes fijas se amplían al lienzo final sin IA.</p></>}
  </div>}</>;
}
