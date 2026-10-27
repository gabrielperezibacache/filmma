# Restauración estable local

Filmma incorpora tres tratamientos compatibles con generación, preparación de película, selección de versiones y exportación4K revisada:

- Conservar textura:35% inicial, hasta70%; intervención limitada al detalle fino.
- Restaurar definición:75% inicial, hasta85%; restauración neural con color amplio de la fuente.
- Restauración estable:65% inicial, hasta85%; la misma restauración, con compensación de movimiento sólo en las pequeñas correcciones de textura añadidas por IA.

Las opciones anteriores conservan sus valores y versiones. Cambiar de tratamiento crea una copia desde el original retenido; no encadena restauraciones ni confunde sus cachés. La preparación de película incorpora las copias sin cambiar guion, personajes, recortes, color, velocidad, subtítulos ni audio. La exportación revisada usa exactamente las copias aceptadas; no inicia otra inferencia.

## Funcionamiento y límites

Real-ESRGAN x4plus sigue procesando un fotograma a la vez en mosaicos128. El tratamiento estable calcula flujo óptico bidireccional sobre la fuente, hasta960px de lado mayor. Compara consistencia del movimiento y color, descarta zonas que aparezcan nuevas y reinicia al detectar cortes o cambios de geometría.

Sólo compensa el residuo de IA del fotograma anterior. La base del fotograma actual conserva su encuadre y tiempo. El peso anterior se limita a45%, el cambio entre residuos a12 niveles y la modificación temporal a6/255 por canal; en la prueba real el máximo observado fue5. El estado guarda sólo un fotograma, independientemente de la duración total. No se reconstruyen rostros ni se usa un prompt generativo adicional.

Estas restricciones reducen cambios innecesarios, pero no garantizan identidad ni ausencia de estelas. El flujo puede fallar ante oclusiones, movimientos rápidos o texturas repetidas. Revisar varios instantes en Comparar antes de exportar, especialmente rostros, manos, vestuario, objetos finos y cortes. No corrige pseudotexto, objetos mal formados ni movimiento incorrecto que ya estén en el video original.

El límite de procesamiento sigue siendo15s por archivo, hasta60fps, SDR y fuente FullHD o equivalente vertical. La copia de IA conserva las dimensiones proporcionales dentro del presupuestoUHD y el montaje final encaja la imagen completa, sin recortarla. No se extiende una toma repitiendo imágenes para aparentar duración generada.

## Preparación

`python3 runtime/filmma_upscale.py setup --temporal --json` prepara el motor existente y el componente opcional OpenCV4.11.0.86 de38MB. La rueda oficial dePyPI se fija por versión, tamaño y SHA256 en `runtime/temporal-dependency.json`; se instala dentro del proyecto, sin modificar el Python global. La procedencia del hash esPyPI, no una firma independiente del autor. Se conservan licencias en el paquete.

La interfaz muestra Preparar acabado estable cuando falta el componente; no encola una mejora que no pueda ejecutarse. Los otros tratamientos siguen disponibles. El diagnóstico incluye `temporalAvailable`. Las copias guardan el perfil `temporal`, el modo `motion-compensated-residual-v1`, los hashes de fuente/salida y medidas de estabilización; esta procedencia sobrevive a un paqueteFilmma exportado e importado.

## Evidencia en M4Max36GB

`output/qa/temporal-720-comparison/` contiene una comparación real de22fotogramas nativos1280×736 a24fps (0,916667s), restauración normal65% y estable65%. Ambas salidas3840×2160 fueron decodificadas completamente y conservan los paquetes de audio y el originalSHA256. Se inspeccionaron recortes del objetivo/cuerpo en fotogramas0,11,21: la diferencia es sutil, con definición comparable y textura algo más uniforme.

La variación media de los residuos pasó de0,797109 a0,708204 (11,2%menos). Es una medida descriptiva sin registro de movimiento; no equivale a parpadeo puro, detalle real recuperado ni una puntuación de calidad. Se estabilizaron21fotogramas, sin reinicios, confianza media0,881 y cambio temporal máximo5/255. La comparación de dos acabados reutilizando una inferencia por fotograma tardó215,93s. RSS máximo separado: proceso0,85GiB y mayor hijo0,81GiB; no son máximos simultáneos ni toda la memoriaGPU/unificada.

`output/qa/temporal-pipeline-v2/validation.json` verifica además una inferencia real sobre24fotogramas a512×320 de un archivo ya existente (un segundo). Se preparó la película, se seleccionó su copia3642×2276 y se exportó3840×2160 reutilizándola, sin repetir la inferencia. Se comprobaron fotogramas, fps, duración, decodificación, audio, guion, personajes y originales. Esta prueba técnica no se presenta como generación720p ni como validación de una toma largaHD.

Las20 pruebasPython cubren el algoritmo, cortes, objetos nuevos, movimiento, límites de cambio, estado de memoria constante y contratos existentes. Las28 pruebasAPI/película y las comprobaciones de paqueteFilmma cubren preparación, valores anteriores, familias de originales, cachés y procedencia. Las pruebas de trabajador sintético validan contratos; no son evidencia de inferencia ni de calidad perceptual.

La toma continuaHD de14,375s anterior sigue fallida por presión crítica de memoria. No se ha repetido ni reactivado su monitor. Se conserva por separado toda su evidencia; esta mejora de postproducción no demuestra que esa generación larga quepa en36GB.

Fuentes del método base: [OpenCV, flujo óptico](https://docs.opencv.org/4.11.0/d4/dee/tutorial_optical_flow.html), [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN). La combinación de residuo, límites y compuertas pertenece a Filmma.
