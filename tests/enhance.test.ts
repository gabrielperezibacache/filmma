import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, chmod, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createApp } from '../server/app.js';
import { runProcess } from '../server/process.js';
import { enhanceVideo } from '../server/enhance.js';
import { generationFrames, generationSeconds } from '../server/generation-limits.js';

async function fixture(options: Parameters<typeof createApp>[0] = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-enhance-')), dataDirectory = join(directory, 'data');
  await mkdir(join(dataDirectory, 'media'), { recursive: true });
  const source = join(dataDirectory, 'media', 'source.mp4');
  const made = await runProcess('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=30:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source]);
  assert.equal(made.code, 0, made.stderr);
  const f = await createApp({ dataDirectory, skipDiagnostics: true, ...options });
  f.store.project.assets.push({ id: 'source', name: 'Toma de prueba', type: 'video', url: '/api/media/source.mp4', size: (await readFile(source)).length, mime: 'video/mp4' });
  f.store.project.scenes[0]!.videoAssetId = 'source';
  const server = f.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const request = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Filmma-Client': 'filmma' }, body: JSON.stringify(body) });
  const wait = async (id: string) => { for (let n = 0; n < 800; n++) { const job = f.store.jobs.find((entry) => entry.id === id)!; if (['completed', 'failed', 'cancelled'].includes(job.status)) return job; await new Promise((done) => setTimeout(done, 25)); } throw new Error('Job timeout'); };
  return { ...f, directory, source, base, request, wait, close: async () => { await f.close(); server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); await rm(directory, { recursive: true, force: true }); } };
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('real enhancement preserves original, clocks and copied audio, adds derivative without changing screenplay links', { timeout: 60000 }, async () => {
  const f = await fixture();
  try {
    const original = hash(await readFile(f.source)), scenes = JSON.stringify(f.store.project.scenes), characters = JSON.stringify(f.store.project.characters);
    for (const preset of ['clean', 'upscale'] as const) {
      const response = await f.request('/api/assets/source/enhance', { projectId: f.store.project.id, preset }); assert.equal(response.status, 202);
      const { job } = await response.json(), completed = await f.wait(job.id); assert.equal(completed.status, 'completed', completed.message);
      const asset = f.store.project.assets.find((entry) => entry.id === completed.result?.assetId)!;
      assert.equal(asset.enhancement?.sourceAssetId, 'source'); assert.equal(asset.enhancement?.width, preset === 'clean' ? 96 : 192); assert.equal(asset.enhancement?.height, preset === 'clean' ? 64 : 128);
      assert.equal(asset.enhancement?.fps, 30); assert.equal(asset.enhancement?.duration, 1);
      const output = join(f.directory, 'data', 'media', `${asset.id}.mp4`);
      const decode = await runProcess('ffmpeg', ['-v', 'error', '-i', output, '-f', 'null', '-']); assert.equal(decode.code, 0, decode.stderr);
      const audioHashes = await Promise.all([f.source, output].map(path => runProcess('ffmpeg', ['-v', 'error', '-i', path, '-map', '0:a:0', '-c', 'copy', '-f', 'hash', '-'])));
      assert.equal(audioHashes[0]!.stdout, audioHashes[1]!.stdout, 'Compatible source audio packets remain identical');
    }
    assert.equal(hash(await readFile(f.source)), original); assert.equal(JSON.stringify(f.store.project.scenes), scenes); assert.equal(JSON.stringify(f.store.project.characters), characters);
    const submitted = await f.request('/api/export', { format: 'project' });
    const bundled = await f.wait((await submitted.json()).job.id); assert.equal(bundled.status, 'completed', bundled.message);
    const archive = await (await fetch(f.base + bundled.result!.url)).blob();
    const form = new FormData(); form.append('projectFile', archive, 'quality.filmma.zip');
    const imported = await fetch(f.base + '/api/projects/import', { method: 'POST', headers: { 'X-Filmma-Client': 'filmma' }, body: form });
    assert.equal(imported.status, 201, await imported.clone().text());
    const restored = (await imported.json()).project;
    for (const derivative of restored.assets.filter((asset: any) => asset.enhancement)) {
      assert.notEqual(derivative.enhancement.sourceAssetId, 'source');
      assert(restored.assets.some((asset: any) => asset.id === derivative.enhancement.sourceAssetId && asset.name === 'Toma de prueba'));
    }

  } finally { await f.close(); }
});

test('enhancement rejects stale project, nonvideo, remote/symlink source and unsupported preset', async () => {
  const f = await fixture();
  try {
    const body = { projectId: f.store.project.id, preset: 'clean' };
    assert.equal((await f.request('/api/assets/source/enhance', { ...body, projectId: 'stale-project' })).status, 409);
    assert.equal((await f.request('/api/assets/demo-01/enhance', body)).status, 415);
    assert.equal((await f.request('/api/assets/missing/enhance', body)).status, 404);
    assert.equal((await f.request('/api/assets/source/enhance', { ...body, preset: 'invent-ai-detail' })).status, 400);
    const source = f.store.project.assets.find(asset => asset.id === 'source')!;
    source.url = 'https://example.com/video.mp4'; assert.notEqual((await f.request('/api/assets/source/enhance', body)).status, 202);
    await symlink(f.source, join(f.directory, 'data', 'media', 'link.mp4')); source.url = '/api/media/link.mp4'; assert.notEqual((await f.request('/api/assets/source/enhance', body)).status, 202);
    assert.equal(f.store.jobs.length, 0);
  } finally { await f.close(); }
});

test('cancel during enhancement terminates process and removes incomplete derivative without modifying original', { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const original = hash(await readFile(f.source)), destination = join(f.directory, 'data', 'media', 'cancelled.mp4'), fake = join(f.directory, 'slow-ffmpeg');
    await writeFile(fake, '#!/usr/bin/env node\nconst fs=require("node:fs");fs.writeFileSync(process.argv.at(-1),"partial");setTimeout(()=>{},20000);\n'); await chmod(fake, 0o700);
    const controller = new AbortController();
    const work = enhanceVideo({ source: f.source, destination, preset: 'upscale', ffmpeg: fake, ffprobe: 'ffprobe', signal: controller.signal, update() {} });
    const rejected = assert.rejects(work, /cancelado/);
    for (let n = 0; n < 100; n++) { if ((await readdir(join(f.directory, 'data', 'media'))).includes('cancelled.mp4')) break; await new Promise(done => setTimeout(done, 20)); }
    controller.abort(); await rejected;
    assert.deepEqual(await readdir(join(f.directory, 'data', 'media')), ['source.mp4']); assert.equal(hash(await readFile(f.source)), original);
  } finally { await f.close(); }
});

test('generation maximum applies before enqueue and after model frame quantization without limiting imported scenes', async () => {
  for (const model of ['minimax-h3', 'ltx-2b'] as const) for (const seconds of [1, 3, 4, 14.99, 15]) assert(generationFrames(seconds, model) / 24 <= seconds);
  assert.equal(generationFrames(15, 'minimax-h3'), 345); assert.equal(generationFrames(15, 'ltx-2b'), 353);
  assert.throws(() => generationSeconds(undefined, 16), /15 segundos/); assert.equal(generationSeconds(3, 120), 3);
  const f = await fixture({ runtimePath: '/missing.py' });
  try {
    f.store.project.scenes[0]!.duration = 120;
    assert.equal((await f.request('/api/generate', { sceneId: 'scene-01', model: 'ltx-2b' })).status, 400);
    assert.equal((await f.request('/api/generate', { sceneId: 'scene-01', model: 'ltx-2b', duration: 15.01 })).status, 400);
    assert.equal((await f.request('/api/generate-sequence', { model: 'ltx-2b', conditioningMode: 'text', onlyMissing: false })).status, 400);
    assert.equal(f.store.jobs.length, 0); assert.equal(f.store.project.scenes[0]!.duration, 120);
    const explicit = await f.request('/api/generate', { sceneId: 'scene-01', model: 'ltx-2b', duration: 1, conditioningMode: 'text' }); assert.equal(explicit.status, 202);
    await f.wait((await explicit.json()).job.id);
  } finally { await f.close(); }
});

test('a runtime producing more than 15 seconds is rejected and its output removed', { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const long = join(f.directory, 'long.mp4');
    const made = await runProcess('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=32x32:r=24:d=15.1', '-c:v', 'libx264', long]); assert.equal(made.code, 0);
    const runtime = join(f.directory, 'runtime.cjs');
    await writeFile(runtime, `const fs=require('node:fs');const path=process.argv[process.argv.indexOf('--request')+1];const req=JSON.parse(fs.readFileSync(path));fs.copyFileSync(${JSON.stringify(long)},req.outputPath);`);
    const isolated = await fixture({ runtimePath: runtime, python: process.execPath });
    try {
      const response = await isolated.request('/api/generate', { sceneId: 'scene-01', model: 'ltx-2b', conditioningMode: 'text', duration: 1 });
      const done = await isolated.wait((await response.json()).job.id); assert.equal(done.status, 'failed'); assert.match(done.message, /15 segundos/);
      assert.equal(isolated.store.project.assets.filter(asset => asset.type === 'video').length, 1); assert.deepEqual(await readdir(join(isolated.directory, 'data', 'media')), ['source.mp4']);
    } finally { await isolated.close(); }
  } finally { await f.close(); }
});
