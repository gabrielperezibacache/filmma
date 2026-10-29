import {adaptationSchema,referenceSourceSchema} from './adaptation-schema.js';
import {productionSchema} from './production.js';
import {googleVideoProvenanceSchema} from './google-video.js';
import { z } from 'zod';
import { CINEMA_VALUES, HISTORICAL_CONTEXT_LIMITS, HISTORICAL_MODES } from '../src/cinematography.js';
import type { FinishingSummary } from './film-finishing.js';
import { DEFAULT_PROJECT_FORMAT, DEFAULT_PROJECT_FPS, PROJECT_FORMATS } from '../src/export-resolution.js';

const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const text = (max = 12000) => z.string().max(max);
const localUrl = z.string().max(250).regex(/^\/(?:api\/media\/[a-zA-Z0-9._-]+|demo\/[a-zA-Z0-9._-]+)$/);
export const temporalEnhancementMetricsSchema = z.object({frames:z.number().int().min(1).max(900),stabilizedFrames:z.number().int().min(0).max(899),resets:z.number().int().min(0).max(899),meanConfidence:z.number().min(0).max(1),maxTemporalChangeRgb:z.number().min(0).max(6),maxPreviousWeight:z.number().min(0).max(.45),maximumRgbUpdate:z.number().min(0).max(6),stateFrames:z.literal(1),flowMaxDimension:z.number().min(16).max(960),method:text(500),limit:text(500)});
export const aiProcessingProfileSchema = z.enum(['conservative', 'restore', 'temporal']);
export const aiProcessingFields = { processingProfile: aiProcessingProfileSchema.optional(), strength: z.number().min(.15).max(.85).optional() };
export function validateAiProcessing(value: { processingProfile?: 'conservative'|'restore'|'temporal'; strength?: number }, ctx: z.RefinementCtx) {
  if ((value.processingProfile ?? 'conservative') === 'conservative' && value.strength !== undefined && value.strength > .7) ctx.addIssue({code:'custom',path:['strength'],message:'El acabado conservador admite entre 15 % y 70 % de intensidad.'});
}
export function defaultAiProcessing<T extends { processingProfile?: 'conservative'|'restore'|'temporal'; strength?: number }>(value: T) {
  const processingProfile = value.processingProfile ?? 'conservative';
  return { ...value, processingProfile, strength: value.strength ?? (processingProfile === 'temporal' ? .65 : processingProfile === 'restore' ? .75 : .35) };
}
export const historicalContextSchema = z.object({
  year: text(HISTORICAL_CONTEXT_LIMITS.year).regex(/^[^\u0000-\u001f\u007f]*$/).optional(),
  location: text(HISTORICAL_CONTEXT_LIMITS.location).regex(/^[^\u0000-\u001f\u007f]*$/).optional(),
  notes: text(HISTORICAL_CONTEXT_LIMITS.notes).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/).optional(),
  mode: z.enum(HISTORICAL_MODES).optional(),
}).strict();
export const cinematographySchema = z.object({
  director:z.enum(CINEMA_VALUES.director).optional(),takeType:z.enum(CINEMA_VALUES.takeType).optional(),
  cameraStyle:z.enum(CINEMA_VALUES.cameraStyle).optional(),fStop:z.enum(CINEMA_VALUES.fStop).optional(),
  framing:z.enum(CINEMA_VALUES.framing).optional(),angle:z.enum(CINEMA_VALUES.angle).optional(),lens:z.enum(CINEMA_VALUES.lens).optional(),aperture:z.enum(CINEMA_VALUES.aperture).optional(),
  movement:z.enum(CINEMA_VALUES.movement).optional(),pace:z.enum(CINEMA_VALUES.pace).optional(),lighting:z.enum(CINEMA_VALUES.lighting).optional(),palette:z.enum(CINEMA_VALUES.palette).optional(),
  filmFormat:z.enum(CINEMA_VALUES.filmFormat).optional(),filmStock:z.enum(CINEMA_VALUES.filmStock).optional(),lensFamily:z.enum(CINEMA_VALUES.lensFamily).optional(),cameraBody:z.enum(CINEMA_VALUES.cameraBody).optional(),
  era:z.enum(CINEMA_VALUES.era).optional(),historicalContext:historicalContextSchema.optional(),
}).strict();
export const continuityValuesSchema = z.object({
  costume: text(1200).optional(), appearance: text(1200).optional(), props: text(1200).optional(), notes: text(2000).optional(),
});
export const continuityOverrideSchema = continuityValuesSchema.extend({ stateLabel:text(120).optional(), intentionalChange: z.boolean().optional(), changeReason: text(1200).optional() });
export const generationProvenanceSchema = z.object({
  modelVariant:z.enum(['bf16','gguf-q4','gguf-q8']).optional(),modelRevision:text(100).optional(),runtimeRevision:text(100).optional(),
  projectId:id,sceneId:id,model:z.enum(['minimax-h3','ltx-2b']),seed:z.number().int().min(0).max(2147483647),prompt:text(64000),negativePrompt:text(),createdAt:text(100),
  width:z.number().int().positive().max(16384),height:z.number().int().positive().max(16384),numFrames:z.number().int().positive().max(360),fps:z.number().positive().max(240),steps:z.number().int().min(1).max(100),
  conditioningMode:z.enum(['image','references','text']),referenceAssetIds:z.array(id).max(32),cinematography:cinematographySchema.optional(),camera:text(250).optional(),characterIds:z.array(id).max(30),
  memoryProfile:z.enum(['conservative','h3-long-ssd','h3-native-ssd','h3-hd-ssd']).optional(),
  continuity:z.record(id,continuityOverrideSchema).refine(value=>Object.keys(value).length<=100,'Máximo 100 estados de continuidad por toma.').optional(),
});
const voiceIdentifier=z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,'El identificador de voz o modelo no es válido.');
export const kokoroVoiceSchema=z.object({engine:z.literal('kokoro'),voiceId:z.enum(['ef_dora','em_alex','em_santa','af_heart','am_michael']),language:z.enum(['es','en']),speed:z.number().min(.5).max(2)}).strict().refine(v=>v.voiceId.startsWith(v.language==='es'?'e':'a'),'La voz no corresponde al idioma.');
export const elevenLabsSettingsSchema=z.object({stability:z.number().min(0).max(1).optional(),similarity:z.number().min(0).max(1).optional(),style:z.number().min(0).max(1).optional(),speakerBoost:z.boolean().optional()}).strict();
export const elevenLabsVoiceSchema=z.object({engine:z.literal('elevenlabs'),voiceId:voiceIdentifier,modelId:voiceIdentifier.default('eleven_multilingual_v2'),language:z.enum(['es','en']),speed:z.number().min(.7).max(1.2),settings:elevenLabsSettingsSchema.optional()}).strict();
export const qwenVoiceSchema=z.object({engine:z.literal('qwen'),voiceId:voiceIdentifier,language:z.enum(['es','en']),speed:z.number().min(.7).max(1.3),referenceSha256:z.string().regex(/^[a-f0-9]{64}$/i).optional(),referenceAssetId:id.optional()}).strict();
export const characterVoiceSchema=z.discriminatedUnion('engine',[kokoroVoiceSchema,elevenLabsVoiceSchema,qwenVoiceSchema]);
export const dialogueLineSchema=z.object({id,sceneId:id,characterId:id.optional(),text:text(600),offset:z.number().min(0).max(120),delivery:z.enum(['dialogue','voiceover']),sourceDialogue:text(100),audioAssetId:id.optional(),voice:characterVoiceSchema.optional()});
export const dialogueSnapshotSchema=z.object({text:text(600),sourceDialogue:text(100),delivery:z.enum(['dialogue','voiceover']),voice:characterVoiceSchema,characterId:id.optional(),characterSnapshot:z.object({name:text(250),description:text(),referenceAssetId:id.optional(),continuity:continuityValuesSchema.optional()}).optional()});
const sha=z.string().regex(/^[a-f0-9]{64}$/i);
export const voiceReferenceSchema=z.object({projectId:id,characterId:id,sourceAssetId:id,sourceSha256:sha,outputSha256:sha,start:z.number().nonnegative().max(86400),duration:z.number().min(3).max(30.001),sampleRate:z.literal(24000),createdAt:text(100),name:text(250)}).strict();
export const speechAlignmentSchema=z.object({source:z.literal('elevenlabs'),textKind:z.enum(['original','normalized']),characters:z.array(text(16).min(1)).min(1).max(12000),starts:z.array(z.number().min(0).max(15.01)).min(1).max(12000),ends:z.array(z.number().min(0).max(15.01)).min(1).max(12000)}).strict().refine(a=>a.characters.length===a.starts.length&&a.starts.length===a.ends.length&&a.starts.every((t,i)=>a.ends[i]!>=t&&(i===0||t>=a.starts[i-1]!&&a.ends[i]!>=a.ends[i-1]!)),'Los tiempos de habla no son válidos.');
export const speechProvenanceSchema=dialogueSnapshotSchema.extend({projectId:id,sceneId:id,lineId:id,duration:z.number().positive().max(15.01),sampleRate:z.number().int().positive().max(192000),sourceFingerprint:sha,outputSha256:sha,createdAt:text(100),model:text(150),alignment:speechAlignmentSchema.optional(),timingStatus:z.enum(['aligned','unavailable']).optional(),providerRequestId:text(100).regex(/^[a-zA-Z0-9_-]+$/).optional()}).refine(s=>!s.alignment||s.alignment.ends.every(t=>t<=s.duration+.001),'Los tiempos de habla superan el audio.');
export const faceROISchema=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().positive().max(1),height:z.number().positive().max(1)}).strict().refine(r=>r.x+r.width<=1.000001&&r.y+r.height<=1.000001,'La región del rostro debe quedar dentro del cuadro.');
export const lipSyncProvenanceSchema=z.object({projectId:id,sceneId:id,lineId:id,sourceAssetId:id,audioAssetId:id,sourceSha256:sha,audioSha256:sha,outputSha256:sha,sourceFingerprint:sha,dialogue:dialogueSnapshotSchema,lineOffset:z.number().min(0).max(15),trimStart:z.number().nonnegative().max(86400),speed:z.number().min(.25).max(4),sceneDuration:z.number().positive().max(15),duration:z.number().positive().max(15.01),width:z.number().int().positive().max(16384),height:z.number().int().positive().max(16384),fps:z.number().positive().max(240),frames:z.number().int().positive().max(3600),model:text(150),modelRevision:text(100).optional(),codeRevision:text(100).optional(),createdAt:text(100),faceROI:faceROISchema.optional(),metrics:z.object({elapsedSeconds:z.number().nonnegative().optional(),peakMemoryBytes:z.number().nonnegative().optional(),mlxPeakMemoryBytes:z.number().nonnegative().optional(),mlxMemoryLimitBytes:z.number().nonnegative().optional(),memoryMeasurement:text(500).optional()}).optional()});
export const assetSchema = z.object({
  referenceSource:referenceSourceSchema.optional(),
  id, name: text(250), type: z.enum(['image', 'video', 'audio']), url: localUrl,
  mime: text(100), size: z.number().int().nonnegative(),
  googleVideo:googleVideoProvenanceSchema.optional(), voiceReference:voiceReferenceSchema.optional(), generation: generationProvenanceSchema.optional(), speech:speechProvenanceSchema.optional(), lipSync:lipSyncProvenanceSchema.optional(),
  enhancement: z.object({sourceAssetId:id,preset:z.enum(['clean','upscale','ai-4k']),method:z.enum(['ffmpeg-lanczos','realesrgan-ncnn']),createdAt:text(100),width:z.number().int().positive().max(16384),height:z.number().int().positive().max(16384),duration:z.number().positive().max(86400),fps:z.number().positive().max(240),
    model:text(100).optional(),version:text(100).optional(),modelSha256:z.string().regex(/^[a-f0-9]{64}$/i).optional(),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/i).optional(),outputSha256:z.string().regex(/^[a-f0-9]{64}$/i).optional(),strength:z.number().min(.15).max(.85).optional(),profile:aiProcessingProfileSchema.optional(),tile:z.number().int().positive().max(1024).optional(),temporalMode:text(150).optional(),
    metrics:z.object({wallSeconds:z.number().nonnegative().optional(),secondsPerFrame:z.number().nonnegative().optional(),peakChildRssBytes:z.number().nonnegative().optional(),peakWorkerRssBytes:z.number().nonnegative().optional(),memoryNote:text(500).optional(),qualityNote:text(500).optional(),maxRgbDifferenceBeforeEncoding:z.number().nonnegative().max(255).optional(),meanRgbDifferenceBeforeEncoding:z.number().nonnegative().max(255).optional(),temporal:temporalEnhancementMetricsSchema.optional()}).optional(),
  }).superRefine((value,ctx)=>validateAiProcessing({processingProfile:value.profile,strength:value.strength},ctx)).optional(),
});
const seconds = z.number().min(0).max(86400);
export const clipAudioSchema = z.object({ volume: z.number().min(0).max(1).optional(), muted: z.boolean().optional(), fadeIn: seconds.optional(), fadeOut: seconds.optional(), envelope:z.object({offset:z.number().min(-86400).max(86400),duration:seconds.positive()}).strict().optional() });
export const colorSchema = z.object({exposure:z.number().min(-2).max(2).optional(),contrast:z.number().min(.5).max(1.5).optional(),saturation:z.number().min(0).max(2).optional(),temperature:z.number().min(-1).max(1).optional()});
export const transformSchema = z.object({x:z.number().min(-100).max(100),y:z.number().min(-100).max(100),scale:z.number().min(.25).max(3),opacity:z.number().min(0).max(1)});
export const keyframeSchema = transformSchema.extend({id,time:z.number().min(-86400).max(86400),easing:z.enum(['linear','ease-in-out','hold'])});
const speedSchema = z.number().min(.25).max(4);
export const timelineClipSchema = clipAudioSchema.extend({ id, assetId: id, dialogueLineId:id.optional(), preserveAsset:z.boolean().optional(), sceneId: id, offset: seconds, duration: seconds.positive(), trimStart: seconds, opacity: z.number().min(0).max(1).optional(),color:colorSchema.optional(),speed:speedSchema.optional(),transform:transformSchema.partial().optional(),keyframes:z.array(keyframeSchema).max(100).optional() });
export const editorTrackSchema = z.object({ id, name: text(250), type: z.enum(['video', 'audio']), muted: z.boolean(), volume: z.number().min(0).max(1), locked:z.boolean().optional(), clips: z.array(timelineClipSchema).max(500) });
export const subtitleCueSchema = z.object({ id, sceneId: id, dialogueLineId:id.optional(), start: seconds, end: seconds, text: text(2000), characterId: id.optional(), sourceDialogue: text().optional() }).refine((cue) => cue.end > cue.start, 'El subtítulo debe terminar después de empezar.');
export const storyStructureSchema=z.object({sequences:z.array(z.object({id,title:text(250)})).max(100),scenes:z.array(z.object({id,sequenceId:id,title:text(250),setting:text(500),notes:text(2000)})).max(100)});
export const directionAlternativeSchema=z.object({id,name:text(120).min(1),prompt:text(),negativePrompt:text(),camera:text(250),cinematography:cinematographySchema.optional(),opening:text(1200),closing:text(1200)}).strict();
export const shotPlanningSchema=z.object({opening:text(1200).optional(),closing:text(1200).optional(),notes:text(4000).optional(),alternatives:z.array(directionAlternativeSchema).max(6).optional()}).strict();
export const sceneSchema = z.object({
  planning:shotPlanningSchema.optional(),
  storySceneId:id.optional(),
  id, title: text(250), description: text(), dialogue: text(), prompt: text(),
  negativePrompt: text(), duration: z.number().min(1).max(120),
  seed: z.number().int().min(0).max(2147483647), camera: text(250), cinematography: cinematographySchema.optional(),
  trimStart: z.number().min(0).max(86400).optional(),
  audio: clipAudioSchema.optional(),
  color: colorSchema.optional(), speed: speedSchema.optional(),
  look: z.enum(['original', 'noir', 'warm']).default('original'), transition: z.enum(['cut', 'fade', 'dissolve', 'dip']).default('cut'), transitionDuration: z.number().positive().max(2).optional(),
  continuity: z.record(id, continuityOverrideSchema).refine((value) => Object.keys(value).length <= 100, 'Máximo 100 estados de continuidad por plano.').optional(),
  characterIds: z.array(id).max(30), assetId: id.optional(), endAssetId: id.optional(), videoAssetId: id.optional(), takeAssetIds:z.array(id).max(2000).optional(), clearVideoAsset: z.boolean().optional(), preserveVideoAsset: z.boolean().optional(),
});
export const characterSchema = z.object({
  referenceAssetIds:z.array(id).max(12).optional(),states:z.array(z.object({id,name:text(120),values:continuityValuesSchema})).max(20).optional(),
  id, name: text(250), role: text(250), description: text(), locked: z.boolean(), voice:characterVoiceSchema.optional(), assetId: id.optional(), continuity: continuityValuesSchema.optional(),
});
export const clipGroupSchema=z.object({id,name:text(120).min(1),clipIds:z.array(id).min(2).max(500)}).strict();
export const markerSchema=z.object({id,sceneId:id,offset:seconds,title:text(120).min(1),kind:z.enum(['edit','continuity','dialogue','note']),note:text(2000),characterId:id.optional()}).strict();
export const libraryEntrySchema=z.object({tags:z.array(text(40).min(1)).max(24),favorite:z.boolean(),sha256:sha.optional(),fileSize:z.number().int().nonnegative().optional(),observedAt:text(100).optional(),imported:z.object({name:text(250),at:text(100)}).strict().optional(),reconnections:z.array(z.object({name:text(250),at:text(100),sha256:sha}).strict()).max(20).optional()}).strict();
export const projectSchema = z.object({
  adaptation:adaptationSchema.optional(),
  production:productionSchema.optional(),
  library:z.record(id,libraryEntrySchema).refine(r=>Object.keys(r).length<=2000).optional(),
  audioMix:z.object({normalize:z.boolean(),targetLufs:z.number().min(-24).max(-9),truePeakDb:z.number().min(-3).max(-1),ducking:z.boolean(),reductionDb:z.number().min(3).max(30),attack:z.number().min(.05).max(2),release:z.number().min(.1).max(3),musicTrackIds:z.array(id).max(8)}).strict().optional(),
  subtitleStyle:z.object({preset:z.enum(['classic','paper','amber']),size:z.number().min(1.5).max(5),position:z.enum(['bottom','top']),safeMargin:z.number().min(5).max(20)}).strict().optional(),
  clipGroups:z.array(clipGroupSchema).max(100).optional(),markers:z.array(markerSchema).max(1000).optional(),
  story:storyStructureSchema.optional(),
  id, name: text(250), logline: text(), format: z.enum(PROJECT_FORMATS).default(DEFAULT_PROJECT_FORMAT),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(48), z.literal(50), z.literal(60)]).default(DEFAULT_PROJECT_FPS),
  aiFinishing: z.object({enabled:z.boolean(),strength:z.number().min(.15).max(.85).optional(),processingProfile:aiProcessingProfileSchema.optional()}).superRefine(validateAiProcessing).transform(value=>({...value,strength:value.strength??(value.processingProfile==='temporal'?.65:value.processingProfile==='restore'?.75:.35)})).optional(),
  scenes: z.array(sceneSchema).max(100), characters: z.array(characterSchema).max(100),
  assets: z.array(assetSchema).max(2000), audioAssetId: id.optional(), audioVolume: z.number().min(0).max(2).optional(), audioMuted:z.boolean().optional(), updatedAt: z.string().max(100),
  tracks: z.array(editorTrackSchema).max(8).optional(), dialogueLines:z.array(dialogueLineSchema).max(1000).optional(), subtitleCues: z.array(subtitleCueSchema).max(1000).optional(), subtitlesEnabled: z.boolean().optional(),
}).superRefine((project, ctx) => {
  const clips = (project.tracks ?? []).flatMap((track) => track.clips);
  if (clips.length > 500) ctx.addIssue({ code: 'custom', path: ['tracks'], message: 'Máximo 500 clips adicionales por proyecto.' });
  for (const [index, track] of (project.tracks ?? []).entries()) for (const [clipIndex, clip] of track.clips.entries()) if (Math.round(clip.duration * project.fps) < 1) ctx.addIssue({ code: 'custom', path: ['tracks', index, 'clips', clipIndex, 'duration'], message: 'El clip debe durar al menos un fotograma.' });
  for (const [index, cue] of (project.subtitleCues ?? []).entries()) if (Math.round(cue.end * project.fps) <= Math.round(cue.start * project.fps)) ctx.addIssue({ code: 'custom', path: ['subtitleCues', index], message: 'El subtítulo debe durar al menos un fotograma.' });
  if (clips.reduce((sum,clip)=>sum+(clip.keyframes?.length??0),0)>2000) ctx.addIssue({code:'custom',path:['tracks'],message:'Máximo 2.000 fotogramas clave por película.'});
  for (const [trackIndex,track] of (project.tracks??[]).entries()) for (const [clipIndex,clip] of track.clips.entries()) {
    const keys=clip.keyframes??[], frames=keys.map(key=>Math.round(key.time*project.fps));
    if(new Set(keys.map(key=>key.id)).size!==keys.length||new Set(frames).size!==frames.length) ctx.addIssue({code:'custom',path:['tracks',trackIndex,'clips',clipIndex,'keyframes'],message:'Cada fotograma clave necesita un identificador y un tiempo únicos.'});
  }
});
export type Asset = z.infer<typeof assetSchema>;
export type Project = z.infer<typeof projectSchema>;

/** Shared by normal saves and archive imports; no storage or URL trust is implied. */
export function validateEditingReferences(project: Project) {
  const tracks = project.tracks ?? [], clips = tracks.flatMap((track) => track.clips), cues = project.subtitleCues ?? [];
  const fail = (message: string): never => { throw Object.assign(new Error(message), { status: 400 }); };
  for (const group of [tracks, clips, cues, project.dialogueLines??[],project.clipGroups??[],project.markers??[]]) if (new Set(group.map((item) => item.id)).size !== group.length) fail('Los identificadores de pistas, clips y subtítulos deben ser únicos en su grupo.');
  if(project.audioMix&&(new Set(project.audioMix.musicTrackIds).size!==project.audioMix.musicTrackIds.length||project.audioMix.musicTrackIds.some(id=>!tracks.some(t=>t.id===id&&t.type==='audio'))))fail('Las pistas de música deben ser pistas de audio existentes y únicas.');
  const scenes = new Set(project.scenes.map((scene) => scene.id)), characters = new Set(project.characters.map((character) => character.id));
  const grouped=new Set<string>(),clipIds=new Set(clips.map(c=>c.id));for(const group of project.clipGroups??[])for(const key of group.clipIds){if(!clipIds.has(key)||grouped.has(key))fail('Cada clip de grupo debe existir y pertenecer a un solo grupo.');grouped.add(key)}
  for(const marker of project.markers??[]){if(!scenes.has(marker.sceneId)||marker.characterId&&!characters.has(marker.characterId))fail('El marcador debe conservar un plano y personaje existentes.');}
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  for(const shot of project.scenes){const alts=shot.planning?.alternatives??[];if(new Set(alts.map(a=>a.id)).size!==alts.length)fail('Cada alternativa de dirección necesita un identificador único dentro de su plano.');}
  const sequences=project.story?.sequences??[],storyScenes=project.story?.scenes??[];
  for(const group of [sequences,storyScenes])if(new Set(group.map(x=>x.id)).size!==group.length)fail('La estructura narrativa contiene identificadores repetidos.');
  for(const scene of storyScenes)if(!sequences.some(s=>s.id===scene.sequenceId))fail('Una escena narrativa pertenece a una secuencia inexistente.');
  for(const shot of project.scenes)if(shot.storySceneId&&!storyScenes.some(s=>s.id===shot.storySceneId))fail('Un plano pertenece a una escena narrativa inexistente.');
  for(const character of project.characters){
    const refs=character.referenceAssetIds??[],states=character.states??[];
    if(new Set(refs).size!==refs.length||refs.some(id=>assets.get(id)?.type!=='image'))fail('Las referencias de apoyo deben ser imágenes únicas de la biblioteca.');
    if(new Set(states.map(s=>s.id)).size!==states.length)fail('Los estados de un elemento necesitan identificadores únicos.');
  }
  for(const asset of project.assets)if(asset.voiceReference){const meta=asset.voiceReference;if(asset.type!=='audio'||meta.projectId!==project.id||assets.get(meta.sourceAssetId)?.type!=='audio'||meta.sourceAssetId===asset.id)fail('Un perfil de voz debe conservar su audio original en esta película.');}
  for(const character of project.characters)if(character.voice?.engine==='qwen'&&character.voice.referenceAssetId&&assets.get(character.voice.referenceAssetId)?.voiceReference?.characterId!==character.id)fail('El perfil de voz pertenece a otro personaje. Crea una referencia propia para este personaje.');
  const voices=[...project.characters.map(character=>character.voice),...(project.dialogueLines??[]).map(line=>line.voice)];
  for(const voice of voices)if(voice?.engine==='qwen'&&voice.referenceAssetId){
    const asset=assets.get(voice.referenceAssetId),meta=asset?.voiceReference;
    if(asset?.type!=='audio'||!meta||meta.projectId!==project.id||meta.outputSha256!==voice.referenceSha256||voice.voiceId!==`profile-${asset.id}`)fail('La referencia de voz Qwen no corresponde a un perfil conservado en esta película.');
  }
  for (const track of tracks) for (const clip of track.clips) {
    if (!scenes.has(clip.sceneId)) fail('Un clip de pista hace referencia a un plano inexistente.');
    if(clip.dialogueLineId){const line=project.dialogueLines?.find(l=>l.id===clip.dialogueLineId);if(!line)fail('Una voz de pista hace referencia a una intervención inexistente.');}
    const asset = assets.get(clip.assetId);
    if (!asset || (track.type === 'audio' ? asset.type !== 'audio' : !['video', 'image'].includes(asset.type))) fail('El recurso de un clip no corresponde al tipo de su pista.');
  }
  for(const line of project.dialogueLines??[]){
    const scene=project.scenes.find(s=>s.id===line.sceneId);
    if(!scene)fail('Una intervención hace referencia a un plano inexistente.');
    if(line.characterId&&!characters.has(line.characterId))fail('Una intervención hace referencia a un personaje inexistente.');
    if(line.audioAssetId&&assets.get(line.audioAssetId)?.type!=='audio')fail('La voz elegida debe ser un audio de la biblioteca.');
  }
  for (const cue of cues) {
    if (!scenes.has(cue.sceneId)) fail('Un subtítulo hace referencia a un plano inexistente.');
    if (cue.characterId && !characters.has(cue.characterId)) fail('Un subtítulo hace referencia a un personaje inexistente.');
    if(cue.dialogueLineId&&!project.dialogueLines?.some(l=>l.id===cue.dialogueLineId))fail('Un subtítulo hace referencia a una intervención inexistente.');
  }
}
export type Job = {
  context?:{projectId?:string;projectName?:string;sceneId?:string;sceneTitle?:string;assetId?:string;assetName?:string};
  id: string; type: 'generate' | 'export' | 'codex' | 'runtime' | 'enhance' | 'continuity' | 'speech' | 'lipsync' | 'proxy' | 'audio' | 'library' | 'google-video' | 'google-browser';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number; message: string; createdAt: string; updatedAt: string;
  result?: {sourceDocumentId?:string; adaptation?:{projectId:string;fingerprint:string;proposal:import('../src/adaptation').AdaptationProposal}; references?:{summary:string;sources:{title:string;creator:string;pageUrl:string;description:string}[]}; qualityReportId?:string;clientRequestId?:string;lineId?:string;stale?:boolean; sceneId?:string;seed?:number;variantIndex?:number;variantCount?:number;continuityReportId?:string;continuityFingerprint?:string; text?: string; assetId?: string; originalAssetId?:string; projectId?:string; finishing?:FinishingSummary; url?: string; filename?: string; proposal?: { projectId: string; scenes: Project['scenes'] } };
};
