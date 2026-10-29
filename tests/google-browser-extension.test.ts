import {webcrypto} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const endpoint = 'http://127.0.0.1:4320', extensionId = 'a'.repeat(32);
async function worker(initial: Record<string, unknown> = {}) {
    const source = await readFile(new URL('../public/google-browser/worker.js', import.meta.url), 'utf8');
    const saved = structuredClone(initial), requests: {
        url: string;
        body: any;
    }[] = [], tabs: string[] = [];
    let onMessage: any, onAlarm: any, failHeartbeat = false;
    const run = { id: 'run-1', lease: 'lease-1', provider: 'gemini', prompt: 'Un plano continuo', references: [], seconds: 8, format: '16:9' };
    const fetch = async (url: string, options: any) => { const path = new URL(url).pathname, body = options.body instanceof Uint8Array?'binary':options.body?JSON.parse(options.body):null; requests.push({ url, body }); if(url.startsWith('https://contribution.usercontent.google.com/'))return new Response(Uint8Array.from([1,2,3]),{status:200}); if (failHeartbeat && path.includes('/heartbeat/'))
        throw Error('offline'); return new Response(JSON.stringify(path.endsWith('/pair') ? { token: 'local-only-token' } : path.endsWith('/claim') ? { run } : path.includes('/heartbeat/') ? { active: true } : { ok: true }), { status: 200 }); };
    const chrome = {
        storage: { local: { get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, structuredClone(saved[k])])), set: async (values: any) => { Object.assign(saved, structuredClone(values)); }, remove: async (key: string) => { delete saved[key]; } } },
        runtime: { id: extensionId, getURL: (path: string) => `chrome-extension://${extensionId}/${path}`, getManifest: () => ({ version: '0.1.0' }), openOptionsPage: async () => { }, onMessage: { addListener: (handler: any) => { onMessage = handler; } }, onInstalled: { addListener: () => { } } },
        tabs: { create: async (options: any) => { tabs.push(options.url); return { id: 99 }; } }, alarms: { create: async () => { }, onAlarm: { addListener: (handler: any) => { onAlarm = handler; } } }, action: { onClicked: { addListener: () => { } } }
    };
    vm.runInNewContext(source, { chrome, fetch, URL, Response, Uint8Array, AbortSignal, atob, Date, Error,crypto:webcrypto });
    const send = (message: any, sender: any) => new Promise<any>(resolve => { onMessage(message, sender, resolve); });
    return { saved, requests, tabs, send, run, alarm: () => onAlarm({ name: 'filmma' }), failHeartbeat: () => { failHeartbeat = true; } };
}
const optionsSender = { id: extensionId, url: `chrome-extension://${extensionId}/options.html` };
const googleSender = { tab: { id: 99 }, frameId: 0, url: 'https://gemini.google.com/app/test' };
test('extension manifest has narrow page access and no cookie, debugger, history or broad tabs permission', async () => {
    const manifest = JSON.parse(await readFile(new URL('../public/google-browser/manifest.json', import.meta.url), 'utf8'));
    assert.deepEqual(manifest.permissions, ['storage', 'alarms']);
    assert.deepEqual(manifest.content_scripts[0].matches, ['https://gemini.google.com/*', 'https://flow.google.com/*']);
    assert.equal(manifest.content_scripts[0].all_frames, false);
    assert(!manifest.host_permissions.includes('<all_urls>'));
});
test('worker pairs only from its options page, sends to an allowed local studio and opens one owned tab', async () => {
    const w = await worker();
    assert.equal((await w.send({ type: 'pair', endpoint, code: '123456789' }, googleSender)).ok, false);
    assert.equal((await w.send({ type: 'pair', endpoint: 'https://evil.invalid', code: '123456789' }, optionsSender)).ok, false);
    assert.equal(w.requests.length, 0);
    assert.equal((await w.send({ type: 'pair', endpoint, code: '123456789' }, optionsSender)).ok, true);
    assert.deepEqual(w.tabs, ['https://gemini.google.com/app']);
    assert.equal((w.saved.connection as any).endpoint, endpoint);
    assert.equal(w.requests.filter(r => r.url.endsWith('/claim')).length, 1);
    assert.equal((await w.send({ type: 'hello' }, { ...googleSender, frameId: 1 })).ok, false);
    assert.equal((await w.send({ type: 'hello' }, { ...googleSender, tab: { id: 100 } })).ok, false);
    assert.equal((await w.send({ type: 'hello' }, googleSender)).ok, true);
    assert.equal((await w.send({ type: 'submit' }, googleSender)).ok, true);
    assert.equal((await w.send({ type: 'submit' }, googleSender)).ok, false);
    assert.equal(w.requests.filter(r => r.body.phase === 'submitting').length, 1);
});
test('a submitted tab recovers in watch-only mode and cannot proxy arbitrary media URLs', async () => {
    const w = await worker({ connection: { endpoint, token: 'local-only-token' }, active: { run: { id: 'run-1', lease: 'lease-1', provider: 'flow', submittedAt: '2026-10-28T00:00:00Z' }, tabId: 99, submitted: true } });
    const sender = { ...googleSender, url: 'https://flow.google.com/project/test' };
    const answer = await w.send({ type: 'hello' }, sender);
    assert.equal(answer.watchOnly, true);
    assert.equal(answer.run.prompt, undefined);
    assert.equal((await w.send({ type: 'media', url: 'https://evil.invalid/movie.mp4' }, sender)).ok, false);
    assert(!w.requests.some(r => r.url.includes('evil.invalid')));
    assert.equal(w.requests.filter(r => r.body.phase === 'submitting').length, 0);
});
test('transient heartbeat failure keeps ownership and never claims another generation', async () => {
    const active = { run: { id: 'run-1', lease: 'lease-1', provider: 'gemini' }, tabId: 99, submitted: true };
    const w = await worker({ connection: { endpoint, token: 'local-only-token' }, active });
    w.failHeartbeat();
    w.alarm();
    // Wait for the mocked asynchronous heartbeat and its failure handler to settle.
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(w.saved.active, active);
    assert.equal(w.tabs.length, 0);
    assert.equal(w.requests.filter(r => r.url.endsWith('/claim')).length, 0);
});

test('options health check reports the actual studio without claiming a queued generation or returning its token',async()=>{
 const active={run:{id:'run-1',lease:'lease-1',provider:'gemini'},tabId:99,submitted:true};
 const w=await worker({connection:{endpoint,token:'local-only-token'},active});
 const denied=await w.send({type:'status'},googleSender);assert.equal(denied.ok,false);assert.deepEqual(w.saved.active,active);
 const health=await w.send({type:'status'},optionsSender);assert.equal(health.connected,true);assert.equal(health.endpoint,endpoint);assert(!JSON.stringify(health).includes('local-only-token'));assert.equal(w.tabs.length,0);assert.deepEqual(w.requests.map(x=>new URL(x.url).pathname),['/api/google-browser/bridge/ping']);
});

test('worker accepts only the exact Gemini media CDN observed in the player and streams it into the retained download',async()=>{
 const w=await worker({connection:{endpoint,token:'local-only-token'},active:{run:{id:'run-1',lease:'lease-1',provider:'gemini'},tabId:99,submitted:true}});
 assert.equal((await w.send({type:'media',url:'https://contribution.usercontent.google.com/download?filename=video.mp4'},googleSender)).ok,true);
 assert.equal(w.requests.filter(r=>r.url.includes('/chunk/')).length,1);assert.equal(w.requests.filter(r=>r.url.endsWith('/finish/run-1')).length,1);
 const other=await worker({connection:{endpoint,token:'local-only-token'},active:{run:{id:'run-1',lease:'lease-1',provider:'gemini'},tabId:99,submitted:true}});
 assert.equal((await other.send({type:'media',url:'https://contribution.usercontent.google.com.evil.invalid/video.mp4'},googleSender)).ok,false);assert(!other.requests.some(r=>r.url.includes('evil.invalid')));
});
