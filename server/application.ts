import type {Express} from 'express';
import {readFile,mkdir,writeFile,rename,lstat,statfs} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve,basename} from 'node:path';
import {z} from 'zod';
import {ApplicationPreferences} from './app-preferences.js';
import {runProcess} from './process.js';
import {spawn} from 'node:child_process';

const REPOSITORY='gabrielperezibacache/filmma';
const route=(fn:any)=>(req:any,res:any,next:any)=>Promise.resolve(fn(req,res)).catch(next);
const fail=(message:string,status=409)=>Object.assign(new Error(message),{status});
const sha=async(path:string)=>{const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex')};
export async function registerApplicationRoutes(options:{app:Express;root:string;dataDirectory:string;getJobs:()=>{status:string}[];gh?:string;fetcher?:typeof fetch;opener?:(path:string)=>Promise<void>}){
 const{app,root,dataDirectory,getJobs}=options,prefs=new ApplicationPreferences(dataDirectory);await prefs.init();
 const gh=options.gh??process.env.FILMMA_GH??'gh';
 let metadata={version:'0.2.0',commit:'',repository:REPOSITORY};
 try{metadata.version=JSON.parse(await readFile(join(root,'package.json'),'utf8')).version??metadata.version}catch{}
 try{metadata={...metadata,...JSON.parse(await readFile(join(root,'desktop/build-info.json'),'utf8'))}}catch{}
 if(!metadata.commit){try{const r=await runProcess('git',['rev-parse','HEAD'],{cwd:root,timeoutMs:3000});if(r.code===0)metadata.commit=r.stdout.trim()}catch{}}
 const idle=()=>{if(getJobs().some(j=>['running','queued'].includes(j.status)))throw fail('Termina o cancela los trabajos activos antes de abrir el instalador.')};
 const ghJson=async(endpoint:string)=>{const result=await runProcess(gh,['api',endpoint],{timeoutMs:25000});if(result.code!==0)throw fail('Conecta tu cuenta de GitHub para consultar este repositorio privado.',401);return JSON.parse(result.stdout)};
 let update:any,checkedAt=0,pending:Promise<any>|undefined;
 async function check(force=false){
  if(!force&&update&&Date.now()-checkedAt<300000)return update;if(pending)return pending;
  pending=(async()=>{
   let commit:any,release:any;
   try{[commit,release]=await Promise.all([ghJson(`repos/${REPOSITORY}/commits/main`),ghJson(`repos/${REPOSITORY}/releases/latest`).catch(()=>null)])}
   catch(error){return{status:'connection-required',message:(error as Error).message,repository:REPOSITORY,currentVersion:metadata.version}}
   const artifact=release?.assets?.find((a:any)=>/^Filmma-[0-9][a-zA-Z0-9.+-]*-arm64\.dmg$/.test(a.name));
   const checksums=release?.assets?.find((a:any)=>a.name==='SHA256SUMS.txt');
   if(release&&!/^v?\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(String(release.tag_name)))release=null;
   const latestVersion=String(release?.tag_name??'').replace(/^v/,'');
   const newer=latestVersion&&latestVersion.localeCompare(metadata.version,undefined,{numeric:true})>0;
   const changed=!!metadata.commit&&commit.sha!==metadata.commit;
   return{status:newer&&artifact&&checksums?'available':changed?'source-changed':'current',currentVersion:metadata.version,latestVersion:latestVersion||null,repository:REPOSITORY,commit:commit.sha,currentCommit:metadata.commit,checkedAt:new Date().toISOString(),release:release?{id:release.id,tag:release.tag_name,url:release.html_url,name:release.name,notes:String(release.body??'').slice(0,12000),artifact:artifact?{name:artifact.name,size:artifact.size,id:artifact.id}:null}:null}
  })().then(value=>{update=value;checkedAt=Date.now();return value}).finally(()=>{pending=undefined});return pending;
 }
 app.get('/api/application',route(async(_req:any,res:any)=>res.json({id:'filmma-studio',...metadata,platform:process.platform,architecture:process.arch,dataDirectory,runtimeDirectory:join(root,'runtime'),preferences:prefs.value,updates:update??null,desktop:!!process.env.FILMMA_DESKTOP})));
 app.get('/api/application/preferences',(_req,res)=>res.json({preferences:prefs.value}));
 let authChild:ReturnType<typeof spawn>|undefined,authText='',authStatus='idle';
 app.post('/api/application/github/connect',route(async(_req:any,res:any)=>{
  if(!authChild){
   authText='';authStatus='pending';
   authChild=spawn(gh,['auth','login','--hostname','github.com','--web','--git-protocol','https','--skip-ssh-key'],{env:{...process.env,GH_BROWSER:'true'},stdio:['pipe','pipe','pipe'],shell:false});
   const collect=(data:Buffer)=>{authText=(authText+data.toString()).slice(-4000)};
   authChild.stdout?.on('data',collect);authChild.stderr?.on('data',collect);authChild.stdin?.end();
   authChild.on('error',()=>{authStatus='failed';authChild=undefined});authChild.on('close',code=>{authStatus=code===0?'connected':'failed';authChild=undefined;checkedAt=0});
   const child=authChild;setTimeout(()=>{if(authChild===child){child.kill('SIGTERM');authChild=undefined}},10*60*1000).unref();
  }
  await new Promise(resolve=>setTimeout(resolve,1500));
  const code=authText.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/)?.[0];
  res.json({status:authStatus,url:'https://github.com/login/device',code,message:code?`Introduce el código ${code} en GitHub. Después vuelve y busca actualizaciones.`:'Completa la conexión de GitHub y vuelve a buscar actualizaciones.'});
 }));
 app.put('/api/application/preferences',route(async(req:any,res:any)=>res.json({preferences:await prefs.update(req.body)})));
 app.post('/api/application/updates/check',route(async(req:any,res:any)=>{const input=z.object({currentVersion:z.string().regex(/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/).optional()}).strict().parse(req.body??{});const value=await check(true);if(input.currentVersion&&value.latestVersion){const newer=value.latestVersion.localeCompare(input.currentVersion,undefined,{numeric:true})>0;res.json({...value,currentVersion:input.currentVersion,status:newer&&value.release?.artifact?'available':value.status==='available'?'current':value.status})}else res.json(value)}));
 app.get('/api/application/updates',route(async(_req:any,res:any)=>res.json(await check())));
 app.post('/api/application/open-data',route(async(_req:any,res:any)=>{if(process.platform!=='darwin')throw fail('Esta acción requiere macOS.');if(options.opener)await options.opener(dataDirectory);else{const r=await runProcess('open',[dataDirectory],{timeoutMs:5000});if(r.code!==0)throw fail('No se pudo abrir la carpeta.')}res.json({ok:true})}));
 let downloading:Promise<any>|undefined;
 app.post('/api/application/updates/download',route(async(req:any,res:any)=>{
  const input=z.object({releaseId:z.number().int().positive()}).strict().parse(req.body);idle();
  if(downloading)return res.json(await downloading);
  downloading=(async()=>{
   const current=await check(true);if(current.status!=='available'||current.release.id!==input.releaseId)throw fail('La versión disponible cambió. Comprueba las actualizaciones de nuevo.');
   const directory=join(dataDirectory,'application-updates',String(input.releaseId));await mkdir(directory,{recursive:true,mode:0o700});
   const disk=await statfs(directory);if(Number(disk.bavail)*Number(disk.bsize)<current.release.artifact.size+2*1024**3)throw fail('Se necesitan 2 GiB libres además del instalador.');
   const existing=join(directory,'verified.json');
   try{const v=JSON.parse(await readFile(existing,'utf8'));if(await sha(join(directory,v.filename))===v.sha256)return v}catch{}
   const fetch=await runProcess(gh,['release','download',current.release.tag,'--repo',REPOSITORY,'--pattern',current.release.artifact.name,'--pattern','SHA256SUMS.txt','--dir',directory,'--clobber'],{timeoutMs:15*60*1000});
   if(fetch.code!==0)throw fail('No se pudo descargar la versión. Los proyectos y modelos se conservan.');
   const filename=current.release.artifact.name,checksums=await readFile(join(directory,'SHA256SUMS.txt'),'utf8');
   const line=checksums.split('\n').find(line=>line.trim().endsWith(filename));const expected=line?.match(/^([a-f0-9]{64})\s+\*?([^/\\]+)$/i);
   if(!expected||expected[2]!==filename)throw fail('La versión no incluye una huella SHA256 válida.');
   const path=join(directory,filename),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size!==current.release.artifact.size||await sha(path)!==expected[1])throw fail('El instalador no superó la verificación. No se abrirá.');
   const value={id:String(input.releaseId),filename,sha256:expected[1],version:current.latestVersion,verifiedAt:new Date().toISOString()};const temp=existing+'.tmp';await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,existing);return value;
  })().finally(()=>{downloading=undefined});res.json(await downloading);
 }));
 app.post('/api/application/updates/open',route(async(req:any,res:any)=>{
  idle();const {id}=z.object({id:z.string().regex(/^[0-9]+$/)}).strict().parse(req.body);const directory=join(dataDirectory,'application-updates',id),record=JSON.parse(await readFile(join(directory,'verified.json'),'utf8'));
  if(basename(record.filename)!==record.filename||!record.filename.endsWith('-arm64.dmg'))throw fail('El instalador guardado no es válido.');
  const path=resolve(directory,record.filename),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||await sha(path)!==record.sha256)throw fail('El instalador cambió. Descárgalo de nuevo.');
  if(options.opener)await options.opener(path);else{const r=await runProcess('open',[path],{timeoutMs:10000});if(r.code!==0)throw fail('No se pudo abrir el instalador.')}res.json({ok:true});
 }));
 return{preferences:prefs,metadata};
}
