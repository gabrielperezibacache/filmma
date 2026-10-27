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
import { resolveSceneTransitions, transitionOpacity } from '../src/transitions.js';

async function ffmpeg(args:string[]){const result=await runProcess('ffmpeg',['-y','-v','error',...args],{timeoutMs:60000});assert.equal(result.code,0,result.stderr);}
async function picture(path:string,color:string){await sharp({create:{width:320,height:180,channels:3,background:color}}).png().toFile(path);}
async function video(path:string,color:string,duration:number,frequency?:number){
  const args=['-f','lavfi','-i',`color=${color}:s=320x180:r=24:d=${duration}`];
  if(frequency)args.push('-f','lavfi','-i',`sine=frequency=${frequency}:sample_rate=48000:duration=${duration}`);
  await ffmpeg([...args,'-c:v','libx264','-pix_fmt','yuv420p',...(frequency?['-c:a','aac','-ar','48000']:[]),'-t',String(duration),path]);
}
function project(assets:[string,'image'|'video',string][]):Project{
  const result=createSeedProject();result.characters=[];result.audioAssetId=undefined;result.subtitleCues=[];
  result.assets=assets.map(([id,type,extension])=>({id,name:id,type,url:`/api/media/${id}.${extension}`,mime:`${type}/${extension}`,size:0}));
  result.scenes=[];return result;
}
function shot(id:string,assetId:string,duration=1,transition:'cut'|'dip'|'dissolve'|'fade'='cut',transitionDuration=.5):Project['scenes'][number]{
  return {...createSeedProject().scenes[0]!,id,title:id,assetId:undefined,videoAssetId:assetId,duration,trimStart:0,characterIds:[],dialogue:'',transition,transitionDuration,look:'original'};
}
async function render(project:Project,directory:string,label='film'){
  const work=join(directory,`work-${label}`),destination=join(directory,`${label}.mp4`);await mkdir(work);
  await renderProject(project,{destination,workDirectory:work,mediaPath:async(asset)=>join(directory,basename(asset.url)),signal:new AbortController().signal,update:()=>{},dimensions:[320,180]});return destination;
}
async function pixels(movie:string,directory:string,frames:number[],x=160,y=80){
  const file=join(directory,`pixels-${frames.join('-')}-${x}-${y}.rgb`);
  const expression=frames.map((frame)=>`eq(n\\,${frame})`).join('+');
  await ffmpeg(['-i',movie,'-vf',`select=${expression},crop=2:2:${x}:${y},format=rgb24`,'-vsync','0','-f','rawvideo',file]);
  const bytes=await readFile(file);assert.equal(bytes.length,frames.length*12);
  return frames.map((_,index)=>[...bytes.subarray(index*12,index*12+3)]);
}
function near(pixel:number[],expected:number[],tolerance=13){pixel.forEach((value,index)=>assert.ok(Math.abs(value-expected[index]!)<=tolerance,`Pixel ${pixel} expected ${expected} ±${tolerance}`));}
async function audio(movie:string,directory:string){const path=join(directory,`${basename(movie)}.f32`);await ffmpeg(['-i',movie,'-vn','-ac','1','-ar','48000','-f','f32le',path]);return readFile(path);}
function amplitude(bytes:Buffer,frequency:number,start:number,end:number){let sine=0,cosine=0,count=0;for(let index=Math.round(start*48000);index<Math.round(end*48000);index++){const value=bytes.readFloatLE(index*4),angle=2*Math.PI*frequency*index/48000;sine+=value*Math.sin(angle);cosine+=value*Math.cos(angle);count++;}return 2*Math.hypot(sine,cosine)/count;}
function rms(bytes:Buffer,start:number,end:number){let sum=0,count=0;for(let index=Math.round(start*48000);index<Math.round(end*48000);index++){const value=bytes.readFloatLE(index*4);sum+=value*value;count++;}return Math.sqrt(sum/count);}
async function exactDuration(movie:string,frames:number,fps=24){const result=await runProcess('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=duration,nb_read_frames:format=duration','-of','json',movie]);assert.equal(result.code,0,result.stderr);const data=parseJsonOutput(result.stdout);assert.equal(Number(data.streams[0].nb_read_frames),frames);assert.ok(Math.abs(Number(data.streams[0].duration)-frames/fps)<.00001);assert.ok(Math.abs(Number(data.format.duration)-frames/fps)<.04);}

test('real dissolve uses outgoing source handles, inclusive frame opacity, crossfaded sound and unchanged overlay/subtitle anchors',{timeout:120000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'filmma-dissolve-'));
  try{
    await ffmpeg(['-f','lavfi','-i','color=red:s=320x180:r=24:d=1','-f','lavfi','-i','color=0x00ff00:s=320x180:r=24:d=1','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-map','2:a','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-t','2',join(directory,'out.mp4')]);
    await video(join(directory,'in.mp4'),'blue',2,880);await picture(join(directory,'white.png'),'white');
    const p=project([['out','video','mp4'],['in','video','mp4'],['white','image','png']]);p.scenes=[shot('outgoing','out'),shot('incoming','in',2,'dissolve')];
    p.tracks=[{id:'overlay',name:'Referencia',type:'video',muted:true,volume:1,clips:[{id:'white',assetId:'white',sceneId:'incoming',offset:1,duration:.25,trimStart:0,opacity:.2}]}];
    p.subtitleCues=[{id:'caption',sceneId:'incoming',start:1.5,end:1.75,text:'Una palabra.'}];p.subtitlesEnabled=true;
    const movie=await render(p,directory),frames=[23,24,29,35,36,48,54];
    const colors=await pixels(movie,directory,frames);
    near(colors[0]!,[255,0,0]);near(colors[1]!,[0,255,0]);near(colors[2]!,[0,255*6/11,255*5/11]);near(colors[3]!,[0,0,255]);near(colors[4]!,[0,0,255]);near(colors[5]!,[51,51,255]);near(colors[6]!,[0,0,255]);
    const bottom=await pixels(movie,directory,[59,60,66],24,158);assert.ok(bottom[0]![2]!>235);assert.ok(bottom[1]![2]!<110);assert.ok(bottom[2]![2]!>235);
    const samples=await audio(movie,directory),outBase=amplitude(samples,440,.4,.45),inBase=amplitude(samples,880,1.8,1.85);
    assert.ok(amplitude(samples,440,1,1.05)>outBase*.8,'source handle sound starts at outgoing gain');assert.ok(amplitude(samples,880,1,1.05)<inBase*.2,'incoming sound starts near silence');
    const outMid=amplitude(samples,440,1.2,1.25)/outBase,inMid=amplitude(samples,880,1.2,1.25)/inBase;assert.ok(outMid>.35&&outMid<.65,String(outMid));assert.ok(inMid>.35&&inMid<.65,String(inMid));
    assert.ok(amplitude(samples,440,1.5,1.55)<outBase*.04);assert.ok(amplitude(samples,880,1.5,1.55)>inBase*.85);await exactDuration(movie,72);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('dip and following dissolve retain rational scene positions, black endpoints and matching audio envelopes',{timeout:120000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'filmma-dip-'));
  try{
    await video(join(directory,'red.mp4'),'red',2,440);await video(join(directory,'blue.mp4'),'blue',3,880);await picture(join(directory,'yellow.png'),'yellow');
    const p=project([['red','video','mp4'],['blue','video','mp4'],['yellow','image','png']]);p.scenes=[shot('red-shot','red',25/24),shot('blue-shot','blue',26/24,'dip'),shot('yellow-shot','yellow',1,'dissolve')];
    const movie=await render(p,directory),transitions=resolveSceneTransitions(p),dip=transitions[0]!,dissolve=transitions[1]!;
    const frames=[dip.startFrame,dip.startFrame+2,dip.boundaryFrame-1,dip.boundaryFrame,dip.boundaryFrame+2,dip.endFrame-1,dissolve.startFrame,dissolve.startFrame+5,dissolve.endFrame-1];
    const colors=await pixels(movie,directory,frames);
    near(colors[0]!,[255,0,0]);near(colors[1]!,[255*transitionOpacity(dip,frames[1]!).outgoing,0,0]);near(colors[2]!,[0,0,0]);near(colors[3]!,[0,0,0]);near(colors[4]!,[0,0,255*transitionOpacity(dip,frames[4]!).incoming]);near(colors[5]!,[0,0,255]);
    near(colors[6]!,[0,0,255]);const mix=transitionOpacity(dissolve,frames[7]!);near(colors[7]!,[255*mix.incoming,255*mix.incoming,255*mix.outgoing]);near(colors[8]!,[255,255,0]);
    const samples=await audio(movie,directory),cut=dip.boundaryFrame/24,base=rms(samples,.4,.45);assert.ok(rms(samples,cut-.035,cut+.015)<base*.15,'dip has a silent region at the black cut');assert.ok(rms(samples,cut+.3,cut+.35)>base*.75,'incoming sound returns after the dip');
    const end=dissolve.endFrame/24;assert.ok(rms(samples,end+.05,end+.1)<base*.03,'dissolving from a video to a silent still ends silently');await exactDuration(movie,75);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('exhausted outgoing media holds the real last picture and adds no invented handle audio',{timeout:120000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'filmma-transition-eof-'));
  try{
    await video(join(directory,'short.mp4'),'red',.25,440);await video(join(directory,'blue.mp4'),'blue',1,880);
    const p=project([['short','video','mp4'],['blue','video','mp4']]);p.scenes=[shot('held','short'),shot('next','blue',1,'dissolve')];
    const movie=await render(p,directory),colors=await pixels(movie,directory,[23,24,29,35]);near(colors[0]!,[255,0,0]);near(colors[1]!,[255,0,0]);near(colors[2]!,[255*6/11,0,255*5/11]);near(colors[3]!,[0,0,255]);
    const samples=await audio(movie,directory),baseline=amplitude(samples,880,1.7,1.75);assert.ok(rms(samples,.7,.8)<.0002);assert.ok(amplitude(samples,440,1,1.05)<.001);assert.ok(amplitude(samples,880,1,1.05)<baseline*.2);await exactDuration(movie,48);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('one-frame dip is black exactly once and one-frame dissolve is an effective cut',{timeout:120000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'filmma-short-transitions-'));
  try{
    await picture(join(directory,'red.png'),'red');await picture(join(directory,'blue.png'),'blue');await picture(join(directory,'green.png'),'#00ff00');
    for(const fps of [24,25,30] as const){
      const p=project([['red','image','png'],['blue','image','png'],['green','image','png']]);p.fps=fps;p.scenes=[shot('red','red'),shot('blue','blue',1,'dip',1/fps),shot('green','green',1,'dissolve',1/fps)];
      const movie=await render(p,directory,`film-${fps}`),colors=await pixels(movie,directory,[fps-1,fps,fps+1,2*fps-1,2*fps]);near(colors[0]!,[255,0,0]);near(colors[1]!,[0,0,0]);near(colors[2]!,[0,0,255]);near(colors[3]!,[0,0,255]);near(colors[4]!,[0,255,0]);await exactDuration(movie,3*fps,fps);
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('source handles respect trimStart and never revive an explicitly faded-out soundtrack',{timeout:120000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'filmma-transition-trim-'));
  try{
    const args:string[]=[];for(const color of ['red','0x00ff00','yellow','0xff00ff'])args.push('-f','lavfi','-i',`color=${color}:s=320x180:r=24:d=0.5`);
    args.push('-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-filter_complex','[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]','-map','[v]','-map','4:a','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-t','2',join(directory,'source.mp4'));await ffmpeg(args);await picture(join(directory,'blue.png'),'blue');
    const p=project([['source','video','mp4'],['blue','image','png']]);p.scenes=[{...shot('trimmed','source'),trimStart:.5,audio:{fadeOut:.25}},shot('next','blue',1,'dissolve')];
    const movie=await render(p,directory),colors=await pixels(movie,directory,[0,23,24,35]);near(colors[0]!,[0,255,0]);near(colors[1]!,[255,255,0]);near(colors[2]!,[255,0,255]);near(colors[3]!,[0,0,255]);
    const samples=await audio(movie,directory);assert.ok(rms(samples,.3,.35)>.03);assert.ok(rms(samples,1.05,1.4)<.0002,'manual fade-out must not restart in the handle');await exactDuration(movie,48);
  }finally{await rm(directory,{recursive:true,force:true});}
});
