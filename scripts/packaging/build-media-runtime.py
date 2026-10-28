"""Build portable FFmpeg/FFprobe for the Mac installer; no machine-wide install."""
from pathlib import Path
import hashlib,json,os,shutil,subprocess
ROOT=Path(__file__).resolve().parents[2]
WORK=Path(os.environ.get('FILMMA_MEDIA_BUILD','/private/tmp/filmma-media-runtime-arm64'));PREFIX=WORK/'prefix'
VERSION='8.1.2'
WORK.mkdir(parents=True,exist_ok=True)
archive=WORK/f'ffmpeg-{VERSION}.tar.xz'
cached=ROOT/'build/media-runtime'/archive.name
if not archive.exists() and cached.exists():shutil.copyfile(cached,archive)
if not archive.exists():
 # macOS runners can reset Python/OpenSSL TLS before the HTTP request. Use
 # system curl with bounded retries, HTTPS-only redirects and an atomic file.
 # The pinned source receipt below remains mandatory before tar or make.
 partial=archive.with_name(archive.name+'.part')
 for host in ('ffmpeg.org','www.ffmpeg.org'):
  result=subprocess.run(['curl','--fail','--location','--silent','--show-error','--proto','=https','--proto-redir','=https','--retry','3','--retry-all-errors','--connect-timeout','20','--max-time','90','--retry-max-time','120','--output',str(partial),f'https://{host}/releases/ffmpeg-{VERSION}.tar.xz'],timeout=240)
  if result.returncode==0:
   partial.replace(archive)
   break
 else:raise RuntimeError('FFmpeg source download failed from both official HTTPS hosts; no source was extracted.')
digest=hashlib.sha256(archive.read_bytes()).hexdigest()
receipt=ROOT/'desktop/media-runtime.json'
if receipt.exists():assert json.loads(receipt.read_text())['sourceSha256']==digest
else:receipt.write_text(json.dumps({'version':VERSION,'sourceUrl':f'https://ffmpeg.org/releases/ffmpeg-{VERSION}.tar.xz','sourceSha256':digest,'license':'GPL-2.0-or-later with libx264','architecture':'arm64'},indent=2)+'\n')
source=WORK/f'ffmpeg-{VERSION}'
if not source.exists():subprocess.run(['tar','-xf',str(archive),'-C',str(WORK)],check=True)
codec=WORK/'x264-static'
for directory in ('lib/pkgconfig','include'):(codec/directory).mkdir(parents=True,exist_ok=True)
x264=Path(subprocess.check_output(['brew','--prefix','x264'],text=True).strip())
for name in ('x264.h','x264_config.h'):shutil.copyfile(x264/'include'/name,codec/'include'/name)
shutil.copyfile(x264/'lib/libx264.a',codec/'lib/libx264.a')
version=subprocess.check_output(['pkg-config','--modversion','x264'],text=True).strip()
assert version.endswith('.3222'), 'The published source receipt requires x264 r3222 (b35605a); pin this dependency before building.'
(codec/'lib/pkgconfig/x264.pc').write_text(f'prefix={codec}\nlibdir=${{prefix}}/lib\nincludedir=${{prefix}}/include\nName: x264\nDescription: static x264\nVersion: {version}\nLibs: -L${{libdir}} -lx264 -lm -lpthread\nCflags: -I${{includedir}}\n')
environment={**os.environ,'PKG_CONFIG_PATH':str(codec/'lib/pkgconfig')}
if not (source/'ffbuild/config.mak').exists():
 subprocess.run(['./configure',f'--prefix={PREFIX}','--disable-shared','--enable-static','--disable-autodetect','--enable-gpl','--enable-libx264','--enable-zlib','--enable-iconv','--disable-doc','--disable-debug','--extra-libs=-liconv'],cwd=source,env=environment,check=True)
subprocess.run(['make','-j8','EXTRALIBS=-liconv -lm -lpthread'],cwd=source,env=environment,check=True)
subprocess.run(['make','install'],cwd=source,env=environment,check=True)
for name in ('ffmpeg','ffprobe'):
 binary=PREFIX/'bin'/name
 dependencies=subprocess.check_output(['otool','-L',str(binary)],text=True)
 assert '/opt/homebrew/' not in dependencies and '/Users/' not in '\n'.join(dependencies.splitlines()[1:]),dependencies
 subprocess.run([str(binary),'-version'],check=True)
print('Portable media runtime verified:',PREFIX/'bin',flush=True)

destination=ROOT/'build/media-runtime/bin'
destination.mkdir(parents=True,exist_ok=True)
for name in ('ffmpeg','ffprobe'):shutil.copy2(PREFIX/'bin'/name,destination/name)

source_archive=ROOT/'build/media-runtime'/archive.name
source_archive.parent.mkdir(parents=True,exist_ok=True)
if source_archive.resolve()!=archive.resolve():shutil.copy2(archive,source_archive)
