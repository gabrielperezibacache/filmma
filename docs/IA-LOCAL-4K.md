# Detalle con IA local en 4K

Filmma puede crear una versión mejorada de una toma con **Real-ESRGAN x4plus**, ejecutado en el Mac mediante NCNN y MoltenVK. El modelo es fotográfico. No usa restauración facial, personajes nuevos, prompts ni servicios remotos durante el procesamiento.

## Elegir el tratamiento

**Conservar textura** mantiene el acabado anterior, con intensidad inicial del 35 % y rango del 15 al 70 %. Añade un residuo pequeño de detalle, por lo que puede verse casi igual a la ampliación convencional cuando la fuente es borrosa.

**Restaurar definición** usa más de la reconstrucción de Real-ESRGAN, con intensidad inicial del 75 % y rango del 15 al 85 %. Corrige diferencias amplias de iluminación y color respecto del original antes de mezclar. En las pruebas de la toma MiniMax de 512 × 320 produjo contornos más definidos; puede suavizar texturas, cambiar reflejos y estimar detalles que no existían. No usa restauración facial separada, no garantiza identidad y no convierte la fuente en detalle óptico 4K.

Ambos tratamientos crean derivados nuevos desde el original. El perfil queda registrado en la procedencia y participa en la compatibilidad de copias: una versión conservadora no sustituye una restauración, aunque coincidan el modelo y la intensidad. Las copias antiguas sin perfil se consideran conservadoras. El modo se mantiene al generar, preparar la película y exportar; la revisión debe corresponder al mismo perfil e intensidad.

## Uso en el editor

1. Abre una toma que tenga video y entra en **Acabado → Detalle con IA local**.
2. Si aún falta el motor, prepáralo desde ese apartado. La descarga oficial ocupa aproximadamente 52 MB y se verifica antes de usarla.
3. Elige **Conservar textura** o **Restaurar definición**. Empieza con el valor inicial del tratamiento y compara antes de aplicarlo; una intensidad mayor puede hacer más visibles las texturas estimadas por el modelo.
4. Inicia la mejora. Se crea un archivo nuevo y el original sigue disponible.
5. Revisa la versión con **Comparar**. La vista muestra las dimensiones medidas del original y de la copia; **100 % de la copia** permite recorrerla con las barras, el trackpad o las flechas y **200 %** amplía aún más el detalle. Avanza por varios fotogramas. Si la prefieres, selecciona **Usar**. La toma mantiene su enlace con el guion, los personajes y su familia de versiones. La aplicación conserva los ajustes de montaje cuando se cambia entre el original y una versión derivada de la misma fuente.

La corrección de color, la velocidad, las capas y los subtítulos siguen perteneciendo al montaje. El reescalado mejora el archivo fuente y conserva su duración y sus fotogramas, por lo que no desplaza el diálogo ni altera el tiempo del guion.

## Un mismo acabado para la película

Abre **Acabado de la película** en el estudio. **Tratamiento de toda la película** e **Intensidad de toda la película** guardan un perfil y ajuste comunes (15–70 % conservador; 15–85 % restauración), para preparar la secuencia, mejorar las nuevas generaciones y realizar la entrega con IA. Los puntos de partida son 35 % conservador y 75 % restauración; usar el mismo perfil e intensidad ayuda a mantener un tratamiento coherente, pero no constituye una garantía de identidad visual.

**Preparar y usar versiones IA** recorre los videos de los planos y de las capas visuales. Cada original se procesa una sola vez aunque aparezca en varios lugares del montaje. Las imágenes fijas se conservan, y las pistas de audio independientes no se envían al modelo de imagen.

Las copias compatibles ya terminadas se reutilizan después de comprobar su archivo. Deben pertenecer al mismo original y coincidir en modelo, versión, huella de los pesos, intensidad y perfil de procesamiento. Si cambias la intensidad, Filmma crea o busca otra versión desde el original conservado: no añade pasadas neuronales encima de una copia mejorada.

Cuando una copia está lista, se vincula a sus planos y capas conservando guion, personajes, recortes, color, velocidad, animación, duración y sonido. Si cambias manualmente el material de un plano o capa mientras la tarea avanza, ese cambio se respeta; la copia obtenida sigue disponible en la biblioteca. **Volver a originales** recupera los archivos de origen en el montaje sin borrar las versiones creadas. Después puedes comparar y elegir cada toma por separado.

La actividad muestra cuántas fuentes se procesaron, cuáles reutilizaron una copia, cuáles conservaron su original y cuáles tuvieron una incidencia. Un error no borra las copias anteriores ni impide revisar los resultados que sí terminaron. **Cancelar** detiene la tarea y conserva los originales y las copias completas. Al volver a preparar la película se reutiliza lo que siga siendo compatible y se intenta completar lo pendiente.

### Mejorar después de generar

Activa **Mejorar cada toma después de generarla** para aplicar ese acabado común a las nuevas tomas, también al usar **Generar pendientes**. El motor de IA debe estar preparado antes de comenzar. Primero se genera, verifica y guarda la toma original; después se crea su versión de detalle, con una sola operación de GPU a la vez.

Si la mejora falla o se cancela después de guardar la toma, la generación original permanece en la biblioteca. La actividad distingue que falta el acabado; no es necesario volver a generar la toma para reintentar su mejora. Activar esta opción no procesa por sí solo los videos que ya estaban en la película: para ellos usa **Preparar y usar versiones IA**.

### Entregar en 4K con IA

La entrega 4K desde el editor requiere revisar las fuentes que se exportarán. Completa el flujo en este orden:

1. Elige la intensidad y pulsa **Preparar y usar versiones IA**. Espera a que las copias de planos y capas estén terminadas y seleccionadas en el montaje; resuelve las fuentes incompatibles antes de continuar.
2. En **Continuidad**, analiza esas fuentes seleccionadas. Revisa cada pareja de apariciones, registra sus decisiones y confirma el visionado final y los límites del análisis.
3. En **Exportar**, elige **4K UHD** y activa **Usar versiones con IA revisadas**. Filmma verifica que las copias seleccionadas sean compatibles con el acabado elegido y pertenezcan al informe aprobado. Después compone el MP4 con esas mismas fuentes, capas, color, sonido y subtítulos.

Esta exportación no inicia otra inferencia ni cambia las fuentes aprobadas por copias distintas. Si todavía están seleccionados los originales, falta una versión compatible o la revisión quedó obsoleta, el editor solicita preparar y revisar antes de entregar. Las imágenes fijas se adaptan al lienzo final sin aplicarles el modelo de video. Los originales y las copias completas permanecen disponibles; un fallo de preparación permite reintentar sin borrar resultados.

### Revisar las apariciones entre planos

La revisión de continuidad compara cada personaje u objeto con su aparición anterior en el orden del montaje. Usa un fotograma por plano, cuyo instante puedes cambiar; respeta el recorte y la velocidad y aplica el color del plano. Compara las fuentes seleccionadas, incluidas las versiones IA, y no modifica sus archivos.

Puedes delimitar en ambas imágenes zonas de **Rostro**, **Vestuario** u **Objetos**, dibujándolas o ajustando sus coordenadas. El motor puede sugerir rostro y torso cuando hay un personaje sin ambigüedad; el torso es una estimación geométrica, no una segmentación de prendas. Los objetos requieren zonas manuales. Un resultado **Posible diferencia** o **No concluyente** necesita una decisión y una nota; **Sin diferencia evidente** sólo describe la zona y el fotograma examinados. No se confirma identidad ni se reconoce semánticamente la presencia de un objeto.

Las comparaciones incluyen la información de continuidad del guion y los cambios intencionales declarados. Estos datos ayudan a decidir, pero no sustituyen la revisión de las imágenes. También debes reproducir la película completa: el muestreo no cubre toda la duración, las capas, las animaciones ni las transiciones. La aprobación final registra el alcance revisado, y se retira al reabrir o cambiar una decisión.

El informe queda obsoleto si cambias las fuentes, su contenido, el orden o los ajustes visuales del montaje, los vínculos y estados de personajes, las zonas o los instantes. Otra versión de IA necesita otra revisión. La exportación comprueba que coincidan el informe, las fuentes seleccionadas y sus huellas; no considera que revisar el original apruebe automáticamente una copia mejorada. [Detalles y límites del análisis visual local](CONTINUIDAD-LOCAL.md).

### Comprobar si una fuente es compatible

Antes de iniciar la inferencia de cada video, Filmma inspecciona el archivo y sus tiempos con herramientas locales de CPU. La comprobación del motor verifica disponibilidad e integridad de los pesos sin ejecutar el modelo. Un motor preparado y una fuente compatible son condiciones diferentes; una GPU ocupada tampoco significa que el archivo sea incompatible.

Se revisan duración, resolución, proporción de píxel, orientación, color, número de fotogramas, frecuencia y audio. Para demostrar que la frecuencia es constante se comprueban los tiempos de los fotogramas; no basta con la media anunciada por el archivo. El perfil admite un archivo local de hasta 2 GiB, una única pista de video y hasta ocho pistas de audio de ocho canales cada una.

Los límites de 15 segundos y Full HD se aplican al **archivo de origen completo**, no sólo al tramo visible después de recortarlo en la línea de tiempo. Una fuente más larga o mayor debe prepararse explícitamente como otra toma compatible. Se informa el motivo cuando una fuente no cumple los requisitos; no se recorta, reduce ni convierte HDR de forma oculta.

## Qué significa 4K en este flujo

Se aplica **una sola pasada neuronal nativa de 4×**. Después se adapta el resultado al tamaño final mediante Lanczos, manteniendo el encuadre y los límites de 3840 píxeles en el lado mayor y 8.294.400 píxeles de superficie. Las dimensiones son pares para codificar video compatible.

| Fuente | Versión mejorada | Comportamiento |
|---|---|---|
| 512 × 288 | 3840 × 2160 | IA hasta 2048 × 1152 y ampliación final convencional |
| 864 × 480 | 3840 × 2132 | Conserva su proporción, con redondeo de hasta dos píxeles |
| 1920 × 1080 | 3840 × 2160 | IA 4× por fotograma y reducción final a UHD |
| 288 × 512 | 2160 × 3840 | Vertical, sin recortar |
| 1024 × 1024 | 2880 × 2880 | Cuadrado dentro del mismo presupuesto de píxeles |

Un archivo final 4K no equivale a una captura o generación nativa 4K. La IA estima texturas; no puede recuperar de forma demostrable información que no estaba en la fuente. El montaje 16:9 exportado en UHD incorpora las tomas de otras proporciones según el encuadre del proyecto.

## Continuidad y protección del original

El tratamiento **Conservar textura** toma como base el original ampliado con Lanczos. Calcula la diferencia entre esa base y la salida neuronal, elimina la variación de baja frecuencia con un desenfoque gaussiano y añade sólo el detalle restante, limitado a ±24 niveles RGB antes de aplicar la intensidad. Al 35 %, la variación máxima de este paso es de aproximadamente 8 niveles por canal antes de codificar.

El tratamiento **Restaurar definición** mezcla la salida neuronal con la base ampliada después de corregir diferencias de baja frecuencia mediante un desenfoque más amplio. La corrección se calcula por bloques de filas para limitar memoria; no modifica la fórmula conservadora anterior.

El método conservador limita alteraciones amplias de color y geometría. No mezcla fotogramas vecinos, por lo que no introduce estelas por promediado temporal; tampoco aplica reconstrucción de rostros. **No garantiza identidad facial perfecta ni ausencia de parpadeo.** Conviene revisar ojos, pelo, manos, prendas, texto y objetos que deban permanecer idénticos entre planos. Reducir la intensidad o volver al original sigue siendo posible.

El archivo original se abre sólo para lectura. Se comprueba su SHA256 antes y después. La salida se publica con un nombre nuevo después de validar dimensiones, frecuencia y fotogramas. La procedencia registra el original, el modelo, su huella, intensidad, modo de procesamiento y métricas. El servidor conserva o reconstruye el audio y verifica el resultado completo antes de añadirlo a la biblioteca.

## Perfil para M4 Max de 36 GB

- Motor macOS universal con código arm64 nativo y MoltenVK; no necesita CUDA ni Rosetta en Apple Silicon.
- Bloques de **128 × 128**, un dispositivo y una tarea GPU; carga/proceso/guardado `1:1:1`, sin TTA.
- Un fotograma a la vez. Sólo se guardan temporalmente el PNG de entrada, su salida neuronal y el archivo de video en construcción. No se extrae el video completo a una carpeta de imágenes.
- La GPU queda bloqueada para esta tarea mediante el mismo archivo `runtime/.generation.lock` usado por MiniMax y LTX. Una descarga de pesos puede continuar; otra inferencia espera o informa que la GPU está ocupada.
- Fuente SDR de hasta **1920 × 1080** o su equivalente vertical, máximo **15 segundos** y **60 fps**. No se reduce una fuente mayor de forma oculta.
- La primera versión requiere frecuencia constante, píxeles cuadrados y comienzo en cero. Se rechazan HDR, frecuencia variable y fuentes anamórficas para evitar cambios silenciosos de color o tiempo.
- Reserva mínima de 2 GiB libres para los temporales. Los procesos hijos reciben cancelación conjunta y se terminan antes de liberar el bloqueo de generación.

El tamaño de los pesos no representa el consumo total de memoria. Las mediciones de RSS del proceso Python y del mayor proceso hijo se reportan separadas; no equivalen a un pico simultáneo de memoria unificada ni a una medición completa de memoria GPU.

## Prueba real en este Mac

El 17 de octubre de 2026 se procesó una toma LTX de **864 × 480**, 25 fotogramas a 24 fps y 1,041667 segundos, con intensidad del 35 %. El resultado fue **3840 × 2132**, con los mismos 25 fotogramas, frecuencia y duración. La decodificación completa del MP4 terminó sin errores.

| Medición | Resultado |
|---|---|
| Tiempo del trabajador de IA y codificación | 99,391 s |
| Tiempo total de la operación de la aplicación | 102,188 s |
| Tiempo por fotograma, incluyendo el flujo del trabajador | 3,976 s |
| Máximo RSS del mayor proceso hijo | 984.514.560 bytes, aproximadamente 0,92 GiB |
| Máximo RSS del trabajador Python | 395.608.064 bytes, aproximadamente 0,37 GiB |
| Mayor diferencia RGB respecto de Lanczos, antes de codificar | 8 niveles de 255 |
| Diferencia RGB media respecto de Lanczos, antes de codificar | 0,75317 niveles de 255 |

Las huellas del original y de su copia de prueba permanecieron idénticas. También se verificó que la creación de la versión no modificara escenas, personajes ni el proyecto de producción. Esta toma no contenía audio. La medición se refiere a ese archivo y esos parámetros; no garantiza el mismo tiempo para otra resolución o material. Los valores RGB describen cuánto añade el método conservador, no una puntuación de calidad ni una prueba de identidad o continuidad temporal.

La evidencia detallada está en `output/qa/ai-upscale/verified.json`; las pruebas del trabajador están en `output/qa/ai-upscale-runtime-tests.txt`.

Después de esa prueba GPU se añadió únicamente la fijación explícita de las etiquetas de rango, primarias y transferencia mediante `setparams`: FFmpeg ya convertía con matriz BT.709, pero omitía dos etiquetas del archivo. La versión final de esa etapa se comprobó con una prueba CPU de codificación y decodificación RGB → H.264 → RGB: las cuatro etiquetas quedaron correctas y el error máximo del color uniforme de control fue de 3 niveles RGB o menos. La evidencia es `output/qa/ai-upscale/color-check-setparams.mp4` y `output/qa/ai-upscale/color-metadata-verified.json`. No se repitió la inferencia neuronal para este ajuste de metadatos; las cifras de rendimiento de la tabla pertenecen a la prueba GPU anterior a ese ajuste.

## Motor, licencias y verificación

Se usa el paquete oficial [`realesrgan-ncnn-vulkan-20220424-macos.zip`](https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.2.5.0), con el ejecutable NCNN v0.2.0 y el modelo `realesrgan-x4plus`. La [compilación oficial](https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan/blob/v0.2.0/.github/workflows/release.yml) incluye arm64 y x86_64 con MoltenVK estático. Los [parámetros del motor](https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan#full-usages) documentan bloques y control de concurrencia.

| Componente | SHA256 fijado en Filmma |
|---|---|
| Paquete oficial | `e0ad05580abfeb25f8d8fb55aaf7bedf552c375b5b4d9bd3c8d59764d2cc333a` |
| Ejecutable universal | `c1c35d92079085de96b9d547fd7e4464bc8a2e9ccf28d7b8c712d72ade91b7cc` |
| Pesos x4plus | `713ee713b0353afaa27976f0563a64a5043bd70b9bd8936c2e26e25ebcdbcddf` |
| Arquitectura NCNN | `35330ececcea33b6c397a72548e788d5d53becee4734c50b7fada36e89f10a86` |

Estas huellas se calcularon sobre la descarga HTTPS oficial del 17 de octubre de 2026 y quedan fijadas en `runtime/upscale-model.json`. El autor no publicó una suma firmada independiente para ese archivo; la verificación detecta cambios posteriores, pero no constituye una firma del autor.

El código NCNN tiene licencia MIT y Real-ESRGAN licencia BSD de tres cláusulas. Los textos completos se conservan en `runtime/upscale-LICENSES.txt` y se copian a la instalación local del motor.

Para revisar la instalación sin ejecutar inferencia:

```sh
python3 runtime/filmma_upscale.py doctor --json
```

La preparación es idempotente y no cambia MiniMax ni LTX:

```sh
sh scripts/setup-upscaler.sh
```

El trabajador se invoca desde la aplicación con una solicitud JSON que incluye fuente, destino nuevo, carpeta temporal, intensidad y dimensiones de salida. Emite progreso y resultados JSONL. La reproducción, la mezcla de audio y la incorporación de la versión a la biblioteca permanecen bajo control del servidor de Filmma.
