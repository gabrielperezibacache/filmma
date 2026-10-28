#!/usr/bin/env bash
set -euo pipefail
# Run inside MSYS2 UCRT64. Static FFmpeg and x264: no DLL search-path dependency.
ROOT="$(pwd)"
WORK="$ROOT/build/media-windows"
mkdir -p "$WORK" "$ROOT/build/sources" "$ROOT/build/media-runtime/bin"
curl --fail --location --retry 3 --proto '=https' --proto-redir '=https' \
  https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz -o "$WORK/ffmpeg-8.1.2.tar.xz"
echo '464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c  '"$WORK/ffmpeg-8.1.2.tar.xz" | sha256sum -c -
tar -xf "$WORK/ffmpeg-8.1.2.tar.xz" -C "$WORK"
git clone --filter=blob:none https://code.videolan.org/videolan/x264.git "$WORK/x264"
git -C "$WORK/x264" checkout --detach b35605ace3ddf7c1a5d67a2eb553f034aef41d55
git -C "$WORK/x264" archive --format=tar.gz --output="$ROOT/build/sources/x264-b35605a.tar.gz" HEAD
cp "$WORK/x264/COPYING" "$ROOT/build/sources/x264-COPYING.txt"
cd "$WORK/x264"
./configure --prefix="$WORK/prefix" --enable-static --disable-cli --disable-opencl --enable-strip --extra-ldflags='-static'
make -j4
make install
cd "$WORK/ffmpeg-8.1.2"
PKG_CONFIG_PATH="$WORK/prefix/lib/pkgconfig" ./configure --prefix="$WORK/ffmpeg-prefix" \
  --disable-shared --enable-static --disable-autodetect --enable-gpl --enable-libx264 \
  --disable-doc --disable-debug --disable-ffplay --extra-cflags="-I$WORK/prefix/include" \
  --extra-ldflags="-L$WORK/prefix/lib -static" --pkg-config-flags=--static
make -j4
make install
cp "$WORK/ffmpeg-prefix/bin/ffmpeg.exe" "$WORK/ffmpeg-prefix/bin/ffprobe.exe" "$ROOT/build/media-runtime/bin/"
cp "$WORK/ffmpeg-8.1.2.tar.xz" "$ROOT/build/media-runtime/"
"$ROOT/build/media-runtime/bin/ffmpeg.exe" -version
"$ROOT/build/media-runtime/bin/ffprobe.exe" -version
# Reject non-system DLLs so it really runs outside the MSYS2 build shell.
for bin in ffmpeg ffprobe; do
  objdump -p "$ROOT/build/media-runtime/bin/$bin.exe" | sed -n 's/.*DLL Name: //p' | tee "$WORK/$bin-dlls.txt"
  if grep -Eiq 'msys|libgcc|libstdc|libwinpthread|libx264|libiconv' "$WORK/$bin-dlls.txt"; then
    echo 'Unexpected runtime DLL dependency' >&2; exit 1
  fi
done
