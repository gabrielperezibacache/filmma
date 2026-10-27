# Verificación de la segunda entrega

27 de octubre de 2026 · Mac M4 Max, 36 GB. Entorno QA independiente en el puerto 4320 y `output/qa/second-delivery/store`. La película de producción **2038** y sus archivos permanecen en el puerto 4318.

## Resultado comprobado

- **425/425 pruebas automatizadas**, sin omisiones ni fallos, con FFmpeg portable y concurrencia de render limitada a dos. La ejecución final duró 37,75 segundos.
- División de clips con reloj de fuente, velocidad, animación y fundidos conservados. Una prueba PCM compara los fragmentos con el audio sin dividir a nivel de muestras.
- Bloqueos, arrastre, recorte, duplicación y Deshacer probados con acciones de interfaz. Los candados protegen el montaje de clips y permiten seguir mezclando el sonido.
- Exportación H.264/AAC real a 1280 × 720, 48 fotogramas a 24 fps, decodificación completa. El análisis de frecuencias comprueba que la banda sonora silenciada no aparece en la mezcla. Es una prueba de edición y mezcla de dos segundos, no una nueva toma MiniMax ni una validación visual de cine.
- Exportación y reimportación ZIP conservan los candados, las curvas de fundido y los vínculos entre subtítulos, intervenciones y personajes, con identificadores reasignados. Los medios de origen conservan sus hashes.
- Importación real de SRT desde el selector de archivos: desplazamiento revisado de 0,25 s, reparto de un intervalo entre planos y adición de tres tramos sin cambiar los dos subtítulos anteriores. Confirmar queda deshabilitado al modificar el desplazamiento hasta revisar la nueva propuesta.
- Una voz Qwen real de 2,24 s a 24 kHz con el modelo `Qwen3-TTS-12Hz-1.7B-Base-Q4_K_M` ya instalado en Hermes. Sin descarga de pesos. Se conservó el audio y el texto editado al alinear tiempos. Un cambio de vestuario previsto bloqueó el uso de la voz anterior; restaurar el estado recuperó su vigencia. Esta comprobación no acredita identidad facial ni sincronización labial.
- Escritorio 1440 × 1000: visor y transporte visibles con Secuencia, Pistas, Mezcla y Subtítulos; el dock se desplazó 845,5 px manteniendo la ventana en cero y el visor visible.
- Móvil 390 × 844: Herramientas → Ver visor → Volver a herramientas conservó la pestaña, el texto seleccionado, Elena, el cabezal y el scroll. Sin desbordamiento horizontal de página.
- **Siete archivos protegidos**, documento de producción y seis medios/metadatos, idénticos por SHA256 antes y después de activar la actualización. No se generaron videos ni se modificaron escenas de producción.

La revisión independiente de interfaz cerró con **disposition: ship**, incidencia del visor **resolved**, sin correcciones materiales pendientes. Se mantuvo la identidad visual existente. No se alteró el sidecar de diseño obsoleto ni se añadieron afirmaciones de calidad a partir de los tonos de prueba.

## Evidencias locales

`output/qa/second-delivery/` contiene las capturas y registros: `clip-ui-result.json`, `mixer-ui-result.json`, `subtitle-ui-result.json`, `srt-ui-result.json`, `qwen-alignment-ui.json`, `qwen-stale-ui.json`, `viewer-fix-evidence.json`, `preservation-result.json`, `activation-result.json` y `finish-verdict.md`. Incluye los originales de QA y el audio Qwen; este directorio está excluido de Git y del instalador.

Los registros de pruebas de esta sesión están en `/tmp/filmma-second-all-tests-final.log` y el build en `/tmp/filmma-second-production-build.log`. Los mismos tests se ejecutan también en la construcción del instalador. La comprobación del paquete y su ejecución nativa se deben distinguir del uso verificado en navegador.
