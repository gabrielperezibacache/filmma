import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {DEFAULT_APP_PREFERENCES,type AppPreferences} from '../src/app-preferences.js';
export const preferencesSchema=z.object({
 theme:z.enum(['cinema','graphite','light','system']),accent:z.enum(['sage','amber','ocean','rose']),scale:z.enum(['standard','large']),
 density:z.enum(['comfortable','compact']),navigation:z.enum(['labels','icons']),motion:z.enum(['system','reduced']),language:z.enum(['es','en']),
 startPage:z.enum(['home','script','studio']),automaticUpdateChecks:z.boolean(),preferredModel:z.enum(['ltx-2b','minimax-h3']),recommendedProfile:z.enum(['balanced','quality','preview']),
}).strict();
export class ApplicationPreferences {
 private pending:Promise<unknown>=Promise.resolve();
 value:AppPreferences={...DEFAULT_APP_PREFERENCES};
 constructor(readonly directory:string){}
 async init(){try{this.value=preferencesSchema.parse({...DEFAULT_APP_PREFERENCES,...JSON.parse(await readFile(join(this.directory,'application-settings.json'),'utf8'))})}catch(e:any){if(e.code!=='ENOENT')throw new Error('La configuración de Filmma no es válida. El archivo se conserva.')}}
 async update(patch:unknown){const valid=preferencesSchema.partial().parse(patch);const task=this.pending.catch(()=>{}).then(async()=>{const next=preferencesSchema.parse({...this.value,...valid});await mkdir(this.directory,{recursive:true});const temporary=join(this.directory,`application-settings.${randomUUID()}.tmp`);await writeFile(temporary,JSON.stringify(next,null,2),{mode:0o600});await rename(temporary,join(this.directory,'application-settings.json'));this.value=next;return next});this.pending=task;return task}
}
