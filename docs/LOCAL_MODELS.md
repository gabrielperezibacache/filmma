# Filmma: modelos y generación local en Apple Silicon

Verificación de fuentes: **17 de octubre de 2026**. Equipo de desarrollo: MacBook Pro **Apple M4 Max, 36 GB**. No confundir el tamaño de los pesos en disco con la memoria necesaria para inferencia.

## Qué está integrado

| Motor | Identificador | Entrada real | Salida | Situación |
|---|---|---|---|---|
| MiniMax H3, motor nativo Metal `h3.c` | `minimax-h3` | Texto; primer/último fotograma; referencias ordenadas de imagen, video y audio con Ref2VA | MP4 con audio nativo, 24 fps | Motor compilado; pesos configurados en el SSD externo |
| LTX-Video 2B 0.9.8 distilled, MLX | `ltx-2b` | Texto o imagen inicial | MP4 sin audio nativo | Texto y generación desde imagen validados en este M4 Max |

**MiniMax H3 sí dispone de pesos abiertos.** El modelo oficial incluye H3-Base FL2VA y Ref2VA. Hailuo es una familia de productos: una suscripción web no instala los pesos ni sustituye al motor local. La licencia de H3 es la *MiniMax H3 Community License*, no MIT/Apache. El motor comunitario `h3.c` tiene licencia MIT; son componentes diferentes.

Fuentes primarias: [modelo oficial MiniMax H3](https://huggingface.co/MiniMaxAI/MiniMax-H3), [código y arquitectura oficiales](https://github.com/MiniMax-AI/MiniMax-H3), [motor Metal h3.c](https://github.com/antirez/h3.c), [LTX-Video oficial](https://huggingface.co/Lightricks/LTX-Video), [motor ltx-mlx](https://github.com/baisampayans/ltx-mlx).

## Presupuesto de disco y memoria

El manifiesto `runtime/model-catalog.json` fija las versiones, nombres, tamaños exactos y SHA-256 publicados para los pesos grandes. No se usa la rama `main` durante la descarga.

- H3 FL2VA completo: **144.051 GB decimales**, aproximadamente 134.2 GiB.
- Ref2VA añade **66.276 GB** para su transformador. Encoder, tokenizer, VAE y processor se comparten mediante enlaces en `runtime/model-views/` del disco interno (compatible con SSD exFAT) porque los subárboles oficiales son idénticos. Total base + referencias: aproximadamente **210.33 GB**, sin duplicar el encoder y los VAE.
- LTX 2B + T5 + tokenizer: **25.391 GB decimales**, aproximadamente 23.65 GiB. T5 se distribuye en FP32 y el motor lo carga a BF16.
- El instalador conserva **20 GiB libres** además de la descarga pendiente. Usa tres transferencias simultáneas como máximo, permite reanudar archivos `.part` y comprueba SHA-256 antes de instalar cada peso grande.

Al iniciar el trabajo había alrededor de 89 GiB libres. H3 FL2VA no cabía. La instalación admite un SSD externo; no cambia globalmente la configuración de memoria de macOS ni elimina archivos del usuario.

Para LTX, `runtime/ltx_memory.py` convierte cada fragmento FP32 de T5 a BF16 antes de cargar el siguiente y libera el anterior. Mantiene el mismo mapeo y valores BF16; evita conservar simultáneamente todo el juego FP32 y su copia BF16. El pico real se registra en cada toma, sin confundir esta optimización con una garantía de RAM máxima.

En 36 GB, Filmma serializa la generación: **una toma a la vez**. H3 usa `--ssd-streaming`, 50 bloques, `--reuse 1`, sin visor intermedio residente ni reescalado interno oculto. El motor mantiene dos bloques DiT y carga los siguientes desde SSD. El autor publica aproximadamente 2 GiB de almacenamiento DiT para algunos perfiles; **esa cifra no es la RAM total**: encoder, VAE, buffers, macOS y aplicaciones también requieren memoria. La evidencia publicada está medida en otros chips, por lo que no constituye un benchmark del M4 Max del usuario.

Perfil inicial: **512 × 320, 22 fotogramas H3 o 25 LTX, 24 fps**. Filmma limita en equipos de hasta 36 GB el área a 864 × 480 y la secuencia a 107 fotogramas; una película se construye como sucesión de tomas. No se garantiza que toda combinación dentro de esos límites evite presión de memoria. Los resultados y el tiempo real deben evaluarse en el equipo.

## Preparación reproducible

Requisitos: macOS Apple Silicon, Xcode Command Line Tools para H3, FFmpeg/FFprobe y Python 3.9 o superior para el gestor. LTX usa un entorno aislado Python 3.12 creado con [uv](https://docs.astral.sh/uv/getting-started/installation/).

```sh
python3 runtime/filmma_runtime.py doctor --json
./scripts/setup-local-model.sh --model minimax-h3
./scripts/setup-local-model.sh --model ltx-2b
```

Estos comandos instalan el código del motor, **no los pesos**. El gestor comprueba que el checkout está en la versión fijada. Si ya existe otra versión, se detiene y la conserva.

Planificar antes de descargar:

```sh
python3 runtime/filmma_runtime.py download-plan --model ltx-2b --json
python3 runtime/filmma_runtime.py download-plan --model minimax-h3 --model-dir '/Volumes/SSD Externo/Filmma/models/minimax-h3' --with-references --json
```

Revisar la licencia enlazada por el plan. Para iniciar o reanudar:

```sh
python3 runtime/filmma_runtime.py download --model ltx-2b --accept-license
python3 runtime/filmma_runtime.py download --model minimax-h3 --model-dir '/Volumes/SSD Externo/Filmma/models/minimax-h3' --with-references --accept-license
```

El volumen `SSD Externo` fue seleccionado por el usuario. Debe estar conectado y disponer de espacio; no se crea un volumen. Omitir `--with-references` descarga sólo FL2VA. Se puede añadir después. `runtime/local-config.json` recuerda la ruta y si se solicitaron referencias desde que se inicia la descarga, para que el diagnóstico muestre el total y progreso correctos. La presencia de una ruta configurada no significa que los pesos estén completos. Para enlazar pesos ya existentes:

```sh
python3 runtime/filmma_runtime.py configure --model minimax-h3 --model-dir '/Volumes/SSD Externo/Filmma/models/minimax-h3'
```

H3 espera `FL2VA/` dentro de esa carpeta, y `Ref2VA/` si se utilizan referencias. La estructura descargada por Filmma coincide con la del motor. No se descarga el repositorio oficial completo, que contiene copias adicionales de pesos.

Variables opcionales: `FILMMA_MODEL_ROOT`, `FILMMA_H3_MODEL_DIR`, `FILMMA_LTX_MODEL_DIR`, `FILMMA_H3_BIN`, `FILMMA_LTX_PYTHON`. `HF_TOKEN` sólo se utiliza en memoria para solicitudes de descarga, si fuera necesario; no se imprime ni se guarda.

## Contrato de generación

El servidor mantiene la cola. El worker procesa una solicitud por proceso y emite JSONL:

```sh
python3 runtime/filmma_runtime.py generate --request /ruta/solicitud.json
```

También acepta `--request -` para JSON por entrada estándar, o un objeto JSON como argumento. Ejemplo:

```json
{
  "model": "minimax-h3",
  "prompt": "Scene: a woman waits beside a vintage train. Action: she turns toward the platform. Camera: stable medium shot, 50 mm. Look: late afternoon, warm 35 mm texture. Audio: soft railway ambience, no music.",
  "inputImage": "/ruta/referencia.png",
  "outputPath": "/ruta/tomas/plano-01-toma-01.mp4",
  "width": 512,
  "height": 320,
  "numFrames": 56,
  "fps": 24,
  "seed": 42,
  "steps": 20
}
```

Campos opcionales: `lastFrame` y `references: [{"type":"image"|"video"|"silent-video"|"audio","path":"..."}]`. Referencias y fotogramas ancla son modos separados y no se mezclan. H3 admite hasta 9 imágenes, 3 videos y 3 audios, máximo 12 archivos; el motor valida además la duración de audio/video. Audio solo requiere también imagen o video. LTX 2B sólo admite una imagen inicial.

Los prompts nunca se interpolan en un shell. Se pasan como argumentos al motor. No existe ejecución arbitraria de comandos desde la solicitud. Las imágenes originales se leen y conservan; la generación escribe una nueva toma.

- Anchura y altura: múltiplos de 32. Filmma rechaza dimensiones inválidas en lugar de recortar silenciosamente.
- H3: 24 fps y `5 + 17n` fotogramas. Una petición de 23 produce 39, con advertencia y duración efectiva explícitas.
- LTX: 24 fps y `1 + 8n` fotogramas. Ambos adaptadores calculan el movimiento a 24 fps y rechazan otros valores; los cambios de velocidad se realizan en montaje. El contexto de texto se amplía dinámicamente desde 128 hasta 512 tokens T5 para conservar indicaciones de continuidad. Si el prompt excede 512 tokens se rechaza con un mensaje claro, sin truncarlo silenciosamente. El contador real queda en los metadatos.
- `negativePrompt` se conserva en los metadatos, pero estos adaptadores **no lo utilizan como condicionamiento negativo independiente**. Se emite una advertencia sobre esta diferencia. El editor incorpora las restricciones y la dirección de cámara como texto en el prompt principal; el CLI por sí solo conserva el campo negativo como metadato. Esto es seguimiento de instrucciones de texto, no un canal CFG negativo independiente.
- Filmma prepara las imágenes ancla H3 como copias PNG RGB8 temporales: escala proporcional dentro del lienzo y bandas negras si hace falta, sin recorte ni deformación. Así el ajuste por estiramiento/recorte del motor recibe ya la proporción correcta. El original no se modifica; las copias se eliminan al terminar o cancelar y `imagePreparation` registra el ajuste. Las referencias de identidad Ref2VA conservan el tratamiento proporcional propio del motor. LTX también conserva la proporción de su imagen inicial y añade un fondo difuminado cuando es necesario.
- H3 conserva audio nativo; LTX 2B no lo genera. La banda sonora se incorpora en montaje.
- Una ruta de salida existente se rechaza; cada toma se conserva por separado.

Eventos:

```json
{"type":"progress","stage":"loading","message":"Cargando modelo"}
{"type":"warning","message":"Ajuste temporal explícito"}
{"type":"result","outputPath":"/ruta/toma.mp4","metadata":{"local":true,"model":"ltx-2b","seed":42,"duration":1.042,"width":512,"height":320}}
{"type":"error","code":"MODEL_NOT_INSTALLED","message":"Faltan pesos del modelo"}
```

Sólo se emite `result` después de que el proceso termine con éxito y FFprobe confirme un video válido de la resolución solicitada. La salida se construye en un archivo temporal y se renombra al final; un fallo no se presenta como éxito. Se guarda un sidecar `.filmma.json` con solicitud, semilla, versión del modelo/motor, límites, duración y tiempo de ejecución. Cancelar termina también los procesos hijos de codificación y elimina sólo la salida temporal, nunca los originales.

`doctor` informa presencia de archivos y motor, y distingue preparación de inferencia comprobada. Sólo después de generar y validar un video registra `lastValidation`: revisión exacta de pesos y motor, equipo, parámetros, modo, tiempo, metadatos y disponibilidad del archivo. Una revisión diferente invalida esa evidencia. La calidad visual se revisa aparte mediante el video y sus fotogramas. `available: true` significa que el motor y los pesos base están preparados para ejecutar, no garantía de calidad ni identidad. Si Ref2VA aún se descarga, el estado puede seguir siendo `downloading` aunque la base ya esté disponible; `capabilities.referencesInstalled` indica cuándo se pueden usar referencias. `weights.withReferences` distingue el total base del total con Ref2VA.

## Personajes y continuidad

Filmma puede conservar ficha, vestuario, rasgos, objetos, referencias, semilla y prompt por toma. H3 Ref2VA aplica imágenes de identidad como referencias reales; requiere su transformador adicional. El orden de referencias es semántico (`Picture 1`, `Picture 2`, etc.). FL2VA puede anclar el comienzo y el final de una toma. Reutilizar semilla y referencias reduce variación, pero **no garantiza identidad perfecta entre planos**. Se debe revisar el resultado, elegir tomas y repetir cuando sea necesario.

El sistema oficial completo H3 separa **Context-IR**, **H3-Base** y **Regenerate-2K**. La documentación oficial describe Context-IR como servicio alojado no incluido en esta publicación. Filmma prepara prompts estructurados propios, eventualmente con ayuda de Codex, y ejecuta H3-Base localmente; no presenta ese trabajo como el Context-IR propietario ni promete la cadena oficial 2K. Tampoco copia el catálogo de modelos propietarios de Higgsfield.

## Verificación y límites

Motor H3 fijado en `8974cc055ea9c02fcd14cc27dfda3e1027c05153`. LTX MLX fijado en `0d884df6c5f086915e4ffdab950d914757c306f2`. Versiones de pesos en el manifiesto.

En este M4 Max se completó una generación **real desde texto** con los pesos completos LTX 2B: **512 × 320, 25 fotogramas a 24 fps, 4 pasos, semilla 20261017**, MP4 H.264 de **1.041667 s**. Tiempo total del worker: **13.82 s**; inferencia después de cargar: **5.5 s** (T5 1.3 s, DiT 2.1 s, VAE 1.8 s). Pico informado por el asignador MLX: **16,950,218,254 bytes, 15.79 GiB**. Esta medida no representa la RAM total de macOS ni una garantía para otros tamaños. No se usaron nube ni fotogramas simulados.

Evidencia local: `runtime/validation/ltx-2b-smoke.mp4`, su sidecar `.filmma.json`, `smoke-generation.jsonl`, `smoke-ffprobe.json`, `smoke-resource-usage.txt` y tres fotogramas extraídos. Se revisaron visualmente los fotogramas 0, 12 y 24: escena coherente de cámara vintage ante una ventana cálida, movimiento sutil y sin salida negra/ruido. La geometría del objeto es aproximada; esta prueba corta demuestra funcionamiento, no fidelidad industrial ni calidad cinematográfica final. El proceso terminó y liberó la GPU.

También se comprobó **imagen → video desde la API y la cola reales de Filmma**, trabajo `ef45b035-a4e2-44c0-b354-cbf74fd03d80`, estado `completed`. La escena «La marquesina» produjo `data/media/ba25c894-bc90-4c00-b03d-108f43caf009.mp4`: **512 × 288, 73 fotogramas a 24 fps, 3.041667 s, 4 pasos, semilla 20261018**, H.264 sin audio nativo. Tiempo del worker: **13.37 s**. Pico MLX: **18,680,189,248 bytes, 17.40 GiB**. El prompt final, incluyendo cámara, continuidad de Elena y restricciones, utilizó **411 tokens T5 y un contexto de 416**, sin truncarse. La aplicación incorporó el recurso al proyecto y al primer plano.

La comprobación SHA-256 confirmó que `public/demo/scene-01.png` permaneció idéntica. `runtime/validation/image-api-validation.json` conserva trabajo, sidecar, FFprobe y hashes; `image-frame-01.png`, `image-frame-02.png` e `image-frame-03.png` muestran los fotogramas 0, 36 y 72. La revisión visual confirmó movimiento real y continuidad general del cine, iluminación y vestuario. **La mujer se mueve más de lo pedido, el rostro pierde detalle y la lata cambia de geometría hacia el final.** Es un borrador útil, no una toma final ni una garantía de identidad. Una imagen ancla condiciona al modelo; el VAE la reconstruye y no promete copiar sus píxeles literalmente.

Estas dos pruebas corresponden a LTX. **MiniMax H3 todavía no tiene una inferencia completa comprobada en este equipo**: la descarga del perfil con referencias continúa en el SSD externo. El resultado LTX no acredita el comportamiento ni el rendimiento de H3.

Además, en este M4 Max:

- H3 compiló correctamente con Clang/Metal.
- Suite nativa: **1768 comprobaciones host correctas**.
- Primitivas AudioVAE Metal comparadas con CPU: correctas; mayor error absoluto informado 1.192093e-07.
- FFmpeg creó y multiplexó un MP4 con audio mediante tuberías concurrentes.
- Se omitieron las pruebas que requieren pesos reales y fixtures no instalados. Esas omisiones no son inferencia validada.
- La prueba de paridad MLX con un T5 pequeño verifica igualdad exacta de todos los pesos y salidas entre el cargador original y el cargador por fragmentos, con contextos de 128, 256 y 512 tokens. Es una prueba numérica del cargador; no reemplaza una prueba de calidad del modelo completo.
- Los tests de Filmma verifican contratos, formas temporales, referencias incompatibles, conservación de salidas, ausencia de ejecución shell, presupuestos de descarga, errores y ausencia de resultados simulados. Una prueba real FFmpeg verifica que una imagen 2:1 se prepara sobre un lienzo cuadrado sin deformación, con bandas exactas y hash del original intacto.

```sh
python3 -m unittest discover -s runtime/tests -v
runtime/.venv/bin/python -m unittest discover -s runtime/tests -p test_mlx_loading.py -v
make -C runtime/vendor/h3 test
```

En entornos aislados que impiden consultar `sysctl` o utilizar Metal, el diagnóstico puede resultar parcial; la aplicación local debe ejecutarse con acceso normal a la GPU. No se desactiva ningún mecanismo de seguridad del equipo.

### Perfiles del editor

Borrador usa lienzos 512 × 288 para 16:9, 288 × 512 para 9:16 y 512 × 512 para cuadrado, con 4 pasos en ambos motores. En H3 es una aproximación rápida de menor detalle; el perfil Detalle usa 20 pasos. LTX distilled conserva 4 pasos. H3 mantiene siempre 50 bloques, reuse 1 y transmisión desde SSD; el tiempo real en el SSD externo queda pendiente del ensayo completo. Las anclas inicial y final se preparan en PNG temporales con ajuste proporcional y bandas negras, conservando íntegros los originales.


### Duración máxima y mejora de las tomas

Ningún clip generado puede superar **15 segundos**, incluidos los ajustes temporales del motor y la duración del MP4 final. La API rechaza solicitudes superiores antes de encolar y comprueba la salida antes de incorporarla. El runtime también rechaza un `numFrames` que exceda ese límite tras ajustarlo a la forma temporal del modelo. A 24 fps, los máximos válidos son **345 fotogramas para H3 (14.375 s)** y **353 para LTX (14.708 s)**. El editor redondea hacia abajo al número de fotogramas compatible para no exceder la duración solicitada. El perfil conservador de este Mac de 36 GB sigue ofreciendo tomas de 1–4 segundos y el motor mantiene su presupuesto de 107 fotogramas; el límite global de 15 segundos no elimina la protección de memoria. La duración de montaje y los archivos importados pueden ser mayores: se elige una toma breve explícita para un plano largo, o se divide el plano.

La mejora de imagen usa **FFmpeg en CPU**: reducción suave de ruido `hqdn3d`, enfoque moderado `unsharp` y, al ampliar, Lanczos hasta 2× con techo 4K. No es reconstrucción generativa ni el Regenerate-2K oficial de H3, y no recupera detalles auténticos ausentes. No descarga modelos adicionales ni ocupa la GPU de inferencia. Cada operación crea una copia nueva con referencia al original, que se aplica al plano por elección del usuario.

Se admiten videos SDR de dimensiones pares, hasta 2 minutos, 60 fps, 4K y 2 GiB; máximo ocho pistas de audio y ocho canales por pista. La proporción se conserva sin recorte. Se copian las pistas de audio cuando su códec es compatible con MP4; otros códecs se convierten a AAC. Antes de entregar la copia se verifican dimensiones, proporción, duración, fotogramas, fps, número de pistas, canales y tiempos de audio. Dos hilos de CPU, una reserva de 1 GiB y un límite de 20 minutos acotan la operación. Cancelar conserva el original y elimina la copia incompleta.

Comprobación local sobre la toma LTX ya existente: **512 × 288 → 1024 × 576**, **73 fotogramas**, **24 fps**, **3.041667 s**, sin audio nativo, **1.42 s** de procesamiento. El SHA-256 del original permaneció idéntico. Evidencia: `output/qa/quality-ltx-upscale.json` y `output/qa/quality-ltx-upscaled.mp4`. Es una verificación de conservación y procesamiento, no una medición de calidad perceptual ni una nueva inferencia.

## Actualización: perfiles nativos y ensayo HD largo

Los apartados anteriores conservan el historial de preparación. El diagnóstico actual incorpora `validationHistory`, además de `lastValidation`: mantiene evidencia por perfil, resolución, fotogramas, fps, pasos y modo, filtrada por las revisiones instaladas. Una prueba corta no verifica una toma larga ni otra resolución. Los originales y registros anteriores permanecen disponibles aunque cambie el último resultado.

`h3-native-ssd` conserva un presupuesto de **35.000 tokens visuales**: admite, por ejemplo, 768 × 448 con 345 fotogramas, 1024 × 576 con 192 y 1280 × 736 con 124. Los tokens se calculan después de alinear los fotogramas H3 mediante `t = 2 + 5 × ((fotogramas − 5) / 17)` y `tokens = t × (ancho / 32) × (alto / 32)`. Una combinación incompatible se rechaza; no se reduce su duración o resolución silenciosamente.

El perfil separado **`h3-hd-ssd` es experimental**. Admite exclusivamente **1280 × 736 o 736 × 1280**, hasta **345 fotogramas a 24 fps: 14,375 segundos continuos**, 93.840 tokens visuales y entre 2 y 20 pasos, desde texto. No acepta anclas ni referencias visuales. El límite de 35.000 del perfil nativo anterior permanece intacto. El motor requiere dimensiones divisibles por 32: el original tiene 736 filas, y una entrega 1280 × 720 debe conservar el encuadre completo mediante ajuste proporcional y bandas, sin recortar ni estirar.

Todos los perfiles supervisados mantienen los mismos umbrales: 24 GiB de memoria física atribuida al motor, 28 GiB de RSS, crecimiento máximo de 2 GiB de intercambio, presión de memoria normal y reserva de 20 GiB en los discos del modelo y de salida. Estas mediciones muestreadas no abarcan toda la memoria unificada ni garantizan calidad o finalización. No se cambian pesos, precisión, resolución interna, bloques de inferencia ni reutilización para hacer pasar el ensayo.

**El tiempo máximo es explícito y no produce reintentos.** Los perfiles anteriores conservan su límite de seis horas en la API; no reciben una nueva ampliación del tiempo en el runtime. Para `h3-hd-ssd`, el watchdog cuenta doce horas con un reloj monotónico desde el arranque de H3. Al agotarse emite `GENERATION_TIMEOUT`, envía TERM al grupo del motor, espera cinco segundos y, si sigue activo, envía KILL y recoge su terminación. La API permite doce horas y treinta segundos para recibir el diagnóstico y concede al worker hasta doce segundos de limpieza antes de forzar su cierre; el margen no amplía las doce horas de inferencia. Esta supervisión interna también funciona al ejecutar el runtime fuera de la API.

Los tests del plazo utilizan procesos que sólo esperan, incluido uno que ignora TERM; comprueban cierre forzado, registro del motivo y ausencia del grupo hijo tras la limpieza. Las pruebas de API usan clips sintéticos para comprobar reloj, dimensiones, procedencia y conservación. **Ninguna de esas pruebas acredita una inferencia HD larga real**: su éxito requiere verificar el video completo y revisar su calidad visual. Si alcanza el límite o falla, se conserva el diagnóstico; nunca se completan segundos repitiendo, congelando o ralentizando fotogramas.
