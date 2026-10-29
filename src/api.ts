import {tr} from './i18n';

export async function api<T = any>(url:string, body?:unknown, method?:string):Promise<T>{
 const payload=body instanceof FormData?body:body?JSON.stringify(body):undefined;
 let res:Response;
 try{res=await fetch(`/api${url}`,{method:method||(body?'POST':'GET'),headers:body instanceof FormData?{'X-Filmma-Client':'filmma'}:{'Content-Type':'application/json','X-Filmma-Client':'filmma'},body:payload});}
 catch(error){if(error instanceof TypeError||(error instanceof Error&&error.name==='NetworkError'))throw new Error(tr('No se pudo conectar con Filmma. Comprueba que el estudio esté abierto y vuelve a intentarlo.','Could not connect to Filmma. Make sure the studio is running and try again.'));throw error;}
 const data=await res.json().catch(()=>({error:'Respuesta no válida del estudio local.'}));
 if(!res.ok)throw new Error(typeof data.error==='string'?data.error:data.error?.message||data.message||'No se pudo completar la acción.');
 return data;
}
