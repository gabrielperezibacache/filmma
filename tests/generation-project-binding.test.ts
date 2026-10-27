import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';

const fingerprint = (project: unknown) => createHash('sha256').update(JSON.stringify(project)).digest('hex');
async function exists(path: string) { return access(path).then(() => true, () => false); }

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-project-binding-'));
  const runtimePath = join(directory, 'runtime.cjs'), upscalerPath = join(directory, 'upscaler.cjs');
  const runtimeStarted = join(directory, 'runtime-started'), runtimeRelease = join(directory, 'runtime-release');
  const doctorStarted = join(directory, 'doctor-started'), doctorRelease = join(directory, 'doctor-release');
  await writeFile(runtimePath, `
    const fs=require('node:fs'),{spawnSync}=require('node:child_process');
    const r=JSON.parse(fs.readFileSync(process.argv.at(-1)));
    fs.writeFileSync(${JSON.stringify(runtimeStarted)},'ready');
    function run(){if(!fs.existsSync(${JSON.stringify(runtimeRelease)}))return setTimeout(run,10);
      const p=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','color=s='+r.width+'x'+r.height+':r=24','-frames:v',String(r.numFrames),'-c:v','libx264','-preset','ultrafast','-threads','1',r.outputPath],{encoding:'utf8'});
      if(p.status){console.error(p.stderr);process.exit(1)}
      console.log(JSON.stringify({type:'result',outputPath:r.outputPath}));
    }run();
  `);
  await writeFile(upscalerPath, `
    const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(doctorStarted)},'ready');
    function finish(){if(!fs.existsSync(${JSON.stringify(doctorRelease)}))return setTimeout(finish,10);console.log(JSON.stringify({ready:true}))}finish();
  `);
  const app = await createApp({ dataDirectory: join(directory, 'data'), runtimePath, upscalerPath, python: process.execPath, skipDiagnostics: true });
  app.store.project.scenes = app.store.project.scenes.slice(0, 1);
  const scene = app.store.project.scenes[0]!;
  delete scene.assetId; delete scene.endAssetId; delete scene.videoAssetId; scene.characterIds = [];
  app.store.project.aiFinishing = { enabled: false, strength: .35 };
  await app.store.save();
  const server = app.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const request = (body: Record<string, unknown>, path = '/api/generate') => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Filmma-Client': 'filmma' },
    body: JSON.stringify({ sceneId: scene.id, model: 'minimax-h3', memoryProfile: 'h3-long-ssd', conditioningMode: 'text', duration: 1, width: 512, height: 320, steps: 20, ...body }),
  });
  const bootstrap = async () => (await fetch(base + '/api/bootstrap')).json();
  const waitFile = async (path: string) => { for (let i = 0; i < 500; i++) { if (await exists(path)) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Fixture barrier not reached'); };
  const waitJob = async (id: string) => { for (let i = 0; i < 500; i++) { const job = app.store.jobs.find(item => item.id === id)!; if (['completed', 'failed', 'cancelled'].includes(job.status)) return job; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Fixture job did not complete'); };
  return { ...app, directory, scene, request, bootstrap, waitFile, waitJob, runtimeStarted, runtimeRelease, doctorStarted, doctorRelease,
    close: async () => { await writeFile(runtimeRelease, 'go'); await writeFile(doctorRelease, 'go'); await app.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); },
  };
}

test('bootstrap binds its returned project and guarded generation requires the complete valid pair', async () => {
  const f = await fixture();
  try {
    const state = await f.bootstrap(); assert.equal(state.projectFingerprint, fingerprint(state.project));
    assert.equal(state.projectFingerprint, fingerprint(f.store.project));
    for (const body of [{ expectedProjectId: state.project.id }, { expectedProjectFingerprint: state.projectFingerprint }, { clientRequestId: 'not-a-uuid' }]) {
      assert.equal((await f.request(body)).status, 400); assert.equal(f.store.jobs.length, 0);
    }
    const binding = { expectedProjectId: state.project.id, expectedProjectFingerprint: state.projectFingerprint };
    for (const path of ['/api/generate-variants', '/api/generate-sequence']) {
      assert.equal((await f.request({ ...binding, count: 1 }, path)).status, 400, 'other routes must not silently ignore guards');
      assert.equal(f.store.jobs.length, 0);
    }
  } finally { await f.close(); }
});

test('stale project or finishing settings are rejected before any diagnostic or job starts', async () => {
  const f = await fixture();
  try {
    const state = await f.bootstrap(), binding = { expectedProjectId: state.project.id, expectedProjectFingerprint: state.projectFingerprint };
    assert.equal((await f.request({ ...binding, expectedProjectId: 'different-project' })).status, 409);
    assert.equal((await f.request({ ...binding, expectedProjectFingerprint: '0'.repeat(64) })).status, 409);
    f.store.project.aiFinishing = { enabled: true, strength: .75, processingProfile: 'restore' };
    assert.equal((await f.request(binding)).status, 409);
    assert.equal(f.store.jobs.length, 0); assert.equal(await exists(f.doctorStarted), false); assert.equal(await exists(f.runtimeStarted), false);
  } finally { await f.close(); }
});

for (const mutation of ['project', 'aiFinishing'] as const) test(`generation rechecks ${mutation} after asynchronous preflight before enqueue`, { timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    f.store.project.aiFinishing = { enabled: true, strength: .35 };
    const state = await f.bootstrap();
    const pending = f.request({ expectedProjectId: state.project.id, expectedProjectFingerprint: state.projectFingerprint, clientRequestId: randomUUID() });
    await f.waitFile(f.doctorStarted);
    if (mutation === 'project') f.store.project = { ...structuredClone(f.store.project), id: 'new-project-during-preflight' };
    else f.store.project.aiFinishing = { enabled: false, strength: .75, processingProfile: 'restore' };
    await f.store.save(); await writeFile(f.doctorRelease, 'go');
    const response = await pending; assert.equal(response.status, 409, await response.clone().text());
    assert.equal(f.store.jobs.length, 0); assert.equal(await exists(f.runtimeStarted), false);
    assert.deepEqual(await readdir(join(f.directory, 'data/work')), []);
  } finally { await f.close(); }
});

test('client request correlation survives queued metadata, request evidence and final persisted result', { timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    const state = await f.bootstrap(), clientRequestId = randomUUID();
    const response = await f.request({ expectedProjectId: state.project.id, expectedProjectFingerprint: state.projectFingerprint, clientRequestId });
    assert.equal(response.status, 202, await response.clone().text());
    const submitted = (await response.json()).job; assert.equal(submitted.result.clientRequestId, clientRequestId);
    assert.equal(submitted.result.projectId, state.project.id);
    await f.waitFile(f.runtimeStarted);
    const directories = await readdir(join(f.directory, 'data/work')); assert.equal(directories.length, 1);
    const request = JSON.parse(await readFile(join(f.directory, 'data/work', directories[0]!, 'request.json'), 'utf8'));
    assert.equal(request.clientRequestId, clientRequestId);
    await writeFile(f.runtimeRelease, 'go');
    const job = await f.waitJob(submitted.id); assert.equal(job.status, 'completed', job.message); assert.equal(job.result?.clientRequestId, clientRequestId);
    await f.store.save();
    const persisted = JSON.parse(await readFile(join(f.directory, 'data/jobs.json'), 'utf8'));
    assert.equal(persisted.find((item: { id: string }) => item.id === job.id).result.clientRequestId, clientRequestId);
  } finally { await f.close(); }
});

test('existing generation clients may omit project binding and request correlation', { timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    await writeFile(f.runtimeRelease, 'go');
    const response = await f.request({}); assert.equal(response.status, 202);
    const job = await f.waitJob((await response.json()).job.id); assert.equal(job.status, 'completed', job.message);
    assert.equal(job.result?.clientRequestId, undefined);
  } finally { await f.close(); }
});
