import assert from 'node:assert/strict';
/** Exercise browser-origin requests, not only a backend request without Origin. */
export async function checkFrontend(endpoint){
 const response=await fetch(endpoint,{headers:{Origin:endpoint}});assert.equal(response.status,200);
 const html=await response.text(),paths=[...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+\.(?:js|css))"/g)].map(match=>match[1]);assert(paths.some(path=>path.endsWith('.js')));assert(paths.some(path=>path.endsWith('.css')));
 for(const path of paths){const resource=await fetch(endpoint+path,{headers:{Origin:endpoint}});assert.equal(resource.status,200,`Frontend resource rejected: ${path}`);assert.match(resource.headers.get('content-type')??'',path.endsWith('.js')?/javascript/:/text\/css/);await resource.arrayBuffer();}
 return paths.length;
}
