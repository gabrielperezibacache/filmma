# Film, época, lentes y cámaras: contraste y límites

Revisión de fuentes públicas oficiales: 18 de octubre de 2026 (UTC). Complementa `CINEMA-VISUAL-GUIDE.md`; no describe una reproducción del motor privado de Higgsfield.

## Lo comprobado en Cinema Studio

La [presentación oficial de Cinema Studio 4.0](https://higgsfield.ai/blog/cinema-studio-4-0), publicada el 12 de agosto de 2026, anuncia un selector de décadas que modifica grano, color y estilo de lente. Enumera cámaras Modern, DV Camcorder, 35mm Film y 8mm Film; además ofrece una elección automática. Sus lentes incluyen caracteres limpios, anamórficos, anamórficos antiguos, cálidos y con halo. Son afirmaciones del fabricante; esta revisión no mide su simulación óptica ni certifica identidad entre resultados.

La mejora de Filmma consiste en distinguir **cuándo sucede la historia** de **cómo se fotografía**. Una escena de la Antigüedad puede tener captura digital limpia; una historia contemporánea puede tener textura Super 8. No deben imponerse grano, sepia, desgaste ni cambios de rostro por elegir una época. El lugar, año o intervalo y las notas de ambientación permiten precisar más que una década genérica. La ropa, los objetos y la arquitectura necesitan contexto local; una etiqueta temporal universal no garantiza exactitud histórica.

## Separar decisiones que cumplen funciones diferentes

| Decisión | Qué expresa | Qué no implica |
| --- | --- | --- |
| Época narrativa | Tiempo, lugar y contexto de la acción | Envejecimiento automático de la imagen o del personaje |
| Tipo de cámara / captura | Carácter digital, videocámara o fotoquímico | Modelo físico calibrado, aumento de resolución o una marca real |
| Formato de película | Intención de textura y detalle: Super 8, 16, 35, 65 mm | Dimensiones efectivas del archivo ni recorte obligatorio |
| Emulsión o acabado | Dirección de color, grano y respuesta tonal | LUT medida, reproducción química exacta ni revelado real |
| Tipo de lente | Carácter esférico, anamórfico, antiguo o especializado | Focal, relación de aspecto o descompresión exacta |
| Distancia focal y apertura | Intención de perspectiva, separación y profundidad | Óptica físicamente simulada en un generador de video |

El [catálogo oficial de películas Kodak](https://www.kodak.com/en/motion/products/camera-films/) diferencia formatos, emulsiones negativas y reversibles, color y blanco y negro. Entre sus familias figuran VISION3, EKTACHROME, DOUBLE-X y TRI-X. Esto justifica separar formato de emulsión: ambos ejes son distintos y no todas sus combinaciones comerciales existen. Filmma puede usar nombres descriptivos propios; si menciona un producto real, debe identificarlo como inspiración, no como emulación certificada.

Las [Signature Prime de ARRI](https://www.arri.com/en/cine-lenses/signature-lenses/signature-primes-zooms/signature-primes) cubren múltiples focales dentro de una familia de carácter consistente. Las [Master Anamorphic de ARRI](https://www.arri.com/en/cine-lenses/arri-zeiss-fujinon-lenses/master-anamorphics) describen bokeh ovalado y accesorios específicos para variar los destellos. Por eso la familia de lente debe seleccionarse aparte de la focal; no todo anamórfico exige distorsión intensa o destellos constantes. Tampoco conviene presentar el halo de película como una propiedad exclusiva del cristal.

## Integración: puntos auditados antes de la ampliación

Estas ubicaciones corresponden al código leído al comenzar la tarea; las líneas pueden desplazarse al implementar.

- `src/cinematography.ts`: `CINEMA_VALUES` y `CINEMA_FIELDS` son el catálogo; `buildCinematographyPrompt` y `cinemaDirectionLabel` deben compartir precedencia y resolver combinaciones contradictorias. No basta con ampliar las tarjetas.
- `server/types.ts`: `cinematographySchema` es estricto. Los nuevos campos deben aceptarse también en el esquema de escena y en `generationProvenanceSchema`. El contexto histórico adicional debe validarse y limitarse en longitud.
- `server/app.ts`, función `effectiveGenerationPrompt` (líneas 402–405 originales): punto común para incorporar contexto histórico. La creación de `generation` (474–476) debe conservar una copia del contexto usado, de forma que cambiar el plano después no reescriba la historia de una toma.
- `src/storyboard.ts`, funciones `storyboardCinematography`, `storyboardDirection` y `storyboardCsv`: las opciones de `CINEMA_FIELDS` aparecen automáticamente; el contexto histórico libre necesita inclusión explícita. Conviene usar una misma descripción efectiva para HTML, CSV y las etiquetas del plano.
- `server/visual-continuity.ts`, `fingerprint` (95–100): conserva todos los datos de cada escena salvo exclusiones explícitas de audio y selección de tomas. Los campos cinematográficos y el contexto histórico dentro de la escena ya invalidan informes previos. Un contexto global nuevo sí necesitaría añadirse al cálculo.
- `src/continuity.ts`, `continuityContext` (99–103): inicialmente expone solo personajes y estados. Puede añadir la ambientación y un recordatorio editorial cuando un personaje pase entre épocas. Ese recordatorio no debe certificar anacronismos ni cambiar automáticamente su identidad o vestuario.

Pruebas recomendadas: ida y vuelta por almacenamiento y ZIP; prompt y procedencia inmutables; contexto en storyboard; invalidación de informes; conservación de rostro, vestuario, guion y originales; compatibilidad de proyectos antiguos y deshacer como un único cambio.

## Método

Se revisó primero la documentación y evidencia local existente. `firecrawl --status` indicó autenticación pero falló al consultar la cuenta (`fetch failed`); no se pudo verificar el saldo actual ni se compraron créditos. La consulta se completó con navegación web y fuentes oficiales. No se accedió a recursos privados, ni se copiaron imágenes, código o presets propietarios. Las conclusiones de diseño y de integración anteriores son propuestas propias derivadas de la revisión, no funciones atribuidas a esos fabricantes.
