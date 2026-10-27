import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import sharp from 'sharp';
import { createApp } from '../server/app.js';

test('saved continuity reaches the real generation request and Codex context without running inference', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-continuity-api-'));
  const publicDirectory = join(directory, 'public'); await mkdir(join(publicDirectory, 'demo'), { recursive: true });
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ac945d' } }).png().toBuffer();
  await Promise.all([1, 2, 3, 4].map((number) => writeFile(join(publicDirectory, 'demo', `scene-0${number}.png`), png)));
  const capturedRequest = join(directory, 'request.json'), capturedContext = join(directory, 'context.txt');
  const fakeRuntime = join(directory, 'runtime'), fakeCodex = join(directory, 'codex');
  await writeFile(fakeRuntime, `#!/usr/bin/env node
const fs=require('node:fs');const index=process.argv.indexOf('--request');
fs.copyFileSync(process.argv[index+1],${JSON.stringify(capturedRequest)});
console.log(JSON.stringify({type:'error',message:'Fixture: request captured; inference deliberately not executed.'}));process.exitCode=2;
`); await chmod(fakeRuntime, 0o700);
  await writeFile(fakeCodex, `#!/usr/bin/env node
const fs=require('node:fs');let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{fs.writeFileSync(${JSON.stringify(capturedContext)},input);console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'La continuidad está documentada.'}}));});
`); await chmod(fakeCodex, 0o700);
  const runtime = await createApp({ dataDirectory: join(directory, 'data'), publicDirectory, skipDiagnostics: true, python: fakeRuntime, codex: fakeCodex });
  const server: Server = await new Promise((resolve, reject) => { const listener = runtime.app.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve(listener)); });
  const address = server.address(); assert(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown, method = 'POST') => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Filmma-Client': 'filmma' }, body: JSON.stringify(body) });
  async function completed(id: string) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const job = runtime.store.jobs.find((item) => item.id === id)!;
      if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error('Fixture timed out');
  }
  try {
    const project = structuredClone(runtime.store.project);
    project.characters[0]!.continuity = { costume: 'Abrigo azul', props: 'Lata de película' };
    project.characters[1]!.assetId = 'demo-02';
    project.scenes[0]!.continuity = { elena: { appearance: 'Cabello húmedo' } };
    project.scenes[1]!.continuity = { elena: { props: 'Lata sobre la mesa', intentionalChange: true, changeReason: 'Prepara el proyector.' } };
    project.scenes[1]!.cinematography = { era: '1930s', historicalContext: { year: '1932', location: 'Santiago de Chile', mode: 'faithful', notes: 'Conservar el proyector y los rasgos de Elena.' }, filmFormat: '35mm', filmStock: 'tungsten-fast', lensFamily: 'anamorphic', lens: '50mm', cameraBody: 'cinema-digital' };
    Object.assign(project.scenes[1]!.cinematography!, { director: 'ozu', takeType: 'reaction', movement: 'crane-down', angle: 'high' });
    const saved = await post('/api/project', project, 'PUT'); assert.equal(saved.status, 200);
    assert.equal((await saved.json()).project.scenes[1].continuity.elena.changeReason, 'Prepara el proyector.');
    const submitted = await post('/api/generate', { sceneId: 'scene-02', model: 'minimax-h3', conditioningMode: 'references', duration: 1 }); assert.equal(submitted.status, 202);
    const generation = await completed((await submitted.json()).job.id); assert.equal(generation.status, 'failed'); assert.match(generation.message, /Fixture/);
    const request = JSON.parse(await readFile(capturedRequest, 'utf8'));
    assert.equal(request.references.length, 2); assert.equal(request.inputImage, undefined);
    assert.match(request.prompt, /Wardrobe \/ materials: Abrigo azul/);
    assert.match(request.prompt, /Physical appearance \/ current condition: Cabello húmedo/);
    assert.match(request.prompt, /Props \/ accessories: Lata sobre la mesa/);
    assert.match(request.prompt, /Intentional story change: Prepara el proyector/);
    assert.match(request.prompt, /1932/); assert.match(request.prompt, /Santiago de Chile/);
    assert.match(request.prompt, /Conservar el proyector/);
    assert.match(request.prompt, /50 mm/); assert.match(request.prompt, /[Aa]namorphic/);
    assert.match(request.prompt, /500T/); assert.match(request.prompt, /[Dd]igital/);
    assert.match(request.prompt, /Ozu/); assert.match(request.prompt, /reaction take/i);
    assert.match(request.prompt, /descending crane move/); assert.match(request.prompt, /High camera angle/);
    assert.doesNotMatch(request.prompt, /Consider a low, level camera|Consider a patient locked camera/);
    assert.match(request.prompt, /<Picture 1>.*"Elena" \[elena\]/);
    assert.match(request.prompt, /<Picture 2>.*"El proyector" \[projector\]/);
    assert.match(request.references[0].path, /scene-04\.png$/); assert.match(request.references[1].path, /scene-02\.png$/);
    const submittedCodex = await post('/api/codex', { task: 'continuity', prompt: 'Revisa el estado entre escenas.', sceneId: 'scene-02' }); assert.equal(submittedCodex.status, 202);
    const codex = await completed((await submittedCodex.json()).job.id); assert.equal(codex.status, 'completed');
    const context = await readFile(capturedContext, 'utf8');
    assert.match(context, /"currentState"/); assert.match(context, /"sceneId": "scene-04"/); assert.match(context, /Abrigo azul/); assert.match(context, /Prepara el proyector/);
    assert.match(context, /"storyPeriod"/); assert.match(context, /Santiago de Chile/); assert.match(context, /1932/);
    assert.match(context, /"director": "ozu"/); assert.match(context, /"takeType": "reaction"/); assert.match(context, /"movement": "crane-down"/);
    assert.equal(runtime.store.project.assets.filter((asset) => asset.type === 'video').length, 0);
  } finally { await runtime.close(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});
