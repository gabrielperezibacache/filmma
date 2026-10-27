import {spawn} from 'node:child_process';
import {open,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const url='http://127.0.0.1:4318';
async function alive(){try{return (await fetch(url+'/api/jobs',{signal:AbortSignal.timeout(1500)})).ok}catch{return false}}
if(!await alive()){
 await mkdir(join(root,'data'),{recursive:true});
 const log=await open(join(root,'data','studio.log'),'a');
 const child=spawn(process.execPath,['--import','tsx',join(root,'server','index.ts')],{cwd:root,detached:true,stdio:['ignore',log.fd,log.fd],env:process.env});
 child.unref();await log.close();
 let ready=false;for(let i=0;i<60;i++){if(await alive()){ready=true;break}await new Promise(r=>setTimeout(r,500))}
 if(!ready){console.error('No se pudo abrir Filmma. Consulta data/studio.log.');process.exit(1)}
}
if(!process.argv.includes('--no-open'))spawn('open',[url],{stdio:'ignore'}).unref();
console.log('Filmma está abierto en '+url);
