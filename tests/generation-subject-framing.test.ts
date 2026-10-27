import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { buildCinematographyPrompt, type Cinematography } from '../src/cinematography.js';

test('only explicitly non-human casts adapt built-in anatomical composition cues', () => {
  const scene = { camera: 'Intención conservada', cinematography: { framing: 'medium', angle: 'eye-level', lens: '50mm', movement: 'locked' } as Cinematography };
  const before = structuredClone(scene), original = buildCinematographyPrompt(scene);
  for (const roles of [['Objeto'], ['Producto'], ['Lugar'], ['Objeto', 'Lugar'], [' Objeto de continuidad · prueba ']]) {
    const prompt = buildCinematographyPrompt(scene, roles);
    assert.match(prompt, /Medium shot of the assigned object, product or place/);
    assert.match(prompt, /main height/);
    assert.match(prompt, /50 mm/); assert.match(prompt, /Locked-off/);
    assert.doesNotMatch(prompt, /waist up|eye level/);
  }
  for (const roles of [[], ['Personaje'], ['Objeto', 'Personaje'], ['Objeto', ''], ['Visitante'], ['Personaje · Objeto']]) {
    assert.equal(buildCinematographyPrompt(scene, roles), original, 'do not infer non-human status for mixed, unresolved or custom casts');
  }
  const close = { cinematography: { framing: 'close-up' } as Cinematography };
  assert.match(buildCinematographyPrompt(close, ['Producto']), /materials and surface details/);
  assert.doesNotMatch(buildCinematographyPrompt(close, ['Producto']), /expression/);
  assert.match(buildCinematographyPrompt(close, ['Personaje']), /expression/);
  assert.deepEqual(scene, before);
});

test('the final generation prompt adapts an object shot while preserving people, continuity and user intent', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-subject-framing-'));
  const runtimePath = join(directory, 'synthetic-runtime.cjs');
  // Exercise the real API composition path with synthetic media, never the GPU.
  await writeFile(runtimePath, `
    const fs=require('node:fs'),{spawnSync}=require('node:child_process');
    const r=JSON.parse(fs.readFileSync(process.argv.at(-1)));
    const result=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','color=s=256x256:r=24','-frames:v',String(r.numFrames),'-c:v','libx264','-preset','ultrafast','-threads','1',r.outputPath],{encoding:'utf8'});
    if(result.status){console.error(result.stderr);process.exit(1)}
    console.log(JSON.stringify({type:'result',outputPath:r.outputPath}));
  `);
  const f = await createApp({ dataDirectory: join(directory, 'store'), runtimePath, python: process.execPath, skipDiagnostics: true });
  const server = f.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  try {
    const scene = f.store.project.scenes[0]!;
    scene.prompt = 'A vintage cinema camera rests on a wooden table.';
    scene.negativePrompt = 'No logos or text';
    scene.cinematography = { framing: 'medium', angle: 'eye-level', lens: '50mm' };
    scene.characterIds = ['object'];
    delete scene.assetId; delete scene.endAssetId; delete scene.videoAssetId;
    f.store.project.characters = [
      { id: 'object', name: 'Cámara', role: 'Objeto de continuidad · prueba', description: 'Brushed metal cinema camera.', locked: true, continuity: { appearance: 'Glass lens', props: 'Wooden table' } },
      { id: 'person', name: 'Elena', role: 'Personaje', description: 'The same recurring character.', locked: true },
    ];
    await f.store.save();
    for (const characterId of ['object', 'person']) {
      f.store.project.scenes[0]!.characterIds = [characterId];
      const response: Response = await fetch(`http://127.0.0.1:${address.port}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Filmma-Client': 'filmma' }, body: JSON.stringify({ sceneId: scene.id, model: 'minimax-h3', conditioningMode: 'text', duration: 1, width: 256, height: 256, steps: 20 }) });
      assert.equal(response.status, 202, await response.clone().text());
      const jobId = (await response.json()).job.id;
      for (let i = 0; i < 500 && ['queued', 'running'].includes(f.store.jobs.find(job => job.id === jobId)!.status); i++) await new Promise(resolve => setTimeout(resolve, 20));
      const job = f.store.jobs.find(item => item.id === jobId)!;
      assert.equal(job.status, 'completed', job.message);
      const generation = f.store.project.assets.find(asset => asset.id === job.result!.originalAssetId)!.generation!;
      assert(generation.prompt.startsWith(scene.prompt));
      assert.match(generation.prompt, /Visual constraints \/ Avoid: No logos or text/);
      if (characterId === 'object') {
        assert.doesNotMatch(generation.prompt, /waist up|subject’s eye level/);
        assert.match(generation.prompt, /Medium shot of the assigned object/);
        assert.match(generation.prompt, /Glass lens/); assert.match(generation.prompt, /Wooden table/);
      } else {
        assert.match(generation.prompt, /framing the subject from the waist up/);
        assert.match(generation.prompt, /The same recurring character/);
      }
      assert.equal(f.store.project.scenes[0]!.prompt, scene.prompt);
    }
  } finally {
    await f.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
