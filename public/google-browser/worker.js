/* Filmma's user-installed bridge: browser-owned session, DOM controls, media GETs.
   No cookie/debugger/history permissions and no generation API endpoints. */
const ownOrigins = new Set(['http://127.0.0.1:4318', 'http://127.0.0.1:4320']);
let claiming = false;
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
        await chrome.storage.local.set({ active: { run, tabId: tab.id, submitted: !!run.submittedAt, started: Date.now() } });
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
        if (message.type === 'pair') {
            if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('options.html'))
                throw Error('Enlaza desde las opciones de Filmma.');
            if (!ownOrigins.has(message.endpoint) || !/^\d{9}$/.test(message.code))
                throw Error('Código o destino inválido.');
            const response = await fetch(message.endpoint + '/api/google-browser/bridge/pair', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Filmma-Extension': chrome.runtime.id }, body: JSON.stringify({ code: message.code, extensionId: chrome.runtime.id, version: chrome.runtime.getManifest().version }), redirect: 'error' });
            const result = await response.json();
            if (!response.ok)
                throw Error(result.error || 'Código rechazado.');
            await chrome.storage.local.set({ connection: { endpoint: message.endpoint, token: result.token } });
            await chrome.alarms.create('filmma', { periodInMinutes: .5 });
            await claim();
            return { ok: true };
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
        if (message.type === 'media') {
            const url = new URL(message.url);
            if (url.protocol !== 'https:' || url.username || url.password || !((url.hostname.endsWith('.googleusercontent.com')) || url.hostname === (active.run.provider === 'gemini' ? 'gemini.google.com' : 'flow.google.com')))
                throw Error('DOWNLOAD');
            await stream(active, await fetch(url.href, { credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(180000) }));
            return { ok: true };
        }
        return { ok: false };
    })().then(sendResponse, async (error) => { const { active } = await state(); if (active && message.type !== 'pair')
        await attention(active, ['AUTH', 'QUOTA', 'HUMAN', 'DOM_CHANGED', 'DOWNLOAD', 'TIMED_OUT', 'UNSUPPORTED'].includes(error.message) ? error.message : 'DISCONNECTED'); sendResponse({ ok: false, error: message.type === 'pair' ? String(error.message) : 'La automatización se detuvo. Revisa Filmma y la pestaña de Google.' }); });
    return true;
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'filmma')
    void claim(); });
chrome.runtime.onInstalled.addListener(() => { void chrome.runtime.openOptionsPage(); void chrome.alarms.create('filmma', { periodInMinutes: .5 }); });
chrome.action.onClicked.addListener(() => void chrome.runtime.openOptionsPage());
