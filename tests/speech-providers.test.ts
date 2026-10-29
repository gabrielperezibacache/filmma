import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElevenLabsProvider, type ElevenLabsSynthesis } from '../server/speech-providers.js';

const KEY = 'sk_private_fixture_never_display_this';
const OLD_KEY = 'sk_original_fixture_never_display_this';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const models = [
  { model_id: 'eleven_multilingual_v2', name: 'Multilingual v2', can_do_text_to_speech: true, languages: [{ language_id: 'es' }, { language_id: 'en' }] },
  { model_id: 'eleven_flash_v2_5', name: 'Flash v2.5', can_do_text_to_speech: true, languages: [{ language_id: 'es' }, { language_id: 'en' }] },
  { model_id: 'eleven_english_v1', name: 'English', can_do_text_to_speech: true, languages: [{ language_id: 'en' }] },
  { model_id: 'eleven_multilingual_sts_v2', name: 'Voice changer', can_do_text_to_speech: false, languages: [{ language_id: 'es' }] },
];
type Call = { url: URL; options: RequestInit };
async function fixture(override?: (call: Call) => Response | Promise<Response> | undefined, timeoutMs?: number) {
  const dir = await mkdtemp(join(tmpdir(), 'filmma-eleven-')), credentialsDirectory = join(dir, 'private'), calls: Call[] = [];
  const fetcher = (async (url: string | URL | Request, options: RequestInit = {}) => {
    const call = { url: new URL(String(url)), options }; calls.push(call);
    assert.equal(call.url.origin, 'https://api.elevenlabs.io'); assert.equal(options.redirect, 'error');
    const other = await override?.(call); if (other) return other;
    if (call.url.pathname === '/v2/voices') return json({ voices: [{ voice_id: 'voice_elena', name: 'Elena', category: 'cloned', labels: { language: 'es' }, preview_url: 'https://not-used.invalid/preview.mp3' }], has_more: false });
    if (call.url.pathname === '/v1/models') return json(models);
    if (call.url.pathname === '/v1/user/subscription') return json({ tier: 'creator', character_count: 100, character_limit: 10000, payment_secret: KEY });
    if (call.url.pathname === '/v1/text-to-speech/voice_elena') return new Response(Buffer.alloc(48000, 5), { headers: { 'Content-Type': 'audio/pcm' } });
    throw new Error('Unexpected URL');
  }) as typeof fetch;
  const provider = createElevenLabsProvider({ credentialsDirectory, fetch: fetcher, timeoutMs });
  const input: ElevenLabsSynthesis = { text: 'Una última función.', voiceId: 'voice_elena', modelId: 'eleven_multilingual_v2', language: 'es', speed: 1, outputPath: join(dir, 'voice.wav') };
  return { dir, credentialsDirectory, provider, input, calls, fetcher, close: () => rm(dir, { recursive: true, force: true }) };
}

test('unconfigured provider is local, and connecting uses read-only account endpoints with private persisted credentials', async () => {
  const f = await fixture(); try {
    assert.equal((await f.provider.status()).configured, false); assert.equal(f.calls.length, 0);
    const state = await f.provider.connect(KEY);
    assert.equal(state.ready, true); assert.equal(state.voices[0]!.name, 'Elena'); assert.equal(state.models.length, 2); assert.deepEqual(state.account, { tier: 'creator', used: 100, limit: 10000 });
    assert.equal(f.calls.length, 3); assert(f.calls.every(c => c.options.method === 'GET' && (c.options.headers as any)['xi-api-key'] === KEY));
    assert.doesNotMatch(JSON.stringify(state), new RegExp(KEY)); assert.doesNotMatch(JSON.stringify(state), /preview_url|payment_secret/);
    assert.equal((await stat(f.credentialsDirectory)).mode & 0o777, 0o700); assert.equal((await stat(join(f.credentialsDirectory, 'elevenlabs.json'))).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(join(f.credentialsDirectory, 'elevenlabs.json'), 'utf8')).apiKey, KEY);
    await f.provider.status(); await f.provider.status(); assert.equal(f.calls.length, 3, 'polling must never refresh remotely');
    const restarted = createElevenLabsProvider({ credentialsDirectory: f.credentialsDirectory, fetch: f.fetcher }); assert.equal((await restarted.status()).ready, true); assert.equal(f.calls.length, 3);
    assert.equal((await f.provider.status({ refresh: true })).connectionId, state.connectionId); assert.equal(f.calls.length, 6);
  } finally { await f.close(); }
});

test('pagination keeps saved voices and filters metadata and incompatible models without generating a sample', async () => {
  const f = await fixture(({ url }) => url.pathname === '/v2/voices' ? json(url.searchParams.get('next_page_token') ? { voices: [{ voice_id: 'voice_second', name: `Second ${KEY}`, category: 'professional' }, { voice_id: 'voice_elena', name: 'duplicate', category: 'cloned' }], has_more: false } : { voices: [{ voice_id: 'voice_elena', name: 'Elena', category: 'cloned' }], has_more: true, next_page_token: 'page-two' }) : undefined);
  try { const state = await f.provider.connect(KEY); assert.equal(state.voices.length, 2); assert.doesNotMatch(JSON.stringify(state), new RegExp(KEY)); assert(f.calls.every(c => c.options.method === 'GET')); assert.equal(f.calls[1]!.url.searchParams.get('next_page_token'), 'page-two'); }
  finally { await f.close(); }
});

test('failed or malformed keys do not replace the prior connection and remote error bodies are never exposed', async () => {
  const f = await fixture(({ options }) => (options.headers as any)['xi-api-key'] === KEY ? json({ detail: { message: `Leaked ${KEY}`, arbitrary: 'secret remote account data' } }, 401) : undefined);
  try {
    await assert.rejects(f.provider.connect('not a key'), /clave API válida/); assert.equal(f.calls.length, 0);
    await f.provider.connect(OLD_KEY);
    await assert.rejects(f.provider.connect(KEY), error => { const text = String(error); assert.doesNotMatch(text, /sk_|secret remote/); return /no es válida/.test(text); });
    assert.equal((await f.provider.status()).ready, true); assert.equal(JSON.parse(await readFile(join(f.credentialsDirectory, 'elevenlabs.json'), 'utf8')).apiKey, OLD_KEY);
  } finally { await f.close(); }
});

test('a restricted key can connect without reading subscription details', async () => {
  const f = await fixture(({ url }) => url.pathname === '/v1/user/subscription' ? json({ detail: KEY }, 403) : undefined);
  try { const state = await f.provider.connect(KEY); assert.equal(state.ready, true); assert.equal(state.account, undefined); }
  finally { await f.close(); }
});

test('explicit synthesis creates a new lossless 24 kHz WAV with stable settings and no hidden cloud retries', async () => {
  const f = await fixture(); try {
    await f.provider.connect(KEY); const result = await f.provider.synthesize({ ...f.input, seed: 42 });
    assert.equal(result.ok, true); assert.equal(result.duration, 1); assert.equal(result.sampleRate, 24000);
    const wav = await readFile(f.input.outputPath); assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.readUInt32LE(24), 24000); assert.equal(wav.readUInt16LE(22), 1); assert.equal(wav.readUInt32LE(40), 48000); assert.equal(wav.length, 48044);
    const paid = f.calls.filter(c => c.options.method === 'POST'); assert.equal(paid.length, 1); assert.equal(paid[0]!.url.searchParams.get('output_format'), 'pcm_24000');
    const body = JSON.parse(String(paid[0]!.options.body)); assert.equal(body.seed, 42); assert.equal(body.language_code, undefined); assert.equal(body.voice_settings.speed, 1); assert.equal(body.voice_settings.stability, .5);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(KEY));
    const flash = join(f.dir, 'flash.wav'); await f.provider.synthesize({ ...f.input, modelId: 'eleven_flash_v2_5', outputPath: flash }); assert.equal(JSON.parse(String(f.calls.at(-1)!.options.body)).language_code, 'es');
  } finally { await f.close(); }
});

test('long streamed audio is cancelled at fifteen seconds and no truncated output is published', async () => {
  let cancelled = false, pulls = 0;
  const f = await fixture(({ options }) => options.method === 'POST' ? new Response(new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(240000)); }, cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'audio/pcm' } }) : undefined);
  try { await f.provider.connect(KEY); await assert.rejects(f.provider.synthesize(f.input), /supera 15 segundos/); assert(cancelled); assert(pulls <= 6); await assert.rejects(stat(f.input.outputPath), { code: 'ENOENT' }); assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 1); }
  finally { await f.close(); }
});

test('voice/model/speed validation and existing originals are checked before spending credits', async () => {
  const f = await fixture(); try {
    await f.provider.connect(KEY);
    for (const change of [{ speed: 1.8 }, { voiceId: '../../other' }, { modelId: 'eleven_monolingual_v1' }, { voiceId: 'voice_not_owned' }]) await assert.rejects(f.provider.synthesize({ ...f.input, ...change }));
    await writeFile(f.input.outputPath, 'original audio'); await assert.rejects(f.provider.synthesize(f.input), /ya existe/); assert.equal(await readFile(f.input.outputPath, 'utf8'), 'original audio');
    assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 0);
  } finally { await f.close(); }
});

test('queued speech cannot spend credits on a replacement account', async () => {
  const f = await fixture(); try {
    const first = await f.provider.connect(KEY), second = await f.provider.connect(OLD_KEY);
    assert.notEqual(first.connectionId, second.connectionId);
    await assert.rejects(f.provider.synthesize({ ...f.input, expectedConnectionId: first.connectionId }), /cuenta de ElevenLabs cambió/);
    assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 0);
  } finally { await f.close(); }
});

test('HTTP errors, unexpected media, malformed PCM and network exceptions remain sanitized', async () => {
  for (const response of [() => json({ message: KEY }, 429), () => new Response('bad', { headers: { 'Content-Type': 'audio/mpeg' } }), () => new Response(new Uint8Array(3), { headers: { 'Content-Type': 'audio/pcm' } }), () => { throw new Error(`Network exposed ${KEY}`); }]) {
    const f = await fixture(({ options }) => options.method === 'POST' ? response() : undefined);
    try { await f.provider.connect(KEY); await assert.rejects(f.provider.synthesize(f.input), error => { assert.doesNotMatch(String(error), new RegExp(KEY)); return true; }); await assert.rejects(stat(f.input.outputPath), { code: 'ENOENT' }); assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 1); }
    finally { await f.close(); }
  }
});

test('timeouts and caller cancellation abort cloud requests without output or retry', async () => {
  for (const cancel of [false, true]) {
    let providerAborted = false;
    let markDispatched!:()=>void; const dispatched=new Promise<void>(resolve=>{markDispatched=resolve});
    const f = await fixture(({ options }) => options.method === 'POST' ? new Promise<Response>((_done, reject) => { markDispatched(); options.signal!.addEventListener('abort', () => { providerAborted = true; reject(new Error(KEY)); }, { once: true }); }) : undefined, cancel ? 500 : 20);
    try {
      await f.provider.connect(KEY); const controller = new AbortController(), pending = f.provider.synthesize({ ...f.input, signal: controller.signal });
      // Start caller cancellation after dispatch: file reads before the request may
      // exceed 10 ms under the complete media suite without being a provider fault.
      if (cancel) { await dispatched; controller.abort(); }
      await assert.rejects(pending, cancel ? /cancelado/ : /tardó demasiado/); assert(providerAborted); await assert.rejects(stat(f.input.outputPath), { code: 'ENOENT' });
      assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 1);
    } finally { await f.close(); }
  }
});

test('disconnect cancels an in-flight generation, removes only credentials and prevents stale connection commits', async () => {
  let started!: () => void; const running = new Promise<void>(resolve => { started = resolve; });
  const f = await fixture(({ options }) => options.method === 'POST' ? new Promise<Response>((_done, reject) => { started(); options.signal!.addEventListener('abort', () => reject(new Error(KEY)), { once: true }); }) : undefined);
  try {
    await f.provider.connect(KEY); const pending = f.provider.synthesize(f.input), rejected = assert.rejects(pending, /cancelado/); await running;
    assert.equal((await f.provider.disconnect()).configured, false); await rejected; assert.equal((await f.provider.status()).configured, false); await assert.rejects(stat(join(f.credentialsDirectory, 'elevenlabs.json')), { code: 'ENOENT' }); await assert.rejects(stat(f.input.outputPath), { code: 'ENOENT' });
  } finally { await f.close(); }
});

test('private storage refuses permissive and symbolic credential files', async () => {
  const f = await fixture(); try {
    await mkdir(f.credentialsDirectory); const outside = join(f.dir, 'outside.json'); await writeFile(outside, JSON.stringify({ apiKey: KEY }), { mode: 0o600 }); await symlink(outside, join(f.credentialsDirectory, 'elevenlabs.json'));
    await assert.rejects(f.provider.status(), /conexión privada/); assert.equal(f.calls.length, 0); assert.equal(JSON.parse(await readFile(outside, 'utf8')).apiKey, KEY);
    await rm(join(f.credentialsDirectory, 'elevenlabs.json')); await writeFile(join(f.credentialsDirectory, 'elevenlabs.json'), '{}', { mode: 0o644 }); await assert.rejects(f.provider.status(), /conexión privada/);
  } finally { await f.close(); }
});

test('current account models expose accurate controls; v4 omits unsupported parameters and v3 validates stability before a paid request', async () => {
  const modern = ['eleven_v3','eleven_v4','eleven_v4_turbo'].map(model_id=>({model_id,name:model_id,can_do_text_to_speech:true,languages:[{language_id:'es'}]}));
  const f=await fixture(({url})=>url.pathname==='/v1/models'?json([...models,...modern]):undefined);
  try {
    const state=await f.provider.connect(KEY);assert.equal(state.models.find(m=>m.id==='eleven_v4')?.supportsSpeed,false);
    assert.equal(state.models.find(m=>m.id==='eleven_v3')?.supportsSpeakerBoost,false);
    await assert.rejects(f.provider.synthesize({...f.input,modelId:'eleven_v4',speed:1.1}),/ritmo 1/);
    await assert.rejects(f.provider.synthesize({...f.input,modelId:'eleven_v3',settings:{stability:.6}}),/estabilidad/);
    assert.equal(f.calls.filter(c=>c.options.method==='POST').length,0);
    await f.provider.synthesize({...f.input,modelId:'eleven_v4',settings:{stability:.8,similarity:.9,style:.6,speakerBoost:false}});
    assert.deepEqual(JSON.parse(String(f.calls.at(-1)!.options.body)).voice_settings,{stability:.8,similarity_boost:.9});
    await f.provider.synthesize({...f.input,outputPath:join(f.dir,'custom.wav'),settings:{stability:.7,similarity:.8,style:.2,speakerBoost:false}});
    assert.deepEqual(JSON.parse(String(f.calls.at(-1)!.options.body)).voice_settings,{stability:.7,similarity_boost:.8,style:.2,use_speaker_boost:false,speed:1});
  } finally {await f.close();}
});

test('voice previews accept only public HTTPS media and account usage stays sanitized',async()=>{
 const f=await fixture(({url})=>url.pathname==='/v2/voices'?json({voices:[
  {voice_id:'public',name:'Pública',preview_url:'https://storage.googleapis.com/eleven-public-prod/premade/voices/test.mp3',description:`Voice ${KEY}`},
  ...['http://localhost/audio','https://storage.googleapis.com/private/test','https://cdn.elevenlabs.io.evil.test/audio','https://cdn.elevenlabs.io/audio?secret=123','https://user:password@cdn.elevenlabs.io/audio','javascript:alert(1)'].map((preview_url,i)=>({voice_id:`blocked_${i}`,name:'Blocked',preview_url}))
 ],has_more:false}):undefined);
 try{const state=await f.provider.connect(KEY);assert.match(state.voices[0]!.previewUrl!,/^https:\/\/storage.googleapis.com\/eleven-public-prod\//);assert(state.voices.slice(1).every(v=>!v.previewUrl));assert.doesNotMatch(JSON.stringify(state),new RegExp(KEY));assert(f.calls.every(c=>c.options.method==='GET'));}finally{await f.close();}
});

function timedSpeech(text:string,extra:Record<string,unknown>={}) {
 return {audio_base64:Buffer.alloc(48000,5).toString('base64'),alignment:{characters:Array.from(text),character_start_times_seconds:Array.from(text,(_c,i)=>.1+i*.6/text.length),character_end_times_seconds:Array.from(text,(_c,i)=>.1+(i+1)*.6/text.length)},...extra};
}

test('timestamp synthesis validates PCM and preserves genuine speech timing and request provenance',async()=>{
 const f=await fixture(({url})=>url.pathname.endsWith('/with-timestamps')?new Response(JSON.stringify(timedSpeech('Una última función.')),{headers:{'content-type':'application/json','request-id':'voice-take-123'}}):undefined);
 try{await f.provider.connect(KEY);const result=await f.provider.synthesize({...f.input,withTimestamps:true});assert.equal(result.duration,1);assert.equal(result.timingStatus,'aligned');assert.equal(result.alignment?.characters.join(''),f.input.text);assert.equal(result.alignment?.textKind,'original');assert.equal(result.providerRequestId,'voice-take-123');assert.equal((await readFile(f.input.outputPath)).length,48044);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);}finally{await f.close();}
});

test('malformed timings keep the original audio with an explicit unavailable status; normalization is identified',async()=>{
 for(const extra of [
  {alignment:{characters:['x'],character_start_times_seconds:[0],character_end_times_seconds:[50]}},
  {alignment:{characters:['a','b'],character_start_times_seconds:[.4,.1],character_end_times_seconds:[.5,.2]}},
  {alignment:{characters:['wrong text'],character_start_times_seconds:[0],character_end_times_seconds:[.5]}},
 ]){
  const f=await fixture(({url})=>url.pathname.endsWith('/with-timestamps')?json(timedSpeech('Una última función.',extra)):undefined);
  try{await f.provider.connect(KEY);const result=await f.provider.synthesize({...f.input,withTimestamps:true});assert.equal(result.timingStatus,'unavailable');assert.equal(result.alignment,undefined);assert.equal(result.duration,1);}finally{await f.close();}
 }
 const normalized={characters:['2','0'],character_start_times_seconds:[.1,.3],character_end_times_seconds:[.3,.5]};
 const f=await fixture(({url})=>url.pathname.endsWith('/with-timestamps')?json(timedSpeech('Una última función.',{alignment:null,normalized_alignment:normalized})):undefined);
 try{await f.provider.connect(KEY);const result=await f.provider.synthesize({...f.input,withTimestamps:true});assert.equal(result.alignment?.textKind,'normalized');assert.equal(result.alignment?.characters.join(''),'20');}finally{await f.close();}
});

test('bad timestamp audio never publishes partial files and never retries a charged request',async()=>{
 for(const value of [{audio_base64:'broken$'}, {audio_base64:Buffer.alloc(720002).toString('base64')}, {audio_base64:Buffer.from('RIFFbad!').toString('base64')}, {audio_base64:'AAAA'}]){
  const f=await fixture(({url})=>url.pathname.endsWith('/with-timestamps')?json(value):undefined);
  try{await f.provider.connect(KEY);await assert.rejects(f.provider.synthesize({...f.input,withTimestamps:true}));assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);await assert.rejects(stat(f.input.outputPath),{code:'ENOENT'});}finally{await f.close();}
 }
});
