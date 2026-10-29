export type LicensedImage={pageId:number;title:string;creator:string;pageUrl:string;imageUrl:string;license:string;licenseUrl:string;width:number;height:number;size:number};
const plain=(s:unknown)=>String(s??'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').trim().slice(0,500);
export function commonsImage(page:any):LicensedImage|undefined{
 const info=page.imageinfo?.[0],meta=info?.extmetadata;if(!info||!meta)return;const license=plain(meta.LicenseShortName?.value),creator=plain(meta.Artist?.value),licenseUrl=String(meta.LicenseUrl?.value??'');
 if(!creator||/^(unknown|unknown author|author unknown|anonymous|desconocido|autor desconocido|anónimo)(?:\s|$)/i.test(creator)||!license||!/^(CC0|CC BY(?:-SA)?(?: \d\.\d)?|Public domain)$/i.test(license)||!/^https:\/\/(?:creativecommons\.org|commons\.wikimedia\.org)\//.test(licenseUrl)||!/^https:\/\/upload\.wikimedia\.org\//.test(info.url)||!/^image\/(jpeg|png|webp)$/.test(info.mime)||info.size>20*1024**2)return;
 return {pageId:page.pageid,title:plain(page.title).replace(/^File:/,''),creator,pageUrl:info.descriptionurl,imageUrl:info.url,license,licenseUrl,width:info.width,height:info.height,size:info.size};
}
export async function licensedImages(query:string,pageId?:number,fetcher:typeof fetch=fetch){
 const url=new URL('https://commons.wikimedia.org/w/api.php');const params={action:'query',format:'json',prop:'imageinfo',iiprop:'url|size|mime|extmetadata',...(pageId?{pageids:String(pageId)}:{generator:'search',gsrsearch:query,gsrnamespace:'6',gsrlimit:'12'})};Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
 const result=await fetcher(url,{headers:{'User-Agent':'Filmma/0.16 (local filmmaking reference library)'},signal:AbortSignal.timeout(20000)});if(!result.ok)throw new Error('No se pudo consultar Wikimedia Commons. Inténtalo más tarde.');const data:any=await result.json();if(data.error)throw new Error('La búsqueda de referencias no está disponible.');return Object.values(data.query?.pages??{}).map(commonsImage).filter((i):i is LicensedImage=>!!i);
}
/** Optional discovery connector. It never supplies licensing proof or imports images. */
export async function firecrawlReferences(query:string,fetcher:typeof fetch=fetch){
 const key=process.env.FIRECRAWL_API_KEY;if(!key)return [];
 const response=await fetcher('https://api.firecrawl.dev/v2/search',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({query,limit:5,sources:[{type:'web'}]}),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error('La búsqueda complementaria de Firecrawl no está disponible. Puedes continuar con la búsqueda de Codex.');const value:any=await response.json();return (value.data?.web??[]).slice(0,5).map((r:any)=>({title:String(r.title??'').slice(0,500),url:String(r.url??'').slice(0,2000),description:String(r.description??'').slice(0,1500)}));
}
