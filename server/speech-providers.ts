import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {createProviderCredentialCodec} from './provider-credential-codec.js';
import {ELEVENLABS_MODELS, ELEVENLABS_DEFAULTS, elevenCapabilities, type ElevenLabsSettings, type SpeechAlignment} from '../src/elevenlabs.js';
import {elevenLabsSettingsSchema, speechAlignmentSchema} from './types.js';

const ORIGIN = 'https://api.elevenlabs.io';
const SAMPLE_RATE = 24000, MAX_SECONDS = 15, MAX_PCM_BYTES = SAMPLE_RATE * 2 * MAX_SECONDS;
const supportedModels:readonly string[] = ELEVENLABS_MODELS;
const safeId = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const keySchema = z.string().trim().min(16).max(512).regex(/^[a-zA-Z0-9_-]+$/);
const voiceSchema = z.object({ id: safeId, name: z.string().max(160), category: z.string().max(80), language: z.string().max(12).optional(), description:z.string().max(500).optional(), previewUrl:z.string().max(2000).optional() });
const modelSchema = z.object({ id: safeId, name: z.string().max(160), languages: z.array(z.string().max(12)).max(100), supportsSpeed: z.boolean(), supportsStyle:z.boolean().optional(), supportsSpeakerBoost:z.boolean().optional() });
const accountSchema = z.object({ tier: z.string().max(80), used: z.number().nonnegative().optional(), limit: z.number().nonnegative().optional(), resetsAt:z.number().int().nonnegative().max(4102444800).optional() });
const catalogSchema = z.object({ checkedAt: z.string().max(40), voices: z.array(voiceSchema).max(2000), models: z.array(modelSchema).max(100), account: accountSchema.optional() });
const storedSchema = catalogSchema.extend({ apiKey: keySchema, connectionId: z.string().uuid() }).strict();
type Catalog = z.infer<typeof catalogSchema>;
type Stored = z.infer<typeof storedSchema>;
export type ElevenLabsStatus = Partial<Catalog> & { provider: 'elevenlabs'; configured: boolean; ready: boolean; connectionId?: string; voices: z.infer<typeof voiceSchema>[]; models: z.infer<typeof modelSchema>[]; message?: string };
export type ElevenLabsSynthesis = { text: string; voiceId: string; modelId: string; language: 'es' | 'en'; speed: number; outputPath: string; signal?: AbortSignal; seed?: number; expectedConnectionId?: string; settings?:ElevenLabsSettings; withTimestamps?:boolean };
export type ElevenLabsOptions = { credentialsDirectory?: string; fetch?: typeof fetch; timeoutMs?: number };
export type ElevenLabsProvider = ReturnType<typeof createElevenLabsProvider>;

class ProviderError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'ELEVENLABS_ERROR') { super(message); }
}
const clean = (value: unknown, max: number, fallback: string) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : fallback;
const disconnected = (): ElevenLabsStatus => ({ provider: 'elevenlabs', configured: false, ready: false, voices: [], models: [], message: 'Conecta tu cuenta con una clave API de ElevenLabs.' });
function publicState(stored: Stored): ElevenLabsStatus {
  const { apiKey: _secret, ...catalog } = stored;
  return { provider: 'elevenlabs', configured: true, ready: catalog.models.length > 0 && catalog.voices.length > 0, ...structuredClone(catalog), ...(!catalog.voices.length ? { message: 'Añade una voz a tu cuenta de ElevenLabs y actualiza la conexión.' } : !catalog.models.length ? { message: 'Esta cuenta no devuelve un modelo compatible con español y PCM de 24 kHz.' } : {}) };
}
export function safeElevenPreview(value:unknown):string|undefined {
  if(typeof value!=='string'||value.length>2000)return;
  try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash)return;
    if((url.hostname==='storage.googleapis.com'&&url.pathname.startsWith('/eleven-public-prod/'))||url.hostname==='cdn.elevenlabs.io')return url.href;
  }catch{/* Ignore untrusted catalog URLs. */}
}
function abortError(signal?: AbortSignal, timedOut = false, paid = false) {
  if (timedOut) return new ProviderError(`ElevenLabs tardó demasiado en responder. Comprueba el estado del servicio antes de reintentar.${paid ? ' La solicitud puede haber consumido créditos.' : ''}`, 504, 'TIMEOUT');
  if (signal?.aborted) return new ProviderError(`Trabajo cancelado.${paid ? ' Una solicitud ya enviada a ElevenLabs puede haber consumido créditos.' : ''}`, 409, 'ABORTED');
  return new ProviderError(`No se pudo contactar con ElevenLabs. Comprueba la conexión antes de volver a generar.${paid ? ' La solicitud puede haber consumido créditos.' : ''}`, 502, 'NETWORK');
}

/** Server-only credential holder. No key, provider response body or remote URL is exposed. */
export function createElevenLabsProvider(options: ElevenLabsOptions = {}) {
  const credentialCodec=createProviderCredentialCodec();
  const directory = resolve(options.credentialsDirectory ?? join(homedir(), '.config', 'filmma', 'providers'));
  const credentialPath = join(directory, 'elevenlabs.json'), fetcher = options.fetch ?? fetch;
  const active = new Set<AbortController>();
  let revision = 0, mutation: Promise<unknown> = Promise.resolve();
  const locked = <T>(action: () => Promise<T>): Promise<T> => { const next = mutation.then(action, action); mutation = next.catch(() => undefined); return next; };

  async function load(): Promise<Stored | undefined> {
    let handle;
    try {
      handle = await open(credentialPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await handle.stat();
      if (!info.isFile() || info.size > (credentialCodec.windows?3:2) * 1024 * 1024 || !credentialCodec.windows&&(info.mode & 0o077)) throw new Error('unsafe');
      return storedSchema.parse(JSON.parse(await credentialCodec.decode(await handle.readFile('utf8'))));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new ProviderError('No se pudo leer la conexión privada de ElevenLabs. Vuelve a conectar la cuenta para repararla.', 409, 'CREDENTIAL_STORAGE');
    } finally { await handle?.close(); }
  }
  async function save(stored: Stored) {
    const serialized=JSON.stringify(stored);
    if(Buffer.byteLength(serialized)>2*1024*1024)throw new ProviderError('El catálogo de ElevenLabs es demasiado grande para guardar la conexión. Reduce las voces guardadas y actualiza.',400,'CATALOG_LIMIT');
    let temporary: string | undefined;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if (!(await lstat(directory)).isDirectory()) throw new Error('unsafe');
      await chmod(directory, 0o700);
      temporary = join(directory, `.elevenlabs-${randomUUID()}.tmp`);
      await writeFile(temporary, await credentialCodec.encode(serialized), { mode: 0o600, flag: 'wx' });
      await rename(temporary, credentialPath);
    } catch { throw new ProviderError('No se pudo guardar la conexión privada de ElevenLabs en este equipo.', 500, 'CREDENTIAL_STORAGE'); }
    finally { if (temporary) await rm(temporary, { force: true }).catch(() => undefined); }
  }
  async function operation<T>(signal: AbortSignal | undefined, milliseconds: number, action: (signal: AbortSignal) => Promise<T>, paid = false): Promise<T> {
    const controller = new AbortController(); let timedOut = false;
    const cancel = () => controller.abort();
    if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', cancel, { once: true });
    active.add(controller);
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? milliseconds);
    try {
      if (controller.signal.aborted) throw abortError(controller.signal);
      return await action(controller.signal);
    } catch (error) { if (timedOut) throw abortError(controller.signal, true, paid); if (controller.signal.aborted) throw abortError(controller.signal, false, paid); if (error instanceof ProviderError) throw error; throw abortError(controller.signal, false, paid); }
    finally { clearTimeout(timer); active.delete(controller); signal?.removeEventListener('abort', cancel); }
  }
  async function request(path: string, apiKey: string, signal: AbortSignal, body?: unknown): Promise<Response> {
    const response = await fetcher(`${ORIGIN}${path}`, { method: body ? 'POST' : 'GET', redirect: 'error', signal, headers: { 'xi-api-key': apiKey, Accept: body && !path.includes('/with-timestamps') ? 'audio/pcm' : 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const [message, status] = response.status === 401 ? ['La clave de ElevenLabs no es válida. Vuelve a conectar la cuenta.', 401] : response.status === 403 ? ['ElevenLabs rechazó el acceso. Revisa los permisos de la clave, la voz y el acceso API de tu plan.', 403] : response.status === 429 ? ['ElevenLabs alcanzó un límite de uso o concurrencia. Revisa los créditos de tu cuenta antes de reintentar.', 429] : response.status === 400 || response.status === 422 ? ['ElevenLabs no admite esta voz o configuración. Actualiza las voces y el modelo de la cuenta.', 400] : ['ElevenLabs no pudo completar la solicitud. No se ha generado un reintento automático.', 502];
      throw new ProviderError(String(message), Number(status), `HTTP_${response.status}`);
    }
    return response;
  }
  async function readBounded(response: Response, bytes: number, signal: AbortSignal, duration = false): Promise<Buffer> {
    const reader = response.body?.getReader();
    if (!reader) throw new ProviderError('ElevenLabs devolvió una respuesta vacía.', 502, 'EMPTY_RESPONSE');
    let size = 0; const chunks: Buffer[] = [];
    try {
      while (true) {
        if (signal.aborted) throw abortError(signal);
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > bytes) throw new ProviderError(duration ? 'La voz supera 15 segundos. Divide la intervención; no se ha recortado ni guardado. ElevenLabs puede haber consumido créditos.' : 'ElevenLabs devolvió una respuesta demasiado grande.', duration ? 400 : 502, duration ? 'DURATION_LIMIT' : 'RESPONSE_LIMIT');
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks, size);
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
  async function json(path: string, key: string, signal: AbortSignal): Promise<any> {
    const response = await request(path, key, signal);
    try { return JSON.parse((await readBounded(response, 2 * 1024 * 1024, signal)).toString('utf8')); }
    catch (error) { if (error instanceof ProviderError) throw error; throw new ProviderError('El catálogo de ElevenLabs no se pudo interpretar.', 502, 'INVALID_RESPONSE'); }
  }
  async function catalog(key: string, signal: AbortSignal): Promise<Catalog> {
    const label = (value: unknown, max: number, fallback: string) => clean(value, max, fallback).replaceAll(key, '[privado]');
    const voices: Catalog['voices'] = [], seen = new Set<string>(); let token: string | undefined;
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({ page_size: '100', include_total_count: 'false', ...(token ? { next_page_token: token } : {}) });
      const value = await json(`/v2/voices?${query}`, key, signal);
      if (!Array.isArray(value.voices)) throw new ProviderError('ElevenLabs no devolvió un catálogo de voces válido.', 502, 'INVALID_RESPONSE');
      for (const voice of value.voices) if (safeId.safeParse(voice?.voice_id).success && !voice.voice_id.includes(key) && !seen.has(voice.voice_id)) {
        seen.add(voice.voice_id); voices.push({ id: voice.voice_id, name: label(voice.name, 160, 'Voz de ElevenLabs'), category: label(voice.category, 80, 'personal'), ...(typeof voice.description==='string'?{description:label(voice.description,500,'')}:{}), ...(safeElevenPreview(voice.preview_url)&&!voice.preview_url.includes(key)?{previewUrl:safeElevenPreview(voice.preview_url)}:{}), ...(typeof voice.labels?.language === 'string' ? { language: label(voice.labels.language, 12, '') } : {}) });
      }
      if (voices.length > 2000) throw new ProviderError('La cuenta tiene más voces de las que Filmma puede mostrar.', 400);
      if (!value.has_more) break;
      if (page === 19 || typeof value.next_page_token !== 'string' || value.next_page_token.length > 2000 || value.next_page_token === token) throw new ProviderError('No se pudo completar la lista de voces de ElevenLabs. Actualiza la conexión.', 502, 'PAGINATION');
      token = value.next_page_token;
    }
    const rawModels = await json('/v1/models', key, signal);
    if (!Array.isArray(rawModels)) throw new ProviderError('ElevenLabs no devolvió modelos válidos.', 502, 'INVALID_RESPONSE');
    const models: Catalog['models'] = rawModels.filter(m => supportedModels.includes(m?.model_id) && m.can_do_text_to_speech === true && Array.isArray(m.languages) && m.languages.some((l: any) => l.language_id === 'es')).map(m => ({ id: m.model_id, name: label(m.name, 160, m.model_id), languages: m.languages.filter((l: any) => typeof l?.language_id === 'string' && /^[a-z]{2,3}$/.test(l.language_id)).map((l: any) => l.language_id).slice(0, 100), ...elevenCapabilities(m.model_id) }));
    let account: Catalog['account'];
    try {
      const value = await json('/v1/user/subscription', key, signal);
      account = { tier: label(value.tier, 80, 'Cuenta conectada'), ...(Number.isFinite(value.character_count) && value.character_count >= 0 ? { used: value.character_count } : {}), ...(Number.isFinite(value.character_limit) && value.character_limit >= 0 ? { limit: value.character_limit } : {}), ...(Number.isInteger(value.next_character_count_reset_unix)&&value.next_character_count_reset_unix>=0&&value.next_character_count_reset_unix<=4102444800?{resetsAt:value.next_character_count_reset_unix}:{}) };
    } catch (error) { if (!(error instanceof ProviderError) || error.status !== 403) throw error; /* Restricted keys may omit account-read permission. */ }
    return { checkedAt: new Date().toISOString(), voices, models, ...(account ? { account } : {}) };
  }
  async function status(params: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<ElevenLabsStatus> {
    const stored = await load(); if (!stored) return disconnected();
    if (!params.refresh) return publicState(stored);
    const currentRevision = revision;
    const updated = { apiKey: stored.apiKey, connectionId: stored.connectionId, ...await operation(params.signal, 30000, signal => catalog(stored.apiKey, signal)) };
    await locked(async () => { if (revision !== currentRevision) throw new ProviderError('La conexión cambió. Actualiza su estado.', 409); await save(updated); });
    return publicState(updated);
  }
  async function connect(apiKey: string, signal?: AbortSignal): Promise<ElevenLabsStatus> {
    const parsed = keySchema.safeParse(apiKey); if (!parsed.success) throw new ProviderError('Introduce una clave API válida de ElevenLabs.');
    const currentRevision = ++revision, stored = { apiKey: parsed.data, connectionId: randomUUID(), ...await operation(signal, 30000, requestSignal => catalog(parsed.data, requestSignal)) };
    await locked(async () => { if (revision !== currentRevision) throw new ProviderError('La conexión cambió antes de guardarse. Vuelve a conectar.', 409); await save(stored); });
    return publicState(stored);
  }
  async function disconnect(): Promise<ElevenLabsStatus> {
    ++revision; for (const controller of active) controller.abort();
    await locked(async () => { try { await rm(credentialPath, { force: true }); } catch { throw new ProviderError('No se pudo retirar la conexión privada de ElevenLabs.', 500, 'CREDENTIAL_STORAGE'); } });
    return disconnected();
  }
  async function synthesize(input: ElevenLabsSynthesis) {
    const parsed = z.object({ text: z.string().trim().min(1).max(783), voiceId: safeId, modelId: z.enum(ELEVENLABS_MODELS), language: z.enum(['es', 'en']), speed: z.number().min(.7).max(1.2), seed: z.number().int().min(0).max(4294967295).optional(), settings:elevenLabsSettingsSchema.optional(), withTimestamps:z.boolean().optional() }).safeParse(input);
    if (!parsed.success || !isAbsolute(input.outputPath) || !input.outputPath.endsWith('.wav')) throw new ProviderError('Revisa el texto, la voz y la velocidad de ElevenLabs (0,7 a 1,2).');
    if (await lstat(input.outputPath).catch(error => { if (error.code === 'ENOENT') return undefined; throw new ProviderError('No se pudo preparar una copia nueva para la voz.', 500, 'OUTPUT'); })) throw new ProviderError('El archivo de destino ya existe. Elige una copia nueva antes de generar.', 409, 'OUTPUT');
    const currentRevision = revision;
    const stored = await load(); if (!stored) throw new ProviderError('Conecta tu cuenta de ElevenLabs antes de generar.', 409);
    if (currentRevision !== revision) throw new ProviderError('La conexión de ElevenLabs cambió. Vuelve a generar con la conexión actual.', 409, 'CONNECTION_CHANGED');
    if (input.expectedConnectionId && input.expectedConnectionId !== stored.connectionId) throw new ProviderError('La cuenta de ElevenLabs cambió mientras esperaba. Vuelve a generar con la conexión actual.', 409, 'CONNECTION_CHANGED');
    return operation(input.signal, 120000, async signal => {
      const model = stored.models.find(m => m.id === parsed.data.modelId);
      if (!stored.voices.some(v => v.id === parsed.data.voiceId) || !model?.languages.includes(parsed.data.language)) throw new ProviderError('La voz o el modelo ya no pertenece al catálogo disponible. Actualiza la conexión de ElevenLabs.', 409);
      const caps=elevenCapabilities(parsed.data.modelId), settings={...ELEVENLABS_DEFAULTS,...parsed.data.settings};
      if(!caps.supportsSpeed&&parsed.data.speed!==1)throw new ProviderError('Este modelo no admite un ritmo numérico. Selecciona ritmo 1 antes de generar.');
      if(caps.discreteStability&&![0,.5,1].includes(settings.stability))throw new ProviderError('Eleven v3 admite estabilidad 0, 0,5 o 1. Ajusta la interpretación antes de generar.');
      // Only parameters supported by this model are sent. Never edit the account's global voice settings.
      const voiceSettings={stability:settings.stability,similarity_boost:settings.similarity,...(caps.supportsStyle?{style:settings.style}:{}),...(caps.supportsSpeakerBoost?{use_speaker_boost:settings.speakerBoost}:{}),...(caps.supportsSpeed?{speed:parsed.data.speed}:{})};
      // A new cloud request is never automatically retried: it may consume credits.
      const body = { text: parsed.data.text, model_id: parsed.data.modelId, voice_settings:voiceSettings, ...(parsed.data.modelId !== 'eleven_multilingual_v2' ? { language_code: parsed.data.language } : {}), ...(parsed.data.seed !== undefined ? { seed: parsed.data.seed } : {}) };
      const response = await request(`/v1/text-to-speech/${parsed.data.voiceId}${parsed.data.withTimestamps?'/with-timestamps':''}?output_format=pcm_24000`, stored.apiKey, signal, body);
      const type = response.headers.get('content-type')?.split(';')[0]?.trim();
      let pcm:Buffer, alignment:SpeechAlignment|undefined;
      if(parsed.data.withTimestamps){
        if(type!=='application/json'){await response.body?.cancel();throw new ProviderError('ElevenLabs no devolvió el audio con tiempos solicitado.',502,'AUDIO_FORMAT');}
        let value:any;try{value=JSON.parse((await readBounded(response,2*1024*1024,signal)).toString('utf8'));}catch(error){if(error instanceof ProviderError)throw error;throw new ProviderError('La respuesta de voz no se pudo interpretar.',502,'INVALID_RESPONSE');}
        const encoded=value?.audio_base64;
        if(typeof encoded!=='string'||!encoded.length||encoded.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw new ProviderError('ElevenLabs devolvió audio incompleto.',502,'INVALID_AUDIO');
        if(encoded.length>Math.ceil(MAX_PCM_BYTES/3)*4)throw new ProviderError('La voz supera 15 segundos. Divide la intervención; no se ha recortado ni guardado. ElevenLabs puede haber consumido créditos.',400,'DURATION_LIMIT');
        pcm=Buffer.from(encoded,'base64');
        for(const [kind,raw] of [['original',value.alignment],['normalized',value.normalized_alignment]] as const){
          const candidate=speechAlignmentSchema.safeParse({source:'elevenlabs',textKind:kind,characters:raw?.characters,starts:raw?.character_start_times_seconds,ends:raw?.character_end_times_seconds});
          if(candidate.success&&(kind!=='original'||candidate.data.characters.join('')===parsed.data.text)&&candidate.data.characters.some((c,i)=>c.trim()&&candidate.data.ends[i]!>candidate.data.starts[i]!)&&candidate.data.ends.every(t=>t<=pcm.length/(SAMPLE_RATE*2)+.001)) {alignment=candidate.data;break;}
        }
      }else{
        if (type && !['audio/pcm', 'audio/x-pcm', 'application/octet-stream'].includes(type)) { await response.body?.cancel(); throw new ProviderError('ElevenLabs devolvió un formato distinto del PCM solicitado.', 502, 'AUDIO_FORMAT'); }
        pcm = await readBounded(response, MAX_PCM_BYTES, signal, true);
      }
      if (pcm.length < 2 || pcm.length % 2 || ['RIFF', 'OggS', 'fLaC'].includes(pcm.toString('ascii', 0, 4)) || pcm.toString('ascii', 0, 3) === 'ID3') throw new ProviderError('ElevenLabs devolvió audio PCM incompleto o incompatible.', 502, 'INVALID_AUDIO');
      if (signal.aborted || currentRevision !== revision) throw abortError(signal.aborted ? signal : AbortSignal.abort());
      const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(SAMPLE_RATE, 24); header.writeUInt32LE(SAMPLE_RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
      let handle, created = false;
      try { handle = await open(input.outputPath, 'wx', 0o600); created = true; await handle.writeFile(Buffer.concat([header, pcm])); if (signal.aborted) throw abortError(signal); }
      catch (error) { if (created) { await handle?.close(); handle = undefined; await rm(input.outputPath, { force: true }); } if (error instanceof ProviderError) throw error; throw new ProviderError('No se pudo guardar la voz en una copia nueva. Los archivos existentes se conservaron.', 500, 'OUTPUT'); }
      finally { await handle?.close(); }
      return { ok: true as const, model: parsed.data.modelId, provider: 'elevenlabs' as const, duration: pcm.length / (SAMPLE_RATE * 2), sampleRate: SAMPLE_RATE, outputPath: input.outputPath, ...(parsed.data.withTimestamps?{timingStatus:alignment?'aligned' as const:'unavailable' as const}:{}), ...(alignment?{alignment}:{}), ...(safeId.safeParse(response.headers.get('request-id')).success&&!response.headers.get('request-id')!.includes(stored.apiKey)?{providerRequestId:response.headers.get('request-id')!}:{}) };
    }, true);
  }
  return { status, connect, disconnect, synthesize };
}
