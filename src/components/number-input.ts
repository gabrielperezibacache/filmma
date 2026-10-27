export type NumberDraftResult={valid:true;value:number}|{valid:false;error:string};

/** A blank or unfinished edit is never committed as zero or a lower bound. */
export function parseNumberDraft(draft:string,min:number,max:number,integer=false):NumberDraftResult{
 const normalized=draft.trim().replace(',','.');
 if(!normalized)return {valid:false,error:'Escribe un valor antes de continuar.'};
 if(!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized))return {valid:false,error:'Escribe un número; puedes usar coma o punto decimal.'};
 const value=Number(normalized);
 if(!Number.isFinite(value))return {valid:false,error:'Escribe un número válido.'};
 if(value<min||value>max)return {valid:false,error:`Elige un valor entre ${min} y ${max}.`};
 if(integer&&!Number.isInteger(value))return {valid:false,error:'Escribe un número entero.'};
 return {valid:true,value};
}
