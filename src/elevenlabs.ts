/** Capabilities verified against ElevenLabs' REST model and voice-settings docs.
 * A model must also be returned by the connected account before it can be used. */
export const ELEVENLABS_MODELS = ['eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_turbo_v2_5', 'eleven_v3', 'eleven_v4', 'eleven_v4_turbo'] as const;
export type ElevenLabsSettings = {stability?:number;similarity?:number;style?:number;speakerBoost?:boolean};
export const ELEVENLABS_DEFAULTS = {stability:.5,similarity:.75,style:0,speakerBoost:true} as const;
export function elevenCapabilities(modelId:string) {
 const v4=modelId==='eleven_v4'||modelId==='eleven_v4_turbo';
 return {supportsSpeed:!v4,supportsStyle:!v4,supportsSpeakerBoost:!v4&&modelId!=='eleven_v3',discreteStability:modelId==='eleven_v3'};
}
export type SpeechAlignment = {source:'elevenlabs';textKind:'original'|'normalized';characters:string[];starts:number[];ends:number[]};
/** Use only speech boundaries. The provider's normalized text never replaces the script. */
export function speechBounds(speech:{duration:number;alignment?:SpeechAlignment}) {
 const timing=speech.alignment;
 if(timing&&timing.characters.length===timing.starts.length&&timing.starts.length===timing.ends.length){
  const spoken=timing.characters.map((c,i)=>c.trim()?i:-1).filter(i=>i>=0);
  if(spoken.length){const start=timing.starts[spoken[0]!]!,end=timing.ends[spoken.at(-1)!]!;
   if(Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>start&&end<=speech.duration+.001)return{start,end};}
 }
 return{start:0,end:speech.duration};
}
