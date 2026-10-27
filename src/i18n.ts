import english from './locales/en.json';
let language:'es'|'en'='es';
export const setLanguage=(value:'es'|'en')=>{language=value};
export function t(value:string):string{return language==='en'?(english as Record<string,string>)[value]||value:value}
export function tf(value:string,values:unknown[]):string{return t(value).replace(/\{(\d+)\}/g,(_match,index)=>String(values[Number(index)]??''))}
export const tr=(spanish:string,english:string)=>language==='en'?english:spanish;
