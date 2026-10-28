import {build} from 'esbuild';import{mkdir,cp,readFile,writeFile,rm}from'node:fs/promises';import{execFileSync}from'node:child_process';import{join,resolve}from'node:path';
const root=resolve(import.meta.dirname,'../..'),target=join(root,'build/desktop-resources');
await mkdir(target,{recursive:true});
for(const name of ['dist','public'])await cp(join(root,name),join(target,name),{recursive:true});
await mkdir(join(target,'server'),{recursive:true});
await build({entryPoints:[join(root,'server/index.ts')],outfile:join(target,'server/index.mjs'),bundle:true,platform:'node',format:'esm',target:'node22',packages:'external'});
const pkg=JSON.parse(await readFile(join(root,'package.json')));await writeFile(join(target,'package.json'),JSON.stringify({name:'filmma-engine',private:true,type:'module',dependencies:pkg.dependencies}));
execFileSync(process.execPath,[process.env.npm_execpath,'install','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:target,stdio:'inherit'});
const runtime=join(target,'engine/runtime');await mkdir(runtime,{recursive:true});
const{readdir}=await import('node:fs/promises');for(const name of await readdir(join(root,'runtime'))){if(/\.(py|json|txt)$/.test(name)&&name!=='local-config.json')await cp(join(root,'runtime',name),join(runtime,name));}
await cp(join(root,'runtime/patches'),join(runtime,'patches'),{recursive:true});
await mkdir(join(target,'engine/desktop'),{recursive:true});
let commit='';try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()}catch{}
await writeFile(join(target,'engine/desktop/build-info.json'),JSON.stringify({version:pkg.version,commit,repository:'gabrielperezibacache/filmma'}));
await mkdir(join(target,'bin'),{recursive:true});
const managedPython=execFileSync('uv',['python','find','3.12'],{encoding:'utf8',env:{...process.env,UV_CACHE_DIR:join(root,'build/uv-cache')}}).trim();
const basePython=execFileSync(managedPython,['-c','import sys; print(sys.base_prefix)'],{encoding:'utf8'}).trim();
await cp(basePython,join(target,'python'),{recursive:true,dereference:false,verbatimSymlinks:true});
for(const base of ['ffmpeg','ffprobe']){const name=base+(process.platform==='win32'?'.exe':'');await cp(join(root,'build/media-runtime/bin',name),join(target,'bin',name));}
for(const name of ['gh','uv']){const binary=name+(process.platform==='win32'?'.exe':'');const location=execFileSync(process.platform==='win32'?'where.exe':'which',[binary],{encoding:'utf8'}).trim().split(/\r?\n/)[0];await cp(location,join(target,'bin',binary),{dereference:true});if(process.platform==='win32')continue;const dependencies=execFileSync('otool',['-L',join(target,'bin',name)],{encoding:'utf8'});if(dependencies.includes('/opt/homebrew/'))throw new Error(`${name} has a non-portable dependency`);}
await cp(join(root,'desktop/media-runtime.json'),join(target,'engine/desktop/media-runtime.json'));
await cp(join(root,'docs/THIRD_PARTY_MAC.md'),join(target,'THIRD_PARTY_MAC.md'));
await mkdir(join(target,'sources'),{recursive:true});
await cp(join(root,'build/sources/x264-b35605a.tar.gz'),join(target,'sources/x264-b35605a.tar.gz'));
await cp(join(root,'build/sources/x264-COPYING.txt'),join(target,'sources/x264-COPYING.txt'));
await cp(join(root,'build/media-runtime/ffmpeg-8.1.2.tar.xz'),join(target,'sources/ffmpeg-8.1.2.tar.xz'));
await cp(join(root,'scripts/packaging/build-media-runtime.py'),join(target,'sources/build-media-runtime.py'));
if(process.platform==='win32'){await cp(join(root,'docs/THIRD_PARTY_WINDOWS.md'),join(target,'THIRD_PARTY_WINDOWS.md'));await cp(join(root,'scripts/packaging/build-media-windows.sh'),join(target,'sources/build-media-windows.sh'));}
console.log('Desktop resources prepared without models or user data:',target);
