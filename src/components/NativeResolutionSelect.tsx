import {generationDimensions,type NativeResolution} from '../generation-profile';
import {tr} from '../i18n';

type Props={value:NativeResolution;onChange:(value:NativeResolution)=>void;disabled?:boolean;format?:string;quality?:string;long?:boolean};
export default function NativeResolutionSelect({value,onChange,disabled=false,format='16:9',quality='quality',long=false}:Props){
 const names={standard:tr('estándar según perfil','standard by profile'),balanced:tr('equilibrada · experimental','balanced · experimental'),detail:tr('detalle · experimental','detail · experimental'),hd720:tr('HD · experimental','HD · experimental')};
 return <label className="field native-resolution-select"><span>{tr('Resolución del original','Original resolution')}</span><select aria-label={tr('Resolución del original','Original resolution')} value={value} onChange={event=>onChange(event.target.value as NativeResolution)} disabled={disabled}>{(Object.keys(names) as NativeResolution[]).map(option=>{const size=generationDimensions(format,long,quality,option);return <option value={option} key={option}>{size.width} × {size.height} · {names[option]}</option>})}</select><small>{tr('Son los píxeles que crea MiniMax, antes del reescalado. Más resolución requiere más memoria.','These are the pixels MiniMax creates before upscaling. Higher resolution needs more memory.')}{value==='hd720'&&format==='16:9'&&tr(' La fuente HD mide 1280 × 736 por alineación del modelo.',' The HD source is 1280 × 736 because of model alignment.')}</small></label>;
}
