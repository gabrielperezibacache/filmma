import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { runProcess, parseJsonOutput } from '../server/process.js';

async function fixture(mode = 'success') {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-film-ai-')), dataDirectory = join(directory, 'data');
  await mkdir(join(dataDirectory, 'media'), { recursive: true });
  const source = join(dataDirectory, 'media', 'source.mp4'), worker = join(directory, 'upscaler.cjs'), runtimePath = join(directory, 'generation.cjs'), controls = join(directory, 'controls.json'), calls = join(directory, 'calls.jsonl'), release = join(directory, 'release');
  const generated = await runProcess('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x54:rate=24:duration=0.083333', '-c:v', 'libx264', source]); assert.equal(generated.code, 0, generated.stderr);
  await writeFile(controls, JSON.stringify({ mode, ready: true }));
  await writeFile(runtimePath, `const fs=require('node:fs');const r=JSON.parse(fs.readFileSync(process.argv.at(-1)));fs.copyFileSync(${JSON.stringify(source)},r.outputPath);console.log(JSON.stringify({type:'result',ok:true}));`);
  await writeFile(worker, `const fs=require('node:fs'),{spawnSync}=require('node:child_process');
const controls=JSON.parse(fs.readFileSync(${JSON.stringify(controls)}));
const info={ok:true,ready:controls.ready,model:'realesrgan-x4plus',engine:'realesrgan-ncnn-vulkan',version:'20220424',modelSha256:'a'.repeat(64),tile:128,temporalMode:'frame-independent-conservative'};
if(process.argv[2]==='doctor'){console.log(JSON.stringify(info));process.exit(0)}
const r=JSON.parse(fs.readFileSync(process.argv.at(-1)));fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(r)+'\\n');
async function run(){if(controls.mode==='pause')while(!fs.existsSync(${JSON.stringify(release)}))await new Promise(done=>setTimeout(done,20));
if(controls.mode==='fail'){console.log(JSON.stringify({event:'error',message:'Fallo IA simulado conservando original'}));process.exit(1)}
const out=spawnSync(r.ffmpeg,['-v','error','-i',r.source,'-an','-vf','scale='+r.targetWidth+':'+r.targetHeight,'-fps_mode','passthrough','-c:v','libx264','-preset','ultrafast','-threads','2',r.destination],{encoding:'utf8'});
if(out.status){console.error(out.stderr);process.exit(1)}console.log(JSON.stringify({...info,...(r.processingProfile==='restore'?{processingProfile:'restore',temporalMode:'frame-independent-color-preserving-v1'}:{}),event:'result'}))}run();`);
  const f = await createApp({ dataDirectory, python: process.execPath, upscalerPath: worker, runtimePath, skipDiagnostics: true });
  f.store.project.assets.push({ id: 'source', name: 'Toma original', type: 'video', url: '/api/media/source.mp4', mime: 'video/mp4', size: (await readFile(source)).length });
  f.store.project.scenes = f.store.project.scenes.slice(0, 3);
  for (const scene of f.store.project.scenes.slice(0, 2)) { scene.videoAssetId = 'source'; scene.duration = 1; scene.trimStart = .01; scene.speed = .5; scene.color = { exposure: .2 }; }
  f.store.project.tracks = [{ id: 'layer', type: 'video', name: 'Capa', muted: true, volume: 1, clips: [{ id: 'clip', assetId: 'source', sceneId: f.store.project.scenes[0]!.id, offset: 0, duration: 1, trimStart: .02, speed: .75, color: { saturation: .8 }, keyframes: [{ id: 'key', time: 0, x: 10, y: 0, scale: .3, opacity: .8, easing: 'linear' }] }] }];
  await f.store.save();
  const server = f.app.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const request = (path: string, body: unknown, method = 'POST') => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Filmma-Client': 'filmma' }, body: JSON.stringify(body) });
  const wait = async (id: string) => { for (let n = 0; n < 2000; n++) { const job = f.store.jobs.find(item => item.id === id)!; if (['completed', 'failed', 'cancelled'].includes(job.status)) return job; await new Promise(done => setTimeout(done, 20)); } throw new Error('Job timeout'); };
  const waitStarted = async () => { for (let n = 0; n < 500; n++) { if (await readFile(calls).catch(() => undefined)) return; await new Promise(done => setTimeout(done, 20)); } throw new Error('Worker timeout'); };
  const records = async () => (await readFile(calls, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  return { ...f, directory, dataDirectory, source, base, controls, calls, release, request, wait, waitStarted, records, close: async () => { await f.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); await rm(directory, { recursive: true, force: true }); } };
}

test('batch deduplicates sources and active requests, applies same copy to scenes and layer, and reuses compatible versions', { timeout: 60000 }, async () => {
  const f = await fixture();
  try {
    const before = structuredClone(f.store.project), body = { projectId: before.id, strength: .35 };
    const responses = await Promise.all([f.request('/api/enhance-sequence', body), f.request('/api/enhance-sequence', body)]);
    const submitted = await Promise.all(responses.map(response => response.json())); assert.equal(submitted[0].job.id, submitted[1].job.id);
    assert.equal(submitted[0].job.result.projectId, before.id); assert.equal(submitted[0].job.result.finishing.total, 1);
    const job = await f.wait(submitted[0].job.id); assert.equal(job.status, 'completed', job.message);
    assert.equal(job.result?.finishing?.created, 1); assert.equal(job.result?.finishing?.applied, 3); assert.equal(job.result?.finishing?.skipped, 1); assert.equal((await f.records()).length, 1);
    const derivative = job.result!.finishing!.items.find(item => item.status === 'created')!.assetId;
    for (let i = 0; i < 2; i++) assert.deepEqual(f.store.project.scenes[i], { ...before.scenes[i], videoAssetId: derivative });
    assert.deepEqual(f.store.project.tracks![0]!.clips[0], { ...before.tracks![0]!.clips[0], assetId: derivative });
    assert.deepEqual(f.store.project.characters, before.characters);
    const repeated = await f.wait((await (await f.request('/api/enhance-sequence', body)).json()).job.id); assert.equal(repeated.status, 'completed'); assert.equal(repeated.result?.finishing?.reused, 1); assert.equal((await f.records()).length, 1);
    const different = await f.wait((await (await f.request('/api/enhance-sequence', { ...body, strength: .5 })).json()).job.id); assert.equal(different.status, 'completed', different.message); assert.equal(different.result?.finishing?.created, 1);
    const records = await f.records(); assert.equal(records.length, 2); assert.equal(records[0].source, f.source); assert.equal(records[1].source, f.source, 'new intensity always starts from the original');
  } finally { await f.close(); }
});

test('processing profiles have distinct batch jobs and caches and always return to the retained original', { timeout: 60000 }, async()=>{
  const f=await fixture('pause');
  try {
    const body={projectId:f.store.project.id,strength:.35};
    const replies=await Promise.all([f.request('/api/enhance-sequence',body),f.request('/api/enhance-sequence',{...body,processingProfile:'restore'}),f.request('/api/enhance-sequence',{...body,processingProfile:'restore'})]);
    assert(replies.every(response=>response.status===202));
    const jobs=await Promise.all(replies.map(response=>response.json()));
    assert.notEqual(jobs[0].job.id,jobs[1].job.id);assert.equal(jobs[1].job.id,jobs[2].job.id);
    await f.waitStarted();await writeFile(f.release,'go');
    for(const submitted of jobs.slice(0,2)){const job=await f.wait(submitted.job.id);assert.equal(job.status,'completed',job.message);assert.equal(job.result?.finishing?.created,1);}
    const records=await f.records();assert.equal(records.length,2);assert.deepEqual(records.map(record=>record.processingProfile).sort(),['conservative','restore']);assert(records.every(record=>record.source===f.source));
    const again=await f.wait((await(await f.request('/api/enhance-sequence',{...body,processingProfile:'restore'})).json()).job.id);
    assert.equal(again.status,'completed',again.message);assert.equal(again.result?.finishing?.reused,1);assert.equal((await f.records()).length,2);
  }finally{await f.close();}
});

test('automatic generation finishing passes the chosen restoration profile and conserves the generated original', {timeout:60000},async()=>{
 const f=await fixture();try{
  f.store.project.aiFinishing={enabled:true,strength:.8,processingProfile:'restore'};
  const response=await f.request('/api/generate',{sceneId:f.store.project.scenes[0]!.id,model:'ltx-2b',conditioningMode:'text',duration:1});assert.equal(response.status,202);
  const job=await f.wait((await response.json()).job.id);assert.equal(job.status,'completed',job.message);
  const records=await f.records();assert.equal(records.length,1);assert.equal(records[0].processingProfile,'restore');assert.equal(records[0].strength,.8);
  const original=f.store.project.assets.find(asset=>asset.id===job.result?.originalAssetId)!;assert(original);assert.equal(original.enhancement,undefined);
  const selected=f.store.project.assets.find(asset=>asset.id===f.store.project.scenes[0]!.videoAssetId)!;
  assert.equal(selected.enhancement?.sourceAssetId,original.id);assert.equal(selected.enhancement?.profile,'restore');assert.equal(selected.enhancement?.strength,.8);
 }finally{await f.close();}
});

test('strict 4K export requires the reviewed restoration profile and reuses the reviewed copy without neural inference', {timeout:60000},async()=>{
 const f=await fixture();try{
  f.store.project.scenes=f.store.project.scenes.slice(0,1);f.store.project.tracks=[];
  const scene=f.store.project.scenes[0]!;scene.trimStart=0;scene.speed=1;scene.characterIds=[];
  const prepared=await f.wait((await(await f.request('/api/enhance-sequence',{projectId:f.store.project.id,processingProfile:'restore'})).json()).job.id);assert.equal(prepared.status,'completed',prepared.message);
  const response=await f.request('/api/continuity/analyze',{projectId:f.store.project.id});assert.equal(response.status,202);
  const analysis=await f.wait((await response.json()).job.id);assert.equal(analysis.status,'completed',analysis.message);
  const report=(await(await fetch(f.base+'/api/continuity')).json()).report;
  assert.equal((await f.request('/api/continuity/review',{projectId:f.store.project.id,reportId:report.id,fingerprint:report.fingerprint,note:'Fixture acknowledges zero inter-scene comparisons.'},'PUT')).status,200);
  const body={format:'mp4',resolution:'2160p',aiEnhance:true,requireContinuityReview:true,continuityReportId:report.id,continuityFingerprint:report.fingerprint};
  const before=f.store.jobs.length;
  assert.equal((await f.request('/api/export',body)).status,409,'conservative cannot replace a reviewed restoration copy');assert.equal(f.store.jobs.length,before);
  assert.equal((await f.request('/api/export',{...body,processingProfile:'restore',strength:.7})).status,409,'the selected strength must match the reviewed copy');
  const approved=await f.request('/api/export',{...body,processingProfile:'restore'});assert.equal(approved.status,202,await approved.clone().text());
  const job=await f.wait((await approved.json()).job.id);assert.equal(job.status,'completed',job.message);assert.equal(job.result?.continuityReportId,report.id);
  assert.equal((await f.records()).length,1,'export must use the reviewed footage without running the upscaler again');
  assert.equal(f.store.project.assets.find(asset=>asset.id===scene.videoAssetId)!.enhancement?.profile,'restore');
 }finally{await f.close();}
});

test('batch preserves newer manual selections including layer ABA, and stale autosave keeps new family bindings with local trim', { timeout: 60000 }, async () => {
  const f = await fixture('pause');
  try {
    const before = structuredClone(f.store.project);
    await copyFile(f.source, join(f.dataDirectory, 'media', 'other.mp4'));
    f.store.project.assets.push({ ...f.store.project.assets.find(asset => asset.id === 'source')!, id: 'other', url: '/api/media/other.mp4' });
    const submitted = await (await f.request('/api/enhance-sequence', { projectId: before.id, strength: .35 })).json(); await f.waitStarted();
    const changed = structuredClone(f.store.project); changed.scenes[0]!.videoAssetId = 'other'; changed.scenes[1]!.trimStart = .07; changed.scenes[1]!.speed = 2; changed.tracks![0]!.clips[0]!.assetId = 'other';
    assert.equal((await f.request('/api/project', changed, 'PUT')).status, 200);
    const back = structuredClone(f.store.project); back.tracks![0]!.clips[0]!.assetId = 'source'; assert.equal((await f.request('/api/project', back, 'PUT')).status, 200);
    await writeFile(f.release, 'go'); const job = await f.wait(submitted.job.id); assert.equal(job.status, 'completed', job.message); assert.equal(job.result?.finishing?.applied, 1);
    const derivative = f.store.project.scenes[1]!.videoAssetId;
    assert.equal(f.store.project.scenes[0]!.videoAssetId, 'other'); assert.equal(f.store.project.tracks![0]!.clips[0]!.assetId, 'source'); assert.equal(f.store.project.scenes[1]!.trimStart, .07); assert.equal(f.store.project.scenes[1]!.speed, 2);
    const stale = structuredClone(f.store.project); stale.scenes[1]!.videoAssetId = 'source'; stale.scenes[1]!.preserveVideoAsset = true; stale.scenes[1]!.trimStart = .09;
    assert.equal((await f.request('/api/project', stale, 'PUT')).status, 200); assert.equal(f.store.project.scenes[1]!.videoAssetId, derivative); assert.equal(f.store.project.scenes[1]!.trimStart, .09);
  } finally { await f.close(); }
});

test('generation preflight rejects a missing AI model; failure and cancellation after generation retain its original', { timeout: 60000 }, async () => {
  for (const mode of ['fail', 'pause']) {
    const f = await fixture(mode);
    try {
      f.store.project.aiFinishing = { enabled: true, strength: .35 };
      await writeFile(f.controls, JSON.stringify({ mode, ready: false }));
      const params = { sceneId: f.store.project.scenes[0]!.id, model: 'ltx-2b', conditioningMode: 'text', duration: 1 };
      assert.equal((await f.request('/api/generate', params)).status, 409); assert.equal(f.store.jobs.length, 0);
      await writeFile(f.controls, JSON.stringify({ mode, ready: true }));
      const response = await f.request('/api/generate', params); assert.equal(response.status, 202); const submitted = await response.json(); await f.waitStarted();
      if (mode === 'pause') await f.request(`/api/jobs/${submitted.job.id}/cancel`, {});
      const job = await f.wait(submitted.job.id); assert.equal(job.status, mode === 'pause' ? 'cancelled' : 'failed');
      const originalId = job.result?.originalAssetId; assert(originalId); assert.equal(f.store.project.scenes[0]!.videoAssetId, originalId);
      const original = f.store.project.assets.find(asset => asset.id === originalId)!; assert(!original.enhancement); assert((await readFile(join(f.dataDirectory, 'media', `${originalId}.mp4`))).length > 100);
    } finally { await f.close(); }
  }
});

test('deleting and restoring a scene during finishing prevents automatic replacement of that restored selection', { timeout: 60000 }, async () => {
  const f = await fixture('pause');
  try {
    const submitted = await (await f.request('/api/enhance-sequence', { projectId: f.store.project.id, strength: .35 })).json(); await f.waitStarted();
    const before = structuredClone(f.store.project), restoredScene = before.scenes[1]!;
    const removed = structuredClone(before); removed.scenes = removed.scenes.filter(scene => scene.id !== restoredScene.id);
    assert.equal((await f.request('/api/project', removed, 'PUT')).status, 200);
    assert.equal((await f.request('/api/project', before, 'PUT')).status, 200);
    await writeFile(f.release, 'go'); const job = await f.wait(submitted.job.id); assert.equal(job.status, 'completed', job.message);
    assert.equal(f.store.project.scenes.find(scene => scene.id === restoredScene.id)!.videoAssetId, 'source');
    assert.notEqual(f.store.project.scenes[0]!.videoAssetId, 'source');
  } finally { await f.close(); }
});

test('AI export uses its snapshot, stores reusable copies without applying them, and never exports after IA failure', { timeout: 60000 }, async () => {
  const f = await fixture('pause');
  try {
    f.store.project.scenes = f.store.project.scenes.slice(0, 1); f.store.project.tracks = []; f.store.project.scenes[0]!.trimStart = 0; f.store.project.scenes[0]!.speed = 1;
    const before = structuredClone(f.store.project);
    const response = await f.request('/api/export', { format: 'mp4', resolution: '2160p', aiEnhance: true, strength: .35 }); assert.equal(response.status, 202); const submitted = await response.json(); await f.waitStarted();
    f.store.project.scenes[0]!.duration = 2; await f.store.save();
    await writeFile(f.release, 'go'); const job = await f.wait(submitted.job.id); assert.equal(job.status, 'completed', job.message); assert.equal(job.result?.finishing?.created, 1); assert.equal(job.result?.finishing?.applied, 0);
    assert.equal(f.store.project.scenes[0]!.videoAssetId, 'source'); assert.equal(f.store.project.scenes[0]!.duration, 2); assert.deepEqual(f.store.project.characters, before.characters);
    const probe = await runProcess('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_read_frames', '-of', 'json', join(f.dataDirectory, 'exports', job.result!.filename!)]);
    const video = parseJsonOutput(probe.stdout).streams[0]; assert.equal(video.width, 3840); assert.equal(video.height, 2160); assert.equal(Number(video.nb_read_frames), 24, 'uses the one-second export snapshot');
    await writeFile(f.controls, JSON.stringify({ mode: 'fail', ready: true }));
    const failed = await f.wait((await (await f.request('/api/export', { format: 'mp4', resolution: '2160p', aiEnhance: true, strength: .7 })).json()).job.id); assert.equal(failed.status, 'failed'); assert.equal(failed.result?.finishing?.errors, 1); assert(!failed.result?.url);
    assert.equal((await readdir(join(f.dataDirectory, 'exports'))).length, 1);
  } finally { await f.close(); }
});

test('finishing completion after switching movies is saved only to the original movie', { timeout: 60000 }, async () => {
  const f = await fixture('pause');
  try {
    const firstId = f.store.project.id;
    const submitted = await (await f.request('/api/enhance-sequence', { projectId: firstId, strength: .35 })).json(); await f.waitStarted();
    const second = structuredClone(f.store.project); second.id = 'another-movie'; second.name = 'Otra película';
    const switched = await f.request('/api/project', second, 'PUT'); assert.equal(switched.status, 200); const secondBefore = structuredClone(f.store.project);
    await writeFile(f.release, 'go'); const job = await f.wait(submitted.job.id); assert.equal(job.status, 'completed', job.message);
    assert.deepEqual(f.store.project, secondBefore);
    const opened = await f.request(`/api/projects/${firstId}/open`, {}); assert.equal(opened.status, 200); const original = (await opened.json()).project;
    assert(original.assets.some((asset: any) => asset.enhancement?.preset === 'ai-4k')); assert.notEqual(original.scenes[0].videoAssetId, 'source');
  } finally { await f.close(); }
});
