import {useId} from 'react';
import {RotateCcw} from 'lucide-react';
import type {ColorAdjustments} from '../types';
import './finishing.css';

const settings = [
  {key:'exposure',label:'Exposición',min:-2,max:2,step:.05,initial:0,unit:' EV'},
  {key:'contrast',label:'Contraste',min:.5,max:1.5,step:.01,initial:1,unit:'×'},
  {key:'saturation',label:'Saturación',min:0,max:2,step:.01,initial:1,unit:'×'},
  {key:'temperature',label:'Temperatura',min:-1,max:1,step:.05,initial:0,unit:''},
] as const;

export default function ColorControls({color,onChange,label='Corrección de color'}:{color?:ColorAdjustments;onChange:(color:ColorAdjustments)=>void;label?:string}) {
  const id=useId();
  const changed=settings.some(item=>(color?.[item.key]??item.initial)!==item.initial);
  return <fieldset className="color-controls"><legend>{label}</legend>
    {settings.map(item=><div className="color-control" key={item.key}>
      <label htmlFor={`${id}-${item.key}`}>{item.label}</label><output htmlFor={`${id}-${item.key}`}>{(color?.[item.key]??item.initial).toFixed(2)}{item.unit}</output>
      <input id={`${id}-${item.key}`} type="range" min={item.min} max={item.max} step={item.step} value={color?.[item.key]??item.initial} onChange={e=>onChange({...color,[item.key]:Number(e.target.value)})}/>
    </div>)}
    <button className="text-button" disabled={!changed} onClick={()=>onChange({})}><RotateCcw size={14}/>Restablecer color</button>
  </fieldset>;
}
