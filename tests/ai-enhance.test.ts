import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aiTargetDimensions, enhanceVideoWithAi, validateAiFrameClock } from '../server/ai-enhance.js';
import { createApp } from '../server/app.js';
import { runProcess } from '../server/process.js';
import { assetSchema, projectSchema } from '../server/types.js';
import { assignScenePatch } from '../src/scene-source.js';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function fixture(ready = true, legacyWorker = false, wrongTemporalMode = false, temporalReady = true) {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-ai-enhance-')), dataDirectory = join(directory, 'data');
  await mkdir(join(dataDirectory, 'media'), { recursive: true });
  const source = join(dataDirectory, 'media', 'source.mp4'), worker = join(directory, 'worker.cjs');
  // A deterministic fake worker exercises Node's verification contract without
  // claiming this conventional scaler is an AI inference or touching the GPU.
  await writeFile(worker, `const fs=require('node:fs'),{spawnSync}=require('node:child_process');
const status={ok:true,ready:${ready},installed:${ready},supported:true,temporalAvailable:${temporalReady},model:'realesrgan-x4plus'};
if(process.argv[2]==='doctor'){console.log(JSON.stringify(status));process.exit(0)}
if(process.argv[2]==='setup'){setTimeout(()=>{console.log(JSON.stringify({event:'result',...status}))},150);return}
const r=JSON.parse(fs.readFileSync(process.argv.at(-1)));fs.mkdirSync(r.workDirectory,{recursive:true});
const p=spawnSync(r.ffmpeg,['-v','error','-i',r.source,'-an','-vf','scale='+r.targetWidth+':'+r.targetHeight,'-fps_mode','passthrough','-c:v','libx264','-preset','ultrafast','-threads','2',r.destination],{encoding:'utf8'});
if(p.status){console.error(p.stderr);process.exit(1)}
console.log(JSON.stringify({event:'result',ok:true,model:'realesrgan-x4plus',engine:'realesrgan-ncnn-vulkan',version:'20220424',modelSha256:'a'.repeat(64),tile:128,...(!${legacyWorker}&&r.processingProfile!=='conservative'?{processingProfile:r.processingProfile,temporalMode:${wrongTemporalMode ? "'frame-independent-conservative'" : "r.processingProfile==='temporal'?'motion-compensated-residual-v1':'frame-independent-color-preserving-v1'"}}:{temporalMode:'frame-independent-conservative'}),metrics:{wallSeconds:1,secondsPerFrame:.5,memoryNote:'Synthetic worker contract test',...(r.processingProfile==='temporal'?{temporal:{frames:r.frames,stabilizedFrames:r.frames-1,resets:0,meanConfidence:.8,maxTemporalChangeRgb:5,maxPreviousWeight:.45,maximumRgbUpdate:6,stateFrames:1,flowMaxDimension:960,method:'Synthetic temporal contract test',limit:'Not real temporal inference'}}:{})}}));
`);
  const made = await runProcess('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x54:rate=30000/1001:duration=0.067', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.067', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=0.067', '-map', '0:v:0', '-map', '1:a:0', '-map', '2:a:0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
  assert.equal(made.code, 0, made.stderr);
  const f = await createApp({ dataDirectory, skipDiagnostics: true, python: process.execPath, upscalerPath: worker });
  f.store.project.assets.push({ id: 'source', name: 'Toma', type: 'video', url: '/api/media/source.mp4', mime: 'video/mp4', size: (await readFile(source)).length });
  f.store.project.scenes[0]!.videoAssetId = 'source';
  f.store.project.scenes[0]!.trimStart = .02; f.store.project.scenes[0]!.speed = .5;
  const server = f.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Filmma-Client': 'filmma' }, body: JSON.stringify(body) });
  const wait = async (id: string) => { for (let n = 0; n < 1200; n++) { const job = f.store.jobs.find(item => item.id === id)!; if (['failed', 'completed', 'cancelled'].includes(job.status)) return job; await new Promise(done => setTimeout(done, 25)); } throw new Error('Timeout'); };
  return { ...f, directory, source, worker, base, post, wait, close: async () => { await f.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); await rm(directory, { recursive: true, force: true }); } };
}

test('AI 4K target stays within UHD area and preserves portrait, landscape and square framing', () => {
  assert.deepEqual(aiTargetDimensions(512, 288), [3840, 2160]);
  assert.deepEqual(aiTargetDimensions(288, 512), [2160, 3840]);
  assert.deepEqual(aiTargetDimensions(640, 640), [2880, 2880]);
  assert.deepEqual(aiTargetDimensions(864, 480), [3840, 2132]);
});

test('stable restoration keeps its own default and provenance without accepting an unprepared component', {timeout:60000}, async()=>{
  const unavailable = await fixture(true,false,false,false);
  try {
    const response=await unavailable.post('/api/assets/source/enhance',{projectId:unavailable.store.project.id,preset:'ai-4k',processingProfile:'temporal'});
    assert.equal(response.status,409);assert.equal(unavailable.store.jobs.length,0);
  } finally {await unavailable.close();}
  const f=await fixture();
  try {
    const originalHash=hash(await readFile(f.source)),before=structuredClone(f.store.project);
    const response=await f.post('/api/assets/source/enhance',{projectId:before.id,preset:'ai-4k',processingProfile:'temporal'});
    assert.equal(response.status,202,await response.clone().text());
    const job=await f.wait((await response.json()).job.id);assert.equal(job.status,'completed',job.message);
    const asset=f.store.project.assets.find(item=>item.id===job.result?.assetId)!;
    assert.equal(asset.enhancement?.profile,'temporal');assert.equal(asset.enhancement?.strength,.65);
    assert.equal(asset.enhancement?.temporalMode,'motion-compensated-residual-v1');assert.equal(asset.enhancement?.sourceAssetId,'source');
    assert.equal(hash(await readFile(f.source)),originalHash);assert.deepEqual(f.store.project.scenes,before.scenes);assert.deepEqual(f.store.project.characters,before.characters);
    const settings=projectSchema.parse({...before,aiFinishing:{enabled:true,processingProfile:'temporal'}}).aiFinishing;
    assert.equal(settings?.strength,.65);
    assert.equal(projectSchema.parse({...before,aiFinishing:{enabled:true,processingProfile:'restore'}}).aiFinishing?.strength,.75);
    assert.equal(projectSchema.parse({...before,aiFinishing:{enabled:true}}).aiFinishing?.strength,.35);
    assert(assetSchema.safeParse(asset).success);
    const exported=await f.wait((await(await f.post('/api/export',{format:'project'})).json()).job.id);
    assert.equal(exported.status,'completed',exported.message);
    const form=new FormData();form.append('projectFile',await(await fetch(f.base+exported.result!.url)).blob(),'stable.filmma.zip');
    const imported=await fetch(f.base+'/api/projects/import',{method:'POST',headers:{'X-Filmma-Client':'filmma'},body:form});
    assert.equal(imported.status,201,await imported.clone().text());
    const restored=(await imported.json()).project.assets.find((item:any)=>item.enhancement?.profile==='temporal');
    assert.equal(restored.enhancement.temporalMode,'motion-compensated-residual-v1');
    assert.equal(restored.enhancement.metrics.temporal.stateFrames,1);
    assert.equal(restored.enhancement.metrics.temporal.frames,3);
  } finally {await f.close();}
});

test('AI route preserves rational frames, both audio tracks, originals, screenplay and provenance across ZIP', { timeout: 60000 }, async () => {
  const f = await fixture();
  try {
    const fingerprint = hash(await readFile(f.source)), scenes = JSON.stringify(f.store.project.scenes), characters = JSON.stringify(f.store.project.characters);
    const response = await f.post('/api/assets/source/enhance', { projectId: f.store.project.id, preset: 'ai-4k', strength: .35 });
    assert.equal(response.status, 202, await response.clone().text());
    const job = await f.wait((await response.json()).job.id); assert.equal(job.status, 'completed', job.message);
    const asset = f.store.project.assets.find(item => item.id === job.result?.assetId)!;
    assert.equal(asset.enhancement?.method, 'realesrgan-ncnn'); assert.equal(asset.enhancement?.modelSha256, 'a'.repeat(64)); assert.equal(asset.enhancement?.strength, .35);
    assert.equal(asset.enhancement?.width, 3840); assert.equal(asset.enhancement?.height, 2160); assert.equal(asset.enhancement?.fps, 30000 / 1001);
    const output = join(f.directory, 'data', 'media', `${asset.id}.mp4`);
    for (let track = 0; track < 2; track++) {
      const packets = await Promise.all([f.source, output].map(path => runProcess('ffmpeg', ['-v', 'error', '-i', path, '-map', `0:a:${track}`, '-c', 'copy', '-f', 'hash', '-'])));
      assert.equal(packets[0]!.stdout, packets[1]!.stdout);
    }
    assert.equal(hash(await readFile(f.source)), fingerprint); assert.equal(JSON.stringify(f.store.project.scenes), scenes); assert.equal(JSON.stringify(f.store.project.characters), characters);
    const scene = assignScenePatch(f.store.project.scenes[0]!, { videoAssetId: asset.id }, f.store.project.assets);
    assert.equal(scene.trimStart, .02); assert.equal(scene.speed, .5); assert.deepEqual(scene.characterIds, f.store.project.scenes[0]!.characterIds);
    assert.deepEqual(await readdir(join(f.directory, 'data', 'work')), []);
    const exportJob = await f.wait((await (await f.post('/api/export', { format: 'project' })).json()).job.id); assert.equal(exportJob.status, 'completed', exportJob.message);
    const form = new FormData(); form.append('projectFile', await (await fetch(f.base + exportJob.result!.url)).blob(), 'ai.filmma.zip');
    const imported = await fetch(f.base + '/api/projects/import', { method: 'POST', headers: { 'X-Filmma-Client': 'filmma' }, body: form }); assert.equal(imported.status, 201, await imported.clone().text());
    const project = (await imported.json()).project, restored = project.assets.find((item: any) => item.enhancement?.preset === 'ai-4k');
    assert.equal(restored.enhancement.modelSha256, 'a'.repeat(64)); assert.notEqual(restored.enhancement.sourceAssetId, 'source'); assert(project.assets.some((item: any) => item.id === restored.enhancement.sourceAssetId));
    assert(assetSchema.safeParse(restored).success);
  } finally { await f.close(); }
});

test('setup deduplicates simultaneous requests in creative queue and missing model never silently falls back', { timeout: 30000 }, async () => {
  const f = await fixture(false);
  try {
    assert.equal((await (await fetch(f.base + '/api/upscaler')).json()).ready, false);
    const missing = await f.post('/api/assets/source/enhance', { projectId: f.store.project.id, preset: 'ai-4k' }); assert.equal(missing.status, 409); assert.equal(f.store.jobs.length, 0);
    const responses = await Promise.all([f.post('/api/upscaler/setup', {}), f.post('/api/upscaler/setup', {})]);
    const jobs = await Promise.all(responses.map(response => response.json())); assert.equal(jobs[0].job.id, jobs[1].job.id); assert.equal(f.store.jobs.length, 1);
    const done = await f.wait(jobs[0].job.id); assert.equal(done.status, 'failed'); assert.match(done.message, /todavía no está listo/);
    for (const strength of [0, .71, 2]) assert.equal((await f.post('/api/assets/source/enhance', { projectId: f.store.project.id, preset: 'ai-4k', strength })).status, 400);
    assert.deepEqual(await readdir(join(f.directory, 'data', 'media')), ['source.mp4']);
  } finally { await f.close(); }
});

test('restoration defaults, original families and provenance survive save and project ZIP without changing legacy settings', { timeout: 60000 }, async () => {
  const f = await fixture();
  try {
    const originalHash = hash(await readFile(f.source)), before = structuredClone(f.store.project);
    for (const body of [{strength:.71},{processingProfile:'unknown'},{processingProfile:'restore',strength:.86}]) {
      assert.equal((await f.post('/api/assets/source/enhance', {projectId:before.id,preset:'ai-4k',...body})).status,400);
    }
    const response = await f.post('/api/assets/source/enhance', {projectId:before.id,preset:'ai-4k',processingProfile:'restore'});
    assert.equal(response.status,202);
    const job = await f.wait((await response.json()).job.id); assert.equal(job.status,'completed',job.message);
    const asset = f.store.project.assets.find(item=>item.id===job.result?.assetId)!;
    assert.equal(asset.enhancement?.profile,'restore'); assert.equal(asset.enhancement?.strength,.75);
    assert.equal(asset.enhancement?.temporalMode,'frame-independent-color-preserving-v1');
    assert.equal(asset.enhancement?.sourceAssetId,'source');
    const conservative = await f.post(`/api/assets/${asset.id}/enhance`,{projectId:before.id,preset:'ai-4k'});
    assert.equal(conservative.status,202);
    const second = await f.wait((await conservative.json()).job.id); assert.equal(second.status,'completed',second.message);
    const secondAsset = f.store.project.assets.find(item=>item.id===second.result?.assetId)!;
    assert.equal(secondAsset.enhancement?.sourceAssetId,'source','changing profile processes the retained source, not the 4K copy');
    assert.equal(secondAsset.enhancement?.profile,'conservative'); assert.equal(secondAsset.enhancement?.strength,.35);
    f.store.project.aiFinishing={enabled:true,strength:.75,processingProfile:'restore'};
    assert.deepEqual(projectSchema.parse(f.store.project).aiFinishing,f.store.project.aiFinishing);
    assert.deepEqual(projectSchema.parse({...f.store.project,aiFinishing:{enabled:true,processingProfile:'restore'}}).aiFinishing,{enabled:true,processingProfile:'restore',strength:.75});
    assert.deepEqual(projectSchema.parse({...f.store.project,aiFinishing:{enabled:true}}).aiFinishing,{enabled:true,strength:.35});
    assert.equal(projectSchema.safeParse({...f.store.project,aiFinishing:{enabled:true,strength:.71}}).success,false);
    await f.store.save();
    const exportJob=await f.wait((await(await f.post('/api/export',{format:'project'})).json()).job.id); assert.equal(exportJob.status,'completed',exportJob.message);
    const form = new FormData();form.append('projectFile',await(await fetch(f.base+exportJob.result!.url)).blob(),'restore.filmma.zip');
    const imported=await fetch(f.base+'/api/projects/import',{method:'POST',headers:{'X-Filmma-Client':'filmma'},body:form});assert.equal(imported.status,201,await imported.clone().text());
    const restored=(await imported.json()).project;
    assert.deepEqual(restored.aiFinishing,{enabled:true,strength:.75,processingProfile:'restore'});
    const restoredCopy=restored.assets.find((item:any)=>item.enhancement?.profile==='restore');
    assert.equal(restoredCopy.enhancement.strength,.75);assert.equal(restoredCopy.enhancement.temporalMode,'frame-independent-color-preserving-v1');
    assert(restored.assets.some((item:any)=>item.id===restoredCopy.enhancement.sourceAssetId));
    assert.equal(hash(await readFile(f.source)),originalHash);
  } finally {await f.close();}
});

test('restore refuses a legacy worker or a result with the wrong temporal processing mode', {timeout:30000}, async()=>{
 for (const legacy of [true,false]) {
  const f=await fixture(true,legacy,!legacy);
  try {
    const originalHash=hash(await readFile(f.source)),count=f.store.project.assets.length;
    const response=await f.post('/api/assets/source/enhance',{projectId:f.store.project.id,preset:'ai-4k',processingProfile:'restore'});
    assert.equal(response.status,202);
    const job=await f.wait((await response.json()).job.id);assert.equal(job.status,'failed');assert.match(job.message,/perfil de acabado/);
    assert.equal(f.store.project.assets.length,count);assert.equal(hash(await readFile(f.source)),originalHash);
    assert.deepEqual(await readdir(join(f.directory,'data/media')),['source.mp4']);
  } finally {await f.close();}
 }
});

test('VFR and clips over 15 seconds are rejected before worker inference', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-ai-clock-'));
  try {
    const variable = join(directory, 'variable.mp4'), long = join(directory, 'long.mp4');
    const vfr = await runProcess('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=96x64:r=24:d=1', '-vf', "select='not(eq(n,4))'", '-fps_mode', 'vfr', '-c:v', 'libx264', variable]); assert.equal(vfr.code, 0, vfr.stderr);
    await assert.rejects(validateAiFrameClock(variable, 'ffprobe', new AbortController().signal, 23, 23), /velocidad variable/);
    const made = await runProcess('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=32x32:r=24:d=15.1', '-c:v', 'libx264', long]); assert.equal(made.code, 0);
    await assert.rejects(enhanceVideoWithAi({ source: long, destination: join(directory, 'output.mp4'), workDirectory: join(directory, 'work'), strength: .35, python: 'missing-python', workerPath: '/missing-worker.py', ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', signal: new AbortController().signal, update() {} }), /hasta 15 segundos/);
    assert(!(await readdir(directory)).includes('output.mp4'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('cancelling AI inference removes partial work and leaves the source unchanged', { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const fingerprint = hash(await readFile(f.source)), workDirectory = join(f.directory, 'cancel-work'), destination = join(f.directory, 'cancelled.mp4');
    await writeFile(f.worker, "const fs=require('node:fs');const r=JSON.parse(fs.readFileSync(process.argv.at(-1)));fs.writeFileSync(r.destination,'partial');setTimeout(()=>{},20000);");
    const controller = new AbortController();
    const work = enhanceVideoWithAi({ source: f.source, destination, workDirectory, strength: .35, python: process.execPath, workerPath: f.worker, ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', signal: controller.signal, update() {} });
    const rejected = assert.rejects(work, /cancelado/);
    for (let n = 0; n < 100; n++) { if (await readFile(join(workDirectory, 'ai-silent.mp4')).catch(() => undefined)) break; await new Promise(done => setTimeout(done, 20)); }
    controller.abort(); await rejected;
    assert.equal(hash(await readFile(f.source)), fingerprint);
    assert(!(await readdir(f.directory)).includes('cancel-work')); assert(!(await readdir(f.directory)).includes('cancelled.mp4'));
  } finally { await f.close(); }
});
