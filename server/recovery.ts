import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,readFile,readdir,rename,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {projectSchema,type Project} from './types.js';

export const recoveryFingerprint=(project:Project)=>createHash('sha256').update(JSON.stringify(project,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value)).digest('hex');
const contentFingerprint=(project:Project)=>recoveryFingerprint({...project,updatedAt:''});
export const recoveryVersion=contentFingerprint;
const validId=/^[a-zA-Z0-9_-]{1,100}$/;
export type Checkpoint={schemaVersion:1;id:string;projectId:string;createdAt:string;reason:string;label:string;sha256:string;project:Project};
export type RecoverySummary=Omit<Checkpoint,'project'> & {sceneCount:number;characterCount:number;assetCount:number;current:boolean};
const message=(text:string)=>new Error(text);

/** Write and fsync a complete document before its atomic rename. No media is
 * copied, transformed or deleted by this journal. History points are immutable. */
async function atomic(path:string,value:unknown){
 const temp=`${path}.${randomUUID()}.tmp`,file=await open(temp,'wx',0o600);
 try{await file.writeFile(JSON.stringify(value,null,2));await file.sync()}finally{await file.close()}
 await rename(temp,path);
}
export class RecoveryJournal{
 readonly directory:string;
 private lastContent='';private lastProject='';private lastPointAt=0;private lastStamp=0;
 constructor(dataDirectory:string,readonly intervalMs=60000){this.directory=join(dataDirectory,'recovery')}
 async init(){await mkdir(this.directory,{recursive:true,mode:0o700});
  try{const head=await this.readFile(join(this.directory,'current.json'));this.lastContent=contentFingerprint(head.project);this.lastProject=head.projectId;this.lastPointAt=Date.parse(head.createdAt);this.lastStamp=this.lastPointAt}catch{}
 }
 private folder(projectId:string){if(!validId.test(projectId))throw message('Identificador de película inválido.');return join(this.directory,projectId)}
 private async readFile(path:string):Promise<Checkpoint>{
  const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>8*1024*1024)throw message('El punto de recuperación no es un archivo válido.');
  const value=JSON.parse(await readFile(path,'utf8'));
  if(value.schemaVersion!==1||!validId.test(value.id)||!validId.test(value.projectId)||!Number.isFinite(Date.parse(value.createdAt))||typeof value.label!=='string'||typeof value.reason!=='string')throw message('El punto de recuperación tiene metadatos inválidos.');
  const project=projectSchema.parse(value.project);
  if(project.id!==value.projectId||recoveryFingerprint(project)!==value.sha256)throw message('El punto de recuperación no superó su comprobación SHA256.');
  return {...value,project};
 }
 async record(project:Project,reason='automatic',label='',force=false):Promise<Checkpoint|undefined>{
  const content=contentFingerprint(project),changed=content!==this.lastContent||project.id!==this.lastProject;
  if(!changed&&!force)return;
  if(this.lastProject&&project.id!==this.lastProject)await this.archivePending(project);
  const folder=this.folder(project.id);await mkdir(folder,{recursive:true,mode:0o700});
  const snapshot=projectSchema.parse(project);
  this.lastStamp=Math.max(Date.now(),this.lastStamp+1);
  const point:Checkpoint={schemaVersion:1,id:randomUUID(),projectId:project.id,createdAt:new Date(this.lastStamp).toISOString(),reason,label:label.slice(0,120),sha256:recoveryFingerprint(snapshot),project:snapshot};
  if(force||project.id!==this.lastProject||Date.now()-this.lastPointAt>=this.intervalMs){await atomic(join(folder,`${point.id}.json`),point);this.lastPointAt=Date.now()}
  await atomic(join(this.directory,'current.json'),point);
  await atomic(join(this.directory,'active.json'),{projectId:project.id});
  this.lastContent=contentFingerprint(snapshot);this.lastProject=project.id;return point;
 }
 async read(projectId:string,id:string){if(!validId.test(id))throw message('Punto de recuperación inválido.');return this.readFile(join(this.folder(projectId),`${id}.json`))}
 async archivePending(project:Project){
  let head:Checkpoint;try{head=await this.readFile(join(this.directory,'current.json'))}catch{return}
  if(contentFingerprint(head.project)===contentFingerprint(project))return;
  const folder=this.folder(head.projectId);await mkdir(folder,{recursive:true,mode:0o700});
  const path=join(folder,`${head.id}.json`);try{await lstat(path)}catch(e:any){if(e.code==='ENOENT')await atomic(path,head);else throw e}
 }
 async list(project:Project){
  const folder=this.folder(project.id);let files:string[]=[];try{files=await readdir(folder)}catch(e:any){if(e.code!=='ENOENT')throw e}
  const entries:RecoverySummary[]=[];let damaged=0;
  for(const name of files.filter(f=>/^[a-zA-Z0-9_-]+\.json$/.test(f))){try{const p=await this.readFile(join(folder,name));entries.push({...p,project:undefined,sceneCount:p.project.scenes.length,characterCount:p.project.characters.length,assetCount:p.project.assets.length,current:contentFingerprint(p.project)===contentFingerprint(project)} as RecoverySummary)}catch{damaged++}}
  entries.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));return{entries,damaged};
 }
 async recover():Promise<Checkpoint|undefined>{
  let projectId:string|undefined;
  try{const pointer=JSON.parse(await readFile(join(this.directory,'active.json'),'utf8'));if(validId.test(pointer.projectId))projectId=pointer.projectId}catch{}
  try{const head=await this.readFile(join(this.directory,'current.json'));if(!projectId||head.projectId===projectId)return head}catch{}
  if(!projectId)return;
  const folder=this.folder(projectId);let files:string[]=[];try{files=await readdir(folder)}catch{return}
  const points:Checkpoint[]=[];for(const name of files.filter(f=>/^[a-zA-Z0-9_-]+\.json$/.test(f)))try{points.push(await this.readFile(join(folder,name)))}catch{}
  return points.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
 }
 async preserveDamaged(path:string,kind:string){
  const destination=join(this.directory,`${kind}-${Date.now()}-${randomUUID()}.json`);
  try{await rename(path,destination);return destination}catch(e:any){if(e.code==='ENOENT')return;throw e}
 }
}
