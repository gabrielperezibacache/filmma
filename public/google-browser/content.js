/* Actions target only visible DOM controls. Ambiguity stops the job. */
(() => {
    let running = false;
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), norm = s => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const visible = e => e instanceof HTMLElement && !!e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
    const label = e => norm(e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent);
    const buttons = () => [...document.querySelectorAll('button,[role="button"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]')].filter(visible);
    function oneButton(pattern, optional = false) { const matches = buttons().filter(e => pattern.test(label(e)) && !e.hasAttribute('disabled') && e.getAttribute('aria-disabled') !== 'true'); if (matches.length === 1)
        return matches[0]; if (optional && !matches.length)
        return null; throw Error('DOM_CHANGED'); }
    async function waitFor(fn, ms = 30000) { const end = Date.now() + ms; do {
        checkHuman();
        const value = fn();
        if (value)
            return value;
        await sleep(500);
    } while (Date.now() < end); throw Error('DOM_CHANGED'); }
    function checkHuman() { if (location.hostname === 'accounts.google.com')
        throw Error('AUTH'); if ([...document.querySelectorAll('iframe')].some(e => visible(e) && /recaptcha|captcha/.test(e.src)))
        throw Error('HUMAN'); const alerts = [...document.querySelectorAll('[role="alert"],[role="dialog"]')].filter(visible).map(e => norm(e.textContent)).join(' '); if (/captcha|verify you|verifica que|terminos del servicio|terms of service/.test(alerts))
        throw Error('HUMAN'); if (/limite|quota|credits|creditos|upgrade|suscrib|comprar/.test(alerts))
        throw Error('QUOTA'); }
    function editor() { const matches = [...document.querySelectorAll('textarea,[contenteditable="true"][role="textbox"],[contenteditable="true"][aria-label]')].filter(visible); if (matches.length !== 1)
        return null; return matches[0]; }
    function setPrompt(element, value) { element.focus(); if (element instanceof HTMLTextAreaElement) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
    }
    else {
        document.execCommand('selectAll', false);
        document.execCommand('insertText', false, value);
        if (norm(element.textContent) !== norm(value))
            throw Error('DOM_CHANGED');
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    } }
    async function upload(refs, provider) { if (!refs.length)
        return; let input = [...document.querySelectorAll('input[type="file"]')].find(e => /image/.test(e.accept)); if (!input) {
        oneButton(provider === 'gemini' ? /^(subida de archivos|upload files|add files)$/i : /^(anadir|añadir|add|subir|upload|agregar|insertar referencia).*$/i).click();
        input = await waitFor(() => [...document.querySelectorAll('input[type="file"]')].find(e => /image/.test(e.accept) || e.multiple));
    } if (!input.multiple && refs.length > 1)
        throw Error('UNSUPPORTED'); const transfer = new DataTransfer(); for (const ref of refs) {
        const text = atob(ref.base64), bytes = Uint8Array.from(text, c => c.charCodeAt(0));
        transfer.items.add(new File([bytes], ref.name, { type: ref.mime }));
    } input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); await sleep(1500); await waitFor(() => !document.querySelector('[role="progressbar"]')); await waitFor(() => refs.every(ref => [...document.querySelectorAll('[aria-label],[title],img[alt]')].filter(visible).some(e => norm([e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('alt')].join(' ')).includes(norm(ref.name))))); }
    async function prepare(run) {
        if (run.provider === 'gemini') {
            if (!buttons().some(e => /desmarcar videos|deselect videos|remove videos/.test(label(e)))) {
                oneButton(/^(subidas y herramientas|uploads and tools)$/).click();
                await waitFor(() => buttons().some(e => /^crear video$|^create video$/.test(label(e))) || [...document.querySelectorAll('[role]')].some(e => visible(e) && /^crear video$|^create video$/.test(label(e))));
                const tool = [...document.querySelectorAll('button,[role="menuitemradio"],[role="menuitemcheckbox"],[role="menuitem"],[role="option"]')].filter(visible).filter(e => /^crear video$|^create video$/.test(label(e)));
                if (tool.length !== 1)
                    throw Error('DOM_CHANGED');
                tool[0].click();
            }
            if (!buttons().some(e => /desmarcar videos|deselect videos|remove videos/.test(label(e))))
                throw Error('UNSUPPORTED');
        }
        else {
            if (!/\/project\//.test(location.pathname)) {
                const create = oneButton(/^nuevo proyecto$|^new project$/);
                create.click();
                await waitFor(() => /\/project\//.test(location.pathname));
            }
            // Flow can create multiple variants per request. Never submit without an
            // explicit single-result indication on the visible generation controls.
            if (!buttons().some(e => /^x?1$|^1x$|^1 resultado$|^1 output$/.test(label(e))))
                throw Error('UNSUPPORTED');
        }
        if ([...document.querySelectorAll('video')].some(e => visible(e) && e.currentSrc))
            throw Error('DOM_CHANGED');
        await upload(run.references, run.provider);
        setPrompt(await waitFor(editor), run.prompt);
        const submit = await waitFor(() => { try {
            return oneButton(/^(enviar|send|generar|generate|crear video|create video|submit)$/);
        }
        catch {
            return null;
        } });
        const ack = await chrome.runtime.sendMessage({ type: 'submit' });
        if (!ack?.ok)
            throw Error('DISCONNECTED');
        submit.click();
        await chrome.runtime.sendMessage({ type: 'progress' });
    }
    const b64 = bytes => { const parts = []; for (let i = 0; i < bytes.length; i += 32768)
        parts.push(String.fromCharCode(...bytes.subarray(i, i + 32768))); return btoa(parts.join('')); };
    async function download(url) {
        if (!/^(blob:|https:)/.test(url))
            throw Error('DOWNLOAD');
        const source = new URL(url);
        if (source.protocol === 'blob:' ? source.origin !== location.origin : source.origin !== location.origin && !source.hostname.endsWith('.googleusercontent.com'))
            throw Error('DOWNLOAD');
        let response;
        try {
            response = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(180000) });
            if (!response.ok || !response.body)
                throw Error('DOWNLOAD');
        }
        catch {
            if (!url.startsWith('https:'))
                throw Error('DOWNLOAD');
            const done = await chrome.runtime.sendMessage({ type: 'media', url });
            if (!done?.ok)
                throw Error('DOWNLOAD');
            return;
        }
        const length = Number(response.headers.get('content-length') || 0);
        if (length > 512 * 1024 ** 2)
            throw Error('DOWNLOAD');
        const reader = response.body.getReader();
        let offset = 0;
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                for (let i = 0; i < value.length; i += 1024 ** 2) {
                    const bytes = value.slice(i, i + 1024 ** 2);
                    const ack = await chrome.runtime.sendMessage({ type: 'chunk', offset, base64: b64(bytes) });
                    if (!ack?.ok)
                        throw Error('DOWNLOAD');
                    offset += bytes.length;
                    if (offset > 512 * 1024 ** 2)
                        throw Error('DOWNLOAD');
                }
            }
            if (!offset || (length && length !== offset))
                throw Error('DOWNLOAD');
            const result = await chrome.runtime.sendMessage({ type: 'finish' });
            if (!result?.ok)
                throw Error('DOWNLOAD');
        }
        finally {
            await reader.cancel().catch(() => { });
        }
    }
    async function watch() { const until = Date.now() + 20 * 60 * 1000; let last = 0; while (Date.now() < until) {
        checkHuman();
        const videos = [...document.querySelectorAll('video')].filter(visible).filter(e => e.currentSrc && e.readyState >= 2);
        if (videos.length > 1)
            throw Error('DOM_CHANGED');
        if (videos.length === 1) {
            await download(videos[0].currentSrc);
            return;
        }
        if (Date.now() - last > 10000) {
            const result = await chrome.runtime.sendMessage({ type: 'progress' });
            if (!result?.ok)
                throw Error('DISCONNECTED');
            last = Date.now();
        }
        await sleep(1000);
    } throw Error('TIMED_OUT'); }
    async function start() { if (running)
        return; const answer = await chrome.runtime.sendMessage({ type: 'hello' }).catch(() => null); if (!answer?.ok || !answer.run)
        return; running = true; try {
        if (!answer.watchOnly)
            await prepare(answer.run);
        await watch();
    }
    catch (e) {
        await chrome.runtime.sendMessage({ type: 'attention', code: ['AUTH', 'QUOTA', 'HUMAN', 'DOM_CHANGED', 'DOWNLOAD', 'TIMED_OUT', 'UNSUPPORTED'].includes(e.message) ? e.message : 'DOM_CHANGED' }).catch(() => { });
    }
    finally {
        running = false;
    } }
    // A tab is created before its content script loads. The worker may still be
    // persisting its tab identity, so retry only this handshake, never generation.
    void (async () => { for (let i = 0; i < 10 && !running; i++) {
        await start();
        if (!running)
            await sleep(500);
    } })();
})();
