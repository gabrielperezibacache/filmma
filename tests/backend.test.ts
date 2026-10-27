import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { request as httpRequest, type Server } from 'node:http';
import sharp from 'sharp';
import { createApp, detectMedia } from '../server/app.js';
import { Store } from '../server/store.js';
import { runProcess } from '../server/process.js';

async function fixture(options: Parameters<typeof createApp>[0] = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-test-'));
  const publicDirectory = join(directory, 'public'); await mkdir(join(publicDirectory, 'demo'), { recursive: true });
  const image = await sharp({ create: { width: 128, height: 72, channels: 3, background: '#bd8a4f' } }).png().toBuffer();
  await Promise.all([1, 2, 3, 4].map((n) => writeFile(join(publicDirectory, 'demo', `scene-0${n}.png`), image)));
  const runtime = await createApp({ dataDirectory: join(directory, 'data'), publicDirectory, skipDiagnostics: true, ...options });
  const server: Server = await new Promise((resolve, reject) => { const listener = runtime.app.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve(listener)); });
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  async function request(path: string, body?: unknown, method = 'POST') {
    return fetch(base + path, { method: body === undefined ? 'GET' : method, headers: { 'Content-Type': 'application/json', 'X-Filmma-Client': 'filmma' }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  return { ...runtime, directory, image, base, request, cleanup: async () => { await runtime.close(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); } };
}

async function waitForJob(f: Awaited<ReturnType<typeof fixture>>, id: string, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const { jobs } = await (await f.request('/api/jobs')).json();
    const job = jobs.find((item: any) => item.id === id);
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('Job did not finish before timeout');
}

test('loopback origin protection and mutation header prevent cross-origin actions', async () => {
  const f = await fixture();
  try {
    assert.equal((await fetch(f.base + '/api/bootstrap')).status, 200);
    assert.equal((await fetch(f.base + '/api/bootstrap', { headers: { Origin: 'https://evil.example' } })).status, 403);
    const foreignHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      httpRequest(f.base + '/api/bootstrap', { headers: { Host: 'evil.example' } }, (response) => { response.resume(); resolve(response.statusCode); }).on('error', reject).end();
    });
    assert.equal(foreignHostStatus, 403);
    assert.equal((await fetch(f.base + '/api/project', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await fetch(f.base + '/api/project', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:4317' } })).status, 204);
  } finally { await f.cleanup(); }
});

test('uploads preserve originals and MIME comes from bytes; SVG uploads are rejected', async () => {
  const f = await fixture();
  try {
    const form = new FormData(); form.append('files', new Blob([f.image], { type: 'text/html' }), 'reference.png');
    const response = await fetch(f.base + '/api/assets', { method: 'POST', headers: { 'X-Filmma-Client': 'filmma' }, body: form });
    assert.equal(response.status, 201);
    const { assets } = await response.json(); assert.equal(assets[0].mime, 'image/png');
    const downloaded = Buffer.from(await (await fetch(f.base + assets[0].url)).arrayBuffer());
    assert.equal(createHash('sha256').update(downloaded).digest('hex'), createHash('sha256').update(f.image).digest('hex'));
    const invalid = new FormData(); invalid.append('files', new Blob(['<svg><script>alert(1)</script></svg>'], { type: 'image/svg+xml' }), 'unsafe.svg');
    assert.equal((await fetch(f.base + '/api/assets', { method: 'POST', headers: { 'X-Filmma-Client': 'filmma' }, body: invalid })).status, 400);
    assert.equal(f.store.project.assets.length, 5);
    assert.equal((await readdir(join(f.directory, 'data', 'work'))).length, 0);
  } finally { await f.cleanup(); }
});

test('uploads reject a stale movie id and clean only their new temporary files', async()=>{
  const f=await fixture();try{
    const before=await readFile(join(f.directory,'data','project.json')),mediaBefore=await readdir(join(f.directory,'data','media'));
    const form=new FormData();form.append('projectId','previous-movie');form.append('files',new Blob([f.image]),'reference.png');
    const response=await fetch(f.base+'/api/assets',{method:'POST',headers:{'X-Filmma-Client':'filmma'},body:form});assert.equal(response.status,409);assert.match(await response.text(),/película/);
    assert.deepEqual(await readFile(join(f.directory,'data','project.json')),before);assert.deepEqual(await readdir(join(f.directory,'data','media')),mediaBefore);assert.deepEqual(await readdir(join(f.directory,'data','work')),[]);
  }finally{await f.cleanup();}
});

test('a movie switch during multipart transfer cannot attach uploads to the next movie',async()=>{
  const f=await fixture();let pending:ReturnType<typeof httpRequest>|undefined;try{
    const original=structuredClone(f.store.project),boundary='filmma-delayed-upload';
    const response=new Promise<{status:number|undefined;body:string}>((resolve,reject)=>{
      pending=httpRequest(f.base+'/api/assets',{method:'POST',headers:{'X-Filmma-Client':'filmma','Content-Type':`multipart/form-data; boundary=${boundary}`}},res=>{let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body}));});pending.on('error',reject);
    });
    pending!.write(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="reference.png"\r\nContent-Type: image/png\r\n\r\n`);pending!.write(f.image.subarray(0,64));
    for(let attempt=0;attempt<100;attempt++){if((await readdir(join(f.directory,'data','work'))).length)break;await new Promise(done=>setTimeout(done,10));}
    assert((await readdir(join(f.directory,'data','work'))).length>0,'multipart upload must have started');
    const replacement={...original,id:'next-upload-project',name:'Otra película',scenes:[],characters:[],assets:[]};assert.equal((await f.request('/api/project',replacement,'PUT')).status,200);const nextSaved=await readFile(join(f.directory,'data','project.json'));
    pending!.end(Buffer.concat([f.image.subarray(64),Buffer.from(`\r\n--${boundary}--\r\n`)]));const result=await response;assert.equal(result.status,409,result.body);
    assert.equal(f.store.project.id,replacement.id);assert.deepEqual(f.store.project.assets,[]);assert.deepEqual(await readFile(join(f.directory,'data','project.json')),nextSaved);assert.deepEqual(await readdir(join(f.directory,'data','media')),[]);assert.deepEqual(await readdir(join(f.directory,'data','work')),[]);
    const backups=await readdir(join(f.directory,'data','projects'));const savedOriginal=JSON.parse(await readFile(join(f.directory,'data','projects',backups[0]!),'utf8'));assert.deepEqual(savedOriginal.assets,original.assets);
  }finally{pending?.destroy();await f.cleanup();}
});

test('project validation rejects broken references; switching projects retains a backup', async () => {
  const f = await fixture();
  try {
    const project = structuredClone(f.store.project);
    project.scenes[0]!.assetId = 'does-not-exist';
    assert.equal((await f.request('/api/project', project, 'PUT')).status, 400);
    project.scenes[0]!.assetId = 'demo-01'; project.scenes.push({ ...project.scenes[0]! });
    assert.equal((await f.request('/api/project', project, 'PUT')).status, 400);
    const replacement = { ...f.store.project, id: 'next-project', name: 'Segundo proyecto', scenes: [], characters: [], assets: [] };
    assert.equal((await f.request('/api/project', replacement, 'PUT')).status, 200);
    const files = await readdir(join(f.directory, 'data', 'projects'));
    assert.equal(files.length, 1);
    const backup = JSON.parse(await readFile(join(f.directory, 'data', 'projects', files[0]!), 'utf8'));
    assert.equal(backup.name, 'La última función'); assert.equal(f.store.project.assets.length, 0);
    const restore = await f.request('/api/project', backup, 'PUT'); assert.equal(restore.status, 200);
    assert.equal((await restore.json()).project.assets.length, 4);
  } finally { await f.cleanup(); }
});

test('restart marks previously active jobs as interrupted and keeps completed work', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-store-'));
  try {
    const store = new Store(directory); await store.init();
    store.jobs.push({ id: 'active', type: 'generate', status: 'running', progress: 20, message: 'running', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    store.jobs.push({ ...store.jobs[0]!, id: 'done', status: 'completed', progress: 100 });
    await store.save();
    const restored = new Store(directory); await restored.init();
    assert.equal(restored.jobs[0]!.status, 'failed'); assert.match(restored.jobs[0]!.message, /interrumpió/);
    assert.equal(restored.jobs[1]!.status, 'completed');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('demo reference migration preserves user writing and custom resource choices', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-migration-'));
  try {
    const store = new Store(directory); await store.init();
    store.project.scenes[1]!.prompt = 'Mi dirección personal, sin cambios.';
    store.project.assets.find((asset) => asset.id === 'demo-02')!.url = '/demo/scene-01.png';
    store.project.assets.find((asset) => asset.id === 'demo-03')!.url = '/api/media/personal-reference.png';
    await store.save();
    const migrated = new Store(directory); await migrated.init();
    assert.equal(migrated.project.assets.find((asset) => asset.id === 'demo-02')!.url, '/demo/scene-02.png');
    assert.equal(migrated.project.assets.find((asset) => asset.id === 'demo-03')!.url, '/api/media/personal-reference.png');
    assert.equal(migrated.project.scenes[1]!.prompt, 'Mi dirección personal, sin cambios.');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('an editor snapshot cannot erase a newly generated clip; explicit removal can', async () => {
  const f = await fixture();
  try {
    const stale = structuredClone(f.store.project);
    f.store.project.assets.push({ id: 'fresh-video', name: 'Toma recién generada', type: 'video', url: '/api/media/fresh-video.mp4', mime: 'video/mp4', size: 1000 });
    f.store.project.scenes[0]!.videoAssetId = 'fresh-video';
    const updated = await f.request('/api/project', stale, 'PUT'); assert.equal(updated.status, 200);
    assert.equal((await updated.json()).project.scenes[0].videoAssetId, 'fresh-video');
    assert(f.store.project.assets.some((asset) => asset.id === 'fresh-video'));
    const cleared = structuredClone(f.store.project); cleared.scenes[0]!.clearVideoAsset = true;
    const response = await f.request('/api/project', cleared, 'PUT'); assert.equal(response.status, 200);
    assert.equal((await response.json()).project.scenes[0].videoAssetId, undefined);
    assert.equal(f.store.project.scenes[0]!.clearVideoAsset, undefined);
  } finally { await f.cleanup(); }
});

test('missing local model fails visibly and never adds a fake video asset', async () => {
  const f = await fixture({ runtimePath: '/missing/filmma-runtime.py' });
  try {
    const { job } = await (await f.request('/api/generate', { sceneId: 'scene-01', model: 'minimax-h3' })).json();
    const result = await waitForJob(f, job.id);
    assert.equal(result.status, 'failed'); assert(result.message.length > 10);
    assert.equal(f.store.project.assets.filter((asset) => asset.type === 'video').length, 0);
    assert.equal((await readdir(join(f.directory, 'data', 'media'))).length, 0);
  } finally { await f.cleanup(); }
});

test('Codex output is returned as a proposal without overwriting the project', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-codex-'));
  const fake = join(directory, 'codex');
  await writeFile(fake, '#!/usr/bin/env node\nlet input="";process.stdin.on("data",b=>input+=b);process.stdin.on("end",()=>{console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"Elena vuelve al cine."}}));});\n'); await chmod(fake, 0o700);
  const f = await fixture({ codex: fake });
  try {
    const previous = JSON.stringify(f.store.project);
    const { job } = await (await f.request('/api/codex', { task: 'continuity', prompt: 'Revisa la continuidad del final.' })).json();
    const result = await waitForJob(f, job.id);
    assert.equal(result.status, 'completed'); assert.equal(result.result.text, 'Elena vuelve al cine.');
    assert.equal(JSON.stringify(f.store.project), previous);
  } finally { await f.cleanup(); await rm(directory, { recursive: true, force: true }); }
});

test('project export bundles a manifest and original media as a valid ZIP', async () => {
  const f = await fixture();
  try {
    const { job } = await (await f.request('/api/export', { format: 'project' })).json();
    const result = await waitForJob(f, job.id); assert.equal(result.status, 'completed', result.message);
    const archive = Buffer.from(await (await fetch(f.base + result.result.url)).arrayBuffer());
    assert.equal(archive.readUInt32LE(0), 0x04034b50);
    const entries = new Map<string, Buffer>(); let offset = 0;
    while (archive.readUInt32LE(offset) === 0x04034b50) {
      const size = archive.readUInt32LE(offset + 18), nameLength = archive.readUInt16LE(offset + 26), extra = archive.readUInt16LE(offset + 28);
      const name = archive.toString('utf8', offset + 30, offset + 30 + nameLength), start = offset + 30 + nameLength + extra;
      entries.set(name, archive.subarray(start, start + size)); offset = start + size;
    }
    assert.equal(entries.size, 6); assert.deepEqual(entries.get('assets/demo-01.png'), f.image);
    const manifest = JSON.parse(entries.get('project.json')!.toString()); assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.project.assets[0].url, 'assets/demo-01.png');
  } finally { await f.cleanup(); }
});

test('real FFmpeg export produces a playable MP4 with scene duration and audible soundtrack', { timeout: 60000 }, async (t) => {
  try { const binary = await runProcess('ffmpeg', ['-version']); if (binary.code !== 0) return t.skip('FFmpeg unavailable'); } catch { return t.skip('FFmpeg unavailable'); }
  const f = await fixture();
  try {
    const score = join(f.directory, 'data', 'media', 'test-score.wav');
    const sound = await runProcess('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1:sample_rate=48000', score]); assert.equal(sound.code, 0);
    f.store.project.assets.push({ id: 'score', name: 'Banda sonora', type: 'audio', url: '/api/media/test-score.wav', mime: 'audio/wav', size: (await readFile(score)).length });
    f.store.project.audioAssetId = 'score'; f.store.project.audioVolume = 0.5;
    f.store.project.scenes = f.store.project.scenes.slice(0, 2).map((scene) => ({ ...scene, duration: 1 })); await f.store.save();
    const { job } = await (await f.request('/api/export', { format: 'mp4' })).json();
    const result = await waitForJob(f, job.id, 50000); assert.equal(result.status, 'completed', result.message);
    const path = join(f.directory, 'data', 'exports', result.result.filename);
    const probe = await runProcess('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height', '-of', 'json', path]);
    const metadata = JSON.parse(probe.stdout); assert(Math.abs(Number(metadata.format.duration) - 2) < 0.3);
    assert.equal(metadata.streams[0].codec_name, 'h264'); assert.equal(metadata.streams[0].width, 1920);
    assert(metadata.streams.some((stream: any) => stream.codec_name === 'aac'));
    const audio = await runProcess('ffmpeg', ['-hide_banner', '-i', path, '-vn', '-af', 'volumedetect', '-f', 'null', '-']);
    const meanVolume = Number(audio.stderr.match(/mean_volume:\s*(-?[\d.]+) dB/)?.[1]);
    assert(Number.isFinite(meanVolume) && meanVolume > -60, `Expected audible music, got ${meanVolume} dB`);
  } finally { await f.cleanup(); }
});

test('runtime download requires explicit size/license confirmation', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/api/runtime/download', { model: 'minimax-h3' })).status, 400);
    assert.equal(f.store.jobs.length, 0);
  } finally { await f.cleanup(); }
});

test('cancelling queued and running work stops execution and leaves no result', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-cancel-'));
  const fake = join(directory, 'codex');
  await writeFile(fake, '#!/usr/bin/env node\nprocess.stdin.resume();setTimeout(()=>{console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"Should not finish"}}));},20000);\n'); await chmod(fake, 0o700);
  const f = await fixture({ codex: fake });
  try {
    const first = await (await f.request('/api/codex', { task: 'script', prompt: 'First' })).json();
    const second = await (await f.request('/api/codex', { task: 'script', prompt: 'Second' })).json();
    assert.equal((await f.request(`/api/jobs/${second.job.id}/cancel`, {})).status, 200);
    assert.equal((await waitForJob(f, second.job.id)).status, 'cancelled');
    assert.equal((await f.request(`/api/jobs/${first.job.id}/cancel`, {})).status, 200);
    assert.equal((await waitForJob(f, first.job.id)).status, 'cancelled');
    assert(f.store.jobs.every((job) => !job.result));
  } finally { await f.cleanup(); await rm(directory, { recursive: true, force: true }); }
});

test('long model preparation does not block Codex in the creative work queue', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-lanes-'));
  const fakeRuntime = join(directory, 'runtime'), fakeCodex = join(directory, 'codex');
  await writeFile(fakeRuntime, '#!/usr/bin/env node\nprocess.stdin.resume();console.log(JSON.stringify({type:"progress",message:"Preparing model",progress:5}));setTimeout(()=>console.log(JSON.stringify({type:"result",installed:true})),20000);\n'); await chmod(fakeRuntime, 0o700);
  await writeFile(fakeCodex, '#!/usr/bin/env node\nprocess.stdin.resume();process.stdin.on("end",()=>console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"Creative work stays available."}})));\n'); await chmod(fakeCodex, 0o700);
  const f = await fixture({ python: fakeRuntime, codex: fakeCodex });
  try {
    const installation = await (await f.request('/api/runtime/install', { model: 'minimax-h3' })).json();
    const writing = await (await f.request('/api/codex', { task: 'continuity', prompt: 'Write while the model prepares.' })).json();
    const written = await waitForJob(f, writing.job.id, 5000);
    assert.equal(written.status, 'completed');
    assert.equal(f.store.jobs.find((job) => job.id === installation.job.id)?.status, 'running');
    await f.request(`/api/jobs/${installation.job.id}/cancel`, {});
  } finally { await f.cleanup(); await rm(directory, { recursive: true, force: true }); }
});

test('media detection rejects executable content regardless of filename', () => {
  assert.equal(detectMedia(Buffer.from('<!doctype html><script>malicious()</script>')), undefined);
  assert.equal(detectMedia(Buffer.from('#!/bin/sh\necho test')), undefined);
});
