# Sincronización labial local

Filmma integra MuseTalk 1.5 mediante un adaptador propio para Apple Silicon. El motor neural es la conversión MLX de `xocialize/musetalk-mlx`; no es la distribución oficial de Tencent y se valida de forma independiente. La preparación descarga aproximadamente 1,88 GB de pesos en `runtime/lipsync/models/`, instala un entorno separado y verifica SHA256. No instala CUDA, PyTorch ni componentes de entrenamiento, ni cambia el entorno de MiniMax.

## Modelos y fuentes verificadas

- [MuseTalk, Tencent Music Lyra Lab](https://github.com/TMElyralab/MuseTalk): modelo de inpainting labial con región facial de 256 × 256, recomendado a 25 fps. Su documentación reconoce posibles cambios de detalles faciales y jitter. No garantiza identidad perfecta ni detalle facial 4K nativo.
- [Licencia del upstream](https://github.com/TMElyralab/MuseTalk/blob/main/LICENSE): MIT; el documento enumera también las licencias de los componentes. Se descarta el [checkpoint estándar de Wav2Lip](https://github.com/Rudrabha/Wav2Lip), restringido a investigación/no comercial, para este flujo que incluye publicidad.
- [Adaptación MLX](https://github.com/xocialize/musetalk-mlx/tree/c6eb30ebd1ed4d043983209813370153de9346bf), commit `c6eb30ebd1ed4d043983209813370153de9346bf`, MIT. Filmma utiliza sólo el núcleo neural; detección, seguimiento, mezcla, validación y gestión de archivos son propios.
- [Pesos MLX fp16](https://huggingface.co/mlx-community/MuseTalk-1.5-fp16/tree/ad54104a0129121fe2ea67471250c0656c985284), revisión `ad54104a0129121fe2ea67471250c0656c985284`. La conversión procede de MuseTalk 1.5, `sd-vae-ft-mse` y Whisper tiny. Se conserva el paquete y se incluye la licencia del upstream en `runtime/lipsync/UPSTREAM-LICENSE.txt`; el port declara MIT en sus metadatos y README, pero no incluye un archivo LICENSE propio.

| Archivo | Bytes | SHA256 |
| --- | ---: | --- |
| unet.safetensors | 1699979043 | 12d1e2f496bc91e4db8c989cffa8aa94b3d6a7098ab9d80ba92a1f38cce362f2 |
| vae.safetensors | 167335279 | 2a7670782dbe0ab66c40833dfd431b193375f0bdfc7c2daf76f5bc4e59070f98 |
| whisper_encoder.safetensors | 16423174 | c04baf7220bbc73393eeba74b6224398ce56caad60e4e0a0f4c28af3180836d3 |
| config.json | 186 | 527702bfd2111adab8b4713d4f70d920a479b5816cbb373731e791f6e3bd47d5 |

## Interfaz del proceso

```sh
python3 runtime/filmma_lipsync.py doctor --json
python3 runtime/filmma_lipsync.py setup --json
python3 runtime/filmma_lipsync.py render --request /ruta/solicitud.json --json
```

`doctor` es ligero, no carga el modelo ni ejecuta inferencia. Revisa plataforma, entorno, herramientas y el registro SHA256 vinculado al tamaño y la modificación de cada archivo. `render` repite la verificación SHA256 completa antes de inferir. La preparación y la inferencia tienen bloqueos independientes; el servidor debe mantenerlas en sus colas y respetar la exclusión de GPU con los demás motores.

`setup` y `render` emiten eventos JSONL de progreso y un resultado JSON final. El código de salida no cero y `ok:false` indican fallo. No se debe presentar la mera instalación como una sincronización lograda.

```json
{
  "sourcePath": "/ruta/original.mp4",
  "audioPath": "/ruta/dialogo.wav",
  "outputPath": "/ruta/nueva-toma.mp4",
  "trimStart": 0,
  "speed": 1,
  "duration": 3,
  "faceROI": {"x": 0.2, "y": 0.1, "width": 0.4, "height": 0.6}
}
```

`trimStart`, `speed`, `duration` y `faceROI` son opcionales. El recorte y la velocidad se hornean en la copia. La duración, si se omite, cubre el audio redondeando al siguiente fotograma; si se especifica, debe cubrirlo. Se añade silencio al final cuando corresponde y nunca se corta el diálogo para que quepa. No se congela ni repite una fuente demasiado corta. La salida nunca supera 15 segundos, conserva dimensiones y encuadre, y usa 25 fps. Las dimensiones deben ser pares, con lado mayor de hasta 4096 píxeles y área máxima equivalente a 4096 × 2160. También admite UHD vertical y cuadrado. Requiere SDR de 8 bits y píxeles cuadrados; HDR, rotación declarada sólo por metadatos o material anamórfico necesita una conversión explícita previa conservando el original.

La ROI usa coordenadas normalizadas desde la esquina superior izquierda. Delimita dónde buscar al personaje; no permite inventar un rostro cuando Vision no lo reconoce. Se detectan todos los fotogramas con Apple Vision en CPU. Cero rostros, múltiples candidatos, labios ocultos, rostro menor de 80 píxeles o cambios bruscos de posición provocan un error accionable. La continuidad por posición evita saltos evidentes pero **no verifica identidad biométrica** ni descubre todos los cambios de actor; hace falta revisión visual.

## Originales, calidad y memoria

La salida debe ser nueva y distinta de ambos originales. Se comprueban sus hashes antes y después. Se genera un MP4 con vídeo H.264, audio AAC y un informe `.lipsync.json`; la publicación final no sobrescribe archivos existentes. Los temporales propios se eliminan al terminar. Las descargas interrumpidas conservan sus parciales.

MuseTalk sólo reconstruye un recorte facial de 256 × 256. Filmma mezcla una zona inferior con borde suave; los píxeles de vestuario, cabello, fondo y otros actores se conservan antes de la compresión del MP4. El vídeo final se recodifica, por lo que no es idéntico píxel por píxel al original. El flujo recomendado es sincronizar, revisar identidad y labios, y después aplicar el reescalado de la copia elegida. El reescalado no convierte el resultado en detalle facial 4K nativo ni garantiza recuperar detalles perdidos.

Se procesa un fotograma cada vez, con límite de memoria MLX de 12 GiB y caché de 512 MiB para el M4 Max de 36 GB. `mlxPeakMemoryBytes` registra asignaciones MLX; `peakMemoryBytes` registra `ru_maxrss` del proceso Python de macOS y excluye FFmpeg/Vision. Ninguno representa toda la memoria unificada o presión global del sistema.

## Validación

Las pruebas unitarias cubren no sobrescritura, no truncamiento de voz, cobertura real del vídeo tras recorte/velocidad, límite de 15 segundos, ROI, ausencia/multiplicidad de rostros, cambios de plano y caducidad del registro de integridad. Las pruebas reales deben registrar fuente, salida, fotogramas, audio, duración, tiempo y medición de memoria, y revisar visualmente el rostro. El fixture público `data/video/yongen.mp4` y su audio de MuseTalk se usa sólo como material de prueba técnica, no se incorpora a la película del usuario ni se presenta como producción propia.

### Prueba real en el M4 Max de 36 GB — 17 de octubre de 2026

Instalación y pesos SHA256 completos, sin usar el entorno de MiniMax. Una inferencia MLX real produjo `runtime/lipsync/validation/validation.mp4` a partir del primer segundo del fixture público no comercial:

| Comprobación | Resultado |
| --- | --- |
| Vídeo | H.264, 704 × 1216, 25 fps, 25 fotogramas decodificados |
| Duración | 1,000 s de vídeo y audio AAC |
| Tiempo del render | 49,326 s; excluye el hash del lanzador y sus importaciones iniciales |
| Pico MLX | 4.331.845.712 bytes, aprox. 4,03 GiB |
| Pico RSS Python | 2.368.110.592 bytes, aprox. 2,21 GiB; excluye procesos auxiliares |
| Originales | SHA256 de vídeo, audio fuente y segmento de prueba sin cambios |
| Pruebas automáticas del adaptador | 17 aprobadas |

`validation.lipsync.json` guarda revisiones, regiones de rostro y métricas. `comparison.png` compara original/copia en los mismos instantes (0,32; 0,64; 0,88 s). La inspección muestra cambios localizados en labios y un suavizado visible de la boca. No se considera una garantía de calidad cinematográfica ni de identidad exacta.

La diferencia RGB media frente al original fue 9,206/255 dentro de la máscara y 2,409/255 fuera, sobre los 25 fotogramas. La diferencia exterior incluye conversión RGB/YUV y compresión. El vídeo intermedio normalizado reproduce el primer fotograma original con diferencia media 0. Estos números miden localización del cambio, **no precisión fonética ni semejanza de identidad**. No se calculó SyncNet. La muestra, las comparaciones y los resultados quedan excluidos de los archivos distribuidos de la aplicación.
