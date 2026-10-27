export async function api<T = any>(url:string, body?:unknown, method?:string):Promise<T>{
 const res=await fetch(`/api${url}`,{method:method||(body?'POST':'GET'),headers:body instanceof FormData?{'X-Filmma-Client':'filmma'}:{'Content-Type':'application/json','X-Filmma-Client':'filmma'},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
 const data=await res.json().catch(()=>({error:'Respuesta no válida del estudio local.'}));
 if(!res.ok)throw new Error(typeof data.error==='string'?data.error:data.error?.message||data.message||'No se pudo completar la acción.');
 return data;
}
