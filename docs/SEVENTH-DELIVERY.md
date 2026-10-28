# Séptima entrega · Color, scopes y comparación entre planos

En **Montaje → Ajustes del plano → Acabado → Scopes y comparación entre planos**, el plano actual se compara con otro plano de la película. Se propone una aparición anterior de un personaje compartido cuando existe, o un plano vecino. Cada referencia puede cambiarse manualmente; también puede revisarse sólo el plano actual.

## Capturar y leer

Elige inicio, medio o final, o un fotograma del tiempo editado, para cada plano. **Capturar muestras** guarda los ajustes antes de leer las fuentes seleccionadas, conserva su recorte y velocidad y avisa si la toma ya terminó. Nunca toma una copia ligera del visor como original. Imágenes ausentes, fuentes ilegibles, solicitudes simultáneas y errores tienen respuesta explícita; la captura se cancela al cerrar la comparación.

El análisis usa CPU con concurrencia de una captura y dos hilos, una muestra a la vez. Reduce hasta 640 px por lado antes de aplicar el mismo look y matriz de corrección del render. PNG sin JPEG intermedio. Los archivos de trabajo temporales se retiran al terminar; las fuentes se comprueban por identidad/tamaño/fechas antes y después, sin modificarlas.

Incluye:

- Forma de onda de luma por posición horizontal.
- Parada RGB con canales separados.
- Histograma de rojo, verde, azul y luma, con escala logarítmica independiente por canal.
- Luma media, porcentaje de píxeles negros con todos sus canales ≤2 y porcentaje con algún canal ≥253.

La luma es una suma ponderada Rec.709 de RGB decodificado de 8 bits, en valores digitales 0–255. No representa luz de escena, señal RAW, IRE ni scopes HDR. Las fuentes etiquetadas HDR o BT.2020 se rechazan sin tone mapping implícito. Las fuentes sin metadatos se interpretan como SDR; un HDR mal etiquetado no queda certificado. Los porcentajes muestran valores cercanos a los extremos en la muestra reducida, no demuestran clipping de la toma original.

## Comparar con contexto

Cada imagen muestra plano, archivo, dimensiones de muestra e instante de fuente. **Sin look ni corrección** permite revisar la fuente. Cambiar color, fuente, recorte, velocidad o instante conserva las muestras anteriores y pide capturarlas de nuevo.

**Guion y continuidad previstos** sitúa acción, diálogo, personajes, vestuario, apariencia, objetos y cambios intencionales junto a cada muestra. Un parecido de color no certifica identidad ni continuidad: revisa varios instantes, las apariciones y el máster.

Los controles ajustan sólo el plano actual, con Deshacer/Rehacer. **Aplicar color de referencia** copia exclusivamente corrección y look; conserva guion, personajes, voz, tiempos y fuentes. El informe JSON descarga metadatos y scopes con estado de vigencia; no escribe una aprobación de continuidad ni altera el proyecto.

## Evidencia y límites

Pruebas con píxeles conocidos para luma, histogramas y parada, API con corrección real de exposición, fuente seleccionada, recorte/velocidad, final agotado, exclusión HDR/BT.2020, serialización y originales intactos. La comparación de interfaz usa referencias técnicas 4K con zoom creadas previamente sobre imágenes existentes: no es nueva generación IA ni evaluación de identidad facial.

Se conservan los límites de las muestras: no incluyen capas, transiciones, subtítulos, barras del lienzo ni evaluación de LUT externas. La revisión temporal de restauración sigue en su comparador específico. Evidencia en `output/qa/seventh-delivery/`; la exportación de prueba y el paquete reabierto preservan ajustes de color, sonido, textos y vínculos.
