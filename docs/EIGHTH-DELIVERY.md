# Octava entrega · Continuidad visual a lo largo de la toma

En **Continuidad → Lo que permanece**, elige **3 instantes** (inicio, medio y final) o **5** (añade los cuartos) y pulsa **Analizar continuidad**. Cada personaje u objeto sigue sus apariciones en el orden del guion. Un video con una única aparición también permite revisar su evolución interna.

## Comparar y decidir

El selector y las miniaturas distinguen comparaciones **entre planos** y **dentro del plano**. Rostro, vestuario y objetos tienen resultados separados para cada intervalo. El resumen conserva la señal más importante: una posible diferencia no desaparece al promediarla con muestras similares. «No concluyente» pide revisar la imagen o ajustar la zona.

Cada imagen conserva nombre del plano, instante editado e instante de fuente. **Instante y coordenadas** permite cambiar el tiempo de esa muestra o delimitar la zona correspondiente a ese personaje y aspecto. Los ajustes son por instante: cambiar el final no sustituye las zonas del inicio. Se conservan los ajustes antiguos de un único fotograma como ajustes del medio, y las zonas comunes antiguas se heredan hasta editar una muestra.

**Lo previsto en el guion** muestra la acción, el diálogo y el estado efectivo de ambas muestras: apariencia, vestuario u objetos, con el motivo de un cambio intencional. La vinculación editorial no constituye reconocimiento de identidad. Cada aparición exige confirmar la revisión de todos sus intervalos; diferencias, incertidumbre y cambios intencionales requieren una nota. La confirmación final del alcance permanece independiente.

## Revisión selectiva

**Analizar cambios** conserva el análisis y las decisiones explícitas de apariciones cuyos archivos, contexto del personaje, guion, escena narrativa, dirección, color, tiempos y zonas siguen iguales. Compara SHA256 de las fuentes y referencias, además de los ajustes. Si falta una miniatura conservada, vuelve a analizar esa aparición. No reutiliza informes anteriores al muestreo múltiple.

Las apariciones afectadas pierden su decisión y requieren revisión. La confirmación final nunca se copia a un informe nuevo. **Rehacer análisis completo** calcula todas las apariciones y retira las decisiones anteriores del informe nuevo. Los informes y originales previos permanecen guardados. El flujo 4K estricto rechaza informes pendientes, parciales o desactualizados, y vuelve a comprobarlos al ejecutar una exportación en cola.

## Alcance local

Apple Vision se ejecuta en CPU, de forma serial, sobre PNG SDR reducidos hasta 1024 px por lado, con recorte temporal, velocidad y color del plano. No usa las copias ligeras del visor. Tres instantes producen hasta siete intervalos para el primer par de apariciones; los pares posteriores reutilizan la cobertura interna del plano ya revisado. Cinco instantes amplían la cobertura. Un límite de 3.000 intervalos previstos evita trabajos desproporcionados.

Una imagen fija aporta una sola muestra. La repetición por final agotado de la fuente cuenta una sola vez, conservando el aviso y el tiempo editado; el recuento distingue posiciones de fotograma en la fuente, no imágenes perceptualmente idénticas. El muestreo no inspecciona cada fotograma. Capas, animaciones, transiciones, subtítulos y composición final requieren visionado. Las fuentes etiquetadas HDR/BT.2020 se rechazan sin conversión implícita.

El rostro se localiza automáticamente sólo cuando hay un único rostro claro y un único personaje humano inequívoco vinculado. Las regiones de vestuario automáticas son estimadas. Objetos requieren zonas manuales correspondientes; no hay reconocimiento semántico de objetos, identificación biométrica ni garantía de continuidad. Luz, pose, escala y oclusión pueden producir avisos o resultados no concluyentes.

## Verificación

Las pruebas de regresión cubren tiempos por fotograma, tres/cinco muestras, fuentes agotadas, zonas independientes, apariciones únicas, cancelación, conservación selectiva, referencias cambiadas, reconstrucción de miniaturas ausentes y bloqueo de exportaciones desactualizadas.

La prueba real con Apple Vision en `output/qa/eighth-delivery/` utiliza tres videos técnicos derivados de una imagen existente: nueve posiciones de fuente y doce intervalos. Un cambio sutil de saturación resultó no concluyente; una variación fuerte de luz se señaló entre planos y dentro de la toma, sin alterar umbrales. No es una validación de reconocimiento facial ni una nueva generación IA. El MP4 de prueba tiene 3840×2160, 24 fps, 288 fotogramas, 12 segundos y audio, con decodificación completa. Esa resolución de exportación no acredita detalle nativo 4K.

Se comprueban los hashes de los siete archivos protegidos de producción y de las fuentes QA. Análisis y exportación conservan el guion, personajes, voces, subtítulos y vínculos del proyecto aislado. Los informes son archivos derivados locales; no se envían imágenes a servicios externos.
