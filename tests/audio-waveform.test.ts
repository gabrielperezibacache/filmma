import test from 'node:test';
import assert from 'node:assert/strict';
import { createWaveformCache, parseWaveform, sampleWaveform } from '../src/audio-waveform.js';
import type { WaveformData } from '../src/audio-waveform.js';
const data: WaveformData = { assetId: 'asset', duration: 4, sampleRate: 8000, channels: 1, hasAudio: true, peaks: [0, .25, .5, 1] };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('waveforms sample the actual trimmed interval without normalizing amplitude', () => {
  assert.deepEqual(sampleWaveform(data, 1, 2, 2), [.25, .5]);
  assert.deepEqual(sampleWaveform(data, 3, 3, 3), [1, 0, 0], 'Beyond source end is silence');
  assert.deepEqual(sampleWaveform(data, 0, 4, 2), [.25, 1], 'Downsampling preserves source peaks');
  assert.deepEqual(sampleWaveform({ ...data, hasAudio: false, peaks: [] }, 0, 4, 4), [0, 0, 0, 0]);
  assert.deepEqual(sampleWaveform({ ...data, peaks: [0, 0, 0, 0] }, 0, 4, 4), [0, 0, 0, 0]);
});

test('waveform output reflects clip gain, track mute and fades over logical unclipped duration', () => {
  const full = { ...data, peaks: [1, 1, 1, 1] };
  assert.deepEqual(sampleWaveform(full, 0, 4, 4, { volume: .5 }, .4), [.2, .2, .2, .2]);
  assert.deepEqual(sampleWaveform(full, 0, 4, 4, { muted: true }), [0, 0, 0, 0]);
  assert.deepEqual(sampleWaveform(full, 0, 4, 4, {}, 0), [0, 0, 0, 0]);
  assert.deepEqual(sampleWaveform(full, 0, 4, 4, { fadeIn: 2, fadeOut: 2 }), [.25, .75, .75, .25]);
  assert.deepEqual(sampleWaveform(full, 0, 2, 2, { fadeOut: 2 }, 1, 10), [1, 1], 'Movie clipping does not shift a fade out earlier');
});

test('malformed waveform results are rejected; no-audio is distinct from a silent stream', () => {
  assert.equal(parseWaveform(data, 'asset'), data);
  assert.equal(parseWaveform({ ...data, hasAudio: false, peaks: [] }, 'asset').hasAudio, false);
  for (const invalid of [{ ...data, assetId: 'wrong' }, { ...data, peaks: [-1] }, { ...data, peaks: [NaN] }, { ...data, peaks: [] }, { ...data, peaks: Array(2049).fill(0) }, { ...data, duration: Infinity }]) assert.throws(() => parseWaveform(invalid, 'asset'), /no es válida/);
});

test('repeated clips share a request and successful cached results, separated by source URL', async () => {
  let calls = 0;
  const cache = createWaveformCache(async () => { calls++; return response(data); });
  const one = cache.acquire({ id: 'asset', url: '/a' }), two = cache.acquire({ id: 'asset', url: '/a' });
  assert.equal(one.promise, two.promise); await one.promise; one.release(); two.release();
  const cached = cache.acquire({ id: 'asset', url: '/a' }); await cached.promise; cached.release(); assert.equal(calls, 1);
  const changed = cache.acquire({ id: 'asset', url: '/b' }); await changed.promise; changed.release(); assert.equal(calls, 2);
});

test('analysis queue stays bounded and aborts only when the last viewer releases the asset', async () => {
  let active = 0, highest = 0; const resolvers = new Map<string, () => void>();
  const cache = createWaveformCache(async (url, options) => {
    const id = url.split('/')[3]!; active++; highest = Math.max(highest, active);
    return new Promise<Response>((resolve, reject) => {
      resolvers.set(id, () => { active--; resolve(response({ ...data, assetId: id })); });
      options?.signal?.addEventListener('abort', () => { active--; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
  }, 2);
  const one = cache.acquire({ id: 'one', url: '/one' }), duplicate = cache.acquire({ id: 'one', url: '/one' });
  const two = cache.acquire({ id: 'two', url: '/two' }), three = cache.acquire({ id: 'three', url: '/three' });
  one.release(); assert.equal(active, 2, 'A second viewer still needs the first source');
  const aborted = assert.rejects(duplicate.promise, { name: 'AbortError' }); duplicate.release(); await aborted;
  await new Promise((resolve) => setImmediate(resolve)); assert.ok(resolvers.has('three')); assert.equal(highest, 2);
  resolvers.get('two')!(); resolvers.get('three')!(); await Promise.all([two.promise, three.promise]); two.release(); three.release();
});

test('analysis failures are explicit and retryable instead of permanently poisoning the cache', async () => {
  let calls = 0; const cache = createWaveformCache(async () => ++calls === 1 ? response({ error: 'El archivo no se pudo leer.' }, 422) : response(data));
  const first = cache.acquire({ id: 'asset', url: '/a' }); await assert.rejects(first.promise, /no se pudo leer/); first.release();
  const retry = cache.acquire({ id: 'asset', url: '/a' }); assert.deepEqual(await retry.promise, data); retry.release(); assert.equal(calls, 2);
});

test('playback speed remaps source peaks while gain envelopes remain on montage time', () => {
  assert.deepEqual(sampleWaveform(data, 0, 2, 4, {}, 1, 2, 2), [0, .25, .5, 1]);
  assert.deepEqual(sampleWaveform(data, 1, 4, 4, {}, 1, 4, .5), [.25, .25, .5, .5]);
  assert.deepEqual(sampleWaveform({ ...data, peaks: [1, 1, 1, 1] }, 0, 2, 4, { fadeIn: 1 }, 1, 2, 2), [.25, .75, 1, 1]);
  assert.deepEqual(sampleWaveform(data, 2, 4, 4, {}, 1, 4, 2), [1, 0, 0, 0]);
});
