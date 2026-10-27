# Resolución de generación y entrega 4K

Actualizado el 18 de octubre de 2026 con pruebas del MacBook M4 Max de 36 GB. La resolución de una toma generada y la del montaje exportado son decisiones diferentes.

## Recomendación para este equipo

| Uso | Resolución | Evidencia y límite |
|---|---|---|
| Borrador horizontal 16:9 | 512 × 288 | LTX probado con 73 fotogramas, 3,041667 s; 17,40 GiB de pico MLX. |
| Mayor área dentro del perfil actual | 864 × 480 | LTX probado con 25 fotogramas, 1,041667 s; 17,48 GiB de pico MLX. Una toma corta no valida todas las duraciones. |
| Siguiente escalón 16:9 exacto | 1024 × 576 | Admitido por la geometría de H3, pero supera la protección actual de 36 GB. No habilitado ni probado en este Mac. |
| Límite horizontal publicado de H3 | 1344 × 768 | Clase 768p del motor; no validado en este Mac. La descarga ya está completa. |
| Entrega horizontal | 3840 × 2160 | Exportación UHD comprobada con audio, subtítulo y capa animada. |

864 × 480 tiene proporción 1,8:1. Para conservar todo el encuadre en un archivo 16:9, el exportador añade bandas de unos 13 píxeles arriba y abajo en UHD. 1344 × 768 necesitaría bandas laterales de unos 30 píxeles. No se estira ni se recorta la composición para ocultar esta diferencia.

Los motores instalados requieren ejes múltiplos de 32. Por eso 768 × 432 y 1280 × 720 no son solicitudes válidas en estos adaptadores. El siguiente 16:9 exacto después de 512 × 288 es 1024 × 576. La protección de Filmma mantiene un máximo de 414.720 píxeles y 107 fotogramas para equipos de hasta 36 GB; es una precaución operativa, no una estimación precisa de memoria para cada combinación.

## Entrega desde Filmma

En **Exportar → Resolución de la película** puedes elegir:

| Formato del proyecto | Estándar | Alta resolución |
|---|---|---|
| Horizontal 16:9 | 1920 × 1080 | 3840 × 2160, 4K UHD |
| Vertical 9:16 | 1080 × 1920 | 2160 × 3840, 4K vertical |
| Cuadrado 1:1 | 1080 × 1080 | 2160 × 2160 |

Se conserva Full HD como opción inicial. El cuadrado de 2160 píxeles no se etiqueta como 4K UHD. La exportación utiliza la mejor fuente seleccionada en cada plano y amplía con Lanczos directamente al lienzo de salida. Los subtítulos se dibujan a ese tamaño y las posiciones de las capas se mantienen proporcionales. No hace falta pulsar repetidamente «Reescalar 2×»: desde una toma 512 × 288, esa acción produce 1024 × 576, no 4K. Para la entrega UHD basta seleccionar 4K en Exportar.

Este proceso es reescalado convencional. Un archivo de 3840 × 2160 procedente de 864 × 480 sigue teniendo el detalle original de esa toma. Para mejor calidad, conviene generar primero la toma de mayor resolución que se haya comprobado estable y usar imágenes de referencia nítidas; mantener el original y realizar la ampliación final una sola vez. Filmma incorpora también **Acabado → Detalle con IA local**: Real-ESRGAN añade detalle fino con mezcla conservadora y conserva una copia aparte. Esa versión se revisa antes de usarla y puede entregarse en el lienzo UHD. No acredita recuperación de detalle real ni identidad perfecta. Consulta [IA local para entrega 4K](IA-LOCAL-4K.md).

El límite absoluto de las tomas generadas sigue siendo 15 segundos. Las solicitudes habituales de este equipo permanecen en perfiles cortos de hasta 4 segundos. La duración de la película editada es independiente.

## Mediciones reales

**Generación LTX:** 864 × 480, 25 fotogramas, 24 fps, 4 pasos, semilla 20261018, imagen inicial y prompt de 411 tokens. El worker tardó **14,35 s**; el pico del asignador MLX fue **18.773.434.572 bytes, 17,48 GiB**. No es la memoria total de macOS. El MP4 de 1,041667 s se decodificó completo; los hashes de imagen y proyecto permanecieron idénticos. La revisión visual detectó movimiento del automóvil pese a la instrucción de mantenerlo estacionado: esta prueba acredita funcionamiento, no obediencia perfecta ni continuidad garantizada. Evidencia: `runtime/validation/resolution-4k/verified.json`.

**Montaje UHD:** fuente LTX 512 × 288, audio, subtítulo asociado a Elena y una capa animada; salida **3840 × 2160, 72 fotogramas, 24 fps, 3 s**. Render **9,46 s**, comando completo con verificaciones **13,39 s**. RSS máxima externa **2,81 GiB**; no representa RAM total ni el coste de películas extensas o muchas capas. Original y proyecto intactos. Evidencia y script reproducible: `output/qa/resolution-4k/report.json` y `output/qa/resolution-4k/README.md`.

MiniMax completó una toma de 512 × 320, 345 fotogramas a 24 fps y 14,375 s con SSD streaming y 20 pasos. El flujo hasta UHD quedó verificado técnicamente, pero la calidad visual fue rechazada: una fuente de 163.840 píxeles ampliada hasta UHD sigue limitada. El perfil largo es una configuración conservadora de Filmma, no la resolución máxima intrínseca de H3. El reescalado inicial al 35 % apenas añadía cambios visibles. Las comparaciones y el piloto de restauración se documentan en `output/qa/quality-recovery/`; no deben confundirse con una generación nativa de mayor resolución.

## Fuentes primarias

- [MiniMax H3 oficial](https://github.com/MiniMax-AI/MiniMax-H3): H3-Base produce 768p; la regeneración 2K forma parte de otro módulo, aún no publicado como código abierto en la fuente consultada. No está incluida en el motor local de Filmma.
- [Motor Metal h3.c](https://github.com/antirez/h3.c#5-pick-resolution-and-duration): ejes múltiplos de 32, área máxima 1344 × 768, perfiles y límites de reescalado interno. El ahorro publicado del SSD corresponde a almacenamiento DiT y no a toda la RAM del sistema.
- [LTX-Video oficial](https://huggingface.co/Lightricks/LTX-Video): geometría divisible por 32 y recomendaciones por debajo de 1280 × 720; la familia incluye variantes distintas. Filmma utiliza específicamente 2B 0.9.8 distilled mediante MLX. Las cifras de otras GPU o variantes no son mediciones de este Mac.
