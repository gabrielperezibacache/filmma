# Segunda entrega: montaje, mezcla y subtítulos

Las herramientas de montaje usan todo el ancho del editor. **Secuencia**, **Pistas**, **Mezcla** y **Subtítulos** comparten el cabezal y mantienen sus relaciones con el plano, el guion y el reparto. En escritorio, el visor permanece visible mientras los detalles se desplazan dentro de la mesa de edición. El transporte y las pestañas quedan siempre al alcance. **Ajustes del plano** abre dirección, generación, acabado y fuentes; **Volver al montaje** recupera el espacio de edición.

En móvil, **Ver visor** abre el mismo instante y **Volver a herramientas** conserva la pestaña, la selección, el cabezal y la posición de lectura. No hay un segundo reloj de previsualización. El visor y la exportación siguen usando los mismos originales; editar no sobrescribe sus archivos.

## Pistas y clips

- El candado protege los clips de una pista frente a movimiento, recorte, división, duplicación y eliminación accidental. Se puede seguir seleccionando un clip y mezclando su sonido. El bloqueo se guarda en el proyecto; no es una barrera de seguridad ni fija el orden del guion: sus clips siguen acompañando al plano de referencia cuando lo reordenas.
- **Dividir en el cabezal** necesita un fotograma dentro del clip. Conserva el archivo, la velocidad, el personaje/intervención vinculados y la curva completa de los fotogramas clave. La segunda parte avanza en el original según la velocidad del clip.
- Los fundidos conservan su reloj anterior a la división, incluso cuando se superponen o atraviesan el corte. Editar **Entrada suave** o **Salida suave** inicia un nuevo fundido para ese fragmento. Un recorte posterior actualiza también el reloj del fundido conservado.
- **Duplicar en el cabezal** crea una copia editable que comparte el original. Mantiene el plano de referencia; puede superponerse con otros clips. No sustituye una toma ni crea otro archivo de video.
- Arrastre, recorte, división y duplicación admiten Deshacer. Los límites siguen siendo ocho pistas adicionales, 500 clips y 2.000 fotogramas clave por película.

## Mesa de mezcla

**Mezcla** reúne audio del plano seleccionado, banda sonora y pistas adicionales. Muestra volumen en porcentaje y dB relativos, silencio, formas de onda del material situado en el cabezal y escucha aislada. Los dB son una conversión del control de ganancia; no son una medición LUFS o de presión sonora. Las formas de onda tampoco son un medidor del pico de la suma.

**Aislar** afecta sólo al visor durante la sesión. El aviso permanece visible al cambiar de herramienta y **Escuchar todo** restaura la mezcla. No cambia el proyecto ni el MP4 exportado. Volúmenes, silencios y fundidos sí se guardan y se exportan; silenciar la banda sonora conserva su nivel para reactivarla.

El navegador limita la ganancia de un elemento de audio al 100 %. Una banda sonora heredada por encima de ese nivel muestra una advertencia para comprobarla en la exportación. La mezcla del MP4 conserva sus intermedios flotantes y el limitador final existente; no se ha añadido normalización automática de sonoridad.

Las voces conservadas que ya no coincidan con el guion, la elección vocal o el estado del personaje aparecen como pendientes de revisión. También se señala una voz movida a un plano distinto al de su intervención. No se regenera ni sustituye audio automáticamente.

## Subtítulos en la línea de tiempo

Cada texto tiene un tramo editable dentro de su plano. Arrastra el cuerpo para desplazarlo o sus bordes para recortarlo. El reloj usa los FPS de salida; conserva al menos un fotograma y no mueve silenciosamente el subtítulo a otra escena. Las flechas cambian un fotograma y Mayús cambia un segundo. El cabezal admite Inicio y Fin.

**Dividir texto en el cabezal** conserva las palabras y la asociación de personaje y voz a ambos lados. Después puedes editar cada fragmento. Las observaciones existentes de superposición, lectura y guion cambiado siguen visibles. Revisa los textos repetidos y su ritmo antes de entregar.

**Voz y guion de este texto** vincula el subtítulo con una intervención del mismo plano, permite escuchar su audio conservado y muestra cuándo requiere revisión. **Usar tiempos de esta voz** ajusta sólo entrada y salida, al fotograma más cercano; conserva las palabras editadas. Se bloquea si cambiaron voz, guion, personaje o continuidad, si la intervención pertenece a otro plano o si el audio no cabe. No transcribe ni sintetiza voz por sí mismo.

La asociación explícita se conserva al duplicar escenas y al exportar/importar un paquete Filmma. Los identificadores se reasignan junto con la intervención y el personaje. Retirar una intervención desvincula los textos manuales que la referenciaban, conservando sus palabras; el subtítulo automático de esa intervención mantiene su comportamiento de retirada existente.

## Importar SRT sin reemplazar ediciones

1. Pulsa **Importar SRT** y selecciona un archivo UTF-8 de hasta 512 KiB.
2. Revisa los textos, los planos y sus intervalos. Puedes introducir un desplazamiento global con coma o punto decimal; **Revisar tiempos** prepara otra propuesta. Cambiar ese valor desactiva la confirmación hasta revisarlo.
3. Un intervalo que atraviesa un corte se reparte entre sus planos y conserva todo el texto en cada tramo. Los tiempos se cuantizan al fotograma. Las entradas sin duración visible o fuera de la película se señalan; los tramos parcialmente fuera se identifican antes de confirmar.
4. **Añadir subtítulos revisados** conserva los existentes. Si el montaje, el guion o sus subtítulos cambiaron durante la revisión, debes preparar la propuesta de nuevo. Los textos importados no reciben un personaje de forma automática.
5. Revisa superposiciones, lectura y personajes. La importación no intenta resolverlas borrando tus textos anteriores.

El límite es de 1.000 entradas de origen y 1.000 subtítulos resultantes en la película. Las etiquetas de formato se presentan como texto, sin ejecutar HTML. El archivo SRT elegido se lee sin modificarlo; el paquete Filmma conserva los subtítulos editables resultantes, no una copia del archivo SRT externo. Guarda ese archivo junto a tus otros originales si necesitas archivarlo.

## Guion y continuidad durante el montaje

El desplegable **Guion y continuidad de este plano** muestra acción, diálogo, reparto, vestuario y objetos previstos para la aparición. Abre el guion, las voces o la ficha del personaje sin perder el plano seleccionado. Estos son estados escritos de la historia, no una comprobación de que el rostro o la ropa del video coincidan. La comparación visual sigue en **Continuidad**.

## Verificación

Las pruebas automatizadas cubren relojes de fuente, animación, fundidos a nivel de muestras PCM, bloqueos durante un arrastre, importación SRT, fotogramas, asociaciones vocales y estados de continuidad. Una exportación real H.264/AAC se decodifica completamente y comprueba que la banda sonora silenciada esté ausente. El paquete Filmma se vuelve a importar para verificar los vínculos y que los originales sigan intactos.

Las pruebas de interfaz se ejecutan en `output/qa/second-delivery/store`, fuera de la película de producción. Los tonos de prueba se identifican expresamente; no son voces generadas ni acreditan sincronización labial. Las intervenciones Qwen reales, cuando se ensayan, se registran por separado con su procedencia, duración y alcance. Evidencias, capturas y resultados se conservan en `output/qa/second-delivery/`.

Se verificó una intervención Qwen real de 2,24 segundos a 24 kHz con el modelo ya instalado de Hermes, sin descargar pesos. El ajuste de tiempos conservó el texto editado del subtítulo; cambiar el vestuario previsto desactivó la alineación de esa voz anterior. Esto acredita procedencia y vigencia de la asociación escrita, no identidad facial ni sincronización labial. La prueba móvil conservó texto, personaje, pestaña, cabezal y desplazamiento al abrir y cerrar el visor.

[Resultados y límites de la verificación](SECOND-DELIVERY-QA.md).
