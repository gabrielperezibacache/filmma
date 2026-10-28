import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../server/app';
import { runProcess } from '../server/process';
const ext = 'a'.repeat(32), sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
async function fixture() {
    const dir = await mkdtemp(join(tmpdir(), 'filmma-browser-')), dataDirectory = join(dir, 'data'), f = await createApp({ dataDirectory, skipDiagnostics: true });
    const p = f.store.project;
    p.scenes = p.scenes.slice(0, 1);
    p.characters = p.characters.slice(0, 1);
    p.assets = [];
    const s = p.scenes[0]!;
    s.characterIds = [p.characters[0]!.id];
    s.assetId = 'identity';
    delete s.endAssetId;
    delete s.videoAssetId;
    p.characters[0]!.assetId = 'identity';
    p.characters[0]!.continuity = { costume: 'Abrigo burdeos', props: 'Lata metálica' };
    const image = await sharp({ create: { width: 64, height: 40, channels: 3, background: '#8b3943' } }).png().toBuffer();
    await writeFile(join(dataDirectory, 'media', 'identity.png'), image);
    p.assets.push({ id: 'identity', name: 'Elena.png', type: 'image', url: '/api/media/identity.png', mime: 'image/png', size: image.length });
    await f.store.save();
    const out = join(dir, 'clip.mp4');
    const encoded = await runProcess('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24:duration=1', '-c:v', 'libx264', '-threads', '2', out]);
    assert.equal(encoded.code, 0);
    const bytes = await readFile(out);
    const server = f.app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const req = (path: string, body?: unknown, headers: Record<string, string> = {}) => fetch(base + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': body instanceof Buffer ? 'application/octet-stream' : 'application/json', 'X-Filmma-Client': 'filmma', ...headers }, body: body instanceof Buffer ? new Uint8Array(body) : body === undefined ? undefined : JSON.stringify(body) });
    const json = async (response: Response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
    const prepare = async () => { const result = await json(await req('/google-video/requests', { projectId: p.id, sceneId: s.id, provider: 'gemini', seconds: 8, referenceAssetIds: ['identity'] }), 201); return result.request; };
    const pair = async () => { const code = (await json(await req('/google-browser/pairing', {}))).code; return json(await req('/google-browser/bridge/pair', { code, extensionId: ext, version: '0.1.0' }, { Origin: 'chrome-extension://' + ext, 'X-Filmma-Extension': ext })); };
    const bridge = (path: string, body: unknown, token: string, lease?: string) => req('/google-browser/bridge' + path, body, { Origin: 'chrome-extension://' + ext, 'X-Filmma-Extension': ext, Authorization: 'Bearer ' + token, ...(lease ? { 'X-Filmma-Lease': lease } : {}) });
    const start = async (requestId: string) => json(await req('/google-browser/runs', { requestId, confirmSubscriptionUse: true, apply: true }), 202);
    return { ...f, dir, dataDirectory, base, bytes, image, req, json, prepare, pair, bridge, start, s, close: async () => { await f.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await rm(dir, { recursive: true, force: true }); } };
}
test('pairing is local, origin-bound, single-use and stores only a private token digest', async () => { const f = await fixture(); try {
    const code = (await f.json(await f.req('/google-browser/pairing', {}))).code;
    assert.equal((await f.req('/google-browser/bridge/pair', { code, extensionId: ext, version: '0.1.0' }, { Origin: 'https://evil.invalid', 'X-Filmma-Extension': ext })).status, 403);
    const paired = await f.json(await f.req('/google-browser/bridge/pair', { code, extensionId: ext, version: '0.1.0' }, { Origin: 'chrome-extension://' + ext, 'X-Filmma-Extension': ext }));
    assert(paired.token);
    const stored = await readFile(join(f.dataDirectory, '.application-private', 'google-browser.json'), 'utf8');
    assert(!stored.includes(paired.token));
    assert.equal((await f.req('/google-browser/bridge/pair', { code, extensionId: ext, version: '0.1.0' }, { 'X-Filmma-Extension': ext })).status, 401);
    assert.equal((await f.bridge('/claim', {}, 'invalid')).status, 401);
    assert.equal((await f.json(await f.req('/google-browser/status'))).configured, true);
}
finally {
    await f.close();
} });
test('one run is claimed once, keeps exact character references and refuses duplicate generation submissions', async () => { const f = await fixture(); try {
    const { token } = await f.pair(), r = await f.prepare(), started = await f.start(r.id);
    assert.equal((await f.req('/google-browser/runs', { requestId: r.id, confirmSubscriptionUse: true, apply: true })).status, 409);
    const { run } = await f.json(await f.bridge('/claim', {}, token));
    assert.equal(run.id, started.run.id);
    assert.match(run.prompt, /Abrigo burdeos/);
    assert.deepEqual(Buffer.from(run.references[0].base64, 'base64'), f.image);
    assert.equal((await f.json(await f.bridge('/claim', {}, token))).run, null);
    assert.equal((await f.bridge('/event/' + run.id, { phase: 'preparing' }, token, 'wrong')).status, 403);
    await f.json(await f.bridge('/event/' + run.id, { phase: 'preparing', pageUrl: 'https://gemini.google.com/app/test?private=removed' }, token, run.lease));
    await f.json(await f.bridge('/event/' + run.id, { phase: 'submitting' }, token, run.lease));
    assert.equal((await f.bridge('/event/' + run.id, { phase: 'submitting' }, token, run.lease)).status, 409);
    assert.equal((await f.json(await f.req('/google-browser/status'))).runs[0].pageUrl, 'https://gemini.google.com/app/test');
}
finally {
    await f.close();
} });
test('browser result preserves original bytes, media clock, character links and a separate retained download', async () => { const f = await fixture(); try {
    const { token } = await f.pair(), r = await f.prepare();
    await f.start(r.id);
    const { run } = await f.json(await f.bridge('/claim', {}, token));
    for (const phase of ['preparing', 'submitting', 'generating'])
        await f.json(await f.bridge('/event/' + run.id, { phase, pageUrl: 'https://gemini.google.com/app/test' }, token, run.lease));
    assert.equal((await f.bridge('/chunk/' + run.id + '?offset=3', f.bytes, token, run.lease)).status, 409);
    const first = await f.json(await f.bridge('/chunk/' + run.id + '?offset=0', f.bytes, token, run.lease));
    assert.equal(first.bytes, f.bytes.length);
    assert.equal((await f.json(await f.bridge('/chunk/' + run.id + '?offset=0', f.bytes, token, run.lease))).bytes, first.bytes);
    const result = await f.json(await f.bridge('/finish/' + run.id, {}, token, run.lease));
    assert.equal(result.asset.googleVideo.verification, 'browser-observed');
    assert.equal(result.asset.googleVideo.workflow, 'subscription-browser');
    assert.equal(result.asset.googleVideo.media.frames, 24);
    assert.equal(result.asset.googleVideo.outputSha256, sha(f.bytes));
    assert.deepEqual(await readFile(join(f.dataDirectory, 'media', basename(result.asset.url))), f.bytes);
    assert.deepEqual(await readFile(join(f.dataDirectory, 'google-browser/downloads', run.id + '.original.mp4')), f.bytes);
    assert.equal(f.store.project.scenes[0]!.videoAssetId, result.asset.id);
    assert.equal(f.store.project.characters[0]!.assetId, 'identity');
    assert.equal((await f.json(await f.req('/google-browser/status'))).runs[0].phase, 'completed');
    assert.equal((await f.bridge('/finish/' + run.id, {}, token, run.lease)).status, 409);
}
finally {
    await f.close();
} });
test('changed screenplay after submit retains the download as an alternative without replacing the selected take', async () => { const f = await fixture(); try {
    const { token } = await f.pair(), r = await f.prepare();
    await f.start(r.id);
    const { run } = await f.json(await f.bridge('/claim', {}, token));
    for (const phase of ['preparing', 'submitting', 'generating'])
        await f.json(await f.bridge('/event/' + run.id, { phase, pageUrl: 'https://gemini.google.com/app/test' }, token, run.lease));
    f.store.project.scenes[0]!.dialogue = 'Cambió la intervención.';
    await f.json(await f.bridge('/chunk/' + run.id + '?offset=0', f.bytes, token, run.lease));
    const result = await f.json(await f.bridge('/finish/' + run.id, {}, token, run.lease));
    assert.equal(result.asset.googleVideo.contextChanged, true);
    assert.notEqual(f.store.project.scenes[0]!.videoAssetId, result.asset.id);
    assert(f.store.project.scenes[0]!.takeAssetIds?.includes(result.asset.id));
}
finally {
    await f.close();
} });
test('a changed reference before claiming stops the run without sending a second generation', async () => { const f = await fixture(); try {
    const { token } = await f.pair(), r = await f.prepare();
    await f.start(r.id);
    await writeFile(join(f.dataDirectory, 'media', 'identity.png'), Buffer.from('changed'));
    assert.equal((await f.bridge('/claim', {}, token)).status, 409);
    const state = await f.json(await f.req('/google-browser/status'));
    assert.equal(state.runs[0].phase, 'attention');
    assert(!state.runs[0].submittedAt);
}
finally {
    await f.close();
} });
test('quota and disconnection require attention; recovering a submitted page never permits another submit', async () => { const f = await fixture(); try {
    const { token } = await f.pair(), r = await f.prepare();
    await f.start(r.id);
    const { run } = await f.json(await f.bridge('/claim', {}, token));
    for (const phase of ['preparing', 'submitting'])
        await f.json(await f.bridge('/event/' + run.id, { phase, pageUrl: 'https://gemini.google.com/app/test' }, token, run.lease));
    await f.json(await f.bridge('/event/' + run.id, { phase: 'attention', error: 'QUOTA' }, token, run.lease));
    assert.equal((await f.req('/google-browser/runs', { requestId: r.id, confirmSubscriptionUse: true })).status, 409);
    await f.json(await f.req('/google-browser/runs/' + run.id + '/continue', {}));
    const resumed = (await f.json(await f.bridge('/claim', {}, token))).run;
    assert(resumed.submittedAt);
    assert.equal((await f.bridge('/event/' + run.id, { phase: 'submitting' }, token, resumed.lease)).status, 409);
    await f.json(await f.req('/google-browser/disconnect', {}));
    assert.equal((await f.bridge('/claim', {}, token)).status, 401);
    const { createApp } = await import('../server/app');
    const reloaded = await createApp({ dataDirectory: f.dataDirectory, skipDiagnostics: true });
    assert.equal(reloaded.store.project.characters[0]!.assetId, 'identity');
    await reloaded.close();
}
finally {
    await f.close();
} });
test('concurrent start and claim requests cannot reserve or dispatch a Google generation twice', async () => { const f = await fixture(); try {
    const { token } = await f.pair(), r = await f.prepare();
    const starts = await Promise.all([f.req('/google-browser/runs', { requestId: r.id, confirmSubscriptionUse: true }), f.req('/google-browser/runs', { requestId: r.id, confirmSubscriptionUse: true })]);
    assert.deepEqual(starts.map(x => x.status).sort(), [202, 409]);
    const claims = await Promise.all([f.bridge('/claim', {}, token), f.bridge('/claim', {}, token)]);
    const results = await Promise.all(claims.map(x => f.json(x)));
    assert.equal(results.filter(x => x.run).length, 1);
}
finally {
    await f.close();
} });
test('concurrent submit messages record one cloud request and block a second click', async () => { const f = await fixture(); try {
    const { token } = await f.pair(), r = await f.prepare();
    await f.start(r.id);
    const { run } = await f.json(await f.bridge('/claim', {}, token));
    await f.json(await f.bridge('/event/' + run.id, { phase: 'preparing', pageUrl: 'https://gemini.google.com/app/test' }, token, run.lease));
    const replies = await Promise.all([f.bridge('/event/' + run.id, { phase: 'submitting' }, token, run.lease), f.bridge('/event/' + run.id, { phase: 'submitting' }, token, run.lease)]);
    assert.deepEqual(replies.map(x => x.status).sort(), [200, 409]);
}
finally {
    await f.close();
} });
test('recovering a partial download retains its bytes and downloads the same submitted result from zero', async () => { const f = await fixture(); try {
    const { token } = await f.pair(), r = await f.prepare();
    await f.start(r.id);
    let { run } = await f.json(await f.bridge('/claim', {}, token));
    for (const phase of ['preparing', 'submitting', 'generating'])
        await f.json(await f.bridge('/event/' + run.id, { phase, pageUrl: 'https://gemini.google.com/app/test' }, token, run.lease));
    const partial = f.bytes.subarray(0, 100);
    await f.json(await f.bridge('/chunk/' + run.id + '?offset=0', partial, token, run.lease));
    await f.json(await f.req('/google-browser/runs/' + run.id + '/stop', {}));
    await f.json(await f.req('/google-browser/runs/' + run.id + '/continue', {}));
    run = (await f.json(await f.bridge('/claim', {}, token))).run;
    assert(run.submittedAt);
    assert.equal(run.bytes, 0);
    const { readdir } = await import('node:fs/promises'), downloadDir = join(f.dataDirectory, 'google-browser/downloads'), retained = (await readdir(downloadDir)).find(name => name.startsWith(run.id + '.retained-'));
    assert(retained);
    assert.deepEqual(await readFile(join(downloadDir, retained)), partial);
    await f.json(await f.bridge('/event/' + run.id, { phase: 'generating' }, token, run.lease));
    await f.json(await f.bridge('/chunk/' + run.id + '?offset=0', f.bytes, token, run.lease));
    const result = await f.json(await f.bridge('/finish/' + run.id, {}, token, run.lease));
    assert.equal(result.asset.googleVideo.outputSha256, sha(f.bytes));
    assert.equal((await f.req('/google-browser/runs/' + run.id + '/stop', {})).status, 409);
}
finally {
    await f.close();
} });

test('cancelling in Activity stops the same browser run and refuses incoming media',async()=>{const f=await fixture();try{const {token}=await f.pair(),r=await f.prepare();await f.start(r.id);const {run}=await f.json(await f.bridge('/claim',{},token));await f.json(await f.req('/jobs/'+run.id+'/cancel',{}));assert.equal((await f.json(await f.req('/google-browser/status'))).runs[0].phase,'cancelled');assert.equal((await f.bridge('/event/'+run.id,{phase:'preparing'},token,run.lease)).status,409)}finally{await f.close()}});
