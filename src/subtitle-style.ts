import type {Project} from './types';
export type SubtitleStyle={preset:'classic'|'paper'|'amber';size:number;position:'bottom'|'top';safeMargin:number};
export const DEFAULT_SUBTITLE_STYLE:SubtitleStyle={preset:'classic',size:2.5,position:'bottom',safeMargin:6};
export const subtitleStyle=(p:Pick<Project,'subtitleStyle'>):SubtitleStyle=>({...DEFAULT_SUBTITLE_STYLE,...p.subtitleStyle});
export const subtitlePalette={classic:{text:'#ffffff',plate:'#000000',alpha:.72},paper:{text:'#171a19',plate:'#eceee5',alpha:.94},amber:{text:'#ffe2a3',plate:'#171a19',alpha:.88}};
export const captionReading=(text:string,seconds:number)=>({charactersPerSecond:seconds>0?Array.from(text.replace(/\s+/g,' ').trim()).length/seconds:0,words:text.trim()?text.trim().split(/\s+/).length:0});
