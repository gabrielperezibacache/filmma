import { useState } from 'react';
import { ArrowUpRight, Camera, ChevronRight, Copy, RotateCcw } from 'lucide-react';
import type { Scene } from '../types';
import { CINEMA_FIELDS, CINEMA_PRESETS, buildCinematographyPrompt, changeCinemaSetting, cinemaSettingWarnings, historicalDirectionLabel, type Cinematography, type CinemaFieldKey } from '../cinematography';
import { cinemaOptionLabel, cinemaReference } from '../cinema-reference';
import CinemaReferenceGuide, { CinemaReferenceImage } from './CinemaReferenceGuide';
import './cinema-tools.css';

type Props = { scene: Scene; subjectRoles?: readonly string[]; previous?: Scene; onChange: (patch: Partial<Scene>) => void; variant?: 'inspector' | 'workspace' };

export default function CinemaDirection({ scene, subjectRoles, previous, onChange, variant = 'inspector' }: Props) {
  const [preset, setPreset] = useState('');
  const [guideField, setGuideField] = useState<CinemaFieldKey | null>(null);
  const settings = scene.cinematography ?? {};
  const apply = (next: Cinematography) => onChange({ cinematography: Object.keys(next).length ? next : undefined });
  const set = (key: CinemaFieldKey, value: string) => apply(changeCinemaSetting(settings, key, value));
  const applyPreset = () => { const selected = CINEMA_PRESETS.find(item => item.id === preset); if (selected) apply({ ...selected.settings }); };
  const direction = buildCinematographyPrompt(scene, subjectRoles);
  const thumbnail = cinemaReference('framing', settings.framing ?? 'wide')!;
  const chosen = CINEMA_FIELDS.filter(field => settings[field.key]);
  const warnings = cinemaSettingWarnings(settings);
  const creativeShortcuts: { field: CinemaFieldKey; label: string; empty: string }[] = [
    { field: 'director', label: 'Directores', empty: 'Lenguaje visual' },
    { field: 'takeType', label: 'Tipos de toma', empty: 'Función en la escena' },
    { field: 'movement', label: 'Movimiento', empty: 'Recorrido de cámara' },
  ];
  const shortcuts: { field: CinemaFieldKey; label: string; value?: string }[] = [
    { field: 'era', label: 'Época', value: settings.era ? historicalDirectionLabel(settings) : undefined },
    { field: 'filmFormat', label: 'Película · FILM', value: [settings.filmFormat && cinemaOptionLabel('filmFormat', settings.filmFormat), settings.filmStock && cinemaOptionLabel('filmStock', settings.filmStock)].filter(Boolean).join(' · ') || undefined },
    { field: 'lensFamily', label: 'Lentes', value: settings.lensFamily ? cinemaOptionLabel('lensFamily', settings.lensFamily) : undefined },
    { field: 'cameraBody', label: 'Cámaras', value: settings.cameraBody ? cinemaOptionLabel('cameraBody', settings.cameraBody) : undefined },
  ];
  return <section className={`cinema-direction cinema-direction--${variant}`} aria-labelledby="cinema-direction-title">
    <h3 id="cinema-direction-title"><Camera size={16}/>Dirección cinematográfica</h3>
    <p>Define la mirada, la función de la toma y cómo se mueve la cámara. Cada decisión prepara la próxima generación.</p>
    <button className="cinema-guide-entry" onClick={() => setGuideField('framing')}>
      <CinemaReferenceImage reference={thumbnail} value={settings.framing ?? 'wide'}/>
      <span><strong>Explorar referencias</strong><small>Encuentra el aspecto de este plano</small></span><ArrowUpRight size={17}/>
    </button>
    <div className="cinema-creative-shortcuts" aria-label="Lenguaje, toma y movimiento">{creativeShortcuts.map(item => <button key={item.field} onClick={() => setGuideField(item.field)}><strong>{item.label}</strong><small>{settings[item.field] ? cinemaOptionLabel(item.field, settings[item.field]) : item.empty}</small><ArrowUpRight size={14}/></button>)}</div>
    <div className="cinema-guide-shortcuts" aria-label="Decisiones de época y captura">{shortcuts.map(item => <button key={item.field} onClick={() => setGuideField(item.field)}><span><strong>{item.label}</strong><small>{item.value ?? 'Elegir…'}</small></span><ChevronRight size={15}/></button>)}</div>
    <div className="cinema-fields cinema-quick-fields">{(['framing', 'movement'] as CinemaFieldKey[]).map(key => {
      const field = CINEMA_FIELDS.find(item => item.key === key)!;
      return <label className="field" key={key}><span>{field.label}</span><select value={settings[key] ?? ''} onChange={event => set(key, event.target.value)}><option value="">Sin indicación</option>{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
    })}</div>
    {!settings.framing && !settings.movement && scene.camera?.trim() && <p className="cinema-legacy-direction"><strong>Dirección heredada</strong><span>{scene.camera.trim()}</span></p>}
    {chosen.some(field => !['framing', 'movement', 'era', 'filmFormat', 'filmStock', 'lensFamily', 'cameraBody'].includes(field.key)) && <div className="cinema-direction-summary" aria-label="Dirección actual del plano">{chosen.filter(field => !['framing', 'movement', 'era', 'filmFormat', 'filmStock', 'lensFamily', 'cameraBody'].includes(field.key)).map(field => <span key={field.key}><small>{field.label}</small>{cinemaOptionLabel(field.key, settings[field.key])}</span>)}</div>}
    {warnings.length > 0 && <div className="cinema-setting-notes"><strong>Revisa esta combinación</strong><ul>{warnings.map(note => <li key={note}>{note}</li>)}</ul></div>}
    <details className="cinema-starting-points"><summary>Empezar con una propuesta</summary><div className="cinema-preset"><label className="field"><span>Punto de partida</span><select value={preset} onChange={event => setPreset(event.target.value)}><option value="">Elegir una propuesta…</option>{CINEMA_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><button className="quiet-button" disabled={!preset} onClick={applyPreset}>Aplicar dirección</button></div>{preset && <p className="cinema-preset-note">{CINEMA_PRESETS.find(item => item.id === preset)?.description} Reemplaza las indicaciones actuales; puedes deshacerlo.</p>}</details>
    <div className="cinema-actions"><button className="text-button" disabled={!previous?.cinematography} onClick={() => apply(structuredClone(previous!.cinematography!))}><Copy size={14}/>Copiar del plano anterior</button><button className="text-button" disabled={!Object.keys(settings).length} onClick={() => onChange({ cinematography: undefined })}><RotateCcw size={14}/>Restablecer dirección</button></div>
    <details className="cinema-prompt"><summary>Instrucciones de dirección y época</summary><p>Se suman a la intención del plano y a la continuidad de sus personajes. La respuesta depende del modelo y de la imagen inicial.</p><pre>{direction || 'Sin instrucciones adicionales. Se conserva la intención del plano.'}</pre></details>
    {guideField && <CinemaReferenceGuide settings={settings} camera={scene.camera} subjectRoles={subjectRoles} sceneTitle={scene.title} initialField={guideField} previous={previous?.cinematography ? { title: previous.title, settings: previous.cinematography } : undefined} onApply={apply} onClose={() => setGuideField(null)}/>}
  </section>;
}
