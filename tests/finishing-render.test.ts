import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import { createSeedProject } from '../server/seed.js';
import type { Project } from '../server/types.js';
import { runProcess, parseJsonOutput } from '../server/process.js';
import { renderProject } from '../server/render.js';
import { colorMatrix } from '../src/visual-effects.js';

async function ffmpeg(args:string[]){const result=await runProcess('ffmpeg',['-y','-v','error','-threads','2',...args],{timeoutMs:90000});assert.equal(result.code,0,result.stderr);}
async function picture(path:string,color:string,alpha?:number){await sharp({create:{width:320,height:180,channels:alpha==null?3:4,background:alpha==null?color:{r:255,g:255,b:255,alpha}}}).png().toFile(path);}
function project(assets:[string,'image'|'video'|'audio',string][]):Project{
  const result=createSeedProject();result.audioAssetId=undefined;result.subtitleCues=[];result.tracks=[];
  result.assets=assets.map(([id,type,extension])=>({id,name:id,type,url:`/api/media/${id}.${extension}`,mime:`${type}/${extension}`,size:0}));result.scenes=[];return result;
}
function shot(id:string,assetId:string,duration=1):Project['scenes'][number]{return {...createSeedProject().scenes[0]!,id,title:id,assetId:undefined,videoAssetId:assetId,duration,trimStart:0,dialogue:'Elena vuelve a la sala.',transition:'cut',look:'original'};}
async function render(p:Project,directory:string,label='film'){
  const work=join(directory,`work-${label}`),destination=join(directory,`${label}.mp4`);await mkdir(work);
  await renderProject(p,{destination,workDirectory:work,mediaPath:async(asset)=>join(directory,basename(asset.url)),signal:new AbortController().signal,update:()=>{},dimensions:[320,180]});return destination;
}
async function pixels(movie:string,directory:string,frames:number[],x=160,y=80){
  const file=join(directory,`pixels-${frames.join('-')}-${x}-${y}.rgb`),expression=frames.map((frame)=>`eq(n\\,${frame})`).join('+');
  await ffmpeg(['-i',movie,'-vf',`select=${expression},crop=2:2:${x}:${y},format=rgb24`,'-vsync','0','-f','rawvideo',file]);const bytes=await readFile(file);assert.equal(bytes.length,frames.length*12);return frames.map((_,index)=>[...bytes.subarray(index*12,index*12+3)]);
}
function near(pixel:number[],expected:number[],tolerance=12){pixel.forEach((value,index)=>assert.ok(Math.abs(value-expected[index]!)<=tolerance,`Pixel ${pixel} expected ${expected} ±${tolerance}`));}
async function audio(movie:string,directory:string){const path=join(directory,`${basename(movie)}.f32`);await ffmpeg(['-i',movie,'-vn','-ac','1','-ar','48000','-f','f32le',path]);return readFile(path);}
function amplitude(bytes:Buffer,frequency:number,start:number,end:number){let sine=0,cosine=0,count=0;for(let index=Math.round(start*48000);index<Math.round(end*48000);index++){const value=bytes.readFloatLE(index*4),angle=2*Math.PI*frequency*index/48000;sine+=value*Math.sin(angle);cosine+=value*Math.cos(angle);count++;}return 2*Math.hypot(sine,cosine)/count;}
function rms(bytes:Buffer,start:number,end:number){let sum=0,count=0;for(let index=Math.round(start*48000);index<Math.round(end*48000);index++){const value=bytes.readFloatLE(index*4);sum+=value*value;count++;}return Math.sqrt(sum/count);}
async function exactDuration(movie:string,frames:number){const result=await runProcess('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=duration,nb_read_frames:format=duration','-of','json',movie]);assert.equal(result.code,0,result.stderr);const data=parseJsonOutput(result.stdout);assert.equal(Number(data.streams[0].nb_read_frames),frames);assert.ok(Math.abs(Number(data.streams[0].duration)-frames/24)<.00001);assert.ok(Math.abs(Number(data.format.duration)-frames/24)<.04);}

test('rendered RGB colour matches the shared sRGB matrix for exposure, saturation, contrast and temperature',{timeout:120000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'filmma-grade-'));
  try{
    await picture(join(directory,'original.png'),'#5078a0');const p=project([['original','image','png']]);
    const grades=[{}, {exposure:1}, {saturation:0}, {contrast:1.5,temperature:1}, {exposure:-1,contrast:.5,saturation:1.3,temperature:-1}];
    p.scenes=grades.map((color,index)=>({...shot(`s${index}`,'original'),color}));
    const before=structuredClone(p),movie=await render(p,directory),colors=await pixels(movie,directory,grades.map((_,index)=>index*24+12));
    grades.forEach((grade,index)=>{const matrix=colorMatrix(grade),expected=[0,1,2].map(row=>Math.max(0,Math.min(255,[80,120,160].reduce((sum,value,col)=>sum+matrix[row*5+col]!*value,matrix[row*5+4]!*255))));near(colors[index]!,expected,9);});
    assert.deepEqual(p,before,'render must preserve screenplay, cast and grading state');await exactDuration(movie,120);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('speed uses source time, preserves audio pitch, freezes EOF and leaves screenplay, characters and subtitles on their mounted clocks',{timeout:120000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'filmma-speed-'));
  try{
    const args:string[]=[];for(const color of ['red','0x00ff00','yellow','0xff00ff'])args.push('-f','lavfi','-i',`color=${color}:s=320x180:r=24:d=0.5`);
    args.push('-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-filter_complex','[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]','-map','[v]','-map','4:a','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-t','2',join(directory,'source.mp4'));await ffmpeg(args);
    await ffmpeg(['-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=2','-c:a','pcm_s16le',join(directory,'voice.wav')]);
    const p=project([['source','video','mp4'],['voice','audio','wav']]);p.scenes=[{...shot('fast','source',2),trimStart:.5,speed:2},{...shot('slow','source',2),speed:.5}];
    p.tracks=[{id:'voices',name:'Voces',type:'audio',muted:false,volume:1,clips:[{id:'voice',assetId:'voice',sceneId:'slow',offset:.5,duration:1,trimStart:0,speed:4}]}];
    p.subtitlesEnabled=true;p.subtitleCues=[{id:'cue',sceneId:'slow',start:.5,end:1,text:'Elena permanece.'}];
    const before=structuredClone(p),movie=await render(p,directory),colors=await pixels(movie,directory,[0,6,12,23,47,48,68,74,95]);
    [[0,255,0],[255,255,0],[255,0,255],[255,0,255],[255,0,255],[255,0,0],[255,0,0],[0,255,0],[0,255,0]].forEach((expected,index)=>near(colors[index]!,expected));
    const samples=await audio(movie,directory);assert.ok(amplitude(samples,440,.1,.2)>.05);assert.ok(amplitude(samples,880,.1,.2)<.003,'2x keeps original pitch');assert.ok(rms(samples,1,1.6)<.0003,'source EOF pads silence');
    assert.ok(amplitude(samples,440,2.15,2.35)>.05);assert.ok(amplitude(samples,220,2.15,2.35)<.003,'0.5x keeps original pitch');assert.ok(amplitude(samples,880,2.6,2.8)>.05,'4x audio layer retains its own pitch');assert.ok(amplitude(samples,880,3.1,3.3)<.002,'4x exhausted layer is silent');
    const bottom=await pixels(movie,directory,[59,60,72],24,158);assert.ok(bottom[0]![0]!>230);assert.ok(bottom[1]![0]!<110);assert.ok(bottom[2]![1]!>230);
    assert.deepEqual(p,before);await exactDuration(movie,96);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('keyed layer translates, scales and fades with preserved source alpha in clip-local time',{timeout:120000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'filmma-keys-'));
  try{
    await picture(join(directory,'black.png'),'black');await picture(join(directory,'layer.png'),'white',.5);
    const p=project([['black','image','png'],['layer','image','png']]);p.scenes=[shot('scene','black',2)];
    p.tracks=[{id:'titles',name:'Capa',type:'video',muted:true,volume:1,clips:[{id:'animated',assetId:'layer',sceneId:'scene',offset:.5,duration:1.5,trimStart:0,opacity:0,keyframes:[{id:'first',time:0,x:-25,y:0,scale:.25,opacity:1,easing:'ease-in-out'},{id:'last',time:1,x:25,y:0,scale:.5,opacity:.5,easing:'linear'}]}]}];
    const before=structuredClone(p),movie=await render(p,directory);
    const left=await pixels(movie,directory,[11,12,24,36,47],80,90);near(left[0]!,[0,0,0]);near(left[1]!,[128,128,128]);near(left[2]!,[0,0,0]);near(left[3]!,[0,0,0]);
    const middle=await pixels(movie,directory,[12,18,24],160,90);near(middle[0]!,[0,0,0]);near(middle[1]!,[0,0,0]);near(middle[2]!,[96,96,96]);
    const right=await pixels(movie,directory,[24,36,47],240,90);near(right[0]!,[0,0,0]);near(right[1]!,[64,64,64]);near(right[2]!,[64,64,64]);
    const outsideScale=await pixels(movie,directory,[12,24,36],80,40);outsideScale.forEach(pixel=>near(pixel,[0,0,0]));
    assert.deepEqual(p,before);await exactDuration(movie,48);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('dissolve handles advance at outgoing speed and retain its colour grade',{timeout:120000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'filmma-speed-handle-'));
  try{
    await ffmpeg(['-f','lavfi','-i','color=red:s=320x180:r=24:d=1','-f','lavfi','-i','color=0x00ff00:s=320x180:r=24:d=1','-f','lavfi','-i','color=yellow:s=320x180:r=24:d=1','-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]','-map','[v]','-c:v','libx264','-pix_fmt','yuv420p',join(directory,'source.mp4')]);await picture(join(directory,'blue.png'),'blue');
    const p=project([['source','video','mp4'],['blue','image','png']]);p.scenes=[{...shot('outgoing','source'),speed:2,color:{saturation:0}},{...shot('incoming','blue'),transition:'dissolve',transitionDuration:.5}];
    const movie=await render(p,directory),colors=await pixels(movie,directory,[0,12,24,35]);near(colors[0]!,[54,54,54]);near(colors[1]!,[182,182,182]);near(colors[2]!,[237,237,237]);near(colors[3]!,[0,0,255]);await exactDuration(movie,48);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('a trimmed hold animation jumps on the keyed frame while graded letterboxing moves with the layer',{timeout:120000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'filmma-key-hold-'));
  try{
    await picture(join(directory,'blue.png'),'blue');await sharp({create:{width:160,height:180,channels:3,background:'#808080'}}).png().toFile(join(directory,'narrow.png'));
    const p=project([['blue','image','png'],['narrow','image','png']]);p.scenes=[shot('scene','blue')];
    p.tracks=[{id:'over',name:'Capa',type:'video',muted:true,volume:1,clips:[{id:'hold',assetId:'narrow',sceneId:'scene',offset:0,duration:1,trimStart:0,color:{exposure:1},keyframes:[{id:'before',time:-.5,x:-25,y:0,scale:.5,opacity:1,easing:'hold'},{id:'jump',time:.5,x:25,y:0,scale:.5,opacity:1,easing:'linear'}]}]}];
    const movie=await render(p,directory),left=await pixels(movie,directory,[0,11,12],80,90),right=await pixels(movie,directory,[11,12],240,90);
    near(left[0]!,[255,255,255]);near(left[1]!,[255,255,255]);near(left[2]!,[0,0,255]);near(right[0]!,[0,0,255]);near(right[1]!,[255,255,255]);
    const bar=await pixels(movie,directory,[0,12],20,90);near(bar[0]!,[0,0,0]);near(bar[1]!,[0,0,255]);await exactDuration(movie,24);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('the full 100-key animation limit exports without exceeding FFmpeg expression nesting',{timeout:120000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'filmma-key-limit-'));
  try{
    await picture(join(directory,'black.png'),'black');await picture(join(directory,'white.png'),'white');
    const p=project([['black','image','png'],['white','image','png']]);p.scenes=[shot('scene','black',5)];
    p.tracks=[{id:'over',name:'Capa',type:'video',muted:true,volume:1,clips:[{id:'many',assetId:'white',sceneId:'scene',offset:0,duration:5,trimStart:0,keyframes:Array.from({length:100},(_,index)=>({id:`key${index}`,time:index/24,x:index%2?10:-10,y:0,scale:.5+index%4*.1,opacity:index%2?1:.5,easing:'ease-in-out' as const}))}]}];
    const movie=await render(p,directory),colors=await pixels(movie,directory,[0,1,98,99,119]);
    [[128,128,128],[255,255,255],[128,128,128],[255,255,255],[255,255,255]].forEach((expected,index)=>near(colors[index]!,expected));await exactDuration(movie,120);
  }finally{await rm(directory,{recursive:true,force:true});}
});
