import type {CharacterVoice,DialogueLine} from './types';
import type {SpeechAlignment} from './elevenlabs';
export const SPEECH_DIRECTIONS=[
 {id:'thoughtful',es:'Reflexiva',en:'Reflective',tag:'thoughtful'},
 {id:'curious',es:'Curiosidad',en:'Curious',tag:'curious'},
 {id:'warm',es:'Cercanía',en:'Warm',tag:'warmly'},
 {id:'hesitant',es:'Duda',en:'Hesitant',tag:'hesitant'},
 {id:'tense',es:'Tensión contenida',en:'Restrained tension',tag:'nervous'},
 {id:'reassuring',es:'Consuelo',en:'Reassuring',tag:'reassuring'},
 {id:'urgent',es:'Urgencia',en:'Urgent',tag:'rushed'},
 {id:'quiet',es:'Íntima',en:'Intimate',tag:'quietly'},
 {id:'tired',es:'Cansancio',en:'Tired',tag:'tired'},
] as const;
export const recognizedDirection=(direction:string|undefined)=>!direction||SPEECH_DIRECTIONS.some(d=>d.id===direction);

export function supportsSpeechDirection(voice:CharacterVoice|undefined){
 return voice?.engine==='elevenlabs'&&['eleven_v3','eleven_v4','eleven_v4_turbo'].includes(voice.modelId);
}
/** Acting instructions are kept out of the screenplay and captions. */
export function directedSpeechText(line:Pick<DialogueLine,'text'|'direction'>,voice:CharacterVoice){
 if(!line.direction)return line.text;
 if(!supportsSpeechDirection(voice))throw new Error('La intención de voz requiere Eleven v4 o v3. Cambia el modelo de la voz o retira la intención antes de generar.');
 const preset=SPEECH_DIRECTIONS.find(d=>d.id===line.direction);
 if(!preset)throw new Error('Elige una intención de voz de la lista antes de generar. Las indicaciones antiguas se conservan para revisión.');
 return `[${preset.tag}] ${line.text}`;
}
export function spokenAlignment(alignment:SpeechAlignment|undefined,line:Pick<DialogueLine,'text'|'direction'>):SpeechAlignment|undefined{
 if(!alignment||!line.direction)return alignment;
 const text=alignment.characters.join('');
 if(text===line.text)return alignment;
 // Tag timestamps can be ambiguous. Only use alignment that explicitly describes
 // the clean spoken text; otherwise retain the full audio with unavailable timing.
 return undefined;
}
