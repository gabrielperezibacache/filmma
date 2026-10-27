import {useEffect,useState} from 'react';
import {ExternalLink,Link2,RefreshCw,Unplug} from 'lucide-react';
import {api} from '../api';
import {DIALOGUE_ENGINES,DIALOGUE_VOICES,defaultDialogueVoice} from '../dialogue';
import type {CharacterVoice,DialogueEngine,LocalDialogueStatus,Project} from '../types';

type AccountStatus={configured:boolean;ready:boolean;message?:string;voices:{id:string;name:string;language?:string}[];models:{id:string;name:string;languages:string[];supportsSpeed?:boolean}[]};
type QwenStatus=LocalDialogueStatus&{referenceSha256?:string;modelReady?:boolean};
export function useVoiceProviders(refresh:string|number,enabled=true){
 const [eleven,setEleven]=useState<AccountStatus>(),[qwen,setQwen]=useState<QwenStatus>();
 useEffect(()=>{if(!enabled)return;let live=true;void Promise.all([
  api<AccountStatus>('/speech/elevenlabs').then(s=>{if(live)setEleven(s)}).catch(e=>{if(live)setEleven({configured:false,ready:false,voices:[],models:[],message:String(e)})}),
  api<QwenStatus>('/speech/qwen').then(s=>{if(live)setQwen(s)}).catch(e=>{if(live)setQwen({ok:false,ready:false,message:String(e)})}),
 ]);return()=>{live=false}},[refresh,enabled]);
 return {eleven,qwen,setEleven};
}
export type VoiceProviders=ReturnType<typeof useVoiceProviders>;

export function VoiceConnections({providers}:{providers:VoiceProviders}){
 const {eleven,qwen,setEleven}=providers;
 const [key,setKey]=useState(''),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const accountAction=async(action:'connect'|'disconnect'|'refresh')=>{
  if(busy)return;setBusy(action);setError('');
  const apiKey=key.trim();setKey('');
  try{setEleven(await api<AccountStatus>(`/speech/elevenlabs/${action}`,action==='connect'?{apiKey}:{}))}
  catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy('')}
 };
 return <>
  <article className="dw-provider"><h2>Qwen · voces locales</h2><p>Reutiliza tu modelo de Hermes. Cada personaje puede tener una voz propia a partir de un audio, o usar la referencia de Hermes.</p><span className={(qwen?.modelReady??qwen?.ready)?'dw-ready':'dw-muted'}>{qwen?(qwen.modelReady??qwen.ready)?qwen.ready?'Modelo listo · referencia de Hermes disponible':'Modelo listo para las voces de tus personajes':qwen.message??qwen.reason??'No se encontró la instalación de Hermes':'Buscando la instalación…'}</span>{qwen?.model&&<small>{qwen.model}</small>}{qwen?.warnings?.map(w=><small key={w}>{w}</small>)}</article>
  <article className="dw-provider"><h2>ElevenLabs · tu cuenta</h2><p>Usa las voces de tu cuenta. Al generar se enviará sólo el texto de la intervención a ElevenLabs y se consumirán créditos de tu plan.</p><span className={eleven?.ready?'dw-ready':'dw-muted'}>{eleven?eleven.ready?`${eleven.voices.length} voces disponibles`:eleven.message??(eleven.configured?'Conexión guardada · actualiza las voces':'Cuenta sin conectar'):'Comprobando conexión…'}</span>
   <form onSubmit={e=>{e.preventDefault();void accountAction('connect')}}>
    <label>Clave API de ElevenLabs<input aria-label="Clave API de ElevenLabs" type="password" autoComplete="off" spellCheck={false} value={key} maxLength={512} placeholder={eleven?.configured?'Nueva clave para cambiar de cuenta':'Pega aquí tu clave API'} onChange={e=>setKey(e.target.value)}/></label>
    <div className="dw-actions"><button className="quiet-button" type="submit" disabled={!!busy||!key.trim()}><Link2 size={15}/>{busy==='connect'?'Conectando…':eleven?.configured?'Cambiar conexión':'Conectar cuenta'}</button><a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer">Obtener clave<ExternalLink size={13}/></a></div>
   </form>
   <small>La clave se guarda sólo en este Mac, fuera de las películas y de sus exportaciones. Conectar o actualizar las voces no genera audio.</small>
   {eleven?.configured&&<div className="dw-actions"><button className="dw-text-button" disabled={!!busy} onClick={()=>void accountAction('refresh')}><RefreshCw size={14}/>{busy==='refresh'?'Actualizando…':'Actualizar mis voces'}</button><button className="dw-text-button" disabled={!!busy} onClick={()=>void accountAction('disconnect')}><Unplug size={14}/>Desconectar</button></div>}
   {error&&<p className="dw-warning-text" role="alert">{error}</p>}
  </article>
 </>;
}

export function providerReady(voice:CharacterVoice|undefined,providers:VoiceProviders,kokoroReady:boolean,project?:Project,characterId?:string){
 if(!voice)return false;
 if(voice.engine==='kokoro')return kokoroReady;
 if(voice.engine==='qwen'){if(voice.referenceAssetId){const asset=project?.assets.find(a=>a.id===voice.referenceAssetId&&a.type==='audio');return !!(providers.qwen?.modelReady??providers.qwen?.ready)&&!!asset?.voiceReference&&asset.voiceReference.projectId===project?.id&&asset.voiceReference.characterId===characterId&&voice.voiceId===`profile-${asset.id}`&&voice.referenceSha256===asset.voiceReference.outputSha256;}return !!providers.qwen?.ready&&!!providers.qwen.voices?.some(v=>v.id===voice.voiceId)&&!!voice.referenceSha256&&voice.referenceSha256===providers.qwen.referenceSha256;}
 return !!providers.eleven?.ready&&providers.eleven.voices.some(v=>v.id===voice.voiceId)&&providers.eleven.models.some(m=>m.id===voice.modelId&&m.languages.includes(voice.language));
}

export function VoiceSelection({voice,providers,project,characterId,onChange}:{voice:CharacterVoice;providers:VoiceProviders;project?:Project;characterId?:string;onChange:(v:CharacterVoice)=>void}){
 const {eleven,qwen}=providers;
 const range=DIALOGUE_ENGINES.find(e=>e.id===voice.engine)!;
 const profiles=project?.assets.filter(a=>a.type==='audio'&&a.voiceReference&&a.voiceReference.characterId===characterId)??[];
 const qwenVoices=[...(qwen?.voices??[]),...profiles.map(a=>({id:`profile-${a.id}`,name:a.voiceReference!.name,language:''}))];
 const list=voice.engine==='kokoro'?DIALOGUE_VOICES:voice.engine==='elevenlabs'?eleven?.voices??[]:qwenVoices;
 const models=eleven?.models.filter(m=>m.languages.includes(voice.language))??[];
 const changeEngine=(engine:DialogueEngine)=>{
  const first=engine==='elevenlabs'?eleven?.voices[0]?.id:engine==='qwen'?qwen?.voices?.[0]?.id:undefined;
  let next=defaultDialogueVoice(engine,first);
  if(next.engine==='qwen'&&qwen?.referenceSha256)next={...next,referenceSha256:qwen.referenceSha256};
  if(next.engine==='elevenlabs'&&eleven?.models.length){const current=next;if(!eleven.models.some(m=>m.id===current.modelId&&m.languages.includes(current.language))){const model=eleven.models.find(m=>m.languages.includes(current.language));if(model)next={...current,modelId:model.id};}}
  onChange(next);
 };
 const selected=list.some(v=>v.id===voice.voiceId);
 return <>
  <div className="dw-fields dw-provider-fields"><label>Motor de voz<select aria-label="Motor de voz" value={voice.engine} onChange={e=>changeEngine(e.target.value as DialogueEngine)}><option value="kokoro">Kokoro · local</option><option value="qwen">Qwen · voz propia local</option><option value="elevenlabs">ElevenLabs · mi cuenta</option></select></label>
   <label>Voz estable<select aria-label="Voz estable" value={selected?voice.voiceId:''} onChange={e=>{
    if(voice.engine==='kokoro'){const chosen=DIALOGUE_VOICES.find(v=>v.id===e.target.value);if(chosen)onChange({...voice,voiceId:chosen.id,language:chosen.language})}
    else if(voice.engine==='qwen'){const profile=profiles.find(a=>`profile-${a.id}`===e.target.value);onChange({...voice,voiceId:e.target.value,referenceAssetId:profile?.id,referenceSha256:profile?.voiceReference?.outputSha256??qwen?.referenceSha256});}
    else onChange({...voice,voiceId:e.target.value});
   }}><option value="" disabled>{list.length?'Selecciona una voz':voice.engine==='elevenlabs'?'Conecta tu cuenta en Voces y conexiones':'Voz no disponible'}</option>{list.map(v=><option key={v.id} value={v.id}>{v.name}{voice.engine==='kokoro'?` · ${v.language==='es'?'español':'inglés'}`:''}</option>)}</select></label>
   {voice.engine!=='kokoro'&&<label>Idioma<select aria-label="Idioma de la voz" value={voice.language} onChange={e=>onChange({...voice,language:e.target.value as 'es'|'en'})}><option value="es">Español</option><option value="en">Inglés</option></select></label>}
   {voice.engine==='elevenlabs'&&<label>Modelo de ElevenLabs<select aria-label="Modelo de ElevenLabs" value={models.some(m=>m.id===voice.modelId)?voice.modelId:''} onChange={e=>onChange({...voice,modelId:e.target.value})}><option value="" disabled>Selecciona un modelo compatible</option>{models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
   <label>Ritmo<input aria-label="Ritmo de la voz" type="number" min={range.minSpeed} max={range.maxSpeed} step={.05} value={voice.speed} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&n>=range.minSpeed&&n<=range.maxSpeed)onChange({...voice,speed:n})}}/></label>
  </div>
  {voice.engine==='qwen'&&!voice.referenceAssetId&&qwen?.referenceSha256&&voice.referenceSha256!==qwen.referenceSha256&&<div className="dw-warning"><p>{voice.referenceSha256?'La referencia de Hermes cambió. Las grabaciones anteriores se conservan. Revisa la nueva voz antes de adoptarla para este personaje.':'Vincula la referencia de Hermes para conservar esta misma voz entre planos.'}</p><button className="quiet-button" onClick={()=>onChange({...voice,referenceSha256:qwen.referenceSha256})}>Usar la referencia actual de Hermes</button></div>}
  <p className="dw-hint">{voice.engine==='elevenlabs'?'Generar en ElevenLabs usa los créditos de tu cuenta. Si el audio supera 15 segundos se rechazará sin recortarlo; la solicitud remota puede haber consumido créditos.':voice.engine==='qwen'?'Qwen utiliza una misma referencia para conservar el timbre. La interpretación puede variar; escucha el resultado antes de llevarlo al montaje.':'Las acotaciones ayudan a dirigir, pero Kokoro no controla emociones ni clona voces. Escucha la pronunciación antes de usarla.'}</p>
 </>;
}
