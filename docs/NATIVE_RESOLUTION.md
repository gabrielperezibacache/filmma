# Resolución nativa de MiniMax en Filmma

La fuente determina cuánto detalle recibe el acabado con IA. Exportar una toma de 512 × 320 en 3840 × 2160 aumenta el tamaño de salida; no recupera automáticamente el detalle que nunca se generó.

## Elegir una toma

En Dirección o Montaje, selecciona MiniMax y **Resolución nativa**. El resumen muestra las dimensiones, los fotogramas, los pasos y la duración real antes de generar.

| Opción | Fuente horizontal 16:9 | Límite del perfil a 24 fps |
|---|---|---|
| Estándar | 512 × 320 para tomas largas; hasta 768 × 448 para tomas breves en Detalle | Hasta 14,375 s en el perfil largo |
| Equilibrada | 768 × 448 | Hasta 14,375 s, experimental |
| Mayor detalle | 1024 × 576 | Hasta 8 s, experimental |
| HD 720 | 1280 × 736; copia de entrega 1280 × 720 | Hasta 14,375 s en el perfil HD largo experimental |

La geometría nativa usa múltiplos de 32. El lienzo final conserva la proporción elegida sin recortar automáticamente el original. Las opciones verticales y cuadradas muestran sus propias dimensiones y límites. El máximo de 15 s solicitado se ajusta al reloj de MiniMax: 345 fotogramas a 24 fps equivalen a 14,375 s; no se repiten ni ralentizan fotogramas para simular 15 s.

Equilibrada, Mayor detalle y HD 720 usan 20 pasos y generación desde texto. Conservan el guion, las descripciones y los vínculos de continuidad, pero todavía no admiten imágenes ancla ni referencias visuales. Si hay imágenes vinculadas, se conserva la selección y se bloquea la solicitud; Estándar y una toma de hasta 4 s permiten volver al flujo de referencias. La continuidad visual requiere revisar el resultado.

El perfil nativo ordinario limita la superficie a 1280 × 736, el lado mayor a 1280, la duración a 345 fotogramas y la secuencia a 35.000 tokens visuales. Esto permite como máximo 124 fotogramas (5,167 s) a 1280 × 736. Para una duración superior, HD 720 horizontal o vertical selecciona explícitamente otro perfil experimental, `h3-hd-ssd`, hasta 93.840 tokens, exclusivamente 1280 × 736 o su transpuesta. Los demás formatos mantienen el presupuesto de 35.000.

El perfil HD largo puede tardar varias horas y dispone de una parada interna a las 12 horas; la API añade 30 segundos para terminar los procesos y registrar el resultado. Estos límites son un presupuesto experimental, no una garantía de calidad, tiempo o duración ya probados. Se mantienen las paradas por presión de memoria, crecimiento del intercambio y memoria del proceso, además de las reservas de disco. Ningún perfil reduce automáticamente la resolución para encajar ni repite fotogramas para completar la duración.

MiniMax no admite 1280 × 720 exactos porque 720 no es múltiplo de 32. Filmma conserva la fuente de 1280 × 736 y encaja la imagen completa en un lienzo 1280 × 720, con pequeñas bandas laterales; no estira ni recorta el contenido. La salida 4K posterior también encaja el original completo.

## Lo comprobado en el M4 Max de 36 GB

- **512 × 320, 345 fotogramas, 24 fps, 20 pasos:** toma continua de 14,375 s, original, copia IA y exportación UHD decodificados completamente. Su calidad de imagen fue insuficiente para el usuario.
- **1024 × 576, 22 fotogramas, 24 fps, 20 pasos:** piloto nativo completado el 18 de octubre de 2026 a las 05:31 UTC. Duración de video 0,916667 s; 934,376 s para generación y comprobaciones del supervisor. Se verificaron dimensiones, reloj, fotogramas, decodificación y conservación de originales.
- El piloto muestra más detalle visible en el objetivo, las piezas y las texturas. Cambiaron también el prompt y el encuadre; no es una comparación controlada que atribuya toda la mejora a la resolución. Hay pseudotexto y una bobina parcialmente fuera de encuadre. No valida todavía 8 s a 1024 × 576 ni 14,375 s a 768 × 448.
- **1280 × 736, 22 fotogramas, 24 fps, 20 pasos:** piloto terminado y decodificado completamente a las 05:53:58 UTC del 18 de octubre. Generación y comprobaciones del supervisor: 1025,039 s. Se conserva el original y una copia720p comprobada, con los mismos22 fotogramas y paquetes de audio. Fuente con el mismo prompt, semilla y pasos del piloto1024. No acredita todavía la toma largaHD. Evidencia en `output/qa/native-resolution/pilot-720/`.

El piloto1024 registró un máximo muestreado de 11.000.100.768 bytes de physical footprint y 6.959.333.376 bytes de RSS, sin crecimiento de intercambio ni presión anormal. El piloto720 registró 11.342.952.832 bytes de physical footprint y 6.723.043.328 bytes de RSS, también sin presión anormal ni crecimiento de intercambio. Estas medidas no equivalen a toda la memoria unificada/GPU y pueden omitir picos.

Evidencia: `output/qa/native-resolution/pilot-1024/process.json`, `ffprobe.json`, `generation.jsonl`, `frames/` y `visual-review.md`. El historial en `runtime/validation/history/` conserva las configuraciones anteriores. El diagnóstico y la interfaz sólo presentan una prueba como verificada cuando coinciden perfil, modo, dimensiones, duración, fps y pasos.

La toma larga HD sólo puede iniciarse cuando el piloto720 esté verificado y no haya otra inferencia activa. `scripts/start-hd-validation.py` comprueba el estado, hashes, memoria y proyecto QA, y registra la intención antes de enviar una única solicitud. Si `output/qa/native-resolution/long-720/launch.json` existe, no vuelve a enviar la solicitud. Una respuesta HTTP incierta exige inspeccionar los trabajos existentes; nunca repetirla a ciegas. La generación usa el proyecto aislado `qa-minimax-scene`, sin modificar la película2038.

## Acabado 4K

Después de comprobar la fuente, crea una copia con Real-ESRGAN local y exporta a 2160p. Se mantienen separados el original nativo, la copia con IA y el montaje final. Revisar definición, posibles texturas inventadas, encuadre, continuidad y audio antes de aceptar la exportación.

`scripts/verify-minimax-delivery.py` comprueba fotogramas, dimensiones, duración, decodificación completa, audio y hashes de las tres versiones. Para una fuente distinta de la primera prueba512, su quinto argumento debe ser un JSON con `sourceSha256`, `sourceSize`, `aiSize`, `frames`, `fps` y, opcionalmente, `preserve` (rutas absolutas y hashes). Las dimensiones esperadas deben venir de la solicitud y los metadatos del acabado, no inferirse de un archivo potencialmente incorrecto.

## Comparación de acabados sobre fuente HD

Se verificaron cinco versiones completas de la muestraHD de22 fotogramas: Lanczos, enfoque suave, IA conservadora35%, restauración65% y restauración85%. Para el objeto de esta escena se eligió65% por el equilibrio entre contorno y textura. TTA se probó únicamente en tres imágenes: la diferencia fue pequeña y el coste, mayor. No hay videoTTA completo validado. Evidencia y límites en `output/qa/upscale-720-comparison/informe-calidad.md`; comparación interactiva en `http://127.0.0.1:4318/quality-review/index.html`. Las medidas de diferenciasRGB no son puntuaciones de calidad ni detalle real recuperado.

El montaje usa ahora intermediosH.264 sin pérdidas (QP0) para las muestrasYUV420 de trabajo y una sola compresión finalCRF16, evitando compresiones con pérdidas acumuladas en cada etapa. Esto no revierte compresión de la fuente ni conversiones de los filtros. La exportación incluye720p,1080p y2160p; la IA de película sigue vinculada al flujo4K revisado.

La toma largaHD se inició el18 deoctubre de2026 a las15:14:21UTC: trabajoQA `89c47b95-59dc-48f4-9449-c93d53763b51`, fuente1280×736,345fotogramas24fps,20pasos. Su registro único está en `output/qa/native-resolution/long-720/launch.json`. La prueba se detuvo a las15:15:51UTC con MEMORY_PRESSURE, antes de producir un video: macOS notificó presión crítica de memoria. Se conservaron los seis archivos protegidos y producción2038, sin reintentos ni límites relajados. La comprobación automática quedó pausada. El piloto corto no acredita esta duración larga. Evidencia: `output/qa/native-resolution/long-720/terminal-result.json`.

La opción **Restauración estable** añade un acabado temporal local con fuerza inicial65%, conservando fuente, audio y edición. Véanse los límites, preparación y pruebas reales en [STABLE_RESTORATION.md](STABLE_RESTORATION.md). El comparador incluye la sexta versión verificada de la muestraHD; no cambia el resultado fallido de la generaciónHD larga.
