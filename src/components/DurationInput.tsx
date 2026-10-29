import {tr} from '../i18n';
import {RECOMMENDED_GENERATION_SECONDS,generationDurationMaximum} from '../generation-profile';
import CommitNumberInput from './CommitNumberInput';

type Props={model:string;value:number;onChange:(value:number)=>void;label?:string;ariaLabel?:string;disabled?:boolean;onValidityChange?:(valid:boolean)=>void};
export default function DurationInput({model,value,onChange,label='Duración de la toma',ariaLabel,onValidityChange,disabled=false}:Props){
 const max=generationDurationMaximum(model);
 return <CommitNumberInput displayDecimals={3} disabled={disabled} value={value} min={1} max={max} label={label} ariaLabel={ariaLabel} unit="s" onCommit={onChange} onValidityChange={onValidityChange} hint={tr(`De 1 a ${max} s; admite decimales. Confirma con Enter o al salir del campo.`,`From 1 to ${max} s; decimals allowed. Confirm with Enter or when leaving the field.`)} recommendedLabel={tr(`Usar ${RECOMMENDED_GENERATION_SECONDS} s · recomendado`,`Use ${RECOMMENDED_GENERATION_SECONDS} s · recommended`)} recommendedValue={RECOMMENDED_GENERATION_SECONDS}/>;
}
