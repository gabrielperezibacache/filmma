import type {Asset} from './types';

export type ReviewDimensions={width:number;height:number};
export type ReviewZoom='fit'|'100'|'200';

export function reviewDimensions(width?:number,height?:number):ReviewDimensions|null{
 return typeof width==='number'&&typeof height==='number'&&Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0
  ?{width:Math.round(width),height:Math.round(height)}:null;
}

/** The video metadata wins over saved provenance if the two disagree. */
export function reviewSourceDimensions(asset:Asset,measured:ReviewDimensions|null):ReviewDimensions|null{
 return measured??reviewDimensions(asset.enhancement?.width??asset.generation?.width,asset.enhancement?.height??asset.generation?.height);
}

/** Native review sizes never depend on the available viewport width. */
export function reviewCanvas(output:ReviewDimensions|null,viewport:ReviewDimensions,zoom:ReviewZoom):ReviewDimensions{
 if(zoom==='fit'||!output)return viewport;
 const scale=zoom==='200'?2:1;
 return {width:output.width*scale,height:output.height*scale};
}
