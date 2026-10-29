import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {resolve} from 'node:path';
import {GOOGLE_VIDEO_LINKS} from '../src/google-video';

test('Mac shell opens official Google workflow links externally and denies deceptive destinations',async()=>{
 const handlers=new Map<string,Function>(),opened:string[]=[],require=createRequire(import.meta.url);
 const electron={app:{isPackaged:false,requestSingleInstanceLock:()=>false,quit:()=>{}},ipcMain:{handle:(name:string,fn:Function)=>handlers.set(name,fn)},shell:{openExternal:async(url:string)=>{opened.push(url)}}};
 // Load the real main-process policy without creating a window or starting the engine.
 runInNewContext(await readFile(new URL('../desktop/main.cjs',import.meta.url),'utf8'),{require:(name:string)=>name==='electron'?electron:require(name),process:{env:{}},__dirname:resolve('desktop'),URL});
 const open=handlers.get('filmma:open-external')!;assert(open);
 for(const url of Object.values(GOOGLE_VIDEO_LINKS))await open({},url);
 assert.deepEqual(opened,Object.values(GOOGLE_VIDEO_LINKS));
 for(const url of ['http://gemini.google.com/app','https://gemini.google.com.evil.invalid/app','https://gemini.google.com@evil.invalid/','javascript:alert(1)','file:///etc/passwd','https://unrequested-google-service.example/'])await assert.rejects(open({},url),/Destino no permitido/);
 assert.equal(opened.length,Object.keys(GOOGLE_VIDEO_LINKS).length);
 await open({},'https://elevenlabs.io/app/settings/api-keys');
 await open({},'https://elevenlabs.io/docs/overview/models');
 assert.equal(opened.length,Object.keys(GOOGLE_VIDEO_LINKS).length+2);
 for(const url of ['https://elevenlabs.io.evil.invalid/','https://elevenlabs.io@evil.invalid/'])await assert.rejects(open({},url),/Destino no permitido/);
});

test('desktop smoke mode isolates the Electron profile from the installed user application',async()=>{
 const paths:{name:string;value:string}[]=[],require=createRequire(import.meta.url);
 const electron={app:{isPackaged:false,setPath:(name:string,value:string)=>paths.push({name,value}),requestSingleInstanceLock:()=>false,quit:()=>{}},ipcMain:{handle:()=>{}},shell:{openExternal:async()=>{}}};
 runInNewContext(await readFile(new URL('../desktop/main.cjs',import.meta.url),'utf8'),{require:(name:string)=>name==='electron'?electron:require(name),process:{env:{FILMMA_DESKTOP_TEST_DATA:resolve('output/qa/package-profile'),FILMMA_DESKTOP_TEST_PORT:'54321'}},__dirname:resolve('desktop'),URL});
 assert.deepEqual(paths,[{name:'userData',value:resolve('output/qa/package-profile/electron-profile')}]);
});
