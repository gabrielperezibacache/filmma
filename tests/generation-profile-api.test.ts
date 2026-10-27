import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { projectSchema } from '../server/types.js';
import { generationDimensions } from '../src/generation-profile.js';

// These synthetic clips test API accounting only. They are not H3 validation.
async function fixture(shortOutput = false, wrongWidth = false) {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-long-profile-'));
  const runtimePath = join(directory, 'synthetic-runtime.cjs');
  await writeFile(runtimePath, `
    const fs=require('node:fs'),{spawnSync}=require('node:child_process');
    const r=JSON.parse(fs.readFileSync(process.argv.at(-1)));
    console.log(JSON.stringify({type:'progress',message:'Synthetic API fixture, not AI',request:r}));
    const p=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','color=s='+(${wrongWidth ? 'r.width - 32' : 'r.width'})+'x'+r.height+':r=24','-frames:v',String(${shortOutput ? '22' : 'r.numFrames'}),'-c:v','libx264','-preset','ultrafast','-threads','1',r.outputPath],{encoding:'utf8'});
    if(p.status){console.error(p.stderr);process.exit(1)}
    console.log(JSON.stringify({type:'result',outputPath:r.outputPath}));
  `);
  const f = await createApp({ dataDirectory: join(directory, 'data'), runtimePath, python: process.execPath, skipDiagnostics: true });
  f.store.project.scenes = f.store.project.scenes.slice(0, 1);
  const scene = f.store.project.scenes[0]!;
  scene.duration = 345 / 24;
  delete scene.assetId; delete scene.endAssetId; delete scene.videoAssetId;
  scene.characterIds = [];
  await f.store.save();
  const server = f.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const params = { sceneId: scene.id, model: 'minimax-h3', memoryProfile: 'h3-long-ssd', conditioningMode: 'text', duration: 15, width: 512, height: 320, steps: 20 };
  const request = (patch = {}, path = '/api/generate') => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Filmma-Client': 'filmma' }, body: JSON.stringify({ ...params, ...patch }) });
  const wait = async (id: string) => {
    for (let n = 0; n < 500; n++) { const job = f.store.jobs.find(item => item.id === id)!; if (['completed', 'failed', 'cancelled'].includes(job.status)) return job; await new Promise(resolve => setTimeout(resolve, 20)); }
    throw new Error('Synthetic fixture timeout');
  };
  return { ...f, scene, directory, request, wait, close: async () => { await f.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); } };
}

test('long generation is explicit, validates before enqueue and preserves reference selections', async () => {
  const f = await fixture();
  try {
    for (const patch of [{ memoryProfile: 'unknown' }, { model: 'ltx-2b' }, { steps: 1 }, { steps: 21 }, { width: 768 }, { height: 512 }, { duration: 15.01 }, { conditioningMode: 'image' }]) {
      const response = await f.request(patch); assert.equal(response.status, 400, await response.text()); assert.equal(f.store.jobs.length, 0);
    }
    const source = f.store.project.assets.find(asset => asset.type === 'image')!;
    f.scene.assetId = source.id;
    assert.equal((await f.request()).status, 400); assert.equal(f.scene.assetId, source.id);
    delete f.scene.assetId;
    f.scene.endAssetId = source.id;
    assert.equal((await f.request()).status, 400); assert.equal(f.scene.endAssetId, source.id);
    delete f.scene.endAssetId;
    f.scene.characterIds = [f.store.project.characters[0]!.id];
    f.store.project.characters[0]!.locked = true; f.store.project.characters[0]!.assetId = source.id;
    assert.equal((await f.request()).status, 400); assert.equal(f.store.project.characters[0]!.assetId, source.id);
    assert.equal(f.store.jobs.length, 0);
  } finally { await f.close(); }
});

test('long API passes 345 genuine clock slots, saves profile and retains diagnostic evidence', { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const response = await f.request(); assert.equal(response.status, 202, await response.clone().text());
    const job = await f.wait((await response.json()).job.id); assert.equal(job.status, 'completed', job.message);
    const asset = f.store.project.assets.find(item => item.id === job.result!.originalAssetId)!;
    assert.equal(asset.generation!.numFrames, 345); assert.equal(asset.generation!.memoryProfile, 'h3-long-ssd'); assert.equal(asset.generation!.fps, 24);
    assert.equal(projectSchema.parse(f.store.project).assets.find(item => item.id === asset.id)!.generation!.memoryProfile, 'h3-long-ssd');
    const evidence = join(f.directory, 'data/work', asset.id);
    const request = JSON.parse(await readFile(join(evidence, 'request.json'), 'utf8'));
    assert.equal(request.memoryProfile, 'h3-long-ssd'); assert.equal(request.numFrames / request.fps, 14.375);
    const status = JSON.parse(await readFile(join(evidence, 'status.json'), 'utf8'));
    assert.equal(status.status, 'media-verified'); assert.equal(Number(status.video.nb_frames), 345);
    assert.match(await readFile(join(evidence, 'generation.jsonl'), 'utf8'), /Synthetic API fixture/);
    assert.equal(f.store.project.scenes[0]!.duration, 14.375, 'montage remains exact and unchanged');
  } finally { await f.close(); }
});

test('a short source cannot masquerade as a successful long take or overwrite the montage', { timeout: 30000 }, async () => {
  const f = await fixture(true);
  try {
    const before = structuredClone(f.scene), assetCount = f.store.project.assets.length;
    const response = await f.request(); assert.equal(response.status, 202);
    const job = await f.wait((await response.json()).job.id); assert.equal(job.status, 'failed'); assert.match(job.message, /no coincide/);
    assert.deepEqual(f.store.project.scenes[0], before); assert.equal(f.store.project.assets.length, assetCount);
    const folders = await readdir(join(f.directory, 'data/work')); assert.equal(folders.length, 1);
    const evidence = join(f.directory, 'data/work', folders[0]!);
    assert.equal(JSON.parse(await readFile(join(evidence, 'status.json'), 'utf8')).status, 'failed');
    assert((await readFile(join(evidence, 'unverified-output.mp4'))).length > 100, 'retain rejected result for diagnosis without adding it to project');
  } finally { await f.close(); }
});

test('project delivery rate and portrait framing do not override the native model clock', { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    f.store.project.format = '4:5'; f.store.project.fps = 60;
    const characters = structuredClone(f.store.project.characters), scene = structuredClone(f.scene);
    for (const long of [false, true]) {
      const response = await f.request({ width: undefined, height: undefined, memoryProfile: long ? 'h3-long-ssd' : 'conservative', duration: long ? 15 : 3 });
      assert.equal(response.status, 202, await response.clone().text());
      const job = await f.wait((await response.json()).job.id); assert.equal(job.status, 'completed', job.message);
      const asset = f.store.project.assets.find(item => item.id === job.result!.originalAssetId)!;
      const expected = generationDimensions('4:5', long, 'quality');
      assert.equal(asset.generation!.width, expected.width); assert.equal(asset.generation!.height, expected.height);
      assert.equal(asset.generation!.fps, 24, 'export fps must not retime an original generation');
      assert.equal(asset.generation!.numFrames, long ? 345 : 56);
      assert.equal(f.store.project.fps, 60); assert.equal(f.store.project.format, '4:5');
      assert.equal(f.store.project.scenes[0]!.duration, scene.duration);
      assert.equal(f.store.project.scenes[0]!.prompt, scene.prompt);
      assert.deepEqual(f.store.project.characters, characters);
    }
  } finally { await f.close(); }
});


test('native-resolution API rejects over-budget or oversized requests without launching jobs', async () => {
  const f = await fixture();
  const pilot = { memoryProfile: 'h3-native-ssd', width: 1024, height: 576, duration: 1 };
  try {
    for (const invalid of [{ duration: 15 }, { duration: 9 }, { width: 1312 }, { width: 1280, height: 768 }, { steps: 21 }, { conditioningMode: 'references' }, { model: 'ltx-2b' }]) {
      const response = await f.request({ ...pilot, ...invalid });
      assert.equal(response.status, 400, await response.text()); assert.equal(f.store.jobs.length, 0);
    }
    const source = f.store.project.assets.find(asset => asset.type === 'image')!;
    f.scene.assetId = source.id;
    assert.equal((await f.request(pilot)).status, 400); assert.equal(f.scene.assetId, source.id);
    assert.equal(f.store.jobs.length, 0);
  } finally { await f.close(); }
});

test('native-resolution API preserves requested canvas, provenance, montage and evidence', { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const before = structuredClone(f.scene), characters = structuredClone(f.store.project.characters);
    const response = await f.request({ memoryProfile: 'h3-native-ssd', width: 1024, height: 576, duration: 1 });
    assert.equal(response.status, 202, await response.clone().text());
    const job = await f.wait((await response.json()).job.id); assert.equal(job.status, 'completed', job.message);
    const asset = f.store.project.assets.find(item => item.id === job.result!.originalAssetId)!;
    assert.equal(asset.generation!.memoryProfile, 'h3-native-ssd');
    assert.equal(asset.generation!.width, 1024); assert.equal(asset.generation!.height, 576);
    assert.equal(asset.generation!.numFrames, 22); assert.equal(asset.generation!.steps, 20);
    assert.equal(projectSchema.parse(f.store.project).assets.find(item => item.id === asset.id)!.generation!.memoryProfile, 'h3-native-ssd');
    const evidence = join(f.directory, 'data/work', asset.id);
    const request = JSON.parse(await readFile(join(evidence, 'request.json'), 'utf8'));
    assert.equal(request.memoryProfile, 'h3-native-ssd'); assert.equal(request.numFrames, 22);
    assert.equal(request.width, 1024); assert.equal(request.height, 576);
    const status = JSON.parse(await readFile(join(evidence, 'status.json'), 'utf8'));
    assert.equal(status.status, 'media-verified'); assert.equal(Number(status.video.nb_frames), 22);
    assert.equal(status.video.width, 1024); assert.equal(status.video.height, 576);
    assert.match(await readFile(join(evidence, 'generation.jsonl'), 'utf8'), /Synthetic API fixture/);
    assert.equal(JSON.parse(await readFile(join(evidence, 'process-result.json'), 'utf8')).exitCode, 0);
    assert.equal(f.scene.duration, before.duration); assert.equal(f.scene.prompt, before.prompt);
    assert.deepEqual(f.store.project.characters, characters);
  } finally { await f.close(); }
});

test('native pilot cannot silently return a smaller canvas and keeps its failed output', { timeout: 30000 }, async () => {
  const f = await fixture(false, true);
  try {
    const before = structuredClone(f.scene), assetCount = f.store.project.assets.length;
    const response = await f.request({ memoryProfile: 'h3-native-ssd', width: 1024, height: 576, duration: 1 });
    assert.equal(response.status, 202);
    const job = await f.wait((await response.json()).job.id); assert.equal(job.status, 'failed'); assert.match(job.message, /no coincide/);
    assert.deepEqual(f.scene, before); assert.equal(f.store.project.assets.length, assetCount);
    const folders = await readdir(join(f.directory, 'data/work')); assert.equal(folders.length, 1);
    const evidence = join(f.directory, 'data/work', folders[0]!);
    assert.equal(JSON.parse(await readFile(join(evidence, 'status.json'), 'utf8')).status, 'failed');
    assert((await readFile(join(evidence, 'unverified-output.mp4'))).length > 100);
  } finally { await f.close(); }
});


test('native API keeps768 continuous345frames and1024 continuous192frames without changing montage', { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const before = structuredClone(f.scene), characters = structuredClone(f.store.project.characters);
    for (const [width, height, duration, frames] of [[768,448,15,345],[1024,576,8,192]] as const) {
      const response = await f.request({ memoryProfile: 'h3-native-ssd', width, height, duration });
      assert.equal(response.status, 202, await response.clone().text());
      const job = await f.wait((await response.json()).job.id); assert.equal(job.status, 'completed', job.message);
      const asset = f.store.project.assets.find(item => item.id === job.result!.originalAssetId)!;
      assert.equal(asset.generation!.numFrames, frames); assert.equal(asset.generation!.width, width); assert.equal(asset.generation!.height, height);
      const evidence = join(f.directory, 'data/work', asset.id);
      const status = JSON.parse(await readFile(join(evidence, 'status.json'), 'utf8'));
      assert.equal(Number(status.video.nb_frames), frames); assert.equal(status.video.width, width);
      assert.equal(f.scene.duration, before.duration); assert.equal(f.scene.prompt, before.prompt);
      assert.deepEqual(f.store.project.characters, characters);
    }
    const jobCount = f.store.jobs.length;
    const rejected = await f.request({ memoryProfile: 'h3-native-ssd', width: 1024, height: 576, duration: 209/24 });
    assert.equal(rejected.status,400); assert.equal(f.store.jobs.length,jobCount);
  } finally { await f.close(); }
});

test('native API defaults to detail geometry and rejects15seconds without silently falling back', { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    const omitted = { memoryProfile: 'h3-native-ssd', width: undefined, height: undefined };
    const rejected = await f.request({ ...omitted, duration: 15 });
    assert.equal(rejected.status,400); assert.equal(f.store.jobs.length,0);
    for (const format of ['16:9','9:16'] as const) {
      f.store.project.format = format;
      const response = await f.request({ ...omitted, duration: 1 });
      assert.equal(response.status,202,await response.clone().text());
      const job=await f.wait((await response.json()).job.id); assert.equal(job.status,'completed',job.message);
      const asset=f.store.project.assets.find(item=>item.id===job.result!.originalAssetId)!;
      const expected=generationDimensions(format,false,'quality','detail');
      assert.equal(asset.generation!.width,expected.width); assert.equal(asset.generation!.height,expected.height);
      assert.equal(asset.generation!.numFrames,22);
    }
  } finally { await f.close(); }
});


test('HD native API preserves1280by736 originals and refuses long or unaligned720 requests', {timeout:30000}, async()=>{
  const f=await fixture();
  try{
    const before=structuredClone(f.scene),characters=structuredClone(f.store.project.characters);
    const hd={memoryProfile:'h3-native-ssd',width:1280,height:736,duration:124/24};
    for(const invalid of [{height:720},{duration:141/24},{duration:15}]){
      const response=await f.request({...hd,...invalid});
      assert.equal(response.status,400,await response.text()); assert.equal(f.store.jobs.length,0);
    }
    const response=await f.request(hd); assert.equal(response.status,202,await response.clone().text());
    const job=await f.wait((await response.json()).job.id); assert.equal(job.status,'completed',job.message);
    const asset=f.store.project.assets.find(item=>item.id===job.result!.originalAssetId)!;
    assert.equal(asset.generation!.width,1280); assert.equal(asset.generation!.height,736); assert.equal(asset.generation!.numFrames,124);
    const evidence=join(f.directory,'data/work',asset.id);
    const status=JSON.parse(await readFile(join(evidence,'status.json'),'utf8'));
    assert.equal(status.status,'media-verified'); assert.equal(status.video.width,1280); assert.equal(status.video.height,736); assert.equal(Number(status.video.nb_frames),124);
    assert.equal(f.scene.duration,before.duration); assert.equal(f.scene.prompt,before.prompt); assert.deepEqual(f.store.project.characters,characters);
  }finally{await f.close();}
});


test('HD long API explicitly preserves345frames and rejects references or a different canvas', {timeout:30000},async()=>{
  const f=await fixture();
  try{
    const hd={memoryProfile:'h3-hd-ssd',width:1280,height:736,duration:15};
    for(const invalid of [{memoryProfile:'h3-native-ssd'},{width:1024,height:576},{width:960,height:960},{height:720},{steps:21},{conditioningMode:'references'},{model:'ltx-2b'}]){
      const response=await f.request({...hd,...invalid}); assert.equal(response.status,400,await response.text()); assert.equal(f.store.jobs.length,0);
    }
    const characters=structuredClone(f.store.project.characters),before=structuredClone(f.scene);
    const response=await f.request(hd); assert.equal(response.status,202,await response.clone().text());
    const job=await f.wait((await response.json()).job.id); assert.equal(job.status,'completed',job.message);
    const asset=f.store.project.assets.find(item=>item.id===job.result!.originalAssetId)!;
    assert.equal(asset.generation!.memoryProfile,'h3-hd-ssd'); assert.equal(asset.generation!.numFrames,345); assert.equal(asset.generation!.width,1280); assert.equal(asset.generation!.height,736);
    assert.equal(projectSchema.parse(f.store.project).assets.find(item=>item.id===asset.id)!.generation!.memoryProfile,'h3-hd-ssd');
    const evidence=join(f.directory,'data/work',asset.id),status=JSON.parse(await readFile(join(evidence,'status.json'),'utf8'));
    assert.equal(status.status,'media-verified'); assert.equal(Number(status.video.nb_frames),345); assert.equal(status.video.width,1280); assert.equal(status.maximumAdditionalRetries,0);
    assert.equal(f.scene.duration,before.duration); assert.equal(f.scene.prompt,before.prompt); assert.deepEqual(f.store.project.characters,characters);
  }finally{await f.close();}
});

test('HD long API defaults to its own720p-class canvas and refuses other proportions', {timeout:30000},async()=>{
  const f=await fixture();
  try{
    const hd={memoryProfile:'h3-hd-ssd',width:undefined,height:undefined,duration:6};
    f.store.project.format='4:3'; assert.equal((await f.request(hd)).status,400); assert.equal(f.store.jobs.length,0);
    f.store.project.format='9:16'; const response=await f.request(hd); assert.equal(response.status,202,await response.clone().text());
    const job=await f.wait((await response.json()).job.id); assert.equal(job.status,'completed',job.message);
    const asset=f.store.project.assets.find(item=>item.id===job.result!.originalAssetId)!;
    assert.equal(asset.generation!.width,736); assert.equal(asset.generation!.height,1280); assert.equal(asset.generation!.numFrames,141);
  }finally{await f.close();}
});
