import {t,tr} from '../i18n';
import {useId} from 'react';
import type {Project} from '../types';
import {DEFAULT_PROJECT_FORMAT, DEFAULT_PROJECT_FPS, PROJECT_FORMATS, PROJECT_FRAME_RATES} from '../export-resolution';
import './project-output-settings.css';

type Props = {
  format: Project['format'];
  fps: number;
  onChange: (patch: Partial<Pick<Project, 'format' | 'fps'>>) => void;
  compact?: boolean;
  source?: 'local'|'google';
};

const formatLabels: Record<Project['format'], string> = {
  '16:9': '16:9 · recomendado',
  '9:16': '9:16 · vertical',
  '1:1': '1:1 · cuadrado',
  '4:3': '4:3 · clásico',
  '4:5': '4:5 · vertical',
  '2.39:1': '2.39:1 · panorámico',
};

export default function ProjectOutputSettings({format, fps, onChange, compact = false,source='local'}: Props) {
  const id = useId();
  const recommended = format === DEFAULT_PROJECT_FORMAT && fps === DEFAULT_PROJECT_FPS;
  return <div className={`project-output-settings${compact ? ' is-compact' : ''}`}>
    <fieldset aria-describedby={`${id}-scope ${id}-cadence`}>
      <legend>Salida de la película</legend>
      <p id={`${id}-scope`} className="project-output-scope">Estos ajustes se aplican a todo el montaje.</p>
      <div className="project-output-fields">
        <label htmlFor={`${id}-format`}><span>Proporción</span><select id={`${id}-format`} value={format} onChange={event => {
          const next = PROJECT_FORMATS.find(item => item === event.target.value);
          if (next && next !== format) onChange({format: next});
        }}>{PROJECT_FORMATS.map(value => <option key={value} value={value}>{t(formatLabels[value])}</option>)}</select></label>
        <label htmlFor={`${id}-fps`}><span>FPS de salida</span><select id={`${id}-fps`} value={fps} onChange={event => {
          const next = PROJECT_FRAME_RATES.find(item => item === Number(event.target.value));
          if (next && next !== fps) onChange({fps: next});
        }}>{PROJECT_FRAME_RATES.map(value => <option key={value} value={value}>{value} fps{value === DEFAULT_PROJECT_FPS ? ' · recomendado' : ''}</option>)}</select></label>
      </div>
      <p id={`${id}-cadence`} className="project-output-help">{source==='google'?tr('Se conserva la cadencia nativa del video de Google. Sólo la exportación adapta los fps del montaje.','The Google video keeps its native frame rate. Only export adapts the edit frame rate.'):'MiniMax y LTX generan a 24 fps. La exportación adapta los fotogramas a la cadencia elegida, sin cambiar la velocidad de la toma.'}</p>
      {!recommended && <button type="button" className="project-output-reset" onClick={() => onChange({format: DEFAULT_PROJECT_FORMAT, fps: DEFAULT_PROJECT_FPS})}>Usar recomendados: 16:9 y 24 fps</button>}
    </fieldset>
  </div>;
}
