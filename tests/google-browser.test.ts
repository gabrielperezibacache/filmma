import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../server/app';
import { runProcess } from '../server/process';
const ext = 'a'.repeat(32), sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
async function fixture() {
    const dir = await mkdtemp(join(tmpdir(), 'filmma-browser-')), dataDirectory = join(dir, 'data'), f = await createApp({ dataDirectory, skipDiagnostics: true, nativeDownloadsDirectory:join(dir,'native-downloads') });
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
    const reloaded = await createApp({ dataDirectory: f.dataDirectory, skipDiagnostics: true, nativeDownloadsDirectory:join(f.dir,'native-downloads') });
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

test('idle extension ping proves its token is valid without creating or claiming a generation',async()=>{const f=await fixture();try{const {token}=await f.pair();assert.equal((await f.bridge('/ping',{},'expired')).status,401);const health=await f.json(await f.bridge('/ping',{},token));assert.equal(health.connected,true);assert.deepEqual((await f.json(await f.req('/google-browser/status'))).runs,[])}finally{await f.close()}});

test('Flow native download handoff preserves its request and accepts the same package as a manual import',async()=>{const f=await fixture();try{const {token}=await f.pair();const request=(await f.json(await f.req('/google-video/requests',{projectId:f.store.project.id,sceneId:f.s.id,provider:'flow',seconds:8,referenceAssetIds:['identity']}),201)).request;await f.start(request.id);const {run}=await f.json(await f.bridge('/claim',{},token));for(const phase of ['preparing','submitting','generating'])await f.json(await f.bridge('/event/'+run.id,{phase,pageUrl:'https://flow.google.com/project/test'},token,run.lease));await f.json(await f.bridge('/event/'+run.id,{phase:'attention',error:'MANUAL_DOWNLOAD'},token,run.lease));assert.match((await f.json(await f.req('/google-browser/status'))).runs[0].message,/Tamaño original/);const body=new FormData();body.append('projectId',f.store.project.id);body.append('apply','false');body.append('file',new Blob([f.bytes],{type:'video/mp4'}),'flow-original.mp4');const result=await f.json(await fetch(f.base+'/api/google-video/requests/'+request.id+'/import',{method:'POST',headers:{'X-Filmma-Client':'filmma'},body}),201);assert.equal(result.asset.googleVideo.provider,'flow');assert.equal(result.asset.googleVideo.requestId,request.id);assert.deepEqual(result.asset.googleVideo.characterIds,[f.store.project.characters[0]!.id]);assert.equal(result.asset.googleVideo.outputSha256,sha(f.bytes));assert(f.store.project.scenes[0]!.takeAssetIds?.includes(result.asset.id))}finally{await f.close()}});

test('device discovery requires app approval, survives response retries and never exposes tokens in status',async()=>{const f=await fixture();try{
 const proof='6'.repeat(64),headers={Origin:'chrome-extension://'+ext,'X-Filmma-Extension':ext};
 const discover=()=>f.req('/google-browser/bridge/discover',{proof,version:'0.2.0'},headers);
 assert.equal((await f.json(await discover())).enabled,false);
 await f.json(await f.req('/google-browser/discovery',{}));
 assert.equal((await f.json(await discover())).pending,true);
 const before=await f.json(await f.req('/google-browser/status'));assert.equal(before.configured,false);assert.equal(before.discovery.devices.length,1);assert(!JSON.stringify(before).includes(proof));
 const id=before.discovery.devices[0].id;
 assert.equal((await f.req('/google-browser/approve-device',{id},{Origin:'https://evil.invalid'})).status,403);
 await f.json(await f.req('/google-browser/approve-device',{id}));
 const approved=await f.json(await discover());assert(approved.token);assert.equal((await f.json(await discover())).token,approved.token);
 const status=await f.json(await f.req('/google-browser/status'));assert.equal(status.configured,true);assert.equal(status.connected,false);assert(!JSON.stringify(status).includes(approved.token));
 await f.json(await f.bridge('/ping',{},approved.token));assert.equal((await f.json(await f.req('/google-browser/status'))).connected,true);
 const stored=await readFile(join(f.dataDirectory,'.application-private','google-browser.json'),'utf8');assert(!stored.includes(approved.token));
 await f.json(await f.req('/google-browser/disconnect',{}));assert.equal((await f.json(await discover())).enabled,false);assert.equal((await f.bridge('/ping',{},approved.token)).status,401);
}finally{await f.close()}});

test('native Flow recovery imports exact original without fabricating a generation or changing script links',async()=>{const f=await fixture();try{
 const {token}=await f.pair();const request=(await f.json(await f.req('/google-video/requests',{projectId:f.store.project.id,sceneId:f.s.id,provider:'flow',seconds:8,referenceAssetIds:['identity']}),201)).request;
 const narrative=()=>JSON.stringify([f.store.project.scenes.map(({takeAssetIds,...scene})=>scene),f.store.project.characters]);const before=narrative();
 await f.json(await f.req('/google-browser/recover-page',{requestId:request.id,pageUrl:'https://flow.google.com/project/test/edit/test',apply:false}),202);
 const {run}=await f.json(await f.bridge('/claim',{},token));assert.equal(run.recoverOnly,true);assert.equal(run.submittedAt,undefined);
 assert.equal((await f.bridge('/event/'+run.id,{phase:'submitting'},token,run.lease)).status,409);
 await f.json(await f.bridge('/event/'+run.id,{phase:'generating'},token,run.lease));
 const folder=join(f.dir,'native-downloads');await mkdir(folder);await writeFile(join(folder,'Woman_smiling_old.mp4'),Buffer.from('old original'));
 await f.json(await f.bridge('/native-begin/'+run.id,{prefix:'Woman_smiling_'},token,run.lease));
 assert.equal((await f.json(await f.bridge('/native-poll/'+run.id,{},token,run.lease))).pending,true);
 const source=join(folder,'Woman_smiling_new.mp4');await writeFile(source,f.bytes);
 assert.equal((await f.json(await f.bridge('/native-poll/'+run.id,{},token,run.lease))).pending,true);
 const result=await f.json(await f.bridge('/native-poll/'+run.id,{},token,run.lease));assert.equal(result.pending,false);assert.equal(result.asset.googleVideo.outputSha256,sha(f.bytes));
 assert.deepEqual(await readFile(source),f.bytes);assert.equal(narrative(),before);assert(f.store.project.scenes[0]!.takeAssetIds?.includes(result.asset.id));assert.deepEqual(await readFile(join(f.dataDirectory,'media',basename(result.asset.url))),f.bytes);
 const status=await f.json(await f.req('/google-browser/status'));assert.equal(status.runs[0].phase,'completed');assert.equal(status.runs[0].submittedAt,undefined);
}finally{await f.close()}});

test('multiple Google profiles route only their own shots and keep the original profile after default changes',async()=>{
 const f=await fixture();try{
  const pair=async(alias:string,clientId:string)=>{const code=(await f.json(await f.req('/google-browser/pairing',{alias}))).code;return f.json(await f.req('/google-browser/bridge/pair',{code,extensionId:ext,version:'0.3.0',clientId},{'X-Filmma-Extension':ext}));};
  const first=await pair('Personal','11111111-1111-4111-8111-111111111111'),second=await pair('Estudio','22222222-2222-4222-8222-222222222222');
  assert.notEqual(first.profileId,second.profileId);
  const request=await f.prepare();await f.json(await f.req('/google-browser/runs',{requestId:request.id,profileId:first.profileId,confirmSubscriptionUse:true}),202);
  await f.json(await f.req(`/google-browser/profiles/${second.profileId}/select`,{}));
  assert.equal((await f.json(await f.bridge('/claim',{},second.token))).run,null);
  const {run}=await f.json(await f.bridge('/claim',{},first.token));assert.equal(run.profileId,first.profileId);
  assert.equal((await f.bridge('/heartbeat/'+run.id,{},second.token)).status,403);
  assert.equal((await f.bridge('/event/'+run.id,{phase:'preparing'},second.token,run.lease)).status,403);
  assert.equal((await f.req(`/google-browser/profiles/${first.profileId}/revoke`,{})).status,409);
  await f.json(await f.bridge('/event/'+run.id,{phase:'preparing',pageUrl:'https://gemini.google.com/app/test',modelLabel:'Veo · fixture'},first.token,run.lease));
  const report=await f.json(await f.req('/workflow/engines'));assert(report.engines.some((e:any)=>e.modelLabel==='Veo · fixture'&&e.location==='remote'));
  await f.json(await f.req('/google-browser/runs/'+run.id+'/stop',{}));await f.json(await f.req(`/google-browser/profiles/${first.profileId}/revoke`,{}));
  assert.equal((await f.bridge('/ping',{},first.token)).status,401);assert.equal((await f.bridge('/ping',{},second.token)).status,200);
  const status=await f.json(await f.req('/google-browser/status'));assert.equal(status.profiles.length,1);assert.equal(status.profiles[0].alias,'Estudio');assert(!JSON.stringify(status).includes(second.token));
 }finally{await f.close();}
});

test('opening Flow is delivered once to the selected Chrome profile and never creates a generation',async()=>{
 const f=await fixture();try{const first=await f.pair(),second=await f.pair();await f.json(await f.bridge('/ping',{},first.token));await f.json(await f.req(`/google-browser/profiles/${first.profileId}/open`,{provider:'flow'}));assert.equal((await f.json(await f.bridge('/session',{},second.token))).provider,null);assert.equal((await f.json(await f.bridge('/session',{},first.token))).provider,'flow');assert.equal((await f.json(await f.bridge('/session',{},first.token))).provider,null);assert.equal((await f.json(await f.req('/google-browser/status'))).runs.length,0);}finally{await f.close();}
});
