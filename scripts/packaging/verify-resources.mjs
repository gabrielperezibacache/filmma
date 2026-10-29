import {readdir,access,readFile,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
export const runtimeFiles=['filmma_continuity.py','filmma_continuity.swift','filmma_lipsync.py','filmma_qwen_tts.py','filmma_runtime.py','filmma_speech.py','filmma_temporal.py','filmma_upscale.py','h3-gguf-catalog.json','h3_gguf_cli.c','h3_quant_benchmark.py','h3_quantized.py','ltx_memory.py','ltx_worker.py','model-catalog.json','model_transfer.py','portable_lock.py','requirements-mlx.txt','speech-model.json','temporal-dependency.json','upscale-LICENSES.txt','upscale-model.json','weight_residency.py'];
export async function verifyResources(target){
 const allowed=new Set(['dist','public','server','package.json','package-lock.json','node_modules','engine','bin','python','sources','THIRD_PARTY_MAC.md','THIRD_PARTY_WINDOWS.md']);
 for(const item of await readdir(target))assert(allowed.has(item),`Unexpected resource: ${item}`);
 assert.deepEqual((await readdir(join(target,'engine'))).sort(),['desktop','runtime']);
 const runtime=join(target,'engine/runtime');
 assert.deepEqual((await readdir(runtime)).sort(),[...runtimeFiles,'patches'].sort(),'Only application-owned runtime sources may ship');
 for(const name of runtimeFiles)assert((await lstat(join(runtime,name))).isFile(),`Runtime source must be a regular file: ${name}`);
 for(const name of ['dist/index.html','server/index.mjs','public/google-browser/manifest.json','engine/desktop/build-info.json','bin/'+(process.platform==='win32'?'ffmpeg.exe':'ffmpeg')])await access(join(target,name));
 const build=JSON.parse(await readFile(join(target,'engine/desktop/build-info.json'),'utf8'));assert.match(build.commit,/^[a-f0-9]{40}$/);assert.match(build.version,/^\d+\.\d+\.\d+$/);
 console.log('Package resource allowlist verified: no projects, model weights or private configuration');
}
if(process.argv[1]&&resolve(process.argv[1])===import.meta.filename)await verifyResources(resolve(process.argv[2]??'build/desktop-resources'));
