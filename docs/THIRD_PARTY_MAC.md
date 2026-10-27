# Componentes del instalador de macOS

Filmma incluye Electron (MIT), el runtime Node.js de Electron (MIT y avisos de sus dependencias), GitHub CLI (MIT), uv (MIT/Apache-2.0) y dependencias JavaScript con sus licencias incluidas en node_modules.

FFmpeg 8.1.2 se compila con libx264 y se distribuye bajo GPL-2.0-or-later. Los pesos de IA no están incluidos en el instalador; cada modelo conserva su licencia y origen, accesibles en el gestor.

- FFmpeg: https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz
- Código y licencia de x264: https://code.videolan.org/videolan/x264
- Receta de compilación reproducible: scripts/packaging/build-media-runtime.py
- Huella del archivo fuente: desktop/media-runtime.json
- GitHub CLI: https://github.com/cli/cli
- uv: https://github.com/astral-sh/uv
- Electron: https://github.com/electron/electron

El paquete conserva los avisos de Electron y de las bibliotecas. Las fuentes exactas y las licencias de FFmpeg/x264 acompañan la versión publicada; la receta no requiere instalar Filmma ni modifica modelos o proyectos.
