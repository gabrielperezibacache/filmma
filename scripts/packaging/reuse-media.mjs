// Reuse only our own checksum-verified release, with the same source receipt.
// This avoids rebuilding identical codecs for every application-only change.
import{execFileSync}from'node:child_process';import{mkdir,readFile,writeFile,appendFile}from'node:fs/promises';import{join,resolve}from'node:path';import{createHash}from'node:crypto';
try{
 const release=JSON.parse(execFileSync('gh',['api','repos/gabrielperezibacache/filmma/releases/latest'],{encoding:'utf8'}));
 const pattern=process.platform==='win32'?/^Filmma-[0-9][a-zA-Z0-9.+-]*-win-x64\.zip$/:/^Filmma-[0-9][a-zA-Z0-9.+-]*-arm64\.zip$/;
 const asset=release.assets.find(a=>pattern.test(a.name));if(!asset)throw Error('No matching published platform');
 const directory=resolve('build/reused-media');await mkdir(directory,{recursive:true});
 execFileSync('gh',['release','download',release.tag_name,'--repo','gabrielperezibacache/filmma','--pattern',asset.name,'--pattern','SHA256SUMS.txt','--dir',directory,'--clobber'],{stdio:'inherit'});
 const archive=join(directory,asset.name),checksums=await readFile(join(directory,'SHA256SUMS.txt'),'utf8');
 const expected=checksums.split(/\r?\n/).find(l=>l.endsWith('  '+asset.name))?.split(/\s+/)[0];
 if(!expected||createHash('sha256').update(await readFile(archive)).digest('hex')!==expected)throw Error('Release ZIP checksum mismatch');
 const prefix=process.platform==='win32'?'resources/':'Filmma.app/Contents/Resources/';
 const extract=name=>execFileSync(process.platform==='win32'?'tar.exe':'unzip',process.platform==='win32'?['-xOf',archive,prefix+name]:['-p',archive,prefix+name],{maxBuffer:512*1024**2});
 const receipt=JSON.parse(extract('engine/desktop/media-runtime.json').toString()),current=JSON.parse(await readFile('desktop/media-runtime.json','utf8'));
 if(receipt.version!==current.version||receipt.sourceSha256!==current.sourceSha256)throw Error('Codec source revision changed');
 const ffmpegSource=extract('sources/ffmpeg-8.1.2.tar.xz');if(createHash('sha256').update(ffmpegSource).digest('hex')!==current.sourceSha256)throw Error('Source receipt mismatch');
 await mkdir('build/media-runtime/bin',{recursive:true});await mkdir('build/sources',{recursive:true});
 for(const base of ['ffmpeg','ffprobe']){const name=base+(process.platform==='win32'?'.exe':'');await writeFile('build/media-runtime/bin/'+name,extract('bin/'+name),{mode:0o755});}
 await writeFile('build/media-runtime/ffmpeg-8.1.2.tar.xz',ffmpegSource);
 for(const name of ['x264-b35605a.tar.gz','x264-COPYING.txt'])await writeFile('build/sources/'+name,extract('sources/'+name));
 execFileSync(resolve('build/media-runtime/bin/ffmpeg'+(process.platform==='win32'?'.exe':'')),['-version'],{stdio:'inherit'});
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'reused=true\n');
 console.log('Verified media runtime reused from',release.tag_name);
}catch(error){console.log('Building codecs from pinned sources:',error.message)}
