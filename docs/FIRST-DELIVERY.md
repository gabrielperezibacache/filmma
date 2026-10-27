# Primera entrega: recuperar, orientarse y elegir la fuente

Implementada el 27 de octubre de 2026. Conserva la película, sus originales y las relaciones entre guion, personajes, voces, estados de continuidad y montaje.

## Recuperación de proyectos

En **Película → Recuperación**, guarda un punto con nombre antes de experimentar. Selecciona un guardado para ver sus planos, personajes y diferencias de guion; **Recuperar esta versión** guarda primero un punto del estado actual. Las tomas y originales añadidos después del guardado permanecen en la biblioteca. Puedes volver al punto previo.

La copia más reciente se actualiza con cada cambio de contenido guardado. El historial añade un punto automático como máximo una vez por minuto; los puntos manuales y anteriores a una recuperación se conservan. Cada documento incluye SHA256 y se escribe mediante un archivo temporal sincronizado y renombrado. No se duplican videos. Los guardados viven en `data/recovery/`, separados por película; no son una copia de seguridad en otro disco.

Si el documento principal está ausente o dañado, Filmma busca una copia verificable de la película activa. Conserva el archivo dañado y muestra un aviso al abrir. Si no hay copia válida, detiene la apertura para evitar reemplazarlo. También conserva un último guardado interrumpido aunque el documento principal siga siendo legible. No recupera automáticamente otra película.

La restauración exige que los originales de esa versión estén disponibles y no haya trabajos activos. Si editas después de previsualizar, debes revisar la versión de nuevo. No sustituye el Deshacer de la sesión ni garantiza recuperar cambios que nunca llegaron al servidor. No restaura pesos ni credenciales.

## Recorrido guiado

**Película** muestra seis etapas y propone una siguiente acción basada en el proyecto: escribir, definir un personaje vinculado, conectar un SSD, preparar el modelo, generar una toma, dar voz, revisar continuidad o montar. **Continuar** abre el plano correspondiente. Una imagen de referencia no cuenta como una toma de video; también puedes elegir montar una animática.

Las etapas se pueden visitar en cualquier orden. Una ficha escrita o una referencia disponible no acredita semejanza facial. La revisión visual sólo se marca preparada con un informe vigente y las decisiones registradas. Los trabajos de otras películas no se presentan como trabajo de la película abierta.

## Recomendaciones de modelos

**Motores** separa tres objetivos: **Detalle nativo**, **Personajes y referencias** y **Probar el movimiento**. Considera Apple Silicon, memoria, estado del adaptador, carpeta de pesos y evidencia de una prueba con los parámetros exactos. Distingue el perfil disponible ahora del perfil que requiere preparar o conectar un modelo. La selección se aplica explícitamente y no inicia descargas.

Se comparan los adaptadores integrados de LTX 2B y MiniMax H3. No es una clasificación de todos los modelos existentes. Las revisiones oficiales nuevas siguen requiriendo comprobar la compatibilidad del adaptador. Los perfiles HD de H3 usan texto; no descartan silenciosamente las referencias del reparto. El objetivo de continuidad prioriza el perfil que acepta las referencias visuales de personajes.

## Comparar calidad nativa

En **Motores → Comparar calidad nativa**, genera muestras independientes con el mismo prompt, semilla, pasos, fotogramas y fps en cada resolución. Se procesan secuencialmente con el bloqueo habitual de GPU. Se verifican geometría, reloj, fotogramas, decodificación completa y SHA256 antes de marcar los medios como verificados. Los errores y resultados parciales se conservan; no hay reintentos automáticos.

Los resultados viven en `data/model-quality/` y `data/media/`, sin cambiar escenas, reparto ni selección de tomas. Se pueden reproducir y evaluar con una elección y notas. Mismo prompt y semilla no garantizan la misma composición a otra resolución. No hay puntuación automática de belleza o identidad. El pico del asignador MLX mostrado no representa toda la memoria unificada/GPU.

### Comprobación de esta entrega en M4 Max de 36 GB

| Motor | Fuente | Parámetros | Resultado |
|---|---|---|---|
| LTX 2B | 512 × 288 | 25 fotogramas, 24 fps, 4 pasos, semilla 42 | Decodificación completa; 1,042 s de video; 10,0 s de proceso y verificación |
| LTX 2B | 768 × 448 | Los mismos | Decodificación completa; 1,042 s de video; 9,7 s de proceso y verificación |
| LTX 2B | 1280 × 736 | 25 fotogramas solicitados | Bloqueado antes de inferencia por presupuesto de memoria; sin relajar el límite |
| MiniMax H3 | Perfiles de referencia, 1024 y 1280 | Evidencia histórica de parámetros exactos | SSD desconectado en esta entrega; no se repitió inferencia |

El perfil LTX **Equilibrado** empieza en 768 × 448 y 25 fotogramas. Esta duración breve coincide con la prueba realizada; las duraciones editables más largas no quedan validadas por ella. Las dos muestras muestran geometría inventada en el objeto de cámara. Más píxeles no permiten afirmar calidad final excelente ni continuidad del reparto. La toma MiniMax HD larga falló anteriormente por presión de memoria; no se reintentó.

Evidencias locales: `output/qa/first-delivery/native-comparison-result.json`, `recovery-ui-result.json`, capturas de escritorio y móvil y `preservation-result.json`. Se ejecutaron 412 pruebas automatizadas con FFmpeg portable y concurrencia limitada, además de la restauración desde la interfaz y las dos inferencias LTX reales. Los originales protegidos se comprueban por SHA256 al finalizar.

El acabado con IA y la exportación 4K existentes siguen siendo etapas posteriores y conservan su fuente. Esta entrega no presenta las muestras nativas como generación 4K ni como nuevos planos de la película.
