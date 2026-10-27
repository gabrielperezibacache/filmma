import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createApp } from '../server/app.js';

async function fixture(options: Parameters<typeof createApp>[0] = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-projects-'));
  const codex = join(directory, 'codex-fixture');
  await writeFile(codex, `#!/usr/bin/env node
const fs = require('node:fs');
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const args = process.argv.slice(2), schema = args[args.indexOf('--output-schema') + 1];
  fs.writeFileSync(${JSON.stringify(join(directory, 'codex-capture.json'))}, JSON.stringify({args, input, schema: schema ? JSON.parse(fs.readFileSync(schema, 'utf8')) : null}));
  const value = {text:'ESCENA 1. Una sala vuelve a encenderse.',scenes:[{title:'La luz',description:'Se abre una puerta.',dialogue:'Volvemos.',prompt:'A door opens in an old cinema.',negativePrompt:'blurry',duration:3,camera:'Dolly in',characterIds:input.includes('fixture-invalid-character') ? ['unknown'] : []}]};
  console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(value)}}));
});
`, { mode: 0o700 });
  await chmod(codex, 0o700);
  const app = await createApp({ dataDirectory: join(directory, 'data'), skipDiagnostics: true, codex, ...options });
  const server = app.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const request = (path: string, body?: unknown, method = 'POST') => fetch(base + path, { method: body === undefined ? 'GET' : method, headers: { 'Content-Type': 'application/json', 'X-Filmma-Client': 'filmma' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const waitJob = async (id: string) => { for (let n = 0; n < 100; n++) { const job = app.store.jobs.find((job) => job.id === id)!; if (['completed', 'failed', 'cancelled'].includes(job.status)) return job; await new Promise((done) => setTimeout(done, 40)); } throw new Error('Job timed out'); };
  return { ...app, directory, request, waitJob, close: async () => { await app.close(); server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); await rm(directory, { recursive: true, force: true }); } };
}

test('project list deduplicates latest snapshots and safely reopens both projects', async () => {
  const f = await fixture();
  try {
    const original = structuredClone(f.store.project);
    const next = { ...original, id: 'film-two', name: 'Segunda película', scenes: [], characters: [], assets: [] };
    assert.equal((await f.request('/api/project', next, 'PUT')).status, 200);
    const archive = join(f.directory, 'data/projects');
    await writeFile(join(archive, `${original.id}-0000000000000.json`), JSON.stringify({ ...original, name: 'Snapshot antiguo' }));
    await writeFile(join(archive, 'broken.json'), '{');
    await symlink(join(f.directory, 'data/project.json'), join(archive, 'linked.json'));
    const { projects } = await (await f.request('/api/projects')).json();
    assert.equal(projects.length, 2); assert.equal(projects[0].id, next.id); assert.equal(projects[0].current, true);
    assert.equal(projects[1].name, original.name); assert.equal(projects[1].sceneCount, original.scenes.length);
    const opened = await f.request(`/api/projects/${original.id}/open`, {});
    assert.equal(opened.status, 200); assert.equal((await opened.json()).project.id, original.id);
    assert.equal((await f.request(`/api/projects/${next.id}/open`, {})).status, 200);
    assert.equal(f.store.project.name, 'Segunda película');
    assert.equal((await f.request('/api/projects/unknown/open', {})).status, 404);
    assert.equal(f.store.project.id, next.id);
  } finally { await f.close(); }
});

test('missing original files prevent reopen without replacing the current project', async () => {
  const f = await fixture();
  try {
    const missing = { ...f.store.project, id: 'missing-original', assets: [{ id: 'absent', name: 'Original ausente', type: 'image', url: '/api/media/absent.png', mime: 'image/png', size: 100 }] };
    await writeFile(join(f.directory, 'data/projects', `${missing.id}-0000000000000.json`), JSON.stringify(missing));
    const before = structuredClone(f.store.project);
    assert.equal((await f.request(`/api/projects/${missing.id}/open`, {})).status, 409);
    assert.deepEqual(f.store.project, before);
  } finally { await f.close(); }
});

test('Codex script uses clean config, full story, structured schema and an unsaved proposal', async () => {
  const f = await fixture();
  try {
    const before = structuredClone(f.store.project);
    const { job } = await (await f.request('/api/codex', { task: 'script', prompt: 'Planifica la historia completa.', sceneId: before.scenes[0]!.id })).json();
    const completed = await f.waitJob(job.id); assert.equal(completed.status, 'completed', completed.message);
    assert.match(completed.result!.text!, /ESCENA 1/);
    assert.equal(completed.result!.proposal!.projectId, before.id);
    const scenes = completed.result!.proposal!.scenes; assert.equal(scenes.length, 1); assert.equal(scenes[0]!.title, 'La luz'); assert.equal(scenes[0]!.seed, 0); assert.ok(scenes[0]!.id);
    assert.deepEqual(f.store.project, before);
    const capture = JSON.parse(await readFile(join(f.directory, 'codex-capture.json'), 'utf8'));
    assert.ok(capture.args.includes('--ignore-user-config')); assert.ok(capture.args.includes('--output-schema')); assert.ok(capture.args.includes('read-only'));
    assert.equal(capture.schema.additionalProperties, false); assert.deepEqual(capture.schema.required, ['text', 'scenes']);
    for (const scene of before.scenes) assert.ok(capture.input.includes(scene.id));
    assert.match(capture.input, /No uses herramientas/);
  } finally { await f.close(); }
});

test('Codex proposals reject nonexistent character references and leave the story intact', async () => {
  const f = await fixture();
  try {
    const before = structuredClone(f.store.project);
    const { job } = await (await f.request('/api/codex', { task: 'script', prompt: 'fixture-invalid-character' })).json();
    const failed = await f.waitJob(job.id); assert.equal(failed.status, 'failed'); assert.match(failed.message, /elemento inexistente/); assert.equal(failed.result, undefined);
    assert.deepEqual(f.store.project, before);
  } finally { await f.close(); }
});

test('generation request carries camera and visual constraints in the actual positive prompt', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-prompt-'));
  const runtime = join(directory, 'runtime.cjs'), capturePath = join(directory, 'captured.json');
  await writeFile(runtime, `const fs=require('node:fs');const args=process.argv.slice(2);const request=args[args.indexOf('--request')+1];fs.copyFileSync(request,${JSON.stringify(capturePath)});console.log(JSON.stringify({type:'error',message:'Fixture inspected request, no inference attempted.'}));process.exit(1);`);
  const f = await fixture({ python: process.execPath, runtimePath: runtime });
  try {
    const scene = f.store.project.scenes[0]!; scene.camera = 'Travelling hacia la puerta'; scene.negativePrompt = 'rostros deformados';
    const { job } = await (await f.request('/api/generate', { sceneId: scene.id, model: 'ltx-2b', conditioningMode: 'text', prompt: 'A cinema at dawn', negativePrompt: 'flicker and unwanted text', duration: 2 })).json();
    const result = await f.waitJob(job.id); assert.equal(result.status, 'failed'); assert.match(result.message, /Fixture inspected/);
    const captured = JSON.parse(await readFile(capturePath, 'utf8'));
    assert.match(captured.prompt, /^A cinema at dawn/); assert.match(captured.prompt, /Camera direction: Travelling hacia la puerta/);
    assert.match(captured.prompt, /Visual constraints \/ Avoid: flicker and unwanted text/);
    assert.equal(captured.negativePrompt, 'flicker and unwanted text'); assert.equal(captured.inputImage, undefined); assert.deepEqual(captured.references, []); assert.equal(captured.numFrames, 41); assert(captured.numFrames / captured.fps <= 2, 'Temporal quantization must not exceed the requested clip duration');
  } finally { await f.close(); await rm(directory, { recursive: true, force: true }); }
});
