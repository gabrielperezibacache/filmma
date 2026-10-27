import {useEffect,useRef,useState} from 'react';
import {AudioLines,Check,ChevronDown,Mic2,Upload} from 'lucide-react';
import {api} from '../api';
import {DEFAULT_DIALOGUE_VOICE} from '../dialogue';
import type {Asset,Character,CharacterVoice,Project} from '../types';
import {VoiceSelection,useVoiceProviders,type VoiceProviders} from './VoiceProviders';
import './CharacterVoiceProfile.css';

type Props={project:Project;character:Character;providers?:VoiceProviders;onUpdate:(fn:(p:Project)=>Project,group?:string)=>void;onSave:()=>Promise<void>;onNotify:(text:string)=>void;onImport?:()=>void;hideHeading?:boolean};
const voiceKey=(voice:CharacterVoice|undefined)=>JSON.stringify(voice??null);
const seconds=(value:number)=>`${value.toLocaleString('es',{maximumFractionDigits:2})} s`;

/** The voice belongs to the character, never to the currently selected scene. */
export default function CharacterVoiceProfile({project,character,providers:sharedProviders,onUpdate,onSave,onNotify,onImport,hideHeading=false}:Props){
 const ownProviders=useVoiceProviders(project.id,!sharedProviders),providers=sharedProviders??ownProviders;
 const [sourceId,setSourceId]=useState(''),[start,setStart]=useState(0),[duration,setDuration]=useState(10),[sourceDuration,setSourceDuration]=useState<number>(),[name,setName]=useState('');
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[createOpen,setCreateOpen]=useState(false);
 const fileRef=useRef<HTMLInputElement>(null),audioRef=useRef<HTMLAudioElement>(null),previewing=useRef(false),alive=useRef(true),current=useRef({project,character});current.current={project,character};
 const voice=character.voice??DEFAULT_DIALOGUE_VOICE;
 const sources=project.assets.filter(a=>a.type==='audio'&&!a.voiceReference),source=sources.find(a=>a.id===sourceId);
 const reference=voice.engine==='qwen'&&voice.referenceAssetId?project.assets.find(a=>a.id===voice.referenceAssetId):undefined;
 const validRange=Number.isFinite(start)&&start>=0&&Number.isFinite(duration)&&duration>=3&&duration<=30&&!!sourceDuration&&start+duration<=sourceDuration+.001;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 useEffect(()=>{setSourceId('');setStart(0);setDuration(10);setSourceDuration(undefined);setName('');setError('');setCreateOpen(false)},[project.id,character.id]);
 const changeVoice=(next:CharacterVoice)=>onUpdate(p=>p.id===project.id?{...p,characters:p.characters.map(c=>c.id===character.id?{...c,voice:next}:c)}:p,`character-voice:${character.id}`);
 const importAudio=async(file:File)=>{
  if(busy)return;const projectId=project.id,characterId=character.id;setBusy('import');setError('');
  try{await onSave();if(!alive.current||current.current.project.id!==projectId||current.current.character.id!==characterId)return;
   const body=new FormData();body.append('projectId',projectId);body.append('files',file);const result=await api<{assets:Asset[]}>('/assets',body);
   onUpdate(p=>p.id===projectId?{...p,assets:[...p.assets,...result.assets.filter(a=>!p.assets.some(existing=>existing.id===a.id))]}:p);
   if(alive.current&&current.current.project.id===projectId&&current.current.character.id===characterId){const audio=result.assets.find(a=>a.type==='audio');if(!audio)throw new Error('El archivo se incorporó a la biblioteca, pero no es audio. Elige WAV, MP3 o M4A.');setSourceId(audio.id);setStart(0);setSourceDuration(undefined);onNotify('Audio de referencia incorporado. El original se conserva en la biblioteca.');}
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:String(e))}finally{if(alive.current)setBusy('');if(fileRef.current)fileRef.current.value=''}
 };
 const createProfile=async()=>{
  if(busy||!source||!validRange)return;
  const projectId=project.id,characterId=character.id,previousVoice=voiceKey(character.voice),selectedSource=source.id;setBusy('create');setError('');
  try{await onSave();if(!alive.current||current.current.project.id!==projectId||current.current.character.id!==characterId)return;
   if(voiceKey(current.current.character.voice)!==previousVoice)throw new Error('La voz del personaje cambió mientras se guardaba. Revisa tu selección antes de crear la referencia.');
   const result=await api<{asset:Asset;voice:CharacterVoice;applied?:boolean}>('/speech/qwen/profiles',{projectId,characterId,sourceAssetId:selectedSource,start,duration,name:name.trim()||`${character.name.slice(0,85)} · voz`});
   const liveCharacter=current.current.project.characters.find(c=>c.id===characterId);
   const canApply=result.applied!==false&&current.current.project.id===projectId&&!!liveCharacter&&voiceKey(liveCharacter.voice)===previousVoice;
   onUpdate(p=>p.id===projectId?{...p,assets:p.assets.some(a=>a.id===result.asset.id)?p.assets:[...p.assets,result.asset],characters:canApply?p.characters.map(c=>c.id===characterId&&voiceKey(c.voice)===previousVoice?{...c,voice:result.voice}:c):p.characters}:p);
   if(alive.current&&current.current.project.id===projectId&&current.current.character.id===characterId){setCreateOpen(false);onNotify(canApply?`Voz de ${character.name} preparada. Se mantiene en todos sus planos.`:'Referencia creada y conservada. La voz cambió durante la preparación; elige el nuevo perfil cuando quieras usarlo.');}
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:String(e))}finally{if(alive.current)setBusy('')}
 };
 return <section className="character-voice-profile" aria-label={`Voz de ${character.name}`}>
  {!hideHeading&&<div className="cvp-heading"><Mic2 size={18}/><div><h3>La voz de {character.name}</h3><p>Una misma referencia para cada aparición en el guion.</p></div></div>}
  <VoiceSelection voice={voice} providers={providers} project={project} characterId={character.id} onChange={changeVoice}/>
  {voice.engine==='qwen'&&<>
   {reference?.voiceReference&&<div className="cvp-current"><div><Check size={16}/><strong>{reference.voiceReference.name}</strong><span>{seconds(reference.voiceReference.duration)} · referencia local</span></div><audio controls preload="metadata" src={reference.url} aria-label={`Escuchar la referencia de ${character.name}`}/><p>Vinculada al personaje en todos sus planos. Las grabaciones anteriores se conservan; escucha cada nueva interpretación antes de aplicarla.</p></div>}
   <details className="cvp-create" open={createOpen} onToggle={e=>setCreateOpen(e.currentTarget.open)}><summary><span><AudioLines size={17}/>Crear voz desde un audio</span><ChevronDown size={16}/></summary>
    <p>Elige de 3 a 30 segundos de voz limpia, de una sola persona y con permiso para usarla. Qwen tomará su timbre para los diálogos de {character.name}.</p>
    <div className="cvp-source"><label>Audio de referencia<select aria-label={`Audio de referencia de ${character.name}`} value={source?.id??''} disabled={!!busy} onChange={e=>{previewing.current=false;setSourceId(e.target.value);setSourceDuration(undefined);setStart(0);setError('')}}><option value="">{sources.length?'Elige un audio de la biblioteca':'Importa un audio para comenzar'}</option>{sources.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><button className="quiet-button" disabled={!!busy} onClick={()=>onImport?onImport():fileRef.current?.click()}><Upload size={15}/>{busy==='import'?'Importando…':'Importar audio'}</button><input ref={fileRef} type="file" hidden accept=".wav,.mp3,.m4a,.m4b,.ogg,audio/wav,audio/mpeg,audio/mp4,audio/ogg" onChange={e=>{const file=e.target.files?.[0];if(file)void importAudio(file)}}/></div>
    {source&&<div className="cvp-excerpt"><audio ref={audioRef} key={source.id} controls preload="metadata" src={source.url} aria-label="Escuchar el audio original" onLoadedMetadata={e=>{const length=e.currentTarget.duration;if(Number.isFinite(length)){setSourceDuration(length);setDuration(Math.min(10,length));}else setError('No se pudo leer la duración. Prueba con un archivo WAV o MP3.')}} onTimeUpdate={e=>{if(previewing.current&&e.currentTarget.currentTime>=start+duration){e.currentTarget.pause();previewing.current=false;}}} onError={()=>setError('No se pudo abrir este audio. Importa una copia WAV o MP3 y vuelve a elegirla.')}/>
     <div className="cvp-range"><label>Inicio (segundos)<input type="number" min={0} max={sourceDuration??undefined} step={.1} value={start} disabled={!!busy} onChange={e=>setStart(Number(e.target.value))}/></label><label>Duración (segundos)<input type="number" min={3} max={30} step={.1} value={duration} disabled={!!busy} onChange={e=>setDuration(Number(e.target.value))}/></label><button className="quiet-button" disabled={!validRange||!!busy} onClick={()=>{const player=audioRef.current;if(player){previewing.current=true;player.currentTime=start;void player.play().catch(()=>setError('El navegador no pudo iniciar el audio. Pulsa reproducir en el control del original.'));}}}>Escuchar fragmento</button></div>
     {sourceDuration!==undefined&&<p className={validRange?'cvp-note':'cvp-error'}>{validRange?`${seconds(start)} a ${seconds(start+duration)} de ${seconds(sourceDuration)}. El original no se recorta.`:sourceDuration<3?'Este audio dura menos de 3 segundos. Elige una referencia más larga.':'El fragmento debe durar entre 3 y 30 segundos y quedar dentro del audio.'}</p>}
    </div>}
    <label>Nombre de la voz<input maxLength={100} placeholder={`${character.name} · voz`} value={name} disabled={!!busy} onChange={e=>setName(e.target.value)}/></label>
    <div className="cvp-footer"><button className="primary" disabled={!!busy||!validRange||!(providers.qwen?.modelReady??providers.qwen?.ready)} onClick={()=>void createProfile()}><Mic2 size={16}/>{busy==='create'?'Preparando referencia…':'Crear y usar voz'}</button><span>Se guarda una referencia nueva.<br/>Tu audio original permanece intacto.</span></div>
    {!(providers.qwen?.modelReady??providers.qwen?.ready)&&<p className="cvp-note">{providers.qwen?.message??'Qwen debe estar disponible en este Mac. Revisa Voces y conexiones.'}</p>}
   </details>
  </>}
  {error&&<p className="cvp-error" role="alert">{error}</p>}
 </section>;
}
