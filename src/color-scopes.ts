/** Display-referred Rec.709-weighted luma on decoded 8-bit RGB, not scene light/IRE. */
export type ColorScopes={pixels:number;histogram:number[][];waveform:number[];parade:number[];shadowPercent:number;highlightPercent:number;meanRgb:number[];meanLuma:number;width:128;height:128};
export function computeColorScopes(rgba:Uint8Array,width:number,height:number):ColorScopes{
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>640*640||rgba.length!==width*height*4)throw new Error('La muestra de color debe contener RGBA de hasta 640 × 640.');
 const histogram=Array.from({length:4},()=>Array<number>(256).fill(0)),waveform=Array<number>(128*128).fill(0),parade=Array<number>(384*128).fill(0),sum=[0,0,0];let shadows=0,highlights=0,lumaTotal=0;
 for(let i=0;i<width*height;i++){
  const rgb=[rgba[i*4]!,rgba[i*4+1]!,rgba[i*4+2]!],luma=Math.round(.2126*rgb[0]!+.7152*rgb[1]!+.0722*rgb[2]!),x=Math.min(127,Math.floor(i%width*128/width));
  histogram[3]![luma]!++;lumaTotal+=luma;waveform[(127-Math.floor(luma/2))*128+x]!++;
  rgb.forEach((v,c)=>{histogram[c]![v]!++;sum[c]!+=v;parade[(127-Math.floor(v/2))*384+c*128+x]!++});
  if(rgb.every(v=>v<=2))shadows++;if(rgb.some(v=>v>=253))highlights++;
 }
 const count=width*height;return{pixels:count,histogram,waveform,parade,shadowPercent:shadows/count*100,highlightPercent:highlights/count*100,meanRgb:sum.map(s=>s/count),meanLuma:lumaTotal/count,width:128,height:128};
}
