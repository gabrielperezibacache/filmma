# Runtime de Windows

El instalador x64 incorpora Electron (MIT), Node.js (licencias incluidas en su distribución), Python portable de python-build-standalone (licencias en python/), uv (MIT/Apache-2.0) y GitHub CLI (MIT). Las dependencias npm conservan sus avisos de licencia.

FFmpeg 8.1.2 se compila con libx264 r3222, commit `b35605ace3ddf7c1a5d67a2eb553f034aef41d55`. Esta combinación es GPL-2.0-or-later. El instalador incluye los archivos fuente correspondientes de FFmpeg y x264, COPYING de x264 y el script completo de compilación en `resources/sources/`. FFmpeg se ejecuta como proceso independiente. No se incluye ninguna biblioteca de codec dentro del código de Filmma.

La fuente de FFmpeg se verifica con SHA256 `464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c`. El script fija el commit de x264 y rechaza dependencias de DLL ajenas a Windows. La receta está en `scripts/packaging/build-media-windows.sh`, usando MSYS2 UCRT64, GCC, NASM, make y pkg-config.

Los modelos, CUDA, controladores NVIDIA, ComfyUI y Diffusers no se redistribuyen dentro del instalador. Tienen sus propias licencias y requisitos. Filmma no instala controladores ni modifica la configuración del sistema. El instalador no tiene firma Authenticode: Windows puede mostrar una advertencia de editor desconocido. No se desactiva SmartScreen.
