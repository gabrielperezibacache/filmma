# Quinta entrega · Montaje conectado y reproducción ligera

La quinta entrega amplía **Montaje → Pistas**, añade **Marcadores** y prepara copias locales para la reproducción. Conserva la cinemateca y su visor, el guion, los estados de los personajes, las voces y los archivos originales. Los grupos nuevos pertenecen a clips de pistas adicionales; V1 conserva su organización de planos y escenas narrativas.

## Seleccionar y agrupar

**⌘/Ctrl + clic** alterna un clip o su grupo; **Mayús + clic** añade un rango según el orden visible de pistas. **Seleccionar varios** ofrece selección por toques, sin arrastrar. También puedes seleccionar todos y vaciar la selección. Un grupo se selecciona como conjunto y conserva un nombre propio.

La barra breve permanece antes de la línea de tiempo; las operaciones aparecen debajo de las pistas para que una selección no desplace los clips. Elige un nombre y pulsa **Agrupar selección**. Agrupar grupos existentes los reúne; **Desagrupar selección** conserva todos los clips.

Arrastra el cuerpo de un clip seleccionado o usa los controles de un fotograma para mover el conjunto. **Alt + ←/→** mueve por fotogramas; Mayús cambia el paso a un segundo. Los bordes se ajustan a cortes, clips, cabezal y marcadores; Alt desactiva el ajuste y Escape cancela el arrastre. Cada clip conserva su pista al mover un conjunto y su plano de referencia al atravesar cortes. Un clip individual también puede cambiar a una pista compatible.

**Dividir selección** corta los clips atravesados por el cabezal, preservando el recorrido de fundidos y animación. **Duplicar selección en el cabezal** mantiene las distancias entre clips, usa identificadores nuevos y copia los grupos completos. **Retirar selección** elimina las instancias del montaje, sin borrar los archivos de la biblioteca. Deshacer y Rehacer conservan la operación como un cambio del proyecto.

Una pista bloqueada impide mover, dividir, copiar o retirar el conjunto entero; no hay una aplicación parcial sobre las pistas desbloqueadas. Cambiar los tiempos o grupos durante un arrastre invalida ese movimiento. Los recortes y campos del inspector afectan sólo al clip activo, como explica la ayuda de selección.

## Voz, guion y subtítulos

Los vínculos al plano, intervención y personaje no se sustituyen al agrupar. Al mover todos los fragmentos de una intervención con un reloj de origen coherente, se ajusta su entrada en **Voces** y se desplazan sus subtítulos vinculados, conservando texto editado, duración relativa e identificadores. La grabación sigue vigente si texto, voz y estado del personaje siguen siendo los mismos.

Si quedan fragmentos fuera del conjunto o existen copias de la misma intervención en tiempos distintos, el editor conserva su tiempo de guion y subtítulos y muestra un aviso para revisarlos en Voces. Copiar clips no duplica el diálogo escrito. Los tiempos incompatibles se rechazan antes de aplicar el conjunto. Una sincronización labial anterior puede requerir revisión al cambiar la entrada de voz; los archivos completos se conservan.

## Marcadores por plano

Abre **Montaje → Marcadores**, pulsa **Marcar en el cabezal** o usa **M** fuera de un campo de texto. Cada señal guarda título, tipo —montaje, continuidad, diálogo o nota de producción—, tiempo dentro del plano, nota y personaje u objeto opcional. Se puede abrir desde su lista o desde la regla de Secuencia y Pistas.

Los marcadores siguen a su plano al reordenar el guion. Dividir o duplicar un plano mantiene sus señales con el tramo correspondiente y nuevos identificadores cuando procede. Si un recorte deja una señal fuera del plano, se conserva con un aviso; abrirla muestra el último fotograma disponible del plano. Una nota de continuidad indica qué revisar: no aprueba ni corrige la imagen automáticamente.

La lista puede descargarse como CSV, con plano, personaje, tiempo global y local, nota y estado. El proyecto completo conserva grupos y marcadores y reasigna todos sus vínculos al importar. Retirar un marcador es reversible mediante Deshacer.

## Reproducción del visor

**Reproducción del visor** distingue **Fluida · usar copias listas** y **Original · revisar detalle y color**. **Preparar copias ligeras** encola un trabajo local, con progreso y cancelación en Actividad. Reutiliza las copias válidas y procesa una fuente a la vez, mediante FFmpeg y dos hilos de codificación, sin cargar otro modelo IA.

Las copias H.264 tienen hasta 1280 px por lado y un intervalo de fotogramas clave corto para facilitar búsquedas. Conservan reloj, cantidad de fotogramas, proporción y pistas de audio; se verifican con decodificación completa y huellas SHA-256. Para esta preparación se admiten fuentes SDR de hasta dos minutos, 60 fps, 4K y 2 GiB, con reserva de 1 GiB de disco. Las fuentes incompatibles o que no superan la verificación permanecen disponibles como Original.

El visor utiliza una copia únicamente si corresponde al recurso actual. Si falta o falla al reproducirse, vuelve al original. La caché no cambia los recursos del proyecto ni se añade a la biblioteca o al ZIP. **Exportación y análisis de continuidad usan las fuentes seleccionadas del proyecto, nunca las copias de reproducción.** Una versión IA elegida deliberadamente sigue siendo una fuente seleccionada; no se confunde con esta caché.

El video base siguiente permanece precargado y su nodo se reutiliza al entrar en el plano. Se mantienen como máximo dos fuentes base montadas; las capas y transiciones conservan sus reproductores independientes. Las formas de onda evitan renders repetidos cuando sus datos y ajustes no cambiaron.

Los contadores del navegador se conservan al pausar y se identifican como una medición corta del video actual. No acreditan FPS sostenidos, rendimiento de toda una película ni uso total de memoria unificada. Para evaluar detalle o color, vuelve a Original.

## Verificación

**450 pruebas completas**, sin fallos ni omisiones, y TypeScript comprobado desde cero. Cubren selección/rangos/grupos, movimiento atómico y obsoleto, bloqueo, fundidos, animación, tiempos vinculados de voz/subtítulos, marcadores fuera de tramo, división/duplicación, esquema, caché, solicitudes simultáneas, retorno a Original, fuentes alteradas y reimportación ZIP.

La instancia aislada verificó agrupar voz y capa visual, desplazarlas juntas, arrastrar el grupo, Deshacer/Rehacer, bloqueo y retirada reversible. La prueba táctil final registró dos clips seleccionados tras un toque y cero después del siguiente. Se añadieron señales por botón y M, vinculadas a Elena, y se descargó su CSV.

Dos referencias técnicas con zoom sobre imágenes existentes, de **3840 × 2160, 144 fotogramas a 24 fps y seis segundos**, produjeron copias **1280 × 720** con el mismo reloj y audio: nueve veces menos píxeles por fotograma. Se comprobó la reutilización del siguiente nodo de video. Los contadores cortos no permiten afirmar una mejora de FPS frente al original, que tampoco registró descartes. No se generaron nuevas imágenes, voces ni tomas con modelos IA.

La animática QA se exportó a **1280 × 720, 24 fps, 288 fotogramas y 12 segundos**, con audio y decodificación completa. Su ZIP fue reimportado: grupos, marcadores y vínculos válidos; voz Qwen existente vigente y mismo SHA-256; originales intactos y caché excluida. La película de producción **2038** y sus siete archivos protegidos permanecen separados de QA.

La revisión independiente de acabado registra **SHIP, sin incidencias materiales abiertas**, con cobertura complementaria resuelta. Los documentos, ejemplo, capturas y registros están en `output/qa/fifth-delivery/`. La comprobación de interfaz cubre escritorio 1440 × 1000 y móvil 390 × 844; no equivale a ejecutar el instalador nativo.
