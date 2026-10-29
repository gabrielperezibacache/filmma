import {useId,useState} from 'react';
import {AudioLines,Search} from 'lucide-react';
import {tr} from '../i18n';
import {ELEVENLABS_DEFAULTS,elevenCapabilities} from '../elevenlabs';
import type {ElevenLabsVoice} from '../types';

export type ElevenVoiceOption={id:string;name:string;category?:string;language?:string;description?:string;previewUrl?:string};
export function ElevenVoiceLibrary({voices,voiceId,onChange}:{voices:ElevenVoiceOption[];voiceId:string;onChange:(id:string)=>void}){
 const [query,setQuery]=useState(''),[failed,setFailed]=useState('');
 const selected=voices.find(v=>v.id===voiceId),needle=query.trim().toLocaleLowerCase();
 const filtered=voices.filter(v=>[v.name,v.language,v.category,v.description].join(' ').toLocaleLowerCase().includes(needle));
 // A search must never change a character's voice or conceal the saved selection.
 const options=selected&&!filtered.some(v=>v.id===selected.id)?[selected,...filtered]:filtered;
 return <div className="el-voice-library">
  <div className="el-library-heading"><AudioLines size={18}/><h4>{tr('La voz del personaje','Character voice')}</h4><span>{voices.length} {tr('disponibles','available')}</span></div>
  <div className="el-library-fields">
   <label><span><Search size={13}/>{tr('Buscar en mis voces','Search my voices')}</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={tr('Nombre, idioma o descripción','Name, language or description')}/></label>
   <label>{tr('Voz estable','Consistent voice')}<select aria-label={tr('Voz estable','Consistent voice')} value={selected?voiceId:''} onChange={e=>onChange(e.target.value)}><option value="" disabled>{tr('Selecciona una voz','Select a voice')}</option>{options.map(v=><option value={v.id} key={v.id}>{v.name}{v.language?` · ${v.language}`:''}</option>)}</select></label>
  </div>
  {!filtered.length&&query&&<p role="status">{tr('Sin coincidencias. La voz elegida se conserva.','No matches. Your selected voice is preserved.')}</p>}
  {!voices.length&&<p>{tr('Conecta tu cuenta en Voces y conexiones y actualiza el catálogo.','Connect your account in Voices and connections, then refresh the catalog.')}</p>}
  {selected&&<div className="el-voice-preview"><div><strong>{selected.name}</strong><p>{selected.description||tr('Esta selección se mantiene entre escenas.','This selection carries across scenes.')}</p></div>
   {selected.previewUrl?<><audio key={selected.previewUrl} aria-label={tr(`Escuchar muestra de ${selected.name}`,`Listen to ${selected.name}'s sample`)} controls preload="none" src={selected.previewUrl} onError={()=>setFailed(selected.id)}/><small>{tr('Muestra pública de ElevenLabs · no genera audio ni consume créditos de síntesis.','Public ElevenLabs sample · no speech generation or synthesis credits.')}</small>{failed===selected.id&&<p role="status">{tr('No se pudo reproducir la muestra. Puedes elegir la voz y generar desde el guion.','The sample could not be played. You can still select this voice and generate from the script.')}</p>}</>:<small>{tr('Esta voz no ofrece una muestra pública.','This voice has no public sample.')}</small>}
  </div>}
 </div>;
}

export function ElevenPerformance({voice,onChange}:{voice:ElevenLabsVoice;onChange:(voice:ElevenLabsVoice)=>void}){
 const id=useId(),settings={...ELEVENLABS_DEFAULTS,...voice.settings},caps=elevenCapabilities(voice.modelId);
 const patch=(value:Partial<NonNullable<ElevenLabsVoice['settings']>>)=>onChange({...voice,settings:{...voice.settings,...value}});
 return <details className="el-performance"><summary>{tr('Interpretación y continuidad de la voz','Performance and voice continuity')}</summary>
  <p>{tr('Se guardan con este personaje. Los cambios dejan las grabaciones anteriores disponibles para revisión.','Saved with this character. Previous recordings remain available for review when settings change.')}</p>
  <div className="el-performance-fields">
   <label htmlFor={`${id}-stability`}>{tr('Estabilidad','Stability')}<output>{Math.round(settings.stability*100)} %</output>{caps.discreteStability?<select id={`${id}-stability`} value={settings.stability} onChange={e=>patch({stability:Number(e.target.value)})}><option value={0}>{tr('Expresiva','Expressive')}</option><option value={.5}>{tr('Natural · recomendada','Natural · recommended')}</option><option value={1}>{tr('Estable','Stable')}</option></select>:<input id={`${id}-stability`} type="range" min={0} max={1} step={.05} value={settings.stability} onChange={e=>patch({stability:Number(e.target.value)})}/>}<small>{tr('Más alta: interpretación más regular.','Higher: more consistent delivery.')}</small></label>
   <label htmlFor={`${id}-similarity`}>{tr('Similitud de la voz','Voice similarity')}<output>{Math.round(settings.similarity*100)} %</output><input id={`${id}-similarity`} type="range" min={0} max={1} step={.05} value={settings.similarity} onChange={e=>patch({similarity:Number(e.target.value)})}/><small>{tr('Conserva el timbre; valores muy altos pueden acentuar defectos.','Preserves timbre; high values may amplify artifacts.')}</small></label>
   {caps.supportsStyle&&<label htmlFor={`${id}-style`}>{tr('Intensidad del estilo','Style intensity')}<output>{Math.round(settings.style*100)} %</output><input id={`${id}-style`} type="range" min={0} max={1} step={.05} value={settings.style} onChange={e=>patch({style:Number(e.target.value)})}/><small>{tr('Empieza en 0 para una continuidad más uniforme.','Start at 0 for more consistent delivery.')}</small></label>}
  </div>
  {caps.supportsSpeakerBoost&&<label className="dw-check"><input type="checkbox" checked={settings.speakerBoost} onChange={e=>patch({speakerBoost:e.target.checked})}/>{tr('Refuerzo de claridad y similitud','Clarity and similarity boost')}</label>}
  {!caps.supportsSpeed&&<p className="dw-hint">{tr('Este modelo dirige el ritmo con el texto y la puntuación; no admite velocidad numérica ni intensidad de estilo.','This model uses text and punctuation to control pacing; numeric speed and style intensity are unavailable.')}</p>}
  <button className="dw-text-button" onClick={()=>onChange({...voice,speed:1,settings:undefined})}>{tr('Restablecer valores recomendados','Reset recommended settings')}</button>
 </details>;
}
