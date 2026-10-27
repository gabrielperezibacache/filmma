# Cuarta entrega · Dirección y Storyboard

Esta entrega amplía la planificación de los planos dentro de la cinemateca existente. Guion, escenas narrativas, estados de los personajes, voces, montaje y originales siguen perteneciendo al mismo proyecto. No descarga modelos ni genera nuevas tomas o voces automáticamente.

## Planificar el principio y el final

En **Dirección**, cada plano incorpora **Inicio previsto** y **Final previsto**. Describe posiciones, miradas, acción, vestuario y objetos que deban conservarse o cambiar según el guion. Estos textos entran en la próxima solicitud de generación. Son intenciones creativas: no acreditan que un video ya las cumpla.

**Notas de rodaje** guarda indicaciones para producción y montaje, hasta 4000 caracteres. Se conserva en el proyecto y la hoja de consulta; no se envía al motor. El contexto desplegable **Guion y continuidad de este plano** permite consultar acción, diálogo y estado heredado del reparto junto a la planificación.

La **imagen final de referencia** es distinta del texto de final previsto. Se utiliza como ancla visual sólo con MiniMax H3 en modo imagen y un perfil que lo admita. Los perfiles supervisados de sólo texto conservan las referencias, pero explican que no las utilizan. Cambiar una intención no reemplaza una toma ya seleccionada.

## Alternativas antes de aplicar

Guarda hasta seis alternativas por plano, cada una con nombre. Capturan intención, restricciones, cámara, cinematografía, época e inicio/final escritos. Puedes explorar otro encuadre y abrir una comparación de decisiones actuales y guardadas, incluidas notas de época y valores conservados pero inactivos. La comparación de instrucciones completas permite revisar ambos prompts.

**Aplicar esta alternativa** sólo cambia esa dirección creativa. Conserva acción y diálogo del guion, personajes y sus estados, voces, notas de rodaje, referencias seleccionadas, tomas, recorte, velocidad, color y montaje. El video existente no cambia de aspecto. Si el proyecto cambió después de abrir la comparación, debes revisarla de nuevo. Puedes deshacer, rehacer o retirar una alternativa sin eliminar los medios originales.

## Consultar lo que se enviará al motor

**Instrucciones finales de generación** reúne intención, contexto narrativo, inicio/final, dirección efectiva, continuidad y restricciones mediante la misma función que utiliza el servidor. Identifica modo e imágenes utilizadas o conservadas; permite copiar o descargar TXT. **Comparar con el plano anterior** muestra ambos textos con sus propios personajes y guion, sin copiar ni modificar ninguno.

Los avisos comprueban combinaciones conocidas de dirección. No interpretan semánticamente todas las contradicciones del texto ni verifican semejanza facial. Conviene contrastar la intención con el estado narrativo del personaje antes de generar. Las tomas antiguas conservan el prompt histórico que recibieron.

## Leer y compartir el storyboard

**Inicio y final** es la vista inicial. Los videos ofrecen dos muestras temporales del tramo editado: entrada y último instante de la cuadrícula de fotogramas. Se respetan recorte y velocidad y se identifica el instante solicitado en la fuente. Si el montaje excede el original, se limita al final disponible y aparece un aviso. El navegador decodifica una fuente a la vez y crea miniaturas de hasta 720 px por lado, sin escribir sobre el video.

**Punto medio** cambia a una muestra por plano. Las referencias fijas aparecen una sola vez y se identifican como imágenes de referencia; no representan extremos generados. Una toma ausente permanece ausente, sin sustituirse por su imagen inicial. Detener o cambiar de fuente cancela la preparación pendiente y evita publicar resultados antiguos.

La ficha relaciona muestras, tiempos, dirección, inicio/final, notas, escena narrativa, acción, diálogo, personajes y continuidad. **Planificar este plano** abre Dirección y enfoca su inicio previsto. El storyboard aplica look y color de previsualización; las capas, transiciones, audio y subtítulos se comprueban en Montaje.

**Descargar hoja imprimible** produce HTML independiente con imágenes embebidas y planificación, incluidas alternativas. Se puede abrir sin conexión e imprimir como PDF. La lista CSV conserva sus columnas anteriores y añade seis: inicio, final, notas, alternativas y dos instantes de fuente; ahora tiene 24 campos. Son copias de consulta que no se actualizan al cambiar el proyecto.

## Persistencia y verificación

**Proyecto completo** y los puntos de recuperación conservan la planificación. Al importar un ZIP se reasignan los identificadores de las alternativas junto con los vínculos de guion, reparto y medios. Codex recibe estos datos como contexto creativo del plano. Fountain conserva su alcance de intercambio de guion; utiliza el paquete Filmma para guardar toda la planificación y sus medios.

Se ejecutaron **441 pruebas**, sin fallos ni omisiones, con FFmpeg portable y concurrencia limitada a dos. Cubren límites de texto y alternativas, independencia de las copias, revisión obsoleta, conservación del guion y medios, instrucción compartida con la API, muestreo con recorte/velocidad/FPS, cancelación, fuentes ausentes, HTML escapado, CSV, MP4 real y reimportación ZIP. La prueba de envío utiliza un motor simulado; acredita las instrucciones transmitidas, no una nueva inferencia MiniMax.

La instancia QA aislada verificó guardar, comparar, aplicar, deshacer y rehacer una alternativa. El primer video de prueba combina recorte de 0,25 s y velocidad 0,75: sus muestras aparecen en 0,2500 y 3,2188 s; el punto medio, en 1,7500 s. Es una referencia técnica con zoom de una imagen existente, expresamente identificada; no es una nueva toma IA.

Se descargaron el HTML y CSV desde la interfaz. La animática QA se exportó a **1280 × 720, 24 fps, 288 fotogramas y 12 s**, con audio y decodificación completa. Su paquete fue reimportado: planificación y alternativas intactas, identificadores nuevos y voz Qwen existente vigente antes/después con el mismo SHA-256. Los archivos fuente permanecieron intactos. Estos controles no evalúan calidad estética ni reconocimiento de personajes.

Las capturas finales cubren escritorio 1440 × 1000 y móvil 390 × 844. La revisión independiente de acabado registra **SHIP, sin incidencias materiales** en `output/qa/fourth-delivery/finish-review.md`. El ejemplo, informes y documentos descargados están en `output/qa/fourth-delivery/`. La película de producción **2038** y sus originales permanecen separados de QA.
