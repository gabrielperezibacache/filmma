import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {runProcess} from './process.js';
import {writeFile,readdir,lstat,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
export type CodexModel={id:string;model:string;displayName:string;isDefault:boolean;defaultReasoningEffort:string;supportedReasoningEfforts:{reasoningEffort:string;description:string}[]};
/** Discovery uses the official stdio protocol. No thread is created and no credentials leave Codex. */
export async function codexModels(command:string,requireChatGPT=false):Promise<CodexModel[]>{
 const child=spawn(command,['app-server','--stdio'],{stdio:['pipe','pipe','pipe'],windowsHide:true});let seq=0;const pending=new Map<number,{resolve:(r:any)=>void;reject:(e:Error)=>void}>();
 const lines=createInterface({input:child.stdout});let bytes=0;const error=new Error('No se pudo consultar el catálogo de Codex. Comprueba su instalación y sesión.');
 const abort=()=>{for(const p of pending.values())p.reject(error);pending.clear();};child.on('error',abort);child.on('exit',abort);child.stderr.resume();
 lines.on('line',line=>{bytes+=line.length;if(bytes>4*1024**2){abort();child.kill();return;}try{const m=JSON.parse(line),p=pending.get(m.id);if(p){pending.delete(m.id);if(m.error)p.reject(error);else p.resolve(m.result);}}catch{}});
 const request=(method:string,params:unknown)=>new Promise<any>((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
 const timer=setTimeout(()=>{abort();child.kill();},20000);
 try{await request('initialize',{clientInfo:{name:'filmma',title:'Filmma',version:'0.16.0'},capabilities:{experimentalApi:false}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');if(requireChatGPT){const account=await request('account/read',{refreshToken:false});if(account.account?.type!=='chatgpt')throw new Error('Inicia sesión en Codex con tu cuenta de ChatGPT para usar este recorrido. Filmma no cambiará a una API de pago automáticamente.');}let cursor:string|undefined;const models:CodexModel[]=[];do{const result=await request('model/list',{limit:100,includeHidden:false,...(cursor?{cursor}:{})});models.push(...result.data.filter((m:any)=>!m.hidden));cursor=result.nextCursor;}while(cursor&&models.length<200);return models;}finally{clearTimeout(timer);lines.close();child.stdin.end();child.kill();}
}
export async function codexTask(command:string,options:{folder:string;prompt:string;model:string;effort?:string;schema?:unknown;search?:boolean;image?:boolean;images?:string[];signal:AbortSignal;onProgress?:(message:string)=>void}){
 await codexModels(command,true);
 const args=['exec','--ignore-user-config','--json','--sandbox',options.image?'workspace-write':'read-only','--skip-git-repo-check','--ephemeral','--disable','shell_tool','--disable','unified_exec','--disable','view_image','-c','web_search="'+(options.search?'live':'disabled')+'"','-m',options.model];
 if(options.effort)args.push('-c',`model_reasoning_effort="${options.effort}"`);
 if(options.schema){const path=join(options.folder,'output-schema.json');await writeFile(path,JSON.stringify(options.schema),{mode:0o600});args.push('--output-schema',path);}
 for(const path of options.images??[])args.push('-i',path);
 args.push('-');let answer='',threadId='';const imageResults:{path?:string;result?:string;codexArtifact?:boolean}[]=[];let searched=false;
 const env={...process.env};for(const key of ['OPENAI_API_KEY','CODEX_API_KEY','OPENAI_BASE_URL'])delete env[key];
 const result=await runProcess(command,args,{cwd:options.folder,env,signal:options.signal,stdin:options.prompt,timeoutMs:15*60*1000,onLine(line){try{const e=JSON.parse(line),i=e.item;if(e.type==='thread.started'&&/^[a-f0-9-]{36}$/.test(e.thread_id))threadId=e.thread_id;if(i?.type==='web_search'){searched=true;options.onProgress?.('Codex está consultando referencias en la web…');}if(e.type==='item.completed'&&i?.type==='agent_message')answer=i.text;if(e.type==='item.completed'&&['image_generation','imageGeneration'].includes(i?.type)){imageResults.push({path:i.saved_path??i.savedPath,result:i.result});options.onProgress?.('Comprobando la imagen creada…');}}catch{}}});
 if(result.code!==0)throw new Error(/quota|usage limit|rate.?limit/i.test(result.stderr)?'Codex alcanzó el límite de la cuenta. El material previo se conserva.':'Codex no completó la tarea. Comprueba tu sesión y el modelo elegido.');
 // CLI JSON currently omits built-in image items, but saves them under the
 // generated thread's dedicated artifact directory. Never inspect other chats.
 if(options.image&&threadId){const root=join(process.env.CODEX_HOME??join(homedir(),'.codex'),'generated_images',threadId);try{const stat=await lstat(root);if(stat.isDirectory()&&!stat.isSymbolicLink()&&await realpath(root)===root){let count=0;const visit=async(path:string,depth:number)=>{for(const entry of await readdir(path,{withFileTypes:true})){if(++count>40)throw new Error('Demasiados archivos en el resultado de imagen.');const file=join(path,entry.name);if(entry.isFile()&&/\.(png|jpe?g|webp)$/i.test(entry.name)&&(await lstat(file)).size<=20*1024**2)imageResults.push({path:file,codexArtifact:true});else if(entry.isDirectory()&&depth<2)await visit(file,depth+1);}};await visit(root,0);}}catch(e:any){if(e.code!=='ENOENT')throw e;}}
 return {answer,images:imageResults,searched,threadId};
}
