import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { createApp } from '../server/app.js';

async function fixture(successfulGeneration = false) {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-editing-'));
  const publicDirectory = join(directory, 'public'); await mkdir(join(publicDirectory, 'demo'), { recursive: true });
  const image = await sharp({ create: { width: 128, height: 72, channels: 3, background: '#b34924' } }).png().toBuffer();
  await Promise.all([1, 2, 3, 4].map((n) => writeFile(join(publicDirectory, 'demo', `scene-0${n}.png`), image)));
  const runtimePath = join(directory, 'runtime.cjs'), capture = join(directory, 'requests.jsonl');
  const generatedFixture = join(directory, 'generated-fixture.mp4');
  if (successfulGeneration) execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x36:r=24', '-t', '0.25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', generatedFixture]);
  const finish = successfulGeneration
    ? `const request=JSON.parse(data);const release=request.outputPath+'.release';setInterval(()=>{if(fs.existsSync(release)){fs.copyFileSync(${JSON.stringify(generatedFixture)},request.outputPath);fs.unlinkSync(release);process.exit(0);}},20);`
    : `setTimeout(()=>{console.log(JSON.stringify({type:'error',message:'Fixture request captured without inference'}));process.exit(1);},30);`;
  await writeFile(runtimePath, `const fs=require('node:fs'); const args=process.argv.slice(2);if(args[0]==='install-runtime'){setTimeout(()=>{},20000);}else{const data=fs.readFileSync(args[args.indexOf('--request')+1],'utf8');fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify(JSON.parse(data))+'\\n');${finish}}`);
  const f = await createApp({ dataDirectory: join(directory, 'data'), publicDirectory, runtimePath, python: process.execPath, skipDiagnostics: true });
  const server = f.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const request = (path: string, body: unknown, method = 'POST') => fetch(`http://127.0.0.1:${address.port}${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Filmma-Client': 'filmma' }, body: JSON.stringify(body) });
  const waitJob = async (id: string) => { for (let n = 0; n < 400; n++) { const job = f.store.jobs.find((item) => item.id === id)!; if (['completed', 'failed', 'cancelled'].includes(job.status)) return job; await new Promise((done) => setTimeout(done, 25)); } throw new Error('Job timeout'); };
  return { ...f, directory, capture, request, waitJob, close: async () => { await f.close(); server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); await rm(directory, { recursive: true, force: true }); } };
}

test('sequence preflight rejects any invalid shot and reserves queue capacity atomically', async () => {
  const f = await fixture();
  try {
    f.store.project.scenes[2]!.prompt = '';
    const invalid = await f.request('/api/generate-sequence', { model: 'ltx-2b', conditioningMode: 'text' });
    assert.equal(invalid.status, 400); assert.equal(f.store.jobs.length, 0);
    const base = { ...f.store.project.scenes[0]! };
    f.store.project.scenes = Array.from({ length: 21 }, (_, index) => ({ ...base, id: `shot-${index}` }));
    assert.equal((await f.request('/api/generate-sequence', { model: 'ltx-2b' })).status, 400); assert.equal(f.store.jobs.length, 0);
    f.store.project.scenes.pop();
    const preparation = await (await f.request('/api/runtime/install', { model: 'ltx-2b' })).json();
    assert.equal((await f.request('/api/generate-sequence', { model: 'ltx-2b' })).status, 409);
    assert.equal(f.store.jobs.filter((job) => job.type === 'generate').length, 0);
    await f.request(`/api/jobs/${preparation.job.id}/cancel`, {});
  } finally { await f.close(); }
});

test('sequence onlyMissing skips existing clips and every queued shot uses its snapshot', async () => {
  const f = await fixture();
  try {
    f.store.project.assets.push({ id: 'existing-video', name: 'Clip existente', type: 'video', url: '/api/media/existing.mp4', mime: 'video/mp4', size: 100 });
    f.store.project.scenes[0]!.videoAssetId = 'existing-video';
    const prompts = f.store.project.scenes.slice(1).map((scene) => scene.prompt);
    const response = await f.request('/api/generate-sequence', { model: 'ltx-2b', duration: 1, conditioningMode: 'text', onlyMissing: true });
    assert.equal(response.status, 202); const body = await response.json(); assert.equal(body.jobs.length, 3); assert.equal(body.skipped, 1); assert.equal(body.total, 4);
    f.store.project.scenes.forEach((scene) => { scene.prompt = 'Edited after enqueue'; });
    for (const job of body.jobs) assert.equal((await f.waitJob(job.id)).status, 'failed');
    const captured = (await readFile(f.capture, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(captured.length, 3); captured.forEach((request, index) => { assert.ok(request.prompt.startsWith(prompts[index])); assert.equal(request.numFrames, 17); });
    f.store.project.scenes.forEach((scene) => { scene.videoAssetId = 'existing-video'; });
    const noWork = await f.request('/api/generate-sequence', { model: 'ltx-2b', onlyMissing: true }); assert.equal(noWork.status, 200); assert.deepEqual((await noWork.json()).jobs, []);
  } finally { await f.close(); }
});

test('MiniMax receives a validated ending anchor, while LTX rejects it before queueing', async () => {
  const f = await fixture();
  try {
    const scene = f.store.project.scenes[0]!; scene.endAssetId = 'demo-02';
    const invalid = { ...structuredClone(f.store.project) }; invalid.scenes[0]!.endAssetId = 'unknown';
    assert.equal((await f.request('/api/project', invalid, 'PUT')).status, 400);
    assert.equal((await f.request('/api/generate', { sceneId: scene.id, model: 'ltx-2b', conditioningMode: 'image' })).status, 400); assert.equal(f.store.jobs.length, 0);
    const { job } = await (await f.request('/api/generate', { sceneId: scene.id, model: 'minimax-h3', conditioningMode: 'image' })).json();
    assert.equal((await f.waitJob(job.id)).status, 'failed');
    const captured = JSON.parse((await readFile(f.capture, 'utf8')).trim());
    assert.equal(captured.inputImage, join(f.directory, 'public/demo/scene-01.png')); assert.equal(captured.lastFrame, join(f.directory, 'public/demo/scene-02.png')); assert.deepEqual(captured.references, []);
  } finally { await f.close(); }
});

test('noir and fade alter exported pixels while preserving duration and original bytes', async () => {
  const f = await fixture();
  try {
    const source = join(f.directory, 'public/demo/scene-01.png'), original = await readFile(source);
    f.store.project.scenes = [{ ...f.store.project.scenes[0]!, duration: 1, look: 'original', transition: 'cut' }];
    const exportFilm = async () => { const { job } = await (await f.request('/api/export', { format: 'mp4' })).json(); const done = await f.waitJob(job.id); assert.equal(done.status, 'completed', done.message); return join(f.directory, 'data/exports', done.result!.filename!); };
    const colored = await exportFilm();
    f.store.project.scenes[0]!.look = 'noir'; f.store.project.scenes[0]!.transition = 'fade';
    const noir = await exportFilm();
    const pixel = (path: string, at: string) => [...execFileSync('ffmpeg', ['-v', 'error', '-ss', at, '-i', path, '-frames:v', '1', '-vf', 'crop=2:2:960:540,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];
    const color = pixel(colored, '0.5'), middle = pixel(noir, '0.5'), first = pixel(noir, '0'), ending = pixel(noir, '0.95');
    assert.ok(Math.max(...color) - Math.min(...color) > 40, `Original is colored: ${color}`);
    assert.ok(Math.max(...middle) - Math.min(...middle) <= 3, `Noir is gray: ${middle}`);
    assert.ok(Math.max(...first) < 8, `Fade starts black: ${first}`); assert.ok(Math.max(...ending) < Math.max(...middle) / 2, `Fade ends dark: ${ending}`);
    const metadata = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', noir], { encoding: 'utf8' })); assert.ok(Math.abs(Number(metadata.format.duration) - 1) < 0.15);
    assert.deepEqual(await readFile(source), original);
    f.store.project.scenes[0]!.look = 'warm'; f.store.project.scenes[0]!.transition = 'cut';
    const warm = await exportFilm(); assert.notDeepEqual(pixel(warm, '0.5'), color);
  } finally { await f.close(); }
});

test('an empty screenplay can be backed up as a project while MP4 still requires shots', async () => {
  const f = await fixture();
  try {
    f.store.project.scenes = []; f.store.project.assets = []; f.store.project.characters = [];
    assert.equal((await f.request('/api/export', { format: 'mp4' })).status, 400);
    const exported = await f.request('/api/export', { format: 'project' }); assert.equal(exported.status, 202);
    const { job } = await exported.json(), completed = await f.waitJob(job.id); assert.equal(completed.status, 'completed', completed.message);
    const zip = await readFile(join(f.directory, 'data/exports', completed.result!.filename!));
    assert.equal(zip.readUInt32LE(0), 0x04034b50); assert.ok(zip.includes(Buffer.from('Usa Importar proyecto')));
  } finally { await f.close(); }
});


test('finishing generation preserves manual clip choices and explicit unlinks made while it runs', async () => {
  const f = await fixture(true);
  try {
    f.store.project.assets.push(
      { id: 'take-a', name: 'Toma A', type: 'video', url: '/api/media/take-a.mp4', mime: 'video/mp4', size: 100 },
      { id: 'take-b', name: 'Toma B', type: 'video', url: '/api/media/take-b.mp4', mime: 'video/mp4', size: 100 },
    );
    const sceneId = f.store.project.scenes[0]!.id;
    const scenarios = [
      { label: 'unchanged selection', initial: 'take-a', changes: [] as (string | undefined)[], expected: 'generated' },
      { label: 'different take selected', initial: 'take-a', changes: ['take-b'], expected: 'take-b' },
      { label: 'existing take unlinked', initial: 'take-a', changes: [undefined], expected: undefined },
      { label: 'explicit unlink of empty scene', initial: undefined, changes: [undefined], expected: undefined },
      { label: 'selection changed and restored', initial: 'take-a', changes: ['take-b', 'take-a'], expected: 'take-a' },
    ];
    for (const [index, scenario] of scenarios.entries()) {
      f.store.project.scenes[0]!.videoAssetId = scenario.initial;
      f.store.project.scenes[0]!.trimStart = 5; f.store.project.scenes[0]!.speed = 2; f.store.project.scenes[0]!.color = { temperature: .3 };
      await f.store.save();
      const beforeGeneration = structuredClone(f.store.project);
      const response = await f.request('/api/generate', { sceneId, model: 'ltx-2b', conditioningMode: 'text', duration: 1 });
      assert.equal(response.status, 202); const { job } = await response.json();
      let captured: { outputPath: string } | undefined;
      for (let retry = 0; retry < 200; retry++) {
        const lines = (await readFile(f.capture, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);
        if (lines.length > index) { captured = JSON.parse(lines[index]!); break; }
        await new Promise((done) => setTimeout(done, 10));
      }
      assert.ok(captured, 'Generation must be running before changing the chosen take');
      assert.equal(f.store.jobs.find((item) => item.id === job.id)!.status, 'running');
      for (const selection of scenario.changes) {
        const edited = structuredClone(f.store.project);
        edited.scenes[0]!.videoAssetId = selection; edited.scenes[0]!.clearVideoAsset = selection === undefined;
        const saved = await f.request('/api/project', edited, 'PUT'); assert.equal(saved.status, 200);
      }
      await writeFile(captured.outputPath + '.release', 'finish');
      const done = await f.waitJob(job.id); assert.equal(done.status, 'completed', done.message);
      const generatedId = done.result!.assetId!;
      assert.ok(f.store.project.assets.some((asset) => asset.id === generatedId), 'Every completed take remains in the library');
      assert.equal(f.store.project.scenes[0]!.videoAssetId, scenario.expected === 'generated' ? generatedId : scenario.expected, scenario.label);
      assert.ok((await readFile(captured.outputPath)).length > 100, 'Generated original remains on disk');
      const persisted = JSON.parse(await readFile(join(f.directory, 'data/project.json'), 'utf8'));
      assert.equal(persisted.scenes[0].videoAssetId, f.store.project.scenes[0]!.videoAssetId);
      if (index === 0) {
        assert.equal(f.store.project.scenes[0]!.trimStart, 0, 'A fresh generated source starts at its own first frame, not beyond EOF');
        assert.equal(f.store.project.scenes[0]!.speed, 1); assert.deepEqual(f.store.project.scenes[0]!.color, { temperature: .3 });
        assert.deepEqual(f.store.project.scenes[0]!.characterIds, beforeGeneration.scenes[0]!.characterIds);
        const stale = structuredClone(beforeGeneration); stale.scenes[0]!.description = 'Texto guardado después de terminar la generación'; stale.scenes[0]!.preserveVideoAsset = true;
        const saved = await f.request('/api/project', stale, 'PUT'); assert.equal(saved.status, 200);
        const savedProject = (await saved.json()).project;
        assert.equal(savedProject.scenes[0].videoAssetId, generatedId, 'A stale autosave of take A preserves newly generated B');
        assert.equal(savedProject.scenes[0].trimStart, 0, 'The stale trim from take A must not return after generation'); assert.equal(savedProject.scenes[0].speed, 1);
        assert.deepEqual(savedProject.scenes[0].color, { temperature: .3 });
        assert.equal(savedProject.scenes[0].description, stale.scenes[0]!.description); assert.equal(savedProject.scenes[0].preserveVideoAsset, undefined);
        stale.scenes[0]!.clearVideoAsset = true;
        const cleared = await f.request('/api/project', stale, 'PUT'); assert.equal(cleared.status, 200);
        assert.equal((await cleared.json()).project.scenes[0].videoAssetId, undefined, 'Explicit unlink takes precedence over preserve');
        delete stale.scenes[0]!.clearVideoAsset;
        const keptEmpty = await f.request('/api/project', stale, 'PUT'); assert.equal(keptEmpty.status, 200);
        assert.equal((await keptEmpty.json()).project.scenes[0].videoAssetId, undefined, 'A stale take A cannot reattach a server-side empty selection');
        const clean = JSON.parse(await readFile(join(f.directory, 'data/project.json'), 'utf8'));
        assert.equal(clean.scenes[0].preserveVideoAsset, undefined); assert.equal(clean.scenes[0].clearVideoAsset, undefined);
      }
    }
  } finally { await f.close(); }
});


test('H3 picture tokens follow the exact reference array order, omitting unpictured and unlocked entities', async () => {
  const f = await fixture();
  try {
    f.store.project.characters = [
      { id: 'elena', name: 'Elena', role: 'Protagonista', description: 'Abrigo ocre y cabello oscuro.', locked: true, assetId: 'demo-04' },
      { id: 'memory', name: 'El recuerdo', role: 'Elemento narrativo', description: 'La memoria del viejo cine.', locked: true },
      { id: 'projector', name: 'El proyector', role: 'Objeto', description: 'Metal negro y dos bobinas plateadas.', locked: true, assetId: 'demo-02' },
      { id: 'unlocked', name: 'El visitante', role: 'Figurante', description: 'Una silueta cambiante.', locked: false, assetId: 'demo-03' },
      { id: 'unused', name: 'La marquesina', role: 'Objeto de otro plano', description: 'Luces rojas.', locked: true, assetId: 'demo-01' },
    ];
    const scene = f.store.project.scenes[0]!;
    // Selection order differs from the entity list; mapping must match the actual outgoing array.
    scene.characterIds = ['projector', 'memory', 'elena', 'unlocked'];
    const response = await f.request('/api/generate', { sceneId: scene.id, model: 'minimax-h3', conditioningMode: 'references', duration: 1 });
    assert.equal(response.status, 202); const { job } = await response.json();
    assert.equal((await f.waitJob(job.id)).status, 'failed');
    const request = JSON.parse((await readFile(f.capture, 'utf8')).trim());
    assert.deepEqual(request.references, [
      { type: 'image', path: join(f.directory, 'public/demo/scene-04.png') },
      { type: 'image', path: join(f.directory, 'public/demo/scene-02.png') },
    ]);
    // Match the numbered mapping to stable entity IDs, independent of connective prose.
    const mappedEntities = [...request.prompt.matchAll(/^<Picture (\d+)>[^\n]*?\[([^\]]+)\]/gm)].map((match: RegExpMatchArray) => [Number(match[1]), match[2]]);
    assert.deepEqual(mappedEntities, [[1, 'elena'], [2, 'projector']]);
    assert.match(request.prompt, /"Elena" \[elena\]: Abrigo ocre y cabello oscuro/);
    assert.match(request.prompt, /"El proyector" \[projector\]: Metal negro y dos bobinas plateadas/);
    assert.match(request.prompt, /"El recuerdo" \[memory\]: La memoria del viejo cine/);
    assert.match(request.prompt, /"El visitante" \[unlocked\]: Una silueta cambiante/);
    assert.doesNotMatch(request.prompt, /<Picture 3>|La marquesina/);
    assert.equal(request.inputImage, undefined); assert.equal(request.lastFrame, undefined);
  } finally { await f.close(); }
});
