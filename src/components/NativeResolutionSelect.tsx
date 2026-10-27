import type {NativeResolution} from '../generation-profile';

type Props={value:NativeResolution;onChange:(value:NativeResolution)=>void;disabled?:boolean};
export default function NativeResolutionSelect({value,onChange,disabled=false}:Props){
 return <label className="field native-resolution-select"><span>Resolución nativa</span><select value={value} onChange={event=>onChange(event.target.value as NativeResolution)} disabled={disabled}><option value="standard">Estándar</option><option value="balanced">Equilibrada · hasta 768 px · experimental</option><option value="detail">Mayor detalle · hasta 1024 px · experimental</option><option value="hd720">HD720 · fuente 1280 × 736 · experimental</option></select><small>Dimensiones generadas por MiniMax. La resolución de exportación se elige por separado.{value==='hd720'&&' En 16:9, el original conserva 1280 × 736; la exportación 720p ajusta el encuadre sin recortar.'}</small></label>;
}
