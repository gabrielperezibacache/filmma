import {constants} from 'node:fs';
import {mkdir,open,writeFile,rename,copyFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
const connection=z.object({id:z.string().uuid(),alias:z.string().trim().min(1).max(80),extensionId:z.string().regex(/^[a-p]{32}$/),tokenSha256:z.string().regex(/^[a-f0-9]{64}$/),connectedAt:z.string(),lastSeen:z.string().optional(),version:z.string().max(30).optional(),clientId:z.string().uuid().optional()});
export type GoogleProfile=z.infer<typeof connection>;
const retiredProfile=connection.pick({id:true,alias:true,extensionId:true,clientId:true});
const registry=z.object({version:z.literal(2),selectedId:z.string().uuid().optional(),profiles:z.array(connection).max(12),retired:z.array(retiredProfile).max(24).optional()});
export class GoogleProfiles{
 profiles=new Map<string,GoogleProfile>();selectedId?:string;private retired:z.infer<typeof retiredProfile>[]=[];private saving:Promise<unknown>=Promise.resolve();
 constructor(readonly file:string){}
 get selected(){return this.selectedId?this.profiles.get(this.selectedId):undefined;}
 async init(){
  let handle;
  try{handle=await open(this.file,constants.O_RDONLY|constants.O_NOFOLLOW);const info=await handle.stat();if(!info.isFile()||info.size>65536||process.platform!=='win32'&&(info.mode&0o077))throw Error('Invalid private registry');const raw=JSON.parse(await handle.readFile('utf8'));if(raw===null)return;
   if(raw.version===2){const parsed=registry.parse(raw);this.profiles=new Map(parsed.profiles.map(p=>[p.id,p]));this.retired=parsed.retired??[];this.selectedId=this.profiles.has(parsed.selectedId??'')?parsed.selectedId:parsed.profiles[0]?.id;}
   else{const legacy=connection.omit({id:true,alias:true,clientId:true}).parse(raw),profile={...legacy,id:randomUUID(),alias:'Chrome principal'};this.profiles.set(profile.id,profile);this.selectedId=profile.id;await copyFile(this.file,this.file+'.v1-backup',constants.COPYFILE_EXCL).catch(e=>{if(e.code!=='EEXIST')throw e;});await this.persist();}
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new Error('No se pudo leer el registro local de perfiles de Chrome. Se conserva para revisión.');}finally{await handle?.close();}
 }
 persist(){const task=this.saving.then(async()=>{await mkdir(dirname(this.file),{recursive:true,mode:0o700});const tmp=this.file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify({version:2,selectedId:this.selectedId,profiles:[...this.profiles.values()],retired:this.retired}),{mode:0o600,flag:'wx'});await rename(tmp,this.file);
  for(const p of this.profiles.values()){const directory=join(dirname(this.file),'google-profiles',p.id);await mkdir(directory,{recursive:true,mode:0o700});await writeFile(join(directory,'profile.json'),JSON.stringify({id:p.id,alias:p.alias,browser:'Chrome',sessionStorage:'browser-owned',cookiesExported:false}),{mode:0o600});}
 });this.saving=task.catch(()=>{});return task;}
 async add(input:Omit<GoogleProfile,'id'|'alias'>&{alias?:string}){
  const previous=input.clientId?[...this.profiles.values(),...this.retired].find(p=>p.clientId===input.clientId&&p.extensionId===input.extensionId):undefined;
  if(!this.profiles.has(previous?.id??'')&&this.profiles.size>=12)throw Object.assign(new Error('Puedes enlazar hasta 12 perfiles. Revoca uno que ya no uses.'),{status:409});
  const profile=connection.parse({...input,id:previous?.id??randomUUID(),alias:input.alias??previous?.alias??`Cuenta Google ${this.profiles.size+1}`});this.retired=this.retired.filter(p=>p.id!==profile.id);this.profiles.set(profile.id,profile);this.selectedId=profile.id;await this.persist();return profile;
 }
 authenticate(ext:string,token:string){const seen=createHash('sha256').update(token).digest('hex'),profile=[...this.profiles.values()].find(p=>p.extensionId===ext&&token&&timingSafeEqual(Buffer.from(seen),Buffer.from(p.tokenSha256)));if(!profile)throw Object.assign(new Error('El enlace de este perfil con Filmma no es válido. Vuelve a enlazarlo.'),{status:401});profile.lastSeen=new Date().toISOString();return profile;}
 public(){return [...this.profiles.values()].map(({id,alias,version,lastSeen})=>({id,alias,version,lastSeen,connected:!!lastSeen&&Date.now()-Date.parse(lastSeen)<65000,selected:id===this.selectedId,sessionStorage:'Chrome · perfil local',directory:join(dirname(this.file),'google-profiles',id)}));}
 async select(id:string){if(!this.profiles.has(id))throw Object.assign(new Error('Este perfil ya no está enlazado.'),{status:404});this.selectedId=id;await this.persist();}
 async rename(id:string,alias:string){const profile=this.profiles.get(id);if(!profile)throw Object.assign(new Error('No se encuentra este perfil.'),{status:404});profile.alias=connection.shape.alias.parse(alias);await this.persist();}
 async revoke(id?:string){const retiring=id?[this.profiles.get(id)].filter((p):p is GoogleProfile=>!!p):[...this.profiles.values()];for(const p of retiring)this.retired=[...this.retired.filter(r=>r.id!==p.id),retiredProfile.parse(p)].slice(-24);if(id){this.profiles.delete(id);if(this.selectedId===id)this.selectedId=this.profiles.keys().next().value;}else{this.profiles.clear();this.selectedId=undefined;}await this.persist();}
}
