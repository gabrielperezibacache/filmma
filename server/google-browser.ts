import express, { type Express, type Router, type Request, type Response, type NextFunction } from 'express';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, open, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { NativeDownloadReceipt } from './native-download.js';
import { z } from 'zod';
import type { Store } from './store.js';
import type { Asset, Job } from './types.js';
import type { registerGoogleVideo } from './google-video.js';
import { applyGoogleVideoTake } from '../src/google-video.js';
import { libraryFileHash } from './library.js';
import { writeZip } from './zip.js';
type Service = Awaited<ReturnType<typeof registerGoogleVideo>>;
export type BrowserPhase = 'queued' | 'opening' | 'preparing' | 'submitting' | 'generating' | 'downloading' | 'validating' | 'completed' | 'attention' | 'cancelled';
type BrowserRun = {
    id: string;
    requestId: string;
    projectId: string;
    sceneId: string;
    sceneTitle: string;
    provider: 'gemini' | 'flow';
    createdAt: string;
    updatedAt: string;
    phase: BrowserPhase;
    message: string;
    bytes: number;
    lease?: string;
    submittedAt?: string;
    recoverOnly?: boolean;
    cancelledAt?: string;
    pageUrl?: string;
    baseVideoAssetId?: string;
    apply: boolean;
    assetId?: string;
    originalFile?: string;
    lastChunk?: {
        offset: number;
        size: number;
        sha256: string;
    };
};
const phaseMessages: Record<BrowserPhase, string> = { queued: 'Esperando a Chrome…', opening: 'Abriendo una pestaña para este plano…', preparing: 'Preparando el prompt y las referencias…', submitting: 'Enviando una sola generación con tu cuota…', generating: 'Google está generando el video…', downloading: 'Descargando el original desde Google…', validating: 'Verificando todos los fotogramas y el audio…', completed: 'Original descargado y conservado.', attention: 'Necesita tu intervención en Chrome.', cancelled: 'Automatización detenida. Google puede seguir procesando una solicitud ya enviada.' };
const fail = (message: string, status = 409) => Object.assign(new Error(message), { status });
const route = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void fn(req, res).catch(next);
const digest = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const uuid = z.string().uuid(), extensionId = z.string().regex(/^[a-p]{32}$/), localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
const terminal = (r: BrowserRun) => ['completed', 'attention', 'cancelled'].includes(r.phase);
const safePage = (value: string, provider: BrowserRun['provider']) => { const u = new URL(value); if (u.protocol !== 'https:' || u.hostname !== (provider === 'gemini' ? 'gemini.google.com' : 'flow.google.com') || u.username || u.password)
    throw fail('La pestaña no pertenece al proveedor elegido.', 400); return u.origin + u.pathname; };
const errors: Record<string, string> = { AUTH: 'Inicia sesión en Google en la pestaña de Chrome y vuelve a preparar la toma.', QUOTA: 'Google indica que falta cuota o acceso. Revisa tu plan en Chrome; Filmma no compra créditos.', HUMAN: 'Google requiere una comprobación o una decisión humana. Continúa en Chrome; no se resuelve automáticamente.', DOM_CHANGED: 'Cambió la interfaz de Google o falta un control inequívoco. Revisa la pestaña; no se reenvía la generación.', DOWNLOAD: 'No se pudo completar la descarga. El resultado y los parciales se conservan; no generes otra toma para recuperarlo.', TIMED_OUT: 'La generación superó el tiempo de espera. Comprueba el resultado en Chrome; no se repite automáticamente.', DISCONNECTED: 'Chrome se desconectó. Los archivos y la pestaña de origen se conservan.', MANUAL_DOWNLOAD:'Continúa en Flow: abre el video, descarga Tamaño original e impórtalo en este paquete. No generes otra toma.', UNSUPPORTED: 'La configuración solicitada no se pudo establecer en Google. Revisa el formato o usa el flujo manual.' };
export async function registerGoogleBrowser(o: {
    app: Express;
    bridge: Router;
    store: Store;
    dataDirectory: string;
    publicDirectory: string;
    video: Service;
    mediaPath: (asset: Asset) => Promise<string>;
    nativeDownloadsDirectory?: string;
}) {
    const { app, bridge, store, video } = o, dir = join(o.dataDirectory, 'google-browser'), downloads = join(dir, 'downloads'), privateDir = join(o.dataDirectory, '.application-private');
    await Promise.all([mkdir(downloads, { recursive: true, mode: 0o700 }), mkdir(privateDir, { recursive: true, mode: 0o700 })]);
    const connectionPath = join(privateDir, 'google-browser.json');
    let connection: {
        extensionId: string;
        tokenSha256: string;
        connectedAt: string;
        lastSeen?: string;
        version?: string;
    } | undefined, pair: {
        code: string;
        expires: number;
        attempts: number;
    } | undefined;
    const nativeReceipts=new Map<string,NativeDownloadReceipt>();
    const runs = new Map<string, BrowserRun>(), busy = new Set<string>();
    let discoveryUntil = 0;
    const devices = new Map<string,{id:string;extensionId:string;proofSha256:string;version:string;expires:number;lastSeen:number;token?:string;approved?:boolean}>();
    const pruneDevices=()=>{for(const[key,d]of devices)if(d.expires<Date.now())devices.delete(key)};
    async function atomic(path: string, value: unknown) { const tmp = path + '.' + randomUUID() + '.tmp'; await writeFile(tmp, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); await rename(tmp, path); }
    try {
        const h = await open(connectionPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const s = await h.stat();
            if (!s.isFile() || s.size > 4096 || (process.platform !== 'win32' && s.mode & 0o077))
                throw Error('Conexión privada inválida');
            const raw = JSON.parse(await h.readFile('utf8'));
            if (raw !== null)
                connection = z.object({ extensionId, tokenSha256: z.string().regex(/^[a-f0-9]{64}$/), connectedAt: z.string(), lastSeen: z.string().optional(), version: z.string().optional() }).parse(raw);
        }
        finally {
            await h.close();
        }
    }
    catch (e: any) {
        if (e.code !== 'ENOENT')
            throw fail('No se pudo leer el enlace privado con Chrome.', 500);
    }
    for (const file of (await readdir(dir)).filter(n => /^[a-f0-9-]{36}\.json$/.test(n))) {
        const r = JSON.parse(await readFile(join(dir, file), 'utf8')) as BrowserRun;
        if (!uuid.safeParse(r.id).success || !uuid.safeParse(r.requestId).success)
            continue;
        if (!terminal(r)) {
            r.phase = 'attention';
            r.message = 'Filmma se reinició. Revisa la pestaña de Google; la generación no se reenvía.';
            await atomic(join(dir, file), r);
        }
        runs.set(r.id, r);
    }
    const publicRun = (r: BrowserRun) => { const { lease: _lease, originalFile: _file, lastChunk: _chunk, ...publicFields } = r; return {...publicFields,canRecoverDownload:!!r.originalFile}; };
    async function save(r: BrowserRun) { r.updatedAt = new Date().toISOString(); await atomic(join(dir, r.id + '.json'), r); const j = store.jobs.find(j => j.id === r.id); if (j) {
        j.updatedAt = r.updatedAt;
        j.message = r.message;
        j.status = r.phase === 'completed' ? 'completed' : r.phase === 'cancelled' ? 'cancelled' : r.phase === 'attention' ? 'failed' : r.phase === 'queued' ? 'queued' : 'running';
        j.progress = r.phase === 'completed' ? 100 : r.phase === 'downloading' ? 75 : r.phase === 'validating' ? 92 : r.submittedAt ? 35 : 10;
        j.result = { ...j.result, ...(r.assetId ? { assetId: r.assetId } : {}) };
        await store.save();
    } }
    function get(value: unknown) { const r = runs.get(uuid.parse(value)); if (!r)
        throw fail('No se encuentra esta automatización.', 404); return r; }
    const auth = (req: Request) => { const ext = extensionId.parse(req.get('X-Filmma-Extension')); if (!connection || connection.extensionId !== ext)
        throw fail('Chrome no está enlazado con este Filmma.', 401); const token = req.get('Authorization')?.replace(/^Bearer /, '') ?? ''; const seen = digest(token); if (!token || !timingSafeEqual(Buffer.from(seen), Buffer.from(connection.tokenSha256)))
        throw fail('El enlace con Chrome ya no es válido.', 401); connection.lastSeen = new Date().toISOString(); return ext; };
    const leased = (req: Request) => { auth(req); const r = get(req.params.id); if (!r.lease || r.lease !== req.get('X-Filmma-Lease'))
        throw fail('La pestaña no posee esta toma.', 403); if (terminal(r))
        throw fail('La automatización ya terminó. No se repite una generación.'); return r; };
    // Only this router can accept a Chrome extension origin. Normal Filmma routes
    // keep their existing origin and X-Filmma-Client protections unchanged.
    bridge.use((req, res, next) => { if (!localHosts.has((req.headers.host ?? '').replace(/:\d+$/, '')))
        return res.status(403).json({ error: 'Sólo conexiones locales.' }); const origin = req.get('Origin'); if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin))
        return res.status(403).json({ error: 'Origen no permitido.' }); if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    } res.setHeader('Cache-Control', 'no-store'); if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Filmma-Extension,X-Filmma-Lease');
        return res.status(204).end();
    } const ext = req.get('X-Filmma-Extension'); if (origin && origin !== `chrome-extension://${ext}`)
        return res.status(403).json({ error: 'El origen de la extensión no coincide.' }); next(); });
    bridge.use(express.json({ limit: '64kb' }));
    bridge.post('/discover',route(async(req,res)=>{
        const input=z.object({proof:z.string().regex(/^[a-f0-9]{64}$/),version:z.string().min(1).max(30)}).strict().parse(req.body);
        const ext=extensionId.parse(req.get('X-Filmma-Extension'));pruneDevices();
        const key=digest(ext+':'+input.proof);let device=devices.get(key);
        if(!device&&Date.now()>discoveryUntil)return res.json({enabled:false});
        if(!device){if(devices.size>=6)throw fail('Demasiados dispositivos pendientes. Reinicia la detección.',429);device={id:randomUUID(),extensionId:ext,proofSha256:digest(input.proof),version:input.version,expires:discoveryUntil,lastSeen:Date.now()};devices.set(key,device)}
        device.lastSeen=Date.now();
        // A token is released only after approval through the normal Filmma UI.
        // Retries with the same proof recover a lost response; no tokens in status.
        res.json({enabled:true,pending:!device.approved,...(device.approved&&device.token?{token:device.token}:{})});
    }));
    bridge.post('/pair', route(async (req, res) => { const input = z.object({ code: z.string().regex(/^\d{9}$/), extensionId, version: z.string().max(30) }).strict().parse(req.body); if (input.extensionId !== req.get('X-Filmma-Extension'))
        throw fail('Identificador de extensión distinto.', 403); if (!pair || pair.expires < Date.now() || ++pair.attempts > 5 || input.code !== pair.code)
        throw fail('Código caducado o incorrecto. Crea otro código en Filmma.', 401); const token = randomBytes(32).toString('base64url'); pair = undefined; connection = { extensionId: input.extensionId, tokenSha256: digest(token), connectedAt: new Date().toISOString(), lastSeen: new Date().toISOString(), version: input.version }; await atomic(connectionPath, connection); res.json({ token, connection: 'paired' }); }));
    bridge.post('/ping', route(async(req,res)=>{auth(req);res.json({ok:true,connected:true})}));
    bridge.post('/heartbeat/:id', route(async (req, res) => { auth(req); const r = get(req.params.id); res.json({ active: !terminal(r) }); }));
    bridge.post('/claim', route(async (req, res) => { auth(req); const r = [...runs.values()].find(r => r.phase === 'queued'); if (!r)
        return res.json({ run: null }); r.phase = 'opening'; r.message = phaseMessages.opening; r.lease = randomUUID(); try {
        const request = await video.load(r.requestId);
        if (!r.submittedAt && !r.recoverOnly && video.status(request).stale) {
            r.phase = 'attention';
            r.message = 'El guion o la continuidad cambió antes de enviar. Prepara otro paquete.';
            await save(r);
            return res.json({ run: null });
        }
        await save(r);
        const refs = [];
        let referenceBytes = 0;
        for (const ref of request.references) {
            const asset = store.project.assets.find(a => a.id === ref.id);
            if (!asset)
                throw fail('Falta una referencia del plano.');
            const path = await o.mediaPath(asset), checked = await libraryFileHash(path);
            if (checked.sha256 !== ref.sha256)
                throw fail('Una referencia cambió; no se enviará a Google.');
            referenceBytes += checked.size;
            if (checked.size > 16 * 1024 ** 2 || referenceBytes > 32 * 1024 ** 2)
                throw fail('El puente admite referencias de hasta 16 MB cada una y 32 MB en total. El flujo manual conserva sus límites.');
            refs.push({ id: asset.id, name: asset.name, mime: asset.mime, base64: (await readFile(path)).toString('base64') });
        }
        res.json({ run: { ...publicRun(r), lease: r.lease, prompt: request.prompt, seconds: request.requestedSeconds, format: request.requestedFormat, references: refs } });
    }
    catch (e: any) {
        r.phase = 'attention';
        r.message = String(e.message).slice(0, 500);
        await save(r);
        throw e;
    } }));
    bridge.post('/event/:id', route(async (req, res) => { const r = leased(req), input = z.object({ phase: z.enum(['preparing', 'submitting', 'generating', 'attention']), step:z.literal('references').optional(), pageUrl: z.string().max(2000).optional(), error: z.enum(['AUTH', 'QUOTA', 'HUMAN', 'DOM_CHANGED', 'DOWNLOAD', 'TIMED_OUT', 'DISCONNECTED', 'UNSUPPORTED','MANUAL_DOWNLOAD']).optional() }).strict().parse(req.body); if (input.pageUrl)
        r.pageUrl = safePage(input.pageUrl, r.provider); if (input.phase === 'submitting') {
        if (r.recoverOnly || r.submittedAt || r.phase !== 'preparing' || busy.has(r.id))
            throw fail('Esta solicitud ya se envió o no está preparada.');
        busy.add(r.id);
        try {
            const request = await video.load(r.requestId);
            if (video.status(request).stale)
                throw fail('El contexto cambió antes de generar.');
            if (terminal(r))
                throw fail('La automatización se detuvo.');
            r.submittedAt = new Date().toISOString();
            r.phase = 'submitting';
            r.message = phaseMessages.submitting;
            await save(r);
            return res.json({ ok: true });
        }
        finally {
            busy.delete(r.id);
        }
    } if (input.phase === 'generating' && !r.submittedAt && !r.recoverOnly)
        throw fail('No hay un envío confirmado.'); if (input.phase === 'generating' && ['downloading', 'validating'].includes(r.phase))
        return res.json({ ok: true }); r.phase = input.phase; r.message = input.phase==='preparing'&&input.step==='references'?'Flow espera las referencias: abre esta pestaña, súbelas y pulsa Añadir a petición. El prompt se enviará después.':input.phase === 'attention' ? errors[input.error ?? 'DOM_CHANGED'] : phaseMessages[input.phase]; await save(r); res.json({ ok: true }); }));
    bridge.post('/chunk/:id', express.raw({ type: 'application/octet-stream', limit: '1mb' }), route(async (req, res) => { const r = leased(req); if ((!r.submittedAt&&!r.recoverOnly) || !['generating', 'downloading'].includes(r.phase))
        throw fail('Esta toma no espera un video.'); if (busy.has(r.id)||nativeReceipts.has(r.id))
        throw fail('Hay otra descarga escribiéndose.'); const bytes = req.body as Buffer, offset = z.coerce.number().int().min(0).max(512 * 1024 ** 2).parse(req.query.offset); if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 1024 ** 2 || offset + bytes.length > 512 * 1024 ** 2)
        throw fail('El bloque de video supera el límite.', 400); const hash = digest(bytes); if (r.lastChunk?.offset === offset && r.lastChunk.sha256 === hash && r.lastChunk.size === bytes.length)
        return res.json({ bytes: r.bytes }); if (offset !== r.bytes)
        throw fail('El bloque no sigue el orden de la descarga.'); busy.add(r.id); try {
        const path = join(downloads, r.id + '.part');
        if (offset > 0 && (await lstat(path)).size !== offset)
            throw fail('El parcial cambió. Se conserva para revisión.');
        await writeFile(path, bytes, { flag: offset === 0 ? 'wx' : 'a', mode: 0o600 });
        r.bytes += bytes.length;
        r.lastChunk = { offset, size: bytes.length, sha256: hash };
        r.phase = 'downloading';
        r.message = `Descargando original · ${(r.bytes / 1024 ** 2).toFixed(1)} MB`;
        await save(r);
        res.json({ bytes: r.bytes });
    }
    finally {
        busy.delete(r.id);
    } }));
    async function finish(r: BrowserRun) { if (busy.has(r.id))
        throw fail('La toma se está comprobando.'); busy.add(r.id); try {
        if (!r.originalFile) {
            if (!r.bytes || !r.pageUrl || r.phase !== 'downloading')
                throw fail('La descarga aún no está completa.');
            r.originalFile = r.id + '.original.mp4';
            await rename(join(downloads, r.id + '.part'), join(downloads, r.originalFile));
        }
        r.phase = 'validating';
        r.message = phaseMessages.validating;
        await save(r);
        const source = join(downloads, r.originalFile), temporary = join(o.dataDirectory, 'work', randomUUID()), info = await lstat(source);
        await copyFile(source, temporary, constants.COPYFILE_EXCL);
        const result = await video.importFile({ requestId: r.requestId, projectId: r.projectId, uploadProjectId: r.projectId, apply: false, file: { path: temporary, size: info.size, originalname: `${r.sceneTitle} · ${r.provider}.mp4` }, browser: { automationId: r.id, pageUrl: r.pageUrl! } });
        r.assetId = result.asset.id;
        const current = store.project, scene = current.scenes.find(s => s.id === r.sceneId), request = await video.load(r.requestId);
        if (r.apply && !r.cancelledAt && scene && scene.videoAssetId === r.baseVideoAssetId && !result.asset.googleVideo?.contextChanged && !video.status(request).stale)
            store.project = applyGoogleVideoTake(current, r.sceneId, result.asset, true);
        r.phase = 'completed';
        r.message = phaseMessages.completed;
        await save(r);
        return result;
    }
    catch (e: any) {
        r.phase = 'attention';
        r.message = `El original o sus parciales se conservan. ${String(e.message).slice(0, 500)}`;
        await save(r);
        throw e;
    }
    finally {
        busy.delete(r.id);
    } }
    bridge.post('/native-begin/:id',route(async(req,res)=>{const r=leased(req);if(r.provider!=='flow'||(!r.submittedAt&&!r.recoverOnly)||!r.pageUrl||r.bytes||nativeReceipts.has(r.id))throw fail('Esta toma no espera una descarga nativa.');const{prefix}=z.object({prefix:z.string().min(4).max(111)}).strict().parse(req.body);nativeReceipts.set(r.id,await new NativeDownloadReceipt(o.nativeDownloadsDirectory??join(homedir(),'Downloads'),prefix).begin());r.phase='downloading';r.message='Esperando Tamaño original en Descargas; no se modifica el archivo de Chrome.';await save(r);res.json({ok:true})}));
    bridge.post('/native-poll/:id',route(async(req,res)=>{const r=leased(req),receipt=nativeReceipts.get(r.id);if(!receipt)throw fail('No hay una descarga nativa preparada.');if(busy.has(r.id))return res.json({pending:true});busy.add(r.id);let result;try{result=await receipt.capture(join(downloads,r.id+'.part'));if(result){r.bytes=result.bytes;await save(r);nativeReceipts.delete(r.id)}}finally{busy.delete(r.id)}if(!result)return res.json({pending:true});res.json({pending:false,...await finish(r)})}));
    bridge.post('/finish/:id', route(async (req, res) => { const r = leased(req); res.json(await finish(r)); }));
    app.get('/api/google-browser/status', route(async (_req, res) => {pruneDevices();res.json({ configured: !!connection, connected: !!connection?.lastSeen && Date.now() - Date.parse(connection.lastSeen) < 65000, extensionVersion: connection?.version, extensionUrl: '/api/google-browser/extension',discovery:{active:Date.now()<discoveryUntil,expiresAt:discoveryUntil?new Date(discoveryUntil).toISOString():null,devices:[...devices.values()].filter(d=>!d.approved).map(d=>({id:d.id,extensionId:d.extensionId,version:d.version,lastSeen:new Date(d.lastSeen).toISOString()}))}, runs: [...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100).map(publicRun) }); }));
    app.post('/api/google-browser/discovery',route(async(_req,res)=>{devices.clear();discoveryUntil=Date.now()+5*60000;res.json({ok:true,expiresAt:new Date(discoveryUntil).toISOString()})}));
    app.post('/api/google-browser/approve-device',route(async(req,res)=>{
        const{id}=z.object({id:uuid}).strict().parse(req.body);pruneDevices();const d=[...devices.values()].find(v=>v.id===id);
        if(!d||d.approved||Date.now()>discoveryUntil||Date.now()-d.lastSeen>65000)throw fail('Chrome ya no está disponible. Vuelve a detectarlo.');
        if([...runs.values()].some(r=>!terminal(r)))throw fail('Termina la toma activa antes de cambiar el enlace.');
        const token=randomBytes(32).toString('base64url');
        connection={extensionId:d.extensionId,tokenSha256:digest(token),version:d.version,connectedAt:new Date().toISOString()};
        await atomic(connectionPath,connection);d.token=token;d.approved=true;d.expires=Date.now()+120000;discoveryUntil=0;
        for(const[key,v]of devices)if(v!==d)devices.delete(key);
        res.json({ok:true,message:'Enlace autorizado. Esperando la confirmación de Chrome.'});
    }));
    app.post('/api/google-browser/pairing', route(async (_req, res) => { if ([...runs.values()].some(r => !terminal(r)))
        throw fail('Detén la automatización antes de cambiar el enlace de Chrome.'); pair = { code: String(randomInt(100000000, 1000000000)), expires: Date.now() + 120000, attempts: 0 }; res.json({ code: pair.code, expiresAt: new Date(pair.expires).toISOString() }); }));
    app.post('/api/google-browser/disconnect', route(async (_req, res) => { connection = undefined; pair = undefined; devices.clear(); discoveryUntil=0; await atomic(connectionPath, null); for (const r of runs.values())
        if (!terminal(r)) {
            r.phase = 'attention';
            r.message = errors.DISCONNECTED;
            await save(r);
        } res.json({ configured: false }); }));
    app.get('/api/google-browser/extension', route(async (_req, res) => { const files = ['manifest.json', 'worker.js', 'content.js', 'options.html', 'options.js']; const path = join(o.dataDirectory, 'exports', 'Filmma-Google-Bridge.zip'); await writeZip(path, await Promise.all(files.map(async (name) => ({ name: `Filmma-Google-Bridge/${name}`, data: await readFile(join(o.publicDirectory, 'google-browser', name)) })))); res.download(path, 'Filmma-Google-Bridge.zip'); }));
    app.post('/api/google-browser/runs', route(async (req, res) => { const input = z.object({ requestId: uuid, confirmSubscriptionUse: z.literal(true), apply: z.boolean().default(true) }).strict().parse(req.body); if (!connection)
        throw fail('Enlaza la extensión de Chrome antes de automatizar.'); if ([...runs.values()].some(r => !terminal(r)))
        throw fail('Hay una toma de Google activa. Espera antes de enviar otra.'); const request = await video.load(input.requestId); if (video.status(request).stale)
        throw fail('El paquete está desactualizado. Prepara otro con el guion actual.'); if ([...runs.values()].some(r => r.requestId === request.id && r.submittedAt))
        throw fail('Este paquete ya se envió. Recupera su pestaña sin volver a generar.'); if (store.project.assets.some(a => a.googleVideo?.requestId === request.id))
        throw fail('Este paquete ya tiene una toma. Prepara otro para generar una alternativa.'); const stamp = new Date().toISOString(), r: BrowserRun = { id: randomUUID(), requestId: request.id, provider: request.provider, projectId: request.projectId, sceneId: request.sceneId, sceneTitle: request.sceneTitle, createdAt: stamp, updatedAt: stamp, phase: 'queued', message: phaseMessages.queued, bytes: 0, apply: input.apply, baseVideoAssetId: store.project.scenes.find(s => s.id === request.sceneId)?.videoAssetId }; if ([...runs.values()].some(x => !terminal(x)))
        throw fail('Hay una toma de Google activa.'); runs.set(r.id, r); const j: Job = { id: r.id, type: 'google-browser', status: 'queued', progress: 0, createdAt: stamp, updatedAt: stamp, message: r.message, context: { projectId: r.projectId, projectName: store.project.name, sceneId: r.sceneId, sceneTitle: r.sceneTitle }, result: { projectId: r.projectId, sceneId: r.sceneId } }; store.jobs.push(j); await save(r); res.status(202).json({ run: publicRun(r), job: j }); }));
    app.post('/api/google-browser/recover-page',route(async(req,res)=>{const input=z.object({requestId:uuid,pageUrl:z.string().max(2000),apply:z.boolean().default(false)}).strict().parse(req.body);if(!connection)throw fail('Enlaza Chrome primero.');if([...runs.values()].some(r=>!terminal(r)))throw fail('Hay una toma activa.');const request=await video.load(input.requestId);if(store.project.id!==request.projectId)throw fail('Abre el proyecto del paquete.');const stamp=new Date().toISOString(),r:BrowserRun={id:randomUUID(),requestId:request.id,provider:request.provider,projectId:request.projectId,sceneId:request.sceneId,sceneTitle:request.sceneTitle,createdAt:stamp,updatedAt:stamp,phase:'queued',message:'Recuperando un resultado existente sin generar.',bytes:0,apply:input.apply,recoverOnly:true,pageUrl:safePage(input.pageUrl,request.provider),baseVideoAssetId:store.project.scenes.find(s=>s.id===request.sceneId)?.videoAssetId};runs.set(r.id,r);store.jobs.push({id:r.id,type:'google-browser',status:'queued',progress:0,createdAt:stamp,updatedAt:stamp,message:r.message,context:{projectId:r.projectId,sceneId:r.sceneId,sceneTitle:r.sceneTitle}});await save(r);res.status(202).json({run:publicRun(r)})}));
    async function stop(id: string) {
        const r = get(id);nativeReceipts.delete(r.id);
        if (r.phase === 'completed') throw fail('La toma ya se conservó.');
        r.cancelledAt = new Date().toISOString();
        r.phase = 'cancelled';
        r.message = phaseMessages.cancelled;
        await save(r);
        return r;
    }
    app.post('/api/google-browser/runs/:id/stop', route(async (req, res) => {
        res.json({run:publicRun(await stop(String(req.params.id)))});
    }));
    app.post('/api/google-browser/runs/:id/continue', route(async (req, res) => { const r = get(req.params.id); if (!['attention', 'cancelled'].includes(r.phase) || !r.submittedAt || !r.pageUrl || r.originalFile)
        throw fail('Esta toma no tiene una pestaña pendiente que recuperar.'); if ([...runs.values()].some(other => other.id !== r.id && !terminal(other)))
        throw fail('Espera a que termine la otra toma de Google.'); if (busy.has(r.id))
        throw fail('La descarga aún se está cerrando.'); r.phase = 'opening'; busy.add(r.id); try {
        if (r.bytes) {
            const partial = join(downloads, r.id + '.part');
            try {
                await rename(partial, join(downloads, r.id + '.retained-' + randomUUID() + '.part'));
            }
            catch (e: any) {
                if (e.code !== 'ENOENT')
                    throw e;
            }
        }
        r.bytes = 0;
        r.lastChunk = undefined;
        r.cancelledAt = undefined;
        r.phase = 'queued';
        r.message = 'Recuperando el resultado de Google; no se vuelve a generar.';
        r.lease = undefined;
        await save(r);
        res.json({ run: publicRun(r) });
    }
    catch (e) {
        r.phase = 'attention';
        await save(r);
        throw e;
    }
    finally {
        busy.delete(r.id);
    } }));
    app.post('/api/google-browser/runs/:id/recover', route(async (req, res) => { const r = get(req.params.id); if (r.phase !== 'attention' || !r.originalFile)
        throw fail('No hay una descarga completa que recuperar. Revisa la pestaña de origen.'); res.json(await finish(r)); }));
    return {stop};
}
