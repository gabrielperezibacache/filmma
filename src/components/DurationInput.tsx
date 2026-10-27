import {RECOMMENDED_GENERATION_SECONDS,generationDurationMaximum} from '../generation-profile';
import CommitNumberInput from './CommitNumberInput';

type Props={model:string;value:number;onChange:(value:number)=>void;label?:string;ariaLabel?:string;onValidityChange?:(valid:boolean)=>void};
export default function DurationInput({model,value,onChange,label='Duración de la toma',ariaLabel,onValidityChange}:Props){
 const max=generationDurationMaximum(model);
 return <CommitNumberInput value={value} min={1} max={max} label={label} ariaLabel={ariaLabel} unit="s" onCommit={onChange} onValidityChange={onValidityChange} hint={`De 1 a ${max} s. Admite decimales.`} recommendedValue={RECOMMENDED_GENERATION_SECONDS}/>;
}
