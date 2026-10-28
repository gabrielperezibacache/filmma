# Sexta entrega · Sonido y subtítulos

Esta entrega profundiza en el bloque de sonido y textos pendiente del plan. Conserva las voces elegidas, las referencias de cada personaje, el guion y todos los archivos originales. Sus ajustes se guardan en el proyecto, se pueden deshacer y viajan en el paquete Filmma.

## Música que deja espacio al diálogo

En **Montaje → Mezcla → Acabado de sonido**, activa **Bajar música durante las voces**. La banda sonora y las pistas de audio elegidas se atenúan; los clips vinculados a intervenciones no se atenúan. Reducción inicial: 12 dB, anticipación: 0,2 s y recuperación: 0,6 s. Las pausas pequeñas mantienen la reducción para evitar subidas bruscas entre intervenciones.

Los intervalos proceden de los clips de voz realmente colocados, con recorte, velocidad, duración y silenciamientos. No se estima el habla a partir del texto. Las fuentes de voz con duración conocida no mantienen la reducción después de agotarse. Reordenar los planos mueve sus voces y los intervalos. El visor y el render comparten la envolvente; la escucha aislada sigue siendo una ayuda del visor.

## Medición y normalización

**Medir y preparar escucha** guarda primero el proyecto y crea una copia WAV estéreo a 48 kHz de la mezcla, con mediciones de LUFS integrados, pico real en dBTP y rango en LU antes y después. CPU local, trabajo serial y cancelable, hasta 30 minutos y reserva de 1 GiB más el espacio estimado de trabajo. Para mantener el mismo montaje sonoro, la preparación usa el render con imagen de trabajo pequeña; no modifica fuentes ni carga un modelo IA.

Normalización desactivada por defecto. Al activarla, el objetivo inicial es −16 LUFS y el techo −1,5 dBTP; son elecciones iniciales de Filmma, no una certificación de plataforma. FFmpeg realiza medición y normalización `loudnorm`, lineal cuando es posible y dinámica cuando lo requiere. Una única corrección de ganancia, entre −24 y +12 dB y limitada por el pico medido con 0,2 dB de reserva, compensa desviaciones del primer resultado. La copia final se vuelve a medir. El silencio no recibe una ganancia infinita.

La interfaz distingue objetivo logrado dentro de tolerancia de ±1 LU y +0,2 dB sobre el techo, resultado que necesita revisión y medición antigua. Cambiar mezcla, colocaciones, estado de voz/personaje o archivo deja el informe pendiente. Cambiar sólo la imagen corregida o los subtítulos no cambia la sonoridad. La exportación MP4 vuelve a medir su AAC decodificado y muestra el informe del máster en Actividad, con LUFS, pico real, rango, objetivo, tolerancia y aviso cuando falta medida o no se alcanza el objetivo. La normalización no se simula en el visor: utiliza la escucha WAV para evaluar su nivel.

## Apariencia y división de subtítulos

**Montaje → Subtítulos → Apariencia y zona segura** reúne blanco sobre negro, papel marfil y ámbar; tamaño relativo, posición superior/inferior y margen de 5–20 %. Se aplica al visor y al MP4. El SRT conserva texto y tiempos, sin estilos gráficos.

**Dividir el texto por palabras** permite elegir dónde comienza el siguiente tramo y colocar su corte en el cabezal. Conserva personaje, intervención, diálogo original y palabras; ambas mitades siguen al plano. Es temporización manual, sin transcripción ni alineación fonética automática. El recuento de caracteres por segundo ayuda a revisar lectura, sin aprobarla automáticamente.

## Evidencia y límites

Las pruebas de las entregas sexta y séptima incluyen audio real con tonos técnicos, mezcla, reducción de 12 dB medida por frecuencia, normalización de WAV y AAC, silencio, fuentes cambiadas, solicitudes simultáneas, errores recuperables, esquema y paquete reimportado. La demo reutiliza una voz Qwen existente; no genera ni clona otra. La interfaz se revisa en escritorio y móvil en una instancia aislada. Evidencia y resultados en `output/qa/seventh-delivery/`.
