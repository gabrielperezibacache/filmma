import {constants} from 'node:fs';
import {open,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';

// A bounded receipt for one original downloaded through Google's visible UI.
// Never accepts a caller-supplied path or scans contents of unrelated files.
export class NativeDownloadReceipt {
 private previous=new Set<string>();private stable=new Map<string,string>();private started=Date.now();
 constructor(private directory:string,private prefix:string,private maxBytes=512*1024**2){
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{3,110}$/.test(prefix))throw Error('Nombre de descarga ambiguo. Usa la importación manual.');
 }
 private matches(name:string){return name.startsWith(this.prefix)&&/\.mp4$/i.test(name)&&!name.includes('/')&&!name.includes('\\')}
 async begin(){this.previous=new Set((await readdir(this.directory)).filter(n=>this.matches(n)));return this}
 async capture(destination:string){
  if(Date.now()-this.started>180000)throw Error('La descarga no terminó en tres minutos. El resultado se conserva en Chrome.');
  const files=[];
  for(const name of (await readdir(this.directory)).filter(n=>this.matches(n)&&!this.previous.has(n))){
   const path=join(this.directory,name),s=await lstat(path);
   if(s.isSymbolicLink()||!s.isFile())throw Error('El archivo descargado no es un original regular.');
   if(s.size>this.maxBytes)throw Error('El original supera el límite de 512 MiB.');
   if(s.size>0)files.push({name,path,s});
  }
  if(files.length>1)throw Error('Hay varias descargas coincidentes. Selecciona el original manualmente.');
  if(!files.length)return null;
  const f=files[0]!,fingerprint=[f.s.dev,f.s.ino,f.s.size,f.s.mtimeMs,f.s.ctimeMs].join(':');
  if(this.stable.get(f.name)!==fingerprint){this.stable.set(f.name,fingerprint);return null}
  const source=await open(f.path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
   const before=await source.stat();
   if(!before.isFile()||before.dev!==f.s.dev||before.ino!==f.s.ino||before.size!==f.s.size)throw Error('La descarga cambió antes de copiarla.');
   const target=await open(destination,'wx',0o600);
   try{
    const buffer=Buffer.alloc(1024**2);let offset=0;
    while(offset<before.size){const{bytesRead}=await source.read(buffer,0,Math.min(buffer.length,before.size-offset),offset);if(!bytesRead)throw Error('El original cambió durante la copia.');await target.writeFile(buffer.subarray(0,bytesRead));offset+=bytesRead}
    const after=await source.stat();if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error('El original cambió durante la copia.');
    await target.sync();return{bytes:offset,name:f.name};
   }finally{await target.close()}
  }finally{await source.close()}
 }
}
