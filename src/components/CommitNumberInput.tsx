import {useEffect,useId,useRef,useState} from 'react';
import {parseNumberDraft} from './number-input';
import './number-input.css';

type Props={value:number;min:number;max:number;onCommit:(value:number)=>void;label:string;ariaLabel?:string;unit?:string;hint?:string;integer?:boolean;normalize?:(value:number)=>number;recommendedValue?:number;recommendedLabel?:string;onValidityChange?:(valid:boolean)=>void;className?:string;disabled?:boolean};

export default function CommitNumberInput({value,min,max,onCommit,label,ariaLabel,unit,hint,integer=false,normalize,recommendedValue,recommendedLabel,onValidityChange,className='',disabled=false}:Props){
 const id=useId(),[draft,setDraft]=useState(String(value)),[error,setError]=useState('');
 const validityCallback=useRef(onValidityChange);validityCallback.current=onValidityChange;
 useEffect(()=>{setDraft(String(value));setError('');validityCallback.current?.(parseNumberDraft(String(value),min,max,integer).valid);},[value,min,max,integer]);
 const commit=()=>{
  const result=parseNumberDraft(draft,min,max,integer);
  validityCallback.current?.(result.valid);
  if(!result.valid){setError(result.error);return false;}
  // Focusing a native duration must not quantize it to a different montage clock.
  if(result.value===value){setError('');setDraft(String(value));return true;}
  const committed=normalize?normalize(result.value):result.value;
  const checked=parseNumberDraft(String(committed),min,max,integer);
  if(!checked.valid){setError(checked.error);validityCallback.current?.(false);return false;}
  setError('');setDraft(String(committed));
  if(committed!==value)onCommit(committed);
  return true;
 };
 const restore=()=>{setDraft(String(value));setError('');validityCallback.current?.(parseNumberDraft(String(value),min,max,integer).valid);};
 return <div className={`commit-number ${className}`}>
  <label htmlFor={id}><span>{label}</span></label>
  <div className="commit-number-control"><input id={id} aria-label={ariaLabel} type="text" inputMode={integer?'numeric':'decimal'} value={draft} disabled={disabled} autoComplete="off" spellCheck={false} aria-invalid={!!error} aria-describedby={`${id}-help${error?` ${id}-error`:''}`} onChange={event=>{const next=event.target.value;setDraft(next);setError('');validityCallback.current?.(parseNumberDraft(next,min,max,integer).valid);}} onBlur={commit} onKeyDown={event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'){event.preventDefault();if(!commit())event.stopPropagation();}if(event.key==='Enter'){event.preventDefault();commit();}if(event.key==='Escape'){event.preventDefault();restore();}}}/>{unit&&<span aria-hidden="true">{unit}</span>}</div>
  <div id={`${id}-help`} className="commit-number-help">{hint&&<span>{hint}</span>}{recommendedValue!==undefined&&<button type="button" className="text-button" disabled={disabled} onClick={()=>{setDraft(String(recommendedValue));setError('');validityCallback.current?.(true);onCommit(recommendedValue);}}>{recommendedLabel??`Usar ${recommendedValue}${unit?` ${unit}`:''} · recomendado`}</button>}</div>
  {error&&<p id={`${id}-error`} className="commit-number-error" role="alert">{error} Se conserva {value}{unit?` ${unit}`:''}.</p>}
 </div>;
}
