import test from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../src/api.js';
import {setLanguage} from '../src/i18n.js';

test('offline feedback names Filmma and never retries a potentially accepted mutation',async()=>{
 const original=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;throw new TypeError('Failed to fetch');};
 try{setLanguage('es');await assert.rejects(api('/project',{id:'qa'}),/No se pudo conectar con Filmma.*estudio esté abierto/);assert.equal(requests,1);}
 finally{globalThis.fetch=original;setLanguage('es');}
});
test('network feedback follows the selected application language',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>{const error=new Error('offline');error.name='NetworkError';throw error;};
 try{setLanguage('en');await assert.rejects(api('/jobs'),/Could not connect to Filmma.*studio is running/);}
 finally{globalThis.fetch=original;setLanguage('es');}
});
test('operation-specific server errors stay actionable rather than becoming generic network failures',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({error:'La voz cambió. Revisa el personaje.'},{status:409});
 try{await assert.rejects(api('/speech/generate',{lineId:'qa'}),{message:'La voz cambió. Revisa el personaje.'});}
 finally{globalThis.fetch=original;}
});
