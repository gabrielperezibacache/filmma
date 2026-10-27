import type {Asset,Project,Scene} from './types';

export const H3_LONG_PROFILE='h3-long-ssd' as const;
export const H3_NATIVE_PROFILE='h3-native-ssd' as const;
export const H3_HD_PROFILE='h3-hd-ssd' as const;
export const H3_NATIVE_MAX_FRAMES=345;
export const H3_NATIVE_MAX_VIDEO_TOKENS=35000;
export const H3_HD_MAX_FRAMES=345;
export const H3_HD_MAX_VIDEO_TOKENS=93840;
export type NativeResolution='standard'|'balanced'|'detail'|'hd720';
export const RECOMMENDED_GENERATION_SECONDS=3;
export const generationDurationMaximum=(model:string)=>model==='minimax-h3'?15:4;
export const generationDurationChoices=(model:string)=>model==='minimax-h3'?[1,2,3,4,8,12,15]:[1,2,3,4];
export const secondsLabel=(seconds:number)=>new Intl.NumberFormat('es-CL',{maximumFractionDigits:3}).format(seconds);

export type H3LongValidation={status?:string;model?:string;mode?:string;outputAvailable?:boolean;recordedAt?:number;modelRevision?:string;runtimeRevision?:string;parameters?:{width?:number;height?:number;numFrames?:number;fps?:number;steps?:number;memoryProfile?:string}};

/** Only the current local runtime evidence can confirm this tested long profile. */
export function longProfileValidationMessage(validation?:H3LongValidation|readonly H3LongValidation[]|null,selection?:{memoryProfile?:string;width:number;height:number;numFrames:number;steps:number;fps?:number}){
 const expected=selection??{memoryProfile:H3_LONG_PROFILE,width:512,height:320,numFrames:345,steps:20,fps:24};
 const records:readonly H3LongValidation[]=Array.isArray(validation)?validation:validation?[validation as H3LongValidation]:[];
 const verified=records.some(record=>{const parameters=record.parameters;return record.status==='media-verified'&&record.outputAvailable!==false&&record.model==='minimax-h3'&&record.mode==='text-to-video'&&!!parameters&&!!expected.memoryProfile&&
  parameters.memoryProfile===expected.memoryProfile&&parameters.width===expected.width&&parameters.height===expected.height&&
  parameters.numFrames===expected.numFrames&&parameters.fps===(expected.fps??24)&&parameters.steps===expected.steps;});
 if(selection)return verified?`Prueba de ${secondsLabel(expected.numFrames/(expected.fps??24))} s a ${expected.width} × ${expected.height} completada en este Mac.`:expected.memoryProfile===H3_HD_PROFILE?'Todavía sin prueba verificada de esta duración en este Mac.':'Sin una prueba verificada de esta resolución, duración y pasos en este Mac.';
 return verified?'Prueba de 14,375 s completada en este Mac.':'Sin una prueba larga verificada en el diagnóstico de este Mac.';
}

/** Native dimensions stay within the memory profile. The final canvas uses the
 * project's exact aspect ratio; any native mismatch is fitted without cropping. */
export function generationDimensions(format:string,long:boolean,quality:string,nativeResolution:NativeResolution='standard'){
 const detail=nativeResolution==='detail',balanced=nativeResolution==='balanced',hd=nativeResolution==='hd720';
 const existing=hd?{'16:9':[1280,736],'9:16':[736,1280],'1:1':[960,960]}:detail?{'16:9':[1024,576],'9:16':[576,1024],'1:1':[768,768]}:balanced?{'16:9':[768,448],'9:16':[448,768],'1:1':[576,576]}:long?{'16:9':[512,320],'9:16':[320,512],'1:1':[384,384]}:
  quality==='quality'?{'16:9':[768,448],'9:16':[448,768],'1:1':[640,640]}:
  {'16:9':[512,288],'9:16':[288,512],'1:1':[512,512]};
 const known=existing[format as keyof typeof existing];
 if(known)return {width:known[0],height:known[1]};
 const ratio=({'4:3':4/3,'4:5':4/5,'2.39:1':2.39} as Record<string,number>)[format]??16/9;
 const maxSide=hd?1280:detail?1024:balanced?768:long||quality!=='quality'?512:768;
 const maxArea=hd?1280*736:detail?1024*576:balanced?768*448:long?512*320:quality==='quality'?864*480:512*512;
 const width=Math.min(maxSide,maxSide*ratio,Math.sqrt(maxArea*ratio));
 const height=width/ratio;
 return {width:Math.max(256,Math.floor(width/32)*32),height:Math.max(256,Math.floor(height/32)*32)};
}

/** Same aligned-frame visual-token budget as the supervised runtime. */
export function h3NativeVideoTokens(width:number,height:number,numFrames:number){return (2+5*((numFrames-5)/17))*(width/32)*(height/32)}
export function h3NativeMaximumFrames(width:number,height:number){
 let maximum=22;
 for(let frames=22;frames<=H3_NATIVE_MAX_FRAMES;frames+=17){if(h3NativeVideoTokens(width,height,frames)>H3_NATIVE_MAX_VIDEO_TOKENS)break;maximum=frames}
 return maximum;
}

/** The source take and montage are independent. Always round the native frame
 * clock down: a requested duration cap must never become extra generated frames. */
export function generationPreview(model:string,requested:number,_sceneDuration:number,format:string,quality:string,longSteps=20,nativeResolution:NativeResolution='standard'){
 const long=model==='minimax-h3'&&requested>4;
 const native=model==='minimax-h3'&&nativeResolution!=='standard',supervised=long||native;
 const limit=Math.max(1,Math.min(generationDurationMaximum(model),requested));
 const frames=Math.floor(limit*24+1e-8);
 const numFrames=model==='minimax-h3'?Math.max(22,5+17*Math.floor((frames-5)/17)):Math.max(9,1+8*Math.floor((frames-1)/8));
 const size=generationDimensions(format,long,quality,native?nativeResolution:'standard');
 const hdLong=native&&nativeResolution==='hd720'&&(format==='16:9'||format==='9:16')&&numFrames>124;
 const maximumNativeFrames=hdLong?H3_HD_MAX_FRAMES:h3NativeMaximumFrames(size.width,size.height),maximumNativeSeconds=maximumNativeFrames/24;
 const videoTokens=h3NativeVideoTokens(size.width,size.height,numFrames);
 const blockedReason=native&&(numFrames>maximumNativeFrames||videoTokens>(hdLong?H3_HD_MAX_VIDEO_TOKENS:H3_NATIVE_MAX_VIDEO_TOKENS))?`A ${size.width} × ${size.height}, el presupuesto de memoria admite hasta ${secondsLabel(maximumNativeSeconds)} s nativos (${maximumNativeFrames} fotogramas). ${nativeResolution==='hd720'?'El perfil HD largo sólo admite 16:9 o 9:16. ':''}Reduce la duración o elige otra resolución. No se cambiarán automáticamente.`:undefined;
 return {long,native,hdLong,supervised,blockedReason,limit,numFrames,seconds:numFrames/24,fps:24,...size,maximumNativeFrames,maximumNativeSeconds,videoTokens,steps:native?20:long?Math.max(2,Math.min(20,Math.round(longSteps))):model==='minimax-h3'&&quality==='quality'?20:4,...(supervised?{memoryProfile:hdLong?H3_HD_PROFILE:native?H3_NATIVE_PROFILE:H3_LONG_PROFILE}:{})};
}

/** Preserve the native clock before generation. Rounding a 24 fps source down
 * to a 25/30 fps montage would lower the next native frame group on every click. */
export function generationMontageDuration(preview:{seconds:number}){
 return Number.isFinite(preview.seconds)&&preview.seconds>=1?preview.seconds:undefined;
}

export function longProfileReferenceConflict(scene:Scene,project:Project){
 return !!(scene.assetId||scene.endAssetId||project.characters.some(character=>scene.characterIds.includes(character.id)&&character.assetId));
}

export function knownVideoDuration(asset?:Asset){
 if(asset?.type!=='video')return undefined;
 return asset.enhancement?.duration??asset.lipSync?.duration??(asset.generation?asset.generation.numFrames/asset.generation.fps:undefined);
}
export function sourceCoverage(scene:Scene,duration:number,fps:number){
 const speed=Math.max(.25,Math.min(4,scene.speed??1));
 const available=Math.max(0,(duration-(scene.trimStart??0))/speed);
 const fitted=Math.floor(available*fps+1e-7)/fps;
 return {available,fitted,short:Math.round(scene.duration*fps)>Math.floor(available*fps+1e-7),canFit:fitted>=1};
}
