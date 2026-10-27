# Filmma · API local

El servidor escucha únicamente en `127.0.0.1:4318`. Conserva guion, planos, personajes, objetos, referencias originales y trabajos en la carpeta `data/`. No necesita una base de datos ni una cuenta de Filmma.

## Arranque

`npm run dev` inicia el editor y la API. `npm run build` prepara el editor para producción; después `npm start` sirve ambos desde el puerto 4318.

Variables opcionales:

| Variable | Uso |
| --- | --- |
| `FILMMA_PORT` | Puerto del servidor; por defecto 4318. |
| `FILMMA_DATA_DIR` | Carpeta de proyectos, originales, exportaciones y trabajos. |
| `FILMMA_PYTHON` | Python que ejecuta el controlador del motor local; no sustituye el entorno MLX aislado. |

Las mutaciones deben incluir `X-Filmma-Client: filmma`. El navegador sólo puede llamar desde `http://localhost` o `http://127.0.0.1` en los puertos 4317, 4318 y 5173. Las peticiones con un Host externo se rechazan para reducir ataques de DNS rebinding. Los procesos de generación, FFmpeg y Codex se ejecutan con argumentos separados, sin un intérprete de comandos.

## Datos y conservación

- `data/project.json`: proyecto activo, escrito mediante archivo temporal y renombrado atómico.
- `data/jobs.json`: últimos 300 trabajos. Al reiniciar, los trabajos interrumpidos pasan a fallidos con un mensaje explícito; no se reanudan generaciones ni cargos por sorpresa.
- `data/media/`: archivos originales y tomas generadas. Las importaciones preservan los bytes originales y reciben un nombre aleatorio independiente del nombre suministrado por el usuario.
- `data/exports/`: películas MP4 y respaldos `.filmma.zip` terminados.
- `data/projects/`: copia del proyecto anterior cuando se crea un proyecto con otro identificador. Los originales permanecen en `data/media/`.
- `data/work/`: archivos temporales privados de generación y montaje; se limpian al terminar o cancelar el trabajo.

Los respaldos contienen un manifiesto JSON documentado y los originales, con rutas relativas. Se pueden importar como un proyecto nuevo, conservando el proyecto abierto y reasignando identificadores para evitar colisiones. Los ZIP usan ZIP32 y admiten hasta 4 GB en total; para proyectos mayores se conserva la carpeta `data/` como respaldo completo. La importación comprueba rutas, tamaño descomprimido, CRC y referencias antes de reemplazar el proyecto activo; no acepta enlaces ni rutas externas.

## Rutas

| Método | Ruta | Resultado |
| --- | --- | --- |
| GET | `/api/bootstrap` | `{project,jobs,system}` |
| GET | `/api/system` | Hardware, disponibilidad de FFmpeg, sesión Codex CLI y diagnóstico del motor. |
| PUT | `/api/project` | Valida y guarda el proyecto; devuelve `{project}`. |
| GET | `/api/projects` | `{projects}` con proyecto activo y último respaldo válido por identificador. |
| POST | `/api/projects/:id/open` | Conserva el proyecto actual y abre un respaldo validado; devuelve `{project}`. |
| POST | `/api/projects/import` | Importa un ZIP Filmma validado como proyecto nuevo (multipart, campo `projectFile`); devuelve 201 `{project,importedAsNew:true}`. |
| GET | `/api/project/edl` | Exporta la secuencia como EDL para continuar el montaje en otro editor. |
| GET | `/api/project/subtitles` | Exporta los cues editados como SRT; sin lista explícita conserva el diálogo legacy temporizado por plano. |
| POST | `/api/assets` | Formulario multipart, campo `files`, hasta 12 archivos de 512 MB cada uno; devuelve `{assets}`. |
| GET | `/api/media/:filename` | Recurso local; soporta el streaming del navegador. |
| GET | `/api/jobs` | `{jobs}` |
| POST | `/api/jobs/:id/cancel` | Cancela un trabajo en cola o detiene su grupo de procesos. |
| POST | `/api/generate` | Generación real con un modelo local; devuelve `{job}`. |
| POST | `/api/generate-sequence` | Valida y encola una secuencia completa; devuelve `{jobs,total,skipped}`. |
| POST | `/api/codex` | Propuesta de texto de Codex; devuelve `{job}`. |
| POST | `/api/export` | `format: mp4` o `project`; devuelve `{job}`. |
| GET | `/api/downloads/:filename` | Descarga de una exportación terminada. |
| GET | `/api/runtime/plan?model=…` | Tamaño exacto de descarga, espacio libre, licencia y destino. |
| POST | `/api/runtime/install` | Instala el motor del modelo, sin descargar automáticamente sus pesos. |
| POST | `/api/runtime/download` | Descarga y verifica pesos tras confirmación explícita de tamaño/licencia. |

Los trabajos tienen `status: queued | running | completed | failed | cancelled`, `progress: 0–100`, un mensaje y un resultado opcional. La creación de video, el montaje y Codex comparten una cola con un trabajo activo. Las instalaciones y descargas utilizan una cola independiente con un trabajo activo; así una descarga larga no bloquea la escritura ni la exportación. Nunca se ejecutan dos generaciones a la vez. Las dos colas admiten hasta 20 trabajos pendientes o activos en total. Los resultados de Codex son propuestas; no sustituyen silenciosamente el guion.

Un guardado anterior del editor no puede borrar un clip que acaba de generar el servidor: si omite `videoAssetId`, se conserva el vínculo existente. Para desvincularlo expresamente se envía `clearVideoAsset: true` en ese plano; el servidor consume esa indicación sin guardarla. Los originales y tomas anteriores siguen en la biblioteca.

La lista de proyectos incluye `id`, `name`, `logline`, `updatedAt`, `sceneCount`, `assetCount` y `current`; muestra primero el activo y omite respaldos dañados o enlaces simbólicos. La reapertura responde 404 si no existe un respaldo válido y 409 si faltan originales, conservando el proyecto abierto. Cambiar de proyecto no cancela trabajos: cada tarea usa su propia copia de contexto y los clips generados se vinculan al respaldo correspondiente si ese proyecto ya no está abierto.

## Generación y continuidad

Solicitud mínima:

```json
{
  "sceneId": "scene-01",
  "model": "ltx-2b",
  "duration": 4,
  "conditioningMode": "image"
}
```

Modelos: `minimax-h3` y `ltx-2b`. Se pueden proporcionar `prompt`, `negativePrompt`, `seed`, `steps`, `width` y `height`. Las dimensiones deben ser múltiplos de 32; los valores predeterminados son 768×448, 448×768 o 512×512. El modo de referencia de imagen conserva ese fotograma como condición; el montaje final se adapta al formato del proyecto sin recortar silenciosamente el contenido.

El clip base solicitado dura entre 1 y 4 segundos a 24 fps para el perfil de 36 GB. El motor informa cualquier ajuste al número de fotogramas que exige su arquitectura. La duración del plano en el montaje es independiente: si la toma termina antes, la exportación mantiene el último fotograma y completa el audio con silencio. Si es más larga, la recorta a la duración del plano. `trimStart` indica el desplazamiento inicial, en segundos, de un video importado o generado.

`conditioningMode` admite:

- `image`: fotograma de referencia del plano; es el predeterminado cuando hay una imagen.
- `text`: generación sólo desde texto.
- `references`: referencias visuales de los personajes u objetos fijos del plano; requiere MiniMax H3 y sus pesos opcionales de referencia. Es un modo distinto de los fotogramas ancla, por lo que no se mezclan ambos en una solicitud.

`scene.endAssetId` selecciona una imagen final. En modo `image` con MiniMax se envía como `lastFrame`, junto a la imagen inicial; en LTX ese ajuste se rechaza antes de crear un trabajo. Los modos `text` y `references` no usan anclas inicial/final.

La generación de secuencia acepta `model`, `duration`, `width`, `height`, `steps`, `conditioningMode` y `onlyMissing` (por defecto `true`). Omite planos que ya tengan clip cuando se solicita. Comprueba todos los prompts, archivos de referencia y plazas libres antes de encolar: un plano inválido o capacidad insuficiente rechaza toda la petición, sin aceptar un lote parcial. Hay un máximo de 20 trabajos simultáneamente activos o pendientes, contando ambas colas. Cada plano usa una copia del proyecto capturada al solicitar la secuencia.

Las descripciones de los personajes y objetos asignados se incorporan siempre al prompt, junto a la dirección de cámara. Una referencia fija guarda la decisión creativa; no garantiza identidad perfecta en todos los modelos. LTX no admite referencias de identidad separadas en este adaptador. `negativePrompt` se incorpora al prompt principal como texto bajo `Visual constraints / Avoid:`. No se aplica como embedding negativo independiente ni CFG; su efecto depende de cómo el modelo siga esas instrucciones.

Antes de dar por terminada una generación, el servidor comprueba que existe el MP4 y que FFprobe reconoce un flujo de video. Si faltan pesos o falla el motor, el trabajo falla claramente y no se añade ningún clip ficticio.

## Preparar un modelo

Primero se consulta el plan. `modelDirectory` permite elegir una carpeta absoluta, por ejemplo en un SSD externo; al omitirla se utiliza la configuración del motor o `runtime/models/<model>`. `withReferences` incorpora los pesos adicionales de MiniMax.

```json
{
  "model": "minimax-h3",
  "modelDirectory": "/Volumes/Video/Filmma/minimax-h3",
  "withReferences": false,
  "acceptLicense": true,
  "confirmDownload": true
}
```

La descarga necesita ambos valores de confirmación. El motor conserva las transferencias parciales para reanudarlas y verifica tamaño/hash cuando el repositorio publica el hash. Ni consultar el diagnóstico ni solicitar una generación inicia una descarga por su cuenta.

## Codex

El servidor utiliza la CLI instalada y su sesión normal: `codex exec --ignore-user-config --json --sandbox read-only --skip-git-repo-check --ephemeral -`. El prompt se envía por stdin y nunca se construye un comando a partir del texto del usuario. Los tipos disponibles son `script`, `improve-prompt` y `continuity`. El proceso evita heredar modelos personales no disponibles y no modifica la configuración global ni fija un modelo por nombre.

Para `script`, añade `--output-schema` con un esquema JSON local. El trabajo terminado devuelve `result.text` (guion legible) y `result.proposal: {projectId, scenes}`. Los planos reciben identificadores nuevos y semilla 0, no inventan archivos y validan todos los personajes contra el proyecto original. La propuesta no se guarda automáticamente. `script` y `continuity` reciben todo el montaje; `improve-prompt` recibe el plano seleccionado, si se indica `sceneId`.

El contexto incluye el guion y las descripciones; no se envían archivos visuales ni se lee el archivo de autenticación. El texto se transmite al servicio de Codex según la cuenta y los límites de uso de la persona. La aplicación no convierte una suscripción de ChatGPT/Codex en una clave de API ni permite acceder a herramientas de imagen internas del producto. Las imágenes creadas en Codex se incorporan mediante importación.

## Exportación

FFmpeg crea un segmento por plano con el formato y fps del proyecto, adapta la imagen con bandas si corresponde e incorpora su audio o silencio. El montaje usa H.264 y audio PCM flotante en temporales; el MP4 final lleva AAC a 192 kb/s, estéreo y 48 kHz. Las imágenes se rasterizan en una copia temporal mediante Sharp; el original permanece intacto. FFprobe verifica el número exacto de fotogramas y la duración antes de entregar el enlace.

`project.audioAssetId` selecciona un recurso de audio como banda sonora. `project.audioVolume` controla su volumen entre 0 y 2, con valor predeterminado 0.5. Se mezcla con el audio original de los planos y un limitador controla la saturación. La música comienza al inicio del montaje; si es más corta, termina y el resto conserva el audio de los planos. Si es más larga, se recorta al final de la película. El original no se modifica.

`scene.look` admite `original`, `noir` y `warm`: la exportación aplica el aspecto sobre copias temporales y conserva los originales. `noir` elimina saturación y eleva contraste a 1.08; `warm` usa saturación 0.85 y un balance rojo/azul de +0.03/−0.03. La vista del navegador es una aproximación. `scene.transition` admite `cut` y `fade`: este último aplica entrada/salida a negro de hasta medio segundo, acortada a un tercio de la duración para planos breves, sin cambiar el tiempo de montaje. No es una disolvencia entre dos clips. La banda sonora global sigue siendo compatible con proyectos anteriores. Las pistas adicionales, ajustes de audio y subtítulos editados se describen a continuación.

### Pistas y audio

`scene.audio` y cada clip adicional admiten `{volume, muted, fadeIn, fadeOut}`. El volumen nuevo está entre 0 y 1; los fundidos son lineales y se multiplican cuando se solapan. Sus tiempos se ajustan a fotogramas. Silenciar un clip o una pista de video afecta sólo al sonido. Los ajustes no modifican el original.

`project.tracks` es opcional y admite hasta 8 pistas y 500 clips en total. Cada pista contiene `{id,name,type,muted,volume,clips}`; `type` es `video` (imágenes o videos) o `audio`. Cada clip contiene `{id,assetId,sceneId,offset,duration,trimStart}` y puede añadir los ajustes de audio y `opacity` entre 0 y 1. Los IDs de clips son únicos entre todas las pistas; las referencias se validan tanto al guardar como al importar. Duración, offset, trim y fundidos se limitan a 86400 segundos y el clip necesita al menos un fotograma.

El inicio de un clip es el inicio de su plano ancla más `offset`; sigue al plano al reordenarlo y puede atravesar cortes. V1 determina el final de la película. Un clip adicional que lo exceda se recorta sin adelantar su fundido de salida: la envolvente conserva su duración lógica original. Las capas de imagen/video se muestran enteras, con bandas negras y su opacidad; la última pista y el último clip de su lista quedan arriba. Si se acaba un video, se mantiene su último fotograma; si se acaba el sonido, queda silencio, incluso cuando `trimStart` rebasa el original.

La mezcla multiplica el volumen de pista y clip, conserva headroom en PCM flotante y aplica un único limitador al final sin subir automáticamente los sonidos suaves. Se procesan hasta 12 fuentes de audio y 8 capas visuales por lote para acotar descriptores y memoria. Un proyecto con muchas capas puede necesitar varias pasadas de H.264 y bastante espacio temporal; los originales nunca se recomprimen ni reemplazan. El EDL representa solamente los cortes de V1 y avisa cuando existen capas adicionales.

### Subtítulos editables

`project.subtitleCues` es opcional: cada cue contiene `{id,sceneId,start,end,text,characterId?,sourceDialogue?}`. Inicio y final son relativos al plano ancla; se cuantizan a fotogramas y se recortan dentro de ese plano. El final es exclusivo. Se admiten hasta 1000 cues de 2000 caracteres; cada uno necesita una duración positiva de al menos un fotograma. El personaje es metadato y no se antepone al texto. El backend permite conservar ese metadato aunque después se desvincule el personaje del plano, siempre que aún exista en el proyecto.

Una lista explícita se quema en el MP4 salvo `subtitlesEnabled:false`; una lista vacía significa que no hay subtítulos. Un proyecto antiguo sin ese campo conserva el SRT basado en diálogo y no quema texto automáticamente. Descargar SRT sigue siendo posible cuando la visualización está desactivada. Los metacaracteres se escapan para que el contenido del usuario no introduzca estilos ni instrucciones.

El render usa texto Pango escapado y PNG transparentes generados por Sharp, con Arial Bold, tamaño inicial del 2.5% del ancho, ancho máximo del 86%, fondo negro al 72% y margen inferior del 6%. Conserva Unicode y saltos de línea. Si el texto es demasiado denso, reduce el tamaño para conservarlo completo; si las superposiciones no caben, informa el problema antes de entregar un archivo. La tipografía y el ajuste de líneas pueden variar ligeramente respecto al navegador. La secuencia de transparencia respeta los fotogramas exactos incluso con subtítulos superpuestos.

La importación remapea proyecto, originales, personajes, planos, pistas, clips y cues, incluyendo anclas, referencias y estados de continuidad. El contexto de Codex incluye metadatos de pistas y subtítulos; no analiza sus imágenes ni sonidos.

## Verificación

`node --import tsx --test tests/backend.test.ts` ejecuta pruebas de aislamiento local, preservación de originales, validación de referencias, respaldo de proyectos, recuperación de trabajos, errores reales del motor, propuestas Codex, ZIP y exportación MP4 real con FFmpeg. Las pruebas HTTP requieren permiso para escuchar en un puerto de loopback. Los adaptadores de Codex y generación usados en las pruebas no consumen servicios ni descargan modelos.

`tests/multitrack-backend.test.ts` comprueba persistencia y límites, remapeo de archivos, el orden/opacidad/encuadre de capas en fotogramas MP4 reales, congelación al terminar una fuente, niveles y fundidos mediante muestras PCM, silencio fuera de fuente, cues en sus fotogramas exactos y texto escapado.


## Transiciones y formas de onda

`Scene.transition` añade `dissolve` y `dip`, con `transitionDuration` opcional de hasta dos segundos. Son transiciones de entrada; `fade` conserva el comportamiento anterior. `src/transitions.ts` define límites y curvas por fotograma para visor y exportación. Mantienen las posiciones del guion. Dissolve lee handles posteriores al tramo montado del saliente (con congelación/silencio al agotar la fuente). Dip usa la salida y entrada alrededor del corte. Capas adicionales y subtítulos se componen después. Un fadeOut manual ya completado no vuelve a activar sonido durante un handle.

`GET /api/assets/:id/waveform` analiza exclusivamente recursos locales del proyecto abierto. Devuelve `{assetId,duration,sampleRate,channels,peaks,hasAudio,cached,sourceVersion}`; hasta 2048 picos uniformes absolutos entre 0 y 1, sin normalización por archivo. Conserva canales al medir para evitar cancelar audio estéreo en oposición. FFmpeg decodifica por streaming en CPU; una tarea activa, solicitudes compartidas, cancelación al perder lectores y caché persistente invalidada por identidad/tamaño/fechas del original. Límites: 2 horas, 8 canales, 192 kHz, 8 GB PCM y 90 segundos. No modifica los originales.

`tests/transitions-render.test.ts` mide píxeles, frecuencias/RMS, handles, EOF, fundidos manuales, relojes de 24/25/30 fps y anclas de capas/subtítulos. `tests/waveform.test.ts` usa archivos reales para verificar amplitud, silencio, canales, frecuencias altas, caché, aislamiento, deduplicación y cancelación.

## Acabado reversible y derivados

`Scene` y `TimelineClip` admiten `color` (exposure -2..2 EV, contrast .5..1.5, saturation 0..2, temperature -1..1) y `speed` (.25..4). La duración montada no cambia. Tiempo de fuente exacto: `trimStart + tiempoLocal * speed`; el trim original puede ser fraccionario respecto a la parrilla del montaje. `syncMediaClock` y renderer conservan el tono; FFmpeg encadena atempo. `colorMatrix` comparte una matriz RGB sRGB con SVG y el exportador. Los looks legacy siguen su tratamiento previo. El color afecta a la fuente antes de crear las barras.

Capas admiten `transform` (x,y porcentuales de viewport, scale, opacity) y hasta100 `keyframes` con id,time,pose completa,easing. `time` en segundos locales de montaje, valores -86400..86400 para preservar extremos anteriores al recorte; curva pertenece al punto izquierdo. Reloj cuantizado por fps, smoothstep t²(3−2t), mantener hasta siguiente punto, extremos retenidos. Límite global2000; IDs y fotogramas únicos por clip. El render usa expresiones equilibradas para soportar100 puntos sin desbordar parser. PNG alpha permanece tanto en visor como en composición; las barras exteriores se componen aparte.

`POST /api/assets/:id/enhance` `{projectId,preset:'clean'|'upscale'}` →202 `{job}`. Cola creativa CPU independiente de descarga runtime. Derivado `Asset.enhancement` contiene sourceAssetId,preset,method,createdAt,width,height,duration,fps. La copia aparece en biblioteca y nunca reemplaza automáticamente el plano. Validación de archivo local regular, espacio, SDR/dimensiones/fps/duración/audio, cancelación y limpieza de parciales. ZIP remapea procedencia. Método FFmpeg denoise/unsharp/Lanczos, no restauración generativa. Originales conservados.

Generación: máximo15s antes de encolar, tras cuantización del modelo y tras leer MP4 real; redondeo de frames hacia abajo evita exceder solicitud. El límite de memoria existente de36GB se mantiene. Una nueva toma reinicia trimStart0/speed1; sincronización y autosave atrasado no heredan el reloj de la fuente anterior. Cambios recientes del usuario se conservan mediante merge de tres vías.

## Resolución de exportación

`POST /api/export` acepta `resolution: "1080p" | "2160p"` junto con `format: "mp4"`. Si se omite, conserva 1080p; un valor inválido se rechaza antes de encolar. `src/export-resolution.ts` comparte las dimensiones con la interfaz: 3840×2160 horizontal, 2160×3840 vertical, 2160×2160 cuadrado. El resultado del trabajo incluye `resolution`, `width` y `height`. ZIP conserva los originales sin reescalarlos.

El renderer ajusta con Lanczos y proporción visual (SAR) conservada, sin recorte; dibuja subtítulos al tamaño final y compone como máximo dos capas por lote en UHD. Verifica las dimensiones finales, además de duración y fotogramas. La salida 4K no implica generación nativa 4K. [Perfiles y mediciones](RESOLUCION.md).

## Mejora con IA local

`GET /api/upscaler` informa instalación, integridad y disponibilidad. `POST /api/upscaler/setup` prepara el motor con un único trabajo deduplicado, independiente de la cola de descargas de MiniMax. `POST /api/assets/:id/enhance` admite `preset: "ai-4k"` y `strength` entre 0.15 y 0.70 (0.35 inicial).

`server/ai-enhance.ts` verifica CFR por marcas de tiempo, límites y audio, ejecuta `runtime/filmma_upscale.py`, remultiplexa las pistas de audio y vuelve a comprobar dimensiones, fotogramas, tiempos y huella SHA256 del original. Sólo después añade un recurso con procedencia de modelo y fuente. El resultado no se asigna automáticamente a ningún plano. Los errores o cancelaciones retiran los temporales y conservan el original. [Perfil y límites](IA-LOCAL-4K.md).

## Acabado por película, generación y exportación

`project.aiFinishing` conserva `{enabled, strength}` (0.15–0.70). Al generar con `enabled`, el trabajo guarda y publica primero la toma original; después procesa su copia con IA. Un fallo posterior conserva el recurso original y el resultado parcial del trabajo. Los límites de generación y los prompts de continuidad siguen aplicándose.

`POST /api/enhance-sequence {projectId,strength}` reserva un único trabajo secuencial por película e intensidad. `server/film-finishing.ts` agrupa las fuentes originales de escenas y capas de video: una misma toma se procesa una vez. La reutilización requiere modelo, revisión, huella y parámetros compatibles, además de verificar el archivo. Los resultados parciales viven en `job.result.finishing`, con fuentes creadas, reutilizadas, omitidas y fallidas. Cancelar o reintentar conserva las copias completas.

La sustitución sólo cambia el vínculo al recurso. Los contadores de selección de escenas y capas evitan sustituir una elección manual mientras se trabaja; `preserveVideoAsset` y `preserveAsset` identifican las elecciones que un guardado no pretendía modificar. Son indicadores efímeros. `src/projectSync.ts` combina en tres vías los resultados de capas y escenas, sin pisar nuevas ediciones. Los originales permanecen en la biblioteca y el ZIP.

`POST /api/export {format:"mp4",resolution:"2160p",aiEnhance:true,strength}` prepara las fuentes del montaje capturado al enviar la solicitud y luego renderiza. No sustituye las selecciones del editor abierto. Si una fuente no puede prepararse, el trabajo falla con resultados parciales y no entrega un montaje incompleto. El reintento reutiliza las copias terminadas. Las imágenes fijas se conservan y se ajustan al lienzo durante el render.

### Continuidad visual antes de 4K

`GET /api/continuity?projectId=…` devuelve el informe persistente, su huella actual, `stale`, la configuración de regiones/tiempos y disponibilidad real del motor local. `POST /api/continuity/analyze` recibe `{projectId, settings?: {regions:[{sceneId,characterId,category,rect}], sampleTimes:[{sceneId,time}]}}`. Las categorías son `face`, `wardrobe`, `object`; las regiones se normalizan desde la esquina superior izquierda. El tiempo se expresa dentro del plano editado. Se convierte al archivo mediante recorte y velocidad, se redondea al reloj de la película y se limita al último fotograma cuando el montaje congela el final del clip.

El trabajo `continuity` tiene una cola CPU independiente de generación y descarga. Apple Vision compara apariciones consecutivas de cada elemento vinculado, usando un fotograma de cada plano con su look y corrección de color. El emparejamiento automático se limita a un personaje humano inequívoco por plano y una cara por imagen; objetos conocidos vinculados al mismo plano no impiden esa selección, pero otra persona o un rol ambiguo sí. Los objetos requieren regiones manuales. Los resultados son señales de similitud visual, nunca reconocimiento de identidad. No se analizan el movimiento entre muestras, las capas compuestas, los subtítulos ni las transiciones: el informe exige confirmar esa cobertura.

Los informes y fotogramas se guardan en `data/continuity/<project>/<report>/`, separados del documento editable. La huella SHA-256 incluye bytes de los medios seleccionados, orden y contenido de planos, recortes, velocidad, aspecto, color, personajes, estados de continuidad, regiones, tiempos y configuración de acabado. Un cambio relevante invalida las aprobaciones. Guardar un proyecto antiguo no puede reemplazar el informe. Cancelar conserva las comparaciones completadas pero nunca autoriza la exportación.

`PUT /api/continuity/review` recibe `{projectId,reportId,fingerprint,comparisonId?,decision?,note}`. Las decisiones de pareja son `reviewed`, `intentional` o `pending`; las diferencias o resultados insuficientes requieren nota. Sin `comparisonId` registra la revisión global de las limitaciones. Cambiar/reabrir una decisión borra esa confirmación global. La exportación estricta requiere todas las parejas resueltas y confirmación global, incluso cuando no hay apariciones comparables.

`POST /api/export` acepta `requireContinuityReview:true`, `continuityReportId` y `continuityFingerprint` para MP4 4K. Revalida antes de aceptar, al empezar el trabajo y tras renderizar. Si se solicita IA, las copias compatibles deben estar ya seleccionadas y analizadas: el servidor no sustituye silenciosamente los píxeles revisados. En ese caso exporta las copias existentes sin repetir IA. Los clientes anteriores que omitan el guard conservan su contrato. Todos los originales permanecen intactos.

## Dirección cinematográfica y tomas alternativas

`Scene.cinematography` es opcional y admite los campos `framing`, `angle`, `lens`, `aperture`, `movement`, `pace`, `lighting` y `palette`, todos opcionales y validados como enumeraciones. `src/cinematography.ts` comparte el catálogo en español, sus instrucciones en inglés y cinco presets propios. No aplica valores implícitos a proyectos anteriores. `buildCinematographyPrompt` incorpora únicamente los ajustes elegidos; `cinemaDirectionLabel` presenta esa misma precedencia con etiquetas en español. Un encuadre o movimiento estructurado sustituye el campo libre legacy `camera`; modificar sólo luz, óptica o paleta conserva ese campo para no perder su intención. Los controles son instrucciones al modelo, no una simulación física de lentes o de un motor de cámara de terceros.

`POST /api/generate-variants` recibe los mismos parámetros de generación que `/api/generate`, más `count` entero entre 1 y 4. Responde `202 {jobs,count,seeds}`. La semilla inicial es la solicitada o la del plano; las siguientes aumentan de una en una, sin desbordar 2147483647. Todas las referencias, el límite de 15 segundos, la superficie máxima de 1344 × 768 y el prompt efectivo de hasta 32.000 caracteres se validan antes de reservar la cola. Los trabajos comparten la cola creativa serial; no ejecutan varias inferencias simultáneas.

Cada alternativa queda en la biblioteca asociada al proyecto y al plano. Esta ruta nunca cambia la toma seleccionada, aunque el montaje esté vacío. Si está activo el acabado automático, conserva el original y produce su copia IA sin aplicar ninguno al montaje. Un fallo en ese acabado mantiene el original y el resultado parcial. `/api/generate` y `/api/generate-sequence` conservan su comportamiento previo de selección protegida. Todos estos trabajos incluyen `sceneId` y `seed` desde su entrada en la cola; las variantes también incluyen `variantIndex` y `variantCount`.

El original generado guarda `Asset.generation`: `projectId`, `sceneId`, modelo, semilla, prompt efectivo, restricciones, fecha, dimensiones, fotogramas, fps, pasos, modo de condicionamiento, identificadores de referencias y una instantánea de dirección y continuidad efectiva de sus personajes. Los parámetros corresponden a la solicitud enviada al motor; la validación del archivo de salida se realiza además con FFprobe. No se almacenan rutas internas ni credenciales en esta procedencia. Los derivados conservan la relación `enhancement.sourceAssetId`; `listSceneTakes` recupera su procedencia a través del original y evita atribuir datos ficticios a tomas antiguas. `Scene.takeAssetIds` conserva hasta 2.000 asociaciones explícitas a familias de videos: al generar alternativas o cambiar la selección se recuerda la toma anterior, incluso si era importada o carecía de procedencia. El servidor une las asociaciones guardadas con las recibidas para que un cliente atrasado no las borre; el ZIP las remapea. Añadir una asociación de biblioteca no invalida por sí solo una revisión visual; seleccionar otros píxeles sí la invalida.

Los metadatos de generación son propiedad del servidor. Un guardado atrasado o que omita esos campos no los elimina ni los puede reescribir. `projectSavePayload` los omite únicamente del cuerpo enviado al guardar, manteniéndolos en el estado del editor y su historial, para que muchos prompts extensos no agoten el límite HTTP de 4 MiB. El ZIP incluye el registro completo; al importarlo, remapea proyecto, plano, personajes y referencias sin cambiar el texto histórico del prompt. Su manifiesto admite hasta 64 MiB, manteniendo los límites existentes de entradas, originales y descompresión. La exportación detecta un manifiesto mayor antes de entregar un paquete que no pudiera reimportarse.

`tests/cinema-takes.test.ts` y `tests/generation-variants.test.ts` verifican precedencia de dirección, familias de tomas, historial, cola serial, semillas, prevalidación, selección intacta, acabado IA y exportación/importación con procedencia extensa. Los adaptadores de estas pruebas simulan los modelos y generan archivos verificables con FFmpeg; no constituyen una evaluación visual de la adherencia de los modelos a las instrucciones.

## Voces del guion y sincronización labial

`Character.voice` guarda `{engine:"kokoro",voiceId,language,speed}`. El catálogo local ofrece tres voces españolas (`ef_dora`, `em_alex`, `em_santa`) y dos inglesas (`af_heart`, `am_michael`), velocidad 0.5–2, con idioma validado. Es una voz sintética estable por personaje, no clonación de su voz real. `Project.dialogueLines` admite hasta 1.000 intervenciones `{id,sceneId,characterId?,text,offset,delivery,sourceDialogue,audioAssetId?,voice?}`. Cada texto hablado admite 600 caracteres. La voz de narración sin personaje puede definirse en la propia intervención. `sourceDialogue` contiene la firma compacta del guion; editar el guion exige revisar el vínculo antes de volver a generar o aplicar una voz. La propuesta del parser conserva el guion original, reconoce encabezados de personajes y V.O./O.S., y omite acotaciones de la lectura. No promete control de emoción en Kokoro.

`GET /api/speech` y `GET /api/lipsync` devuelven directamente el diagnóstico del adaptador local y `gpuBusy`. `POST /api/speech/setup {}` y `POST /api/lipsync/setup {}` crean trabajos deduplicados de preparación. `POST /api/speech/generate {projectId,lineId}` usa una instantánea de texto, voz, personaje y continuidad. `POST /api/lipsync/generate {projectId,lineId,sourceAssetId,audioAssetId,faceROI?}` requiere un diálogo asignado a un personaje, voz vigente y la toma seleccionada. `faceROI` es una región normalizada `{x,y,width,height}`; varios rostros requieren una región inequívoca. El servidor coloca la voz en su `offset`, añade únicamente silencio para cubrir el plano y conserva el WAV original.

Ambas generaciones comparten la cola creativa serial con generación y reescalado. Preparar estos motores no crea otra descarga de MiniMax. Las solicitudes idénticas activas reutilizan el mismo trabajo; cada resultado incluye proyecto, plano e intervención. La voz no puede exceder 15 segundos y la sincronización admite planos de hasta 15 segundos. Si la fuente ya contiene otra intervención sincronizada, se exige dividir el plano o volver al original para no sustituir su voz. Si el audio rebasa el plano o faltan fotogramas de fuente al aplicar recorte/velocidad, se rechaza explícitamente: no hay truncamiento, bucle ni congelación silenciosos. MuseTalk entrega una copia a 25 fps y puede redondear hacia arriba menos de un fotograma; el motor hornea recorte y velocidad. Para conservar color y geometría, el backend exige SDR con píxeles cuadrados.

Los resultados se añaden únicamente a la biblioteca. `Asset.speech` y `Asset.lipSync` son metadatos propiedad del servidor, con instantáneas del personaje/guion, modelos y revisiones de código/pesos, tiempos y SHA-256 de archivos. `sceneDuration` conserva el tiempo del montaje y `duration` el tiempo real del MP4; `metrics` separa RSS del proceso de memoria MLX. El informe detallado se guarda fuera de los medios públicos, en `data/dialogue/`. `lipSync` es una modificación de la interpretación, separada de `enhancement`. Antes de publicar la copia se verifican video/audio, dimensiones, duración, decodificación y huellas de fuentes; una edición detectada antes de inferir cancela la ejecución obsoleta con un error claro, y una edición durante la inferencia marca el resultado `stale` sin perderlo ni sustituir el montaje. El ZIP remapea proyecto, escena, personaje, intervención, referencias, audio y fuentes de la copia.

`applyDialogueAudio` incorpora la duración real del WAV en una pista anclada al plano con `TimelineClip.dialogueLineId`; reaplicar reemplaza sólo ese vínculo. `applyDialogueSubtitle` crea explícitamente un subtítulo editable usando esa duración. `applyLipSyncTake` requiere una versión vigente, recuerda la toma anterior, reinicia recorte a 0 y velocidad a 1, y silencia únicamente clips de voz asociados a esa intervención para evitar duplicación. La copia labial contiene la voz en lugar del audio original de la toma; otros clips y pistas se conservan. Ninguna operación aprueba la continuidad visual ni la exportación 4K automáticamente.

`tests/dialogue.test.ts` cubre las asociaciones, cola serial, deduplicación, límites, versiones desactualizadas, aplicación manual, metadatos inmutables y recorrido ZIP con archivos WAV/MP4 reales y adaptadores simulados. Las mediciones y la validación real de modelos son evidencia separada en los documentos de runtime.

## Proveedores de voz

`CharacterVoice.engine` admite `kokoro`, `qwen` y `elevenlabs`. El endpoint existente `POST /api/speech/generate {projectId,lineId}` despacha por la selección persistida del personaje o narrador; conserva cola serial, validación del guion, procedencia, duración máxima y aplicación manual. Qwen usa `runtime/filmma_qwen_tts.py` y verifica la referencia vinculada. ElevenLabs usa el servidor como intermediario; no se devuelve la clave al cliente.

- `GET /api/speech/qwen`: disponibilidad local y referencia de Hermes.
- `GET /api/speech/elevenlabs`: conexión y catálogo guardado, sin consulta remota ni síntesis.
- `POST /api/speech/elevenlabs/connect {apiKey}`: valida la clave mediante consultas y guarda la conexión privada.
- `POST /api/speech/elevenlabs/refresh {}`: actualiza el catálogo remoto.
- `POST /api/speech/elevenlabs/disconnect {}`: elimina sólo la conexión privada.

Todos los endpoints de cambio conservan controles de origen, host local y cabecera `X-Filmma-Client`. El campo `localOnly` del diagnóstico pasa a `false`; `localServerOnly:true` indica que el servidor sigue escuchando sólo en localhost y `optionalRemoteVoices:true` identifica el proveedor remoto optativo.
