/* Filmma's user-installed bridge: browser-owned session, DOM controls, media GETs.
   No cookie/debugger/history permissions and no generation API endpoints. */
const ownOrigins = new Set(['http://127.0.0.1:4318', 'http://127.0.0.1:4320']);
let claiming = false;

async function localClientId(){const saved=await chrome.storage.local.get('clientId');if(saved.clientId)return saved.clientId;const id=crypto.randomUUID();await chrome.storage.local.set({clientId:id});return id;}

async function discover() {
    const {active}=await state();if(active)return;
    const saved=await chrome.storage.local.get('discoveryProofs'),proofs=saved.discoveryProofs??{};
    for(const endpoint of ownOrigins){
        try{
            if(!proofs[endpoint]){proofs[endpoint]=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');await chrome.storage.local.set({discoveryProofs:proofs})}
            const response=await fetch(endpoint+'/api/google-browser/bridge/discover',{method:'POST',headers:{'Content-Type':'application/json','X-Filmma-Extension':chrome.runtime.id},body:JSON.stringify({proof:proofs[endpoint],version:chrome.runtime.getManifest().version,clientId:await localClientId()}),redirect:'error',signal:AbortSignal.timeout(3000)});
            if(!response.ok)continue;const result=await response.json();
            if(result.token){const current=(await state()).connection;if(current?.endpoint===endpoint&&current?.token===result.token)continue;await chrome.storage.local.set({connection:{endpoint,token:result.token,profileId:result.profileId}});await api('/ping',{});}
        }catch{} // One offline Filmma instance must not disconnect the other.
    }
}
async function tick(){await discover();const {connection}=await state();if(connection){try{await api('/ping',{});const session=await api('/session',{});if(session.provider==='flow'||session.provider==='gemini')await chrome.tabs.create({url:session.provider==='flow'?'https://flow.google.com/':'https://gemini.google.com/app',active:true});}catch{}await claim()}}

async function state() { return chrome.storage.local.get(['connection', 'active']); }
async function api(path, body, run) { const { connection } = await state(); if (!connection || !ownOrigins.has(connection.endpoint))
    throw Error('Enlaza Filmma en las opciones de la extensión.'); const response = await fetch(connection.endpoint + '/api/google-browser/bridge' + path, { method: 'POST', headers: { 'Content-Type': body instanceof Uint8Array ? 'application/octet-stream' : 'application/json', 'X-Filmma-Extension': chrome.runtime.id, Authorization: 'Bearer ' + connection.token, ...(run ? { 'X-Filmma-Lease': run.lease } : {}) }, body: body instanceof Uint8Array ? body : JSON.stringify(body ?? {}), redirect: 'error' }); const result = await response.json(); if (!response.ok)
    throw Error(result.error || 'Filmma rechazó la operación.'); return result; }
async function claim() {
    if (claiming)
        return;
    claiming = true;
    let reserved;
    try {
        const { connection, active } = await state();
        if (!connection)
            return;
        if (active) {
            const heartbeat = await api('/heartbeat/' + active.run.id, {}, active.run);
            if (!heartbeat.active)
                await chrome.storage.local.remove('active');
            return;
        }
        const result = await api('/claim', {});
        if (!result.run)
            return;
        const run = result.run;
        reserved = { run };
        const tab = await chrome.tabs.create({ url: run.pageUrl || (run.provider === 'gemini' ? 'https://gemini.google.com/app' : 'https://flow.google.com/'), active: true });
        await chrome.storage.local.set({ active: { run, tabId: tab.id, submitted: !!run.submittedAt||!!run.recoverOnly, started: Date.now() } });
    }
    catch {
        // A transient heartbeat failure keeps ownership of the existing tab. A claim
        // that could not open its tab is stopped, never put back on the generation queue.
        if (reserved)
            await attention(reserved, 'DISCONNECTED');
    }
    finally {
        claiming = false;
    }
}
function providerSender(sender, active) { if (!active || sender.tab?.id !== active.tabId || sender.frameId !== 0)
    return false; try {
    const u = new URL(sender.url);
    return u.protocol === 'https:' && u.hostname === (active.run.provider === 'gemini' ? 'gemini.google.com' : 'flow.google.com');
}
catch {
    return false;
} }
async function event(active, phase, error, pageUrl) { return api('/event/' + active.run.id, { phase, ...(error ? { error } : {}), ...(pageUrl ? { pageUrl } : {}) }, active.run); }
async function attention(active, code) { try {
    await event(active, 'attention', code);
}
catch { } await chrome.storage.local.remove('active'); }
async function chunk(active, offset, bytes) { return api('/chunk/' + active.run.id + '?offset=' + offset, bytes, active.run); }
async function finish(active) { await api('/finish/' + active.run.id, {}, active.run); await chrome.storage.local.remove('active'); }
async function stream(active, response) { if (!response.ok || !response.body)
    throw Error('DOWNLOAD'); const size = Number(response.headers.get('content-length') || 0); if (size > 512 * 1024 ** 2)
    throw Error('DOWNLOAD'); let offset = 0; const reader = response.body.getReader(); try {
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        for (let start = 0; start < value.length; start += 1024 ** 2) {
            const part = value.slice(start, start + 1024 ** 2);
            await chunk(active, offset, part);
            offset += part.length;
            if (offset > 512 * 1024 ** 2)
                throw Error('DOWNLOAD');
        }
    }
    if (!offset || (size && offset !== size))
        throw Error('DOWNLOAD');
    await finish(active);
}
finally {
    await reader.cancel().catch(() => { });
} }
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        if(message.type==='status'){
            if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('options.html'))throw Error('Consulta desde las opciones de Filmma.');
            const {connection}=await state();if(!connection)return {ok:true,connected:false};
            try{await api('/ping',{});return{ok:true,connected:true,endpoint:connection.endpoint}}catch(error){return{ok:false,connected:false,endpoint:connection.endpoint,error:String(error.message)}}
        }
        if (message.type === 'pair') {
            if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('options.html'))
                throw Error('Enlaza desde las opciones de Filmma.');
            if (!ownOrigins.has(message.endpoint) || !/^\d{9}$/.test(message.code))
                throw Error('Código o destino inválido.');
            const response = await fetch(message.endpoint + '/api/google-browser/bridge/pair', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Filmma-Extension': chrome.runtime.id }, body: JSON.stringify({ code: message.code, extensionId: chrome.runtime.id, version: chrome.runtime.getManifest().version,clientId:await localClientId() }), redirect: 'error' });
            const result = await response.json();
            if (!response.ok)
                throw Error(result.error || 'Código rechazado.');
            await chrome.storage.local.set({ connection: { endpoint: message.endpoint, token: result.token,profileId:result.profileId } });
            await chrome.alarms.create('filmma', { periodInMinutes: .5 });
            await api('/ping',{});
            await claim();
            return { ok: true, endpoint:message.endpoint };
        }
        const { active } = await state();
        if (!providerSender(sender, active))
            return { ok: false, error: 'Pestaña no autorizada.' };
        if (message.type === 'hello') {
            if (active.submitted) {
                await event(active, 'generating', undefined, sender.url);
                return { ok: true, watchOnly: true, run: { id: active.run.id, provider: active.run.provider } };
            }
            if (active.delivered) {
                await attention(active, 'DOM_CHANGED');
                return { ok: false };
            }
            active.delivered = true;
            await chrome.storage.local.set({ active });
            await event(active, 'preparing', undefined, sender.url);
            return { ok: true, run: active.run };
        }
        if(message.type==='model'){await api('/event/'+active.run.id,{phase:'preparing',modelLabel:message.modelLabel,pageUrl:sender.url},active.run);return{ok:true};}
        if(message.type==='references'){await api('/event/'+active.run.id,{phase:'preparing',step:'references',pageUrl:sender.url},active.run);return{ok:true}}
        if (message.type === 'submit') {
            if (active.submitted)
                throw Error('No se reenvía una generación.');
            active.submitted = true;
            await chrome.storage.local.set({ active });
            await event(active, 'submitting', undefined, sender.url);
            return { ok: true };
        }
        if (message.type === 'progress') {
            await event(active, 'generating', undefined, sender.url);
            return { ok: true };
        }
        if (message.type === 'attention') {
            await attention(active, message.code);
            return { ok: true };
        }
        if (message.type === 'chunk') {
            if (!active.submitted)
                throw Error('Falta el envío.');
            const raw = atob(message.base64);
            if (raw.length > 1024 ** 2)
                throw Error('DOWNLOAD');
            const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
            await chunk(active, message.offset, bytes);
            return { ok: true };
        }
        if (message.type === 'finish') {
            await finish(active);
            return { ok: true };
        }
        if(message.type==='native-begin')return api('/native-begin/'+active.run.id,{prefix:message.prefix},active.run);
        if(message.type==='native-poll'){const result=await api('/native-poll/'+active.run.id,{},active.run);if(!result.pending)await chrome.storage.local.remove('active');return{ok:true,pending:result.pending};}
        if (message.type === 'media') {
            const url = new URL(message.url);
            if (url.protocol !== 'https:' || url.username || url.password || !((url.hostname.endsWith('.googleusercontent.com')||url.hostname==='contribution.usercontent.google.com') || url.hostname === (active.run.provider === 'gemini' ? 'gemini.google.com' : 'flow.google.com')))
                throw Error('DOWNLOAD');
            await stream(active, await fetch(url.href, { credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(180000) }));
            return { ok: true };
        }
        return { ok: false };
    })().then(sendResponse, async (error) => { const { active } = await state(); if (active && !['pair','status'].includes(message.type))
        await attention(active, ['AUTH', 'QUOTA', 'HUMAN', 'DOM_CHANGED', 'DOWNLOAD', 'TIMED_OUT', 'UNSUPPORTED','MANUAL_DOWNLOAD'].includes(error.message) ? error.message : 'DISCONNECTED'); sendResponse({ ok: false, error: ['pair','status'].includes(message.type) ? String(error.message) : 'La automatización se detuvo. Revisa Filmma y la pestaña de Google.' }); });
    return true;
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'filmma')
    void tick(); });
chrome.runtime.onInstalled.addListener(() => { void chrome.runtime.openOptionsPage(); void chrome.alarms.create('filmma', { periodInMinutes: .5 }); void tick(); });
chrome.action.onClicked.addListener(() => void chrome.runtime.openOptionsPage());

chrome.runtime.onStartup?.addListener(()=>{void chrome.alarms.create('filmma',{periodInMinutes:.5});void tick()});
