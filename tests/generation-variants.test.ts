import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { runProcess } from '../server/process.js';
import { listSceneTakes } from '../src/takes.js';
import { projectSavePayload } from '../src/projectSync.js';

async function fixture(withAi = false) {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-takes-')), dataDirectory = join(directory, 'data');
  await mkdir(join(dataDirectory, 'media'), { recursive: true });
  const source = join(directory, 'fixture.mp4'), calls = join(directory, 'calls.jsonl'), lock = join(directory, 'active'), runtimePath = join(directory, 'runtime.cjs'), upscalerPath = join(directory, 'upscaler.cjs');
  const encoded = await runProcess('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=256x256:rate=24:duration=0.083333', '-c:v', 'libx264', source]); assert.equal(encoded.code, 0, encoded.stderr);
  await writeFile(runtimePath, `const fs=require('node:fs');const r=JSON.parse(fs.readFileSync(process.argv.at(-1)));fs.writeFileSync(${JSON.stringify(lock)},'active',{flag:'wx'});fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(r)+'\\n');setTimeout(()=>{fs.copyFileSync(${JSON.stringify(source)},r.outputPath);fs.unlinkSync(${JSON.stringify(lock)});console.log(JSON.stringify({type:'result',ok:true}));},60);`);
  await writeFile(upscalerPath, `const fs=require('node:fs'),{spawnSync}=require('node:child_process');const info={ok:true,ready:true,model:'realesrgan-x4plus',engine:'realesrgan-ncnn-vulkan',version:'20220424',modelSha256:'a'.repeat(64),tile:128,temporalMode:'frame-independent-conservative'};if(process.argv[2]==='doctor'){console.log(JSON.stringify(info));process.exit(0)}const r=JSON.parse(fs.readFileSync(process.argv.at(-1)));const p=spawnSync(r.ffmpeg,['-v','error','-i',r.source,'-an','-vf','scale='+r.targetWidth+':'+r.targetHeight,'-fps_mode','passthrough','-c:v','libx264','-preset','ultrafast','-threads','2',r.destination],{encoding:'utf8'});if(p.status){console.error(p.stderr);process.exit(1)}console.log(JSON.stringify({...info,event:'result'}));`);
  const f = await createApp({ dataDirectory, runtimePath, upscalerPath, python: process.execPath, skipDiagnostics: true });
  f.store.project.scenes = f.store.project.scenes.slice(0, 1);
  f.store.project.scenes[0]!.duration = 1;
  if (withAi) f.store.project.aiFinishing = { enabled: true, strength: .35 };
  await f.store.save();
  const server = f.app.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const request = (path: string, body: unknown, method = 'POST') => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Filmma-Client': 'filmma' }, body: JSON.stringify(body) });
  const wait = async (id: string) => { for (let n = 0; n < 2000; n++) { const job = f.store.jobs.find(item => item.id === id)!; if (['completed', 'failed', 'cancelled'].includes(job.status)) return job; await new Promise(done => setTimeout(done, 20)); } throw new Error('Job timeout'); };
  const records = async () => (await readFile(calls, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const params = () => ({ sceneId: f.store.project.scenes[0]!.id, model: 'ltx-2b', conditioningMode: 'text', duration: 1, count: 3 });
  return { ...f, directory, base, request, wait, records, params, close: async () => { await f.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); await rm(directory, { recursive: true, force: true }); } };
}

test('variants execute serially with incremental seeds, effective direction and immutable provenance without selecting a take', { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const scene = f.store.project.scenes[0]!;
    scene.seed = 400; scene.camera = 'Do not use this legacy camera'; scene.cinematography = { framing: 'close-up', lens: '85mm', lighting: 'window' };
    scene.continuity = { elena: { costume: 'Abrigo azul', intentionalChange: true, changeReason: 'Nueva jornada' } };
    const before = structuredClone(scene), response = await f.request('/api/generate-variants', { ...f.params(), prompt: 'Elena waits.', negativePrompt: 'blur', width: 512, height: 320, steps: 6 });
    assert.equal(response.status, 202); const submitted = await response.json();
    assert.deepEqual(submitted.seeds, [400, 401, 402]); assert(submitted.jobs.every((job: any) => job.result.sceneId === scene.id));
    for (const item of submitted.jobs) { const completed = await f.wait(item.id); assert.equal(completed.status, 'completed', completed.message); assert.equal(completed.result?.sceneId, scene.id); }
    assert.deepEqual(f.store.project.scenes[0], before, 'even an empty selection and all editing choices remain unchanged');
    const requests = await f.records(); assert.deepEqual(requests.map(item => item.seed), [400, 401, 402]);
    assert.match(requests[0].prompt, /Close-up/); assert.match(requests[0].prompt, /85 mm/); assert.match(requests[0].prompt, /Abrigo azul/); assert.doesNotMatch(requests[0].prompt, /legacy camera/);
    const takes = listSceneTakes(f.store.project, scene.id); assert.equal(takes.length, 3);
    for (const take of takes) {
      const provenance = take.generation!; const request = requests.find(item => item.seed === provenance.seed);
      assert.equal(provenance.prompt, request.prompt); assert.equal(provenance.width, 512); assert.equal(provenance.height, 320); assert.equal(provenance.numFrames, 17); assert.equal(provenance.steps, 6); assert.equal(provenance.conditioningMode, 'text');
      assert.equal(provenance.continuity?.elena?.costume, 'Abrigo azul'); assert.deepEqual(provenance.cinematography, before.cinematography); assert.deepEqual(provenance.referenceAssetIds, []);
      assert(!JSON.stringify(provenance).includes(f.directory)); assert.equal(take.selected, false);
    }
    // An older editor may omit server-owned metadata or new assets entirely.
    const stale = structuredClone(f.store.project); stale.assets = stale.assets.filter(asset => !asset.generation);
    assert.equal((await f.request('/api/project', stale, 'PUT')).status, 200);
    assert.equal(listSceneTakes(f.store.project, scene.id).length, 3);
    const altered = structuredClone(f.store.project), historical = altered.assets.find(asset => asset.generation)!;
    historical.generation!.seed = 123456;
    assert.equal((await f.request('/api/project', altered, 'PUT')).status, 200);
    assert.notEqual(f.store.project.assets.find(asset => asset.id === historical.id)!.generation!.seed, 123456, 'generation provenance is server-owned');
    const regular = await f.request('/api/generate', { ...f.params(), count: undefined, seed: 900 });
    const regularJob = await f.wait((await regular.json()).job.id); assert.equal(regularJob.status, 'completed', regularJob.message);
    assert.equal(f.store.project.scenes[0]!.videoAssetId, regularJob.result?.originalAssetId, 'normal generation keeps its existing apply behavior');
    const chosen = f.store.project.scenes[0]!.videoAssetId;
    const again = await f.request('/api/generate-variants', { ...f.params(), count: 1, seed: 901 });
    assert.equal((await f.wait((await again.json()).jobs[0].id)).status, 'completed'); assert.equal(f.store.project.scenes[0]!.videoAssetId, chosen);
  } finally { await f.close(); }
});

test('invalid variant counts, overflowing seeds, duration and references create no partial jobs', async () => {
  const f = await fixture();
  try {
    for (const patch of [{ count: 0 }, { count: 5 }, { count: 2.5 }, { seed: 2147483647 }, { duration: 16 }, { width: 1344, height: 1344 }, { conditioningMode: 'references' }, { conditioningMode: 'image', model: 'ltx-2b', sceneId: 'absent' }]) {
      const response = await f.request('/api/generate-variants', { ...f.params(), ...patch }); assert([400, 404].includes(response.status), await response.text());
      assert.equal(f.store.jobs.length, 0); assert.equal((await f.records()).length, 0);
    }
    f.store.project.scenes[0]!.characterIds = f.store.project.characters.map(character => character.id);
    for (const character of f.store.project.characters) character.description = 'Description '.repeat(1000);
    const tooLong = await f.request('/api/generate-variants', { ...f.params(), prompt: 'Scene '.repeat(1900), negativePrompt: 'Avoid '.repeat(1900) });
    assert.equal(tooLong.status, 400); assert.match((await tooLong.json()).error, /32.000/); assert.equal(f.store.jobs.length, 0);
  } finally { await f.close(); }
});

test('automatic AI creates a retained derivative for a variant without applying it to an empty montage', { timeout: 60000 }, async () => {
  const f = await fixture(true);
  try {
    const before = structuredClone(f.store.project.scenes[0]);
    const response = await f.request('/api/generate-variants', { ...f.params(), count: 1 }); assert.equal(response.status, 202);
    const job = await f.wait((await response.json()).jobs[0].id); assert.equal(job.status, 'completed', job.message);
    assert.equal(job.result?.finishing?.created, 1); assert.equal(job.result?.finishing?.applied, 0);
    assert.deepEqual(f.store.project.scenes[0], before);
    const takes = listSceneTakes(f.store.project, before!.id); assert.equal(takes.length, 2); assert.equal(takes.filter(take => take.isDerivative).length, 1);
    assert(takes.every(take => take.generation?.sceneId === before!.id && !take.selected));
    assert(takes.some(take => take.asset.id === job.result?.originalAssetId));
  } finally { await f.close(); }
});

test('project archive round trip keeps generation parameters and remaps take, character and image associations', { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const scene = f.store.project.scenes[0]!;
    scene.cinematography = { framing: 'medium', movement: 'locked' }; scene.characterIds = ['elena'];
    const response = await f.request('/api/generate-variants', { ...f.params(), conditioningMode: 'image', count: 1 }); assert.equal(response.status, 202);
    const job = await f.wait((await response.json()).jobs[0].id); assert.equal(job.status, 'completed', job.message);
    const original = f.store.project.assets.find(asset => asset.id === job.result?.originalAssetId)!, provenance = structuredClone(original.generation!);
    const archiveJob = await f.wait((await (await f.request('/api/export', { format: 'project' })).json()).job.id); assert.equal(archiveJob.status, 'completed', archiveJob.message);
    const blob = await (await fetch(f.base + archiveJob.result!.url)).blob(), form = new FormData(); form.append('projectFile', blob, 'takes.filmma.zip');
    const imported = await fetch(f.base + '/api/projects/import', { method: 'POST', headers: { 'X-Filmma-Client': 'filmma' }, body: form }); assert.equal(imported.status, 201, await imported.clone().text());
    const restored = (await imported.json()).project, restoredScene = restored.scenes[0], takes = listSceneTakes(restored, restoredScene.id);
    assert.equal(takes.length, 1); const generation = takes[0]!.generation!;
    assert.equal(generation.projectId, restored.id); assert.equal(generation.sceneId, restoredScene.id); assert.notEqual(generation.projectId, provenance.projectId); assert.notEqual(generation.sceneId, provenance.sceneId);
    assert.deepEqual(generation.characterIds, restoredScene.characterIds); assert.deepEqual(generation.referenceAssetIds, [restoredScene.assetId]);
    assert.equal(generation.prompt, provenance.prompt); assert.equal(generation.seed, provenance.seed); assert.deepEqual(generation.cinematography, restoredScene.cinematography);
    assert.equal(generation.continuity?.[restoredScene.characterIds[0]]?.costume, provenance.continuity?.elena?.costume);
  } finally { await f.close(); }
});


test('large provenance remains in compact saves and project ZIPs without exceeding the editor request limit', { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const submitted = await (await f.request('/api/generate-variants', { ...f.params(), count: 1 })).json();
    const job = await f.wait(submitted.jobs[0].id); assert.equal(job.status, 'completed', job.message);
    const source = f.store.project.assets.find(asset => asset.id === job.result?.originalAssetId)!;
    for (let index = 0; index < 150; index++) {
      const id = `long-take-${index}`, url = `/api/media/${id}.mp4`;
      await copyFile(join(f.directory, 'data', 'media', `${source.id}.mp4`), join(f.directory, 'data', 'media', `${id}.mp4`));
      f.store.project.assets.push({ ...source, id, url, generation: { ...source.generation!, seed: index, prompt: `Narrative snapshot ${index}: ` + 'detailed scene '.repeat(2000) } });
    }
    await f.store.save();
    const before = structuredClone(f.store.project), payload = projectSavePayload(before, before);
    assert(Buffer.byteLength(JSON.stringify(before)) > 4 * 1024 * 1024);
    assert(Buffer.byteLength(JSON.stringify(payload)) < 1024 * 1024);
    assert.equal(before.assets.filter(asset => asset.generation).length, 151, 'payload preparation never mutates editor state');
    const saved = await f.request('/api/project', payload, 'PUT'); assert.equal(saved.status, 200, await saved.clone().text());
    assert.deepEqual(f.store.project.assets, before.assets);
    const exportJob = await f.wait((await (await f.request('/api/export', { format: 'project' })).json()).job.id); assert.equal(exportJob.status, 'completed', exportJob.message);
    const blob = await (await fetch(f.base + exportJob.result!.url)).blob(), form = new FormData(); form.append('projectFile', blob, 'large-take-register.filmma.zip');
    const imported = await fetch(f.base + '/api/projects/import', { method: 'POST', headers: { 'X-Filmma-Client': 'filmma' }, body: form }); assert.equal(imported.status, 201, await imported.clone().text());
    const restored = (await imported.json()).project, takes = listSceneTakes(restored, restored.scenes[0].id);
    assert.equal(takes.length, 151);
    assert.deepEqual(takes.map(take => take.generation!.prompt).sort(), before.assets.flatMap(asset => asset.generation ? [asset.generation.prompt] : []).sort());
  } finally { await f.close(); }
});


test('an imported baseline remains a scene take after choosing a variant, stale saves and archive import', { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const scene = f.store.project.scenes[0]!, source = join(f.directory, 'fixture.mp4'), destination = join(f.directory, 'data', 'media', 'baseline.mp4');
    await copyFile(source, destination);
    f.store.project.assets.push({ id: 'baseline', name: 'Toma anterior importada', type: 'video', url: '/api/media/baseline.mp4', mime: 'video/mp4', size: (await readFile(source)).length });
    scene.videoAssetId = 'baseline';
    const response = await f.request('/api/generate-variants', { ...f.params(), count: 1 }); assert.equal(response.status, 202);
    const job = await f.wait((await response.json()).jobs[0].id); assert.equal(job.status, 'completed', job.message);
    assert.equal(f.store.project.scenes[0]!.videoAssetId, 'baseline'); assert.deepEqual(f.store.project.scenes[0]!.takeAssetIds, ['baseline']);
    const selected = structuredClone(f.store.project); selected.scenes[0]!.videoAssetId = job.result!.originalAssetId; delete selected.scenes[0]!.takeAssetIds;
    assert.equal((await f.request('/api/project', selected, 'PUT')).status, 200);
    const takes = listSceneTakes(f.store.project, scene.id); assert.equal(takes.length, 2); assert.equal(takes.find(take => take.asset.id === 'baseline')?.generation, undefined);
    const stale = structuredClone(f.store.project); stale.scenes[0]!.takeAssetIds = []; assert.equal((await f.request('/api/project', stale, 'PUT')).status, 200);
    assert(f.store.project.scenes[0]!.takeAssetIds!.includes('baseline')); assert.equal(f.store.project.scenes[0]!.videoAssetId, job.result!.originalAssetId);
    assert.deepEqual(await readFile(destination), await readFile(source));
    const exportJob = await f.wait((await (await f.request('/api/export', { format: 'project' })).json()).job.id); assert.equal(exportJob.status, 'completed', exportJob.message);
    const blob = await (await fetch(f.base + exportJob.result!.url)).blob(), form = new FormData(); form.append('projectFile', blob, 'baseline-takes.filmma.zip');
    const imported = await fetch(f.base + '/api/projects/import', { method: 'POST', headers: { 'X-Filmma-Client': 'filmma' }, body: form }); assert.equal(imported.status, 201, await imported.clone().text());
    const restored = (await imported.json()).project, importedTakes = listSceneTakes(restored, restored.scenes[0].id);
    assert.equal(importedTakes.length, 2); const baseline = importedTakes.find(take => take.asset.name === 'Toma anterior importada')!;
    assert(baseline); assert.equal(baseline.generation, undefined); assert.notEqual(baseline.asset.id, 'baseline'); assert(restored.scenes[0].takeAssetIds.includes(baseline.asset.id));
  } finally { await f.close(); }
});
