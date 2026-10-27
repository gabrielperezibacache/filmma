import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createSeedProject } from '../server/seed.js';
import { renderProject } from '../server/render.js';
import { runProcess, parseJsonOutput } from '../server/process.js';

test('montage preserves every decoded source sample until the final delivery encode', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-picture-quality-'));
  try {
    const source = join(directory, 'source.mp4'), work = join(directory, 'work'), destination = join(directory, 'movie.mp4');
    await mkdir(work);
    const made = await runProcess('ffmpeg', ['-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=24:duration=0.5','-c:v','libx264','-crf','18','-pix_fmt','yuv420p',source]);
    assert.equal(made.code, 0, made.stderr);
    const fingerprint = createHash('sha256').update(await readFile(source)).digest('hex');
    const project = createSeedProject(); project.subtitlesEnabled = false; project.subtitleCues = []; project.tracks = []; project.audioAssetId = undefined;
    project.assets = [{ id:'source',name:'Fuente',type:'video',url:'/api/media/source.mp4',mime:'video/mp4',size:0 }];
    project.scenes = [{ ...project.scenes[0]!,assetId:undefined,videoAssetId:'source',duration:.5,trimStart:0,look:'original',transition:'cut',color:undefined }];
    const before = structuredClone(project);
    await renderProject(project, { destination,workDirectory:work,mediaPath:async()=>source,signal:new AbortController().signal,update:()=>{},dimensions:[160,90] });
    const intermediate = (await readdir(work)).find(name=>/^clip-.*\.mov$/.test(name));
    assert(intermediate);
    const pictureHash = async (path:string) => {
      const result = await runProcess('ffmpeg',['-v','error','-i',path,'-map','0:v:0','-an','-pix_fmt','yuv420p','-f','hash','-']);
      assert.equal(result.code,0,result.stderr); return result.stdout.trim();
    };
    assert.equal(await pictureHash(join(work,intermediate)),await pictureHash(source),'The montage stage must not add compression loss before delivery');
    const verified=await runProcess('ffprobe',['-v','error','-count_frames','-show_entries','stream=codec_type,width,height,nb_read_frames,avg_frame_rate','-of','json',destination]);
    assert.equal(verified.code,0,verified.stderr);
    const video=parseJsonOutput(verified.stdout).streams.find((stream:any)=>stream.codec_type==='video');
    assert.equal(video.width,160);assert.equal(video.height,90);assert.equal(video.nb_read_frames,'12');assert.equal(video.avg_frame_rate,'24/1');
    assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'),fingerprint);
    assert.deepEqual(project,before);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
