# Tu primera película en Filmma

Abre **Abrir Filmma.command** con doble clic. Si Filmma ya está funcionando, entra en [el estudio](http://127.0.0.1:4318). Puedes explorar «La última función» o abrir **Mis películas → Crear otra película**. Elige película o publicidad y ponle un título.

La pantalla inicial **Película** reúne tu secuencia y propone el siguiente paso según lo que ya tienes: escribir, definir personajes, conectar el modelo, convertir una referencia en video, dar voz, revisar continuidad o montar. **Continuar** abre el plano correspondiente. También puedes entrar directamente a **Guion**, **Personajes**, **Dirección**, **Voces**, **Montaje** o **Continuidad** desde el recorrido de creación o la navegación. Puedes montar una animática aunque todavía no tengas tomas de video.

**Película → Recuperación** permite guardar un punto con nombre y previsualizar una versión anterior de guion, montaje y personajes. Antes de restaurar se guarda el estado actual; los originales y tomas más recientes siguen en la biblioteca. Si Filmma recupera una copia tras un archivo dañado, lo indica al abrir y conserva ese archivo. El historial empieza con esta versión de la aplicación; no inventa guardados de sesiones anteriores. Consulta [recuperación y pruebas nativas](FIRST-DELIVERY.md) para los límites y ubicación de las copias.

En **Motores**, elige el objetivo de cada prueba: detalle, referencias de personajes o movimiento. **Disponible ahora** indica qué perfil puedes activar; el perfil objetivo puede necesitar conectar el SSD. **Comparar calidad nativa** genera y conserva muestras independientes sin modificar la película. Mira formas, texturas y movimiento antes de registrar una preferencia.

## 1. Escribe la historia

En **Guion**, define la idea central y escribe la acción, el diálogo y la duración de cada escena. **Escribir con Codex** puede desarrollar una propuesta de planos. Lee el resultado, pulsa **Revisar planos** y, si te sirve, incorpórala: los planos se añaden al final, conservando la secuencia existente.

El índice permite buscar por acción, diálogo o personaje, y conserva el plano activo al volver al montaje. Alterna **Escribir** y **Leer** para editar un plano o leer la secuencia completa. **Fountain** exporta un guion portable; **Importar Fountain** muestra los planos y sus observaciones antes de añadir los seleccionados al final. No reemplaza la película abierta. Las acciones y los diálogos se agrupan por plano: revisa las observaciones si tu archivo usa intercalado o diálogo simultáneo.

Codex también puede mejorar el prompt de un plano o revisar la continuidad de toda la historia. Usa tu sesión conectada y necesita Internet. Una propuesta escrita todavía no es un video generado.

## 2. Construye tus personajes y reúne el material

En **Personajes**, crea personajes, objetos, productos o lugares. Describe los rasgos que deben permanecer: rostro, vestuario, materiales, colores y detalles. Añade una imagen de referencia y asigna cada elemento a los planos donde aparece. La ficha mantiene tus decisiones; revisa siempre la identidad en cada toma obtenida.

En la ficha del elemento, abre **Estado inicial** para definir vestuario, aspecto, accesorios y notas. En **Montaje → Continuidad**, cada aparición hereda la anterior según el orden del montaje. Modifica sólo lo que cambia; **Heredar** recupera el valor anterior, y vaciar un campo indica que debe quedar vacío. Marca **Cambio intencional** y explica el motivo cuando la historia lo requiera. La revisión de estas fichas con Codex trabaja sobre sus descripciones; la sección **Continuidad** de la navegación permite además comparar fotogramas de los planos con análisis visual local.

En la ficha de un personaje, **Voz del personaje** permite elegir una voz estable o crear una referencia propia con Qwen local. La elección se conserva en todas sus intervenciones, aunque cambies de plano. El procedimiento completo está en la sección de voces de esta guía.

En **Archivos**, importa imágenes, videos y sonido. Para usar una imagen creada en Codex, guárdala y añádela aquí. También puedes pedir a una sesión de Codex con Filmma conectado que importe el archivo directamente. Después selecciona **Usar en plano**. Los originales se conservan.

## 3. Dirige y genera una toma

En **Dirección**, selecciona un plano, consulta su acción y diálogo y completa **La intención del plano**: quién aparece, qué sucede, dónde, con qué luz y cómo se mueve la cámara. **Explorar referencias** ayuda a elegir una referencia de dirección, la función de la toma, encuadre, óptica, luz y movimiento. Elige su referencia visual y los elementos de continuidad. Para los modos de generación desde texto, imagen o referencias de identidad compatibles, abre **Montaje → Dirección → Ajustes del plano**.

Antes de generar, consulta **Motores**. Un motor preparado o unos archivos descargados no equivalen a una prueba de video aprobada. Cuando esté disponible para probar, comienza con un clip corto y **Generar una toma** en Dirección. **Detalle** es ahora la calidad inicial; **Borrador rápido** queda disponible si eliges priorizar una previsualización de menor detalle. En el inspector de Montaje, la misma acción se llama **Generar este plano**. Revisa el resultado en **Actividad** y en el visor. Puedes elegir otra toma desde la biblioteca o crear una variante para comparar. **Generar pendientes** encola los planos que aún no tienen video y los procesa uno a uno.

**Dirección** y **Montaje** muestran los pasos efectivos junto a la resolución. En MiniMax breve, **Detalle** usa 20 pasos y 768 × 448 para un proyecto 16:9; **Borrador rápido** usa 4 pasos y 512 × 288. Detalle tarda más y requiere más memoria. LTX conserva sus 4 pasos; el selector cambia su resolución. En MiniMax largo, el selector breve no aumenta la resolución: permanece el perfil experimental con 20 pasos iniciales, ajustables entre 2 y 20. Estos ajustes no convierten una fuente pequeña en detalle nativo 4K.

Al enviar una toma, el trabajo aparece inmediatamente en **Actividad**. Si vuelves a Dirección o al inspector mientras ese plano sigue en cola o generándose, verás su estado y **Ver progreso**; el envío simple queda desactivado para evitar duplicados. Las variantes intencionales siguen disponibles en **Tomas**.

Con MiniMax y generación desde imagen, **Fotograma final** permite añadir una segunda imagen para orientar cómo termina la toma. Las referencias de identidad usan un modo distinto.

**Duración de la toma**, dentro de **Crear una toma** o de los ajustes de generación en Montaje, permite escribir los segundos deseados, con **3 s recomendados** como punto de partida para 36 GB. Admite decimales con coma o punto: confirma con Enter o al salir del campo, y usa Escape para recuperar el valor guardado. Si el valor está vacío o fuera de rango, se conserva el anterior y se explica cómo corregirlo. La duración de generación es independiente de la duración del plano en el montaje.

LTX permite solicitudes de **1 a 4 s**. MiniMax permite **1 a 15 s** y usa su perfil largo **experimental** cuando superas 4 s. La interfaz indica si el diagnóstico de este Mac registra una prueba larga verificada; la comprobación de un equipo no se da por hecha en otros. Los motores generan a **24 fps** y trabajan con grupos de fotogramas, por lo que la duración nativa puede ser menor que la solicitada. En MiniMax, **hasta 15 s corresponde a 345 fotogramas a 24 fps, es decir, 14,375 s nativos**, no a 15 s exactos. Revisa la duración efectiva, los fotogramas y las dimensiones que muestra la aplicación antes de comenzar.

El perfil largo usa SSD, supervisión de memoria y **2 a 20 pasos**. Trabaja desde texto a 512 × 320 para 16:9, 320 × 512 para 9:16 o 384 × 384 para 1:1; las demás proporciones también muestran sus dimensiones de generación antes de comenzar. El acabado 4K se hace después. Si el plano tiene imágenes iniciales, finales o referencias visuales de sus personajes, la generación larga queda bloqueada. Las referencias se conservan: vuelve a una duración de hasta 4 s para usarlas. Las descripciones del guion y de los personajes permanecen vinculadas. El perfil experimental puede detenerse si falta memoria.

**Duración en el montaje** indica cuánto ocupa el plano en la película. Puedes editarla en Dirección, Montaje o Guion, entre **1 y 120 s**; al confirmar una edición se ajusta al fotograma de la película. Entrar y salir del campo sin cambiar el valor conserva su duración exacta. **Ajustar montaje** permite usar la duración nativa prevista, sin redondearla a otra cadencia. Si el montaje es más corto que la toma, se utiliza sólo ese tramo y el archivo completo queda disponible para editar después.

Después de generar o importar un video, otro aviso considera su recorte y velocidad y permite ajustar el montaje al material disponible. Si decides mantener un montaje más largo, se conserva el último fotograma en silencio al agotarse la toma; eso no crea video nuevo. Una imagen fija también puede ocupar la duración completa del plano.

## 4. Encuentra el ritmo

La nueva mesa de montaje muestra cada plano en proporción a su duración. Usa el zoom para acercarte, pulsa o arrastra sobre la regla para mover el cabezal, y avanza por fotogramas o cortes con los controles. Los planos pueden moverse arrastrando o con los botones **Mover plano antes/después**.

**Dividir** crea dos partes con al menos **un segundo a cada lado**: conserva el archivo, continúa desde el punto de corte en los videos y deja el diálogo sólo en la primera parte. La primera parte conserva su transición de entrada; el corte nuevo es directo. Los fundidos antiguos del plano completo se retiran al dividir. **Recortar la toma original**, debajo del montaje, abre el video completo: elige entrada y salida en fotogramas y pulsa **Aplicar recorte**. El resultado cambia la duración del plano sin modificar su archivo.

**Deshacer/Rehacer** conserva hasta 60 cambios durante la sesión, incluyendo montaje, guion y continuidad. También funciona con ⌘Z y ⇧⌘Z fuera de los campos de texto; dentro de ellos se conserva la edición nativa. Las imágenes y tomas nuevas que llegan a la biblioteca se mantienen. Al recargar la aplicación comienza un historial nuevo, pero la película guardada permanece.

Enfoca la regla para usar ←/→ por fotograma, Mayús para avanzar diez y S para dividir. Sobre un plano, Alt+←/→ cambia su posición. **Atajos de teclado** muestra el resto de controles.

En **Ajustes del plano**, elige aspecto original, cálido o cine negro. El visor aproxima el color y el aspecto se aplica al exportar. Para añadir música, importa el audio en **Archivos**, elige **Usar como banda sonora** y ajusta su volumen.

### Proporción y FPS de la película

**Salida de la película** aparece en Dirección, sobre el visor de Montaje, en **Guion → Premisa, proporción y FPS** y en Exportar. Sus ajustes pertenecen a toda la película. Las películas nuevas empiezan en **16:9 y 24 fps**, aunque la película anterior tuviera otra configuración. Las películas guardadas conservan sus elecciones; **Usar recomendados** vuelve a 16:9 y 24 fps sólo cuando lo pulsas.

Puedes elegir las proporciones **16:9, 9:16, 1:1, 4:3, 4:5 o 2.39:1**, y **24, 25, 30, 48, 50 o 60 FPS de salida**. El visor y la exportación usan esa proporción; las fuentes se encajan sin recortar sus originales. Las dimensiones exactas se muestran al elegir la resolución de entrega.

Los FPS de salida son distintos de los **24 fps nativos** de MiniMax y LTX. Exportar a otra cadencia adapta los fotogramas sin cambiar la velocidad de la toma: no interpola posiciones nuevas ni convierte una generación a 24 fps en movimiento nativo a 60 fps. Para cámara lenta o rápida, utiliza **Velocidad de la toma**.

Al cambiar los FPS, Filmma impide el cambio si un clip o subtítulo quedaría por debajo de un fotograma o fuera de su tramo visible, o si dos fotogramas clave ocuparían el mismo instante. Se conserva la cadencia anterior: ajusta los tiempos indicados y vuelve a intentarlo. El guion, los personajes y los archivos originales se mantienen vinculados.

### Transiciones y recorte directo

Selecciona el plano que entra y usa **Transición de entrada**, debajo de la mesa de montaje: **Corte directo**, **Fundido encadenado** o **Paso por negro**. Ajusta su duración y pulsa **Ir a la transición** para revisar el corte por fotogramas. El marcador del corte permite volver a seleccionarlo. La duración efectiva se limita al espacio disponible para que dos transiciones no se solapen.

El encadenado usa la continuación del original saliente; cuando ese video se agota, conserva su último fotograma y deja de reproducir su audio. El paso por negro se centra en el corte. Ambos se ven en el visor y se exportan con el sonido de los planos. La música, las capas y los subtítulos mantienen sus tiempos y no reciben automáticamente ese fundido. La transición pertenece al plano entrante y lo acompaña al reordenar; no cambia la duración del guion.

Arrastra los bordes de un plano para recortar su entrada o salida. Al soltar, los siguientes planos se desplazan para cerrar el montaje. Recortar la entrada mueve también sus clips y subtítulos con el material conservado; los intervalos totalmente retirados salen del montaje. **Deshacer** recupera todo en una acción. El texto del guion, los personajes y los originales se conservan. Cada plano mantiene entre uno y 120 segundos. Enfoca un tirador y usa flechas para un fotograma o Mayús para un segundo.

### Pistas de imagen y sonido

Debajo del montaje, **Pistas y audio** permite añadir capas de imagen o video y pistas de música, ambiente o voz. Elige un original de la biblioteca y el plano al que pertenece. Ajusta su entrada dentro del plano, duración y punto de entrada del archivo. Las capas visuales ocupan el encuadre completo; la última pista visual queda encima y su opacidad permite combinarla con las anteriores.

Cada pista y cada clip tienen volumen y silencio. Los clips admiten fundidos de entrada y salida del sonido, y **Audio del plano** controla la toma principal. Silenciar una pista de video sólo silencia su sonido. Un video demasiado corto mantiene el último fotograma y su audio termina; no se inventa material adicional. La duración total sigue determinada por los planos del guion.

Arrastra el cuerpo de un clip para moverlo, incluso a otra pista compatible, y sus bordes para recortar. Se ajusta a cortes, cabezal y bordes de otros clips; mantén Alt para evitar ese ajuste. Escape cancela antes de soltar. El gesto se guarda como una única acción de deshacer. Al cruzar a otro plano, el clip toma ese plano como referencia; sus personajes se muestran en el panel. El recorte izquierdo cambia también el punto de entrada del archivo. Los originales se conservan.

Las **formas de onda** muestran la amplitud real del audio, teniendo en cuenta el recorte, volumen y fundidos del clip. Se calculan localmente y se reutilizan. «Sin pista de audio» y «Audio en silencio» son estados diferentes. El análisis admite hasta dos horas y muestra un error cuando el recurso supera sus límites; no representa palabras ni transcribe el diálogo.

Los clips siguen a su plano al reordenarlo. Al dividirlo, los clips que empiezan después del corte pasan a la continuación; los que cruzan el corte conservan su entrada. Al duplicar se copian los vínculos, y al eliminar se retiran sus clips y subtítulos del montaje. Los originales permanecen en la biblioteca y estas acciones se pueden deshacer.

### Subtítulos vinculados al guion

En **Subtítulos**, añade un texto manual o revisa una propuesta creada desde el diálogo del plano. Ajusta su texto, entrada y salida por fotogramas, y asocia el personaje que habla. Los tiempos son relativos al plano: los subtítulos se desplazan con él y se muestran en el visor.

La propuesta distribuye el texto dentro de la duración disponible; no transcribe ni reconoce el habla. Ajusta sus tiempos escuchando la toma. Los avisos señalan superposiciones, lectura exigente, tiempos fuera del plano o cambios posteriores del diálogo. Tus ediciones se conservan hasta que aceptes un reemplazo.

El interruptor de subtítulos controla su presencia en el visor y en el MP4. El archivo SRT sigue disponible aunque los hayas desactivado. Si divides un plano durante un subtítulo, su texto se conserva a ambos lados del corte.

## 5. Guarda y entrega

El montaje dispone ahora de una mesa de **Mezcla**, bloqueo de pistas, división y copia de clips en el cabezal, y una línea de tiempo para los subtítulos. **Importar SRT** muestra una propuesta antes de añadir textos; **Voz y guion de este texto** conserva la intervención de referencia y permite usar sus tiempos sin reemplazar las palabras editadas. Consulta la [segunda entrega](SECOND-DELIVERY.md) para el flujo completo y sus límites.

Espera a ver **Guardado en tu Mac** antes de cerrar. **Mis películas** permite volver a tus proyectos.

En **Exportar**, elige:

- **Película MP4** para ver o compartir el montaje terminado. En **Resolución de la película**, elige la copia estándar o la de alta resolución; **16:9** permite **4K UHD (3840 × 2160)**. El tamaño y el nombre de la opción se adaptan a la proporción de la película. La exportación de alta resolución desde el editor requiere una revisión de continuidad vigente. Si usarás IA, prepara y aplica primero las versiones, revisa esas fuentes y después exporta. Sin IA, las fuentes pequeñas se amplían conservando el encuadre, sin crear detalle nuevo. Consulta [resoluciones y mediciones](RESOLUCION.md).
- **Proyecto completo** para guardar guion, elementos y originales en un ZIP. Puedes abrirlo después con **Mis películas → Importar proyecto Filmma**; se crea otra película y se conserva la actual.
- **Montaje EDL** para trasladar la secuencia principal (no incluye las capas adicionales ni las transiciones), o **Subtítulos SRT** para obtener los textos temporizados. Los subtítulos editables activados también se integran en el MP4. El proyecto completo conserva todas las pistas y sus ajustes.

El lienzo de entrega tiene estas dimensiones; no indican la resolución nativa del video generado:

| Proporción | Estándar / Full HD | Alta resolución |
| --- | --- | --- |
| 16:9 | 1920 × 1080 | 3840 × 2160 · 4K UHD |
| 9:16 | 1080 × 1920 | 2160 × 3840 · 4K vertical |
| 1:1 | 1080 × 1080 | 2160 × 2160 |
| 4:3 | 1440 × 1080 | 2880 × 2160 |
| 4:5 | 1080 × 1350 | 2160 × 2700 |
| 2.39:1 | 1920 × 804 | 3840 × 1608 · 4K panorámico |

## Estado de los modelos al 17 de octubre de 2026

LTX ya está instalado y se comprobaron dos generaciones reales en este Mac: una desde texto y otra desde la imagen de «La marquesina». Esta última produjo un clip de **3 segundos** desde la propia aplicación y quedó en la biblioteca y el primer plano. Puedes seleccionarlo y crear variantes. El original se conservó intacto.

Revísalo como **borrador**: conserva el ambiente y el vestuario, pero el movimiento puede desviarse del prompt y los rostros u objetos pueden perder precisión. Elegir otra toma y afinar las referencias forma parte del trabajo de dirección.

MiniMax H3 ya tiene sus pesos descargados y verificados en el SSD externo, incluyendo referencias (aproximadamente **210 GB**). Completó una prueba real de **512 × 320, 22 fotogramas a 24 fps y 0,916667 s de video**, en unos **15 minutos y 12 segundos**. Esa misma toma pasó por Real-ESRGAN local al 35 % y por el render de Filmma hasta **3840 × 2160**, conservando sus 22 fotogramas y el original. Es una salida UHD reescalada desde una fuente pequeña, no una generación nativa 4K ni una prueba de identidad facial.

La validación de **14,375 s continuos** se completó en este **Mac Apple M4 Max de 36 GB**: **345 fotogramas a 24 fps, 512 × 320, 20 pasos**, desde texto con el perfil `h3-long-ssd`, en aproximadamente **58 minutos y 47 segundos**. La misma toma pasó por Real-ESRGAN al 35 % en **11 minutos y 32 segundos** y se exportó con Filmma a **3840 × 2160**, conservando 345 fotogramas, duración, audio y el original. Se verificaron los archivos completos y cinco muestras visuales; el guion y los elementos vinculados permanecieron intactos. La fuente añadió una persona no solicitada, por lo que el resultado sólo cumple parcialmente la intención visual. Es 4K reescalado con detalle fino limitado, no generación nativa 4K ni certificación de identidad. Esta prueba corresponde a una toma y configuración concretas; el perfil sigue siendo **experimental** y conserva el control de memoria. El resultado y las mediciones están en `output/qa/minimax-scene/long-4k/`.

También se comprobaron un guion propuesto por Codex y una exportación inicial de 22 segundos hecha con imágenes fijas. Esas pruebas anteriores y las de LTX se documentan por separado de la prueba MiniMax reciente. Consulta [las verificaciones](QA.md) y [el estado técnico de los modelos](LOCAL_MODELS.md) para distinguir cada resultado.

## Revisión de calidad tras la entrega del 18 de octubre de 2026

La primera entrega larga pasó las pruebas de archivo, fotogramas, duración y audio, pero **el usuario rechazó su calidad de imagen**. Esa comprobación técnica no fue una aprobación visual. El original de 512 × 320 y su copia conservadora al 35 % siguen guardados como historial; no se presentan como una calidad 4K satisfactoria.

Se añadió **Restaurar definición al 75 %**, que conserva el color de referencia y permite una contribución neuronal mayor que el tratamiento conservador. Primero se probó un segundo de movimiento con 24 fotogramas; después se procesaron los 345 fotogramas de la toma original, en **703,444 s** (aproximadamente 11 min 43 s), y se exportaron a UHD en **12,072 s**. El **18 de octubre a las 05:07:17 UTC** se completó la decodificación de original, copia IA y exportación. El nuevo MP4 entrega **3840 × 2160, 345 fotogramas, 24 fps y 14,375 s**, con audio y original intacto. Las comparaciones asistidas muestran una mejora clara de contornos y limpieza, con suavizado y texturas inferidas todavía visibles. No sustituye la aceptación creativa del usuario. La entrega es [Filmma-MiniMax-restaurado-4K.mp4](../output/qa/quality-recovery/Filmma-MiniMax-restaurado-4K.mp4) y su comprobación está en [media-verification.json](../output/qa/quality-recovery/final-verification/media-verification.json).

La revisión debe hacerse al **100 % de la copia**, comparando varios momentos y la reproducción. La IA infiere texturas: no recupera detalle real inexistente, no elimina la persona que la generación añadió y no certifica continuidad facial. Cambiar el acabado conserva el original y todas sus versiones; no se vuelve a generar la toma. También se corrigió el encuadre automático de los objetos para no añadir instrucciones anatómicas como «desde la cintura» en futuras generaciones.

## Color, velocidad y animación

Selecciona un plano y abre **Acabado** en el inspector. Exposición, contraste, saturación y temperatura son reversibles y quedan guardados por plano. **Comparar sin corrección** sólo modifica temporalmente el visor; el MP4 conserva el acabado guardado. Puedes copiar el color del plano anterior para dar continuidad visual sin alterar sus personajes, vestuario ni guion. Los tratamientos antiguos de película mantienen su aproximación de color en el visor.

**Velocidad de la toma** permite 0,25× a 4×. La duración de montaje permanece fija: a cámara lenta se recorre menos material; al acelerar se recorre más. El tono del audio se conserva. Una fuente agotada mantiene su último fotograma en silencio. Los recortes y divisiones respetan esta velocidad y las entradas fraccionarias. Una toma nueva comienza desde cero a velocidad normal; alternar entre original y versión mejorada conserva los ajustes.

En **Pistas y audio**, selecciona una capa visual. **Encuadre y animación** permite ajustar posición horizontal/vertical, escala y opacidad. Añade un fotograma clave, desplaza el cabezal y cambia los valores para crear otro. Las curvas **Lineal**, **Suave** y **Mantener** se aplican desde cada punto al siguiente. Los diamantes muestran los puntos en el clip; la lista permite saltar, cambiar curva y eliminar. El máximo es 100 por capa y 2.000 por película. Los puntos fuera del tramo se conservan al recortar para mantener la curva exacta. El recorte, la animación y los subtítulos acompañan a su plano al reordenar el guion.

## Mejora local de imagen

En **Acabado → Mejorar imagen**, **Limpiar imagen** reduce suavemente el ruido y afina el detalle. **Reescalar 2×** duplica como máximo las dimensiones, con tope 4K; una toma 512 × 288 produce 1024 × 576. Para entregar la película en 4K, elige esa resolución en Exportar. Se crea una copia nueva en Biblioteca; usa **Usar versión** para vincularla al mismo plano y **Usar original** para volver. Las versiones conservan la duración, fotogramas, proporción y pistas de audio verificadas. No requieren descargar otro modelo ni usan generación de detalles por IA.

Este flujo admite SDR, dimensiones pares, hasta 2 minutos, 60 fps, 4K y 2 GiB. HDR requiere una conversión explícita fuera de este flujo. Mejorar una fuente no sustituye la captura de detalle: el reescalado no reconstruye información real perdida. Los clips generados tienen un límite absoluto de 15 segundos; el perfil breve de 36 GB ofrece solicitudes de hasta 4 s y MiniMax dispone del perfil largo experimental descrito antes, con un máximo nativo de 14,375 s. El montaje y los archivos importados pueden durar más.

El paquete Filmma conserva todos los ajustes. EDL es una lista de cortes y no transporta color, velocidad, capas, animación ni transiciones; usa el paquete o el MP4 para el montaje completo.

### Detalle con IA local para 4K

En **Acabado → Detalle con IA local**, crea una versión con Real-ESRGAN. Elige **Restaurar definición** para probar una intervención mayor: propone **75 %** y admite entre 15 % y 85 %. **Conservar textura** permanece como alternativa suave, con 35 % inicial y un máximo de 70 %. No repitas automáticamente el tratamiento suave sobre una toma cuya calidad ya rechazaste: compara el nuevo resultado antes de adoptarlo. **Igualar tratamiento del plano anterior** recupera tanto el perfil como la intensidad. El motor se instala una sola vez y trabaja por fotogramas, compartiendo la GPU con la generación local.

Al terminar, abre **Versiones y continuidad → Comparar**. Selecciona **Tamaño de revisión → 100 % de la copia**: un píxel de la copia ocupa un píxel del visor, en lugar de evaluar todo el video reducido. Desliza la separación y recorre la imagen con las barras o el trackpad; las dos versiones muestran la misma zona. Revisa varios fotogramas y la reproducción para comprobar rostro, manos, ropa y objetos. El modo 200 % sirve para ampliar defectos, no para acreditar detalle adicional. **Usar esta versión** conserva el guion, personajes, recorte, velocidad y duración del plano. **Usar original** permite volver en cualquier momento. La IA puede alterar texturas; una intensidad conservadora reduce los cambios pero no garantiza continuidad visual absoluta.

El perfil admite tomas SDR de hasta 15 segundos, 60 fps constantes y Full HD de origen, sin reducción oculta. La copia conserva proporción, tiempos y pistas de audio; exporta la película en 4K UHD para ajustar el lienzo final. [Funcionamiento, límites y mediciones](IA-LOCAL-4K.md).

### Preparar toda la película con IA

En el estudio, abre **Acabado de la película**. Elige el tratamiento y la **Intensidad de toda la película**: **Restaurar definición** propone 75 %; **Conservar textura** permite mantener el tratamiento suave de 35 %. Pulsa **Preparar y usar versiones IA** después de comparar una toma representativa. Filmma procesa uno a uno los originales de los planos y capas de video, reutiliza las copias compatibles que ya existan y aplica las versiones terminadas al montaje. Un mismo original usado en varios planos sólo necesita una copia. Las imágenes fijas y las pistas de audio independientes se conservan.

El guion, los personajes, recortes, color, velocidad, animación y sonido permanecen vinculados al plano o capa. Si seleccionas otro archivo mientras avanza la tarea, se respeta esa elección. Revisa las tomas desde **Acabado → Comparar**; **Volver a originales** permite recuperar sus fuentes sin borrar las copias.

En **Actividad → Ver fuentes** puedes distinguir copias nuevas, reutilizadas, originales conservados e incidencias. Cancelar o encontrar un error conserva los originales y los resultados completos. Vuelve a preparar la película para continuar: las versiones todavía compatibles se reutilizan.

**Mejorar cada toma después de generarla** aplica el mismo ajuste a las nuevas generaciones, incluidas las de **Generar pendientes**. La toma original se guarda antes de comenzar la mejora. Si esta segunda etapa falla, puedes conservar la toma y reintentar su acabado sin volver a generarla. Esta opción no inicia automáticamente el procesamiento de videos anteriores.

Para la entrega con IA, termina primero **Preparar y usar versiones IA** y entra en **Continuidad**. Analiza y revisa las versiones seleccionadas en el montaje, registra una decisión por aparición y guarda la revisión final. Después elige **Exportar → 4K UHD → Usar versiones con IA revisadas**. La exportación comprueba que todos los videos seleccionados sean copias compatibles con el tratamiento y la intensidad elegidos y que correspondan al informe aprobado; compone el MP4 con esas mismas fuentes, sin ejecutar una nueva mejora ni sustituirlas por otras. Si falta preparar o revisar algún material, se detiene con su motivo.

Los límites de 15 segundos, SDR y Full HD se comprueban sobre el archivo de origen completo, aunque sólo uses una parte en el montaje. El reescalado no reduce ni recorta fuentes incompatibles de forma oculta. Para un material mayor o más largo, prepara primero una toma compatible y vuelve a intentarlo.

## Compara la continuidad antes de exportar en 4K

Abre **Continuidad → Analizar continuidad**. El análisis se ejecuta localmente con Apple Vision en CPU. Cada personaje u objeto se compara con su aparición anterior en el orden actual del montaje, aunque haya otros planos entre ambas apariciones. Vincula el mismo elemento a los planos que deban compararse. Una primera aparición no tiene una pareja anterior; un video con una sola aparición sí puede revisarse mediante sus intervalos internos.

Se toman **tres o cinco instantes editables por plano**, comparados entre apariciones y dentro de cada toma. En **Instante y coordenadas**, cambia el tiempo de una muestra; el análisis respeta el recorte y la velocidad de la fuente. Pulsa **Analizar cambios** para actualizar las apariciones afectadas, conservando las revisiones vigentes de las demás. Los fotogramas muestran la fuente seleccionada —original o versión IA— con el color del plano, pero no incluyen capas superpuestas ni transiciones.

Alterna **Rostro**, **Vestuario** y **Objetos**. **Delimitar zona** permite dibujar la parte que quieres comparar en cada imagen; también puedes ajustar sus coordenadas. Marca la misma parte del personaje, prenda u objeto en ambos planos. Para un personaje sin ambigüedad, el motor puede estimar una zona facial y sugerir el torso; comprueba siempre el encuadre sugerido. Los objetos necesitan zonas manuales: el motor compara su apariencia, no reconoce automáticamente qué objeto es.

**Posible diferencia** señala un cambio que merece revisión. **No concluyente** indica que falta detalle, una zona o evidencia suficiente; no equivale a una comprobación satisfactoria. **Sin diferencia evidente** se refiere sólo a esa muestra y zona. La luz, la pose y el ángulo pueden producir avisos, y ningún resultado confirma la identidad de una persona.

Revisa todos los intervalos de cada aparición, confirma su casilla y consulta el estado previsto en el guion. Guarda **Revisado visualmente** o **Cambio intencional**; una diferencia, un resultado no concluyente o un cambio intencional requiere una nota. El cambio narrativo registrado en el guion aporta contexto, pero no aprueba por sí solo la comparación visual. Puedes reabrir una decisión para corregirla; entonces debes confirmar de nuevo la revisión final.

Antes de **Guardar revisión para exportar**, reproduce también la película completa y añade una nota sobre lo revisado. El análisis no examina todos los fotogramas ni las capas, animaciones y transiciones del resultado final. Si no hay apariciones enlazadas, el informe lo indica: no se han realizado comparaciones y debes reconocer ese límite en el visionado.

Cambiar fuentes, orden, recorte, velocidad, color, vínculos de personajes o regiones e instantes vuelve obsoleto el informe. Preparar otro tratamiento o intensidad de IA también requiere revisar las nuevas fuentes. El diálogo de exportación comprueba que la aprobación corresponda al montaje y a los archivos seleccionados. Los originales y las copias IA permanecen intactos; el análisis crea fotogramas auxiliares y un informe, sin modificar los videos. [Alcance del análisis local](CONTINUIDAD-LOCAL.md).


## Dirección, tomas alternativas y storyboard

En **Dirección → Dirección cinematográfica**, abre **Explorar referencias** o entra directamente en **Directores**, **Tipos de toma**, **Movimiento**, **Época**, **Película · FILM**, **Lentes** o **Cámaras**. La guía reúne **17 decisiones y 139 opciones** en ocho grupos: **Dirección**, **Encuadre**, **Época**, **Óptica y foco**, **Luz y color**, **Película**, **Cámara** y **Movimiento**. Cada opción tiene una imagen o un esquema y una explicación; también puedes usar su selector. Sus 37 recursos visuales contienen 36 imágenes únicas creadas con IA. Son ejemplos orientativos, sin verificación histórica, reproducción exacta de un autor ni emulación de una óptica o cámara real.

Explora y cambia las opciones sin modificar todavía el plano. **Aplicar al plano** guarda todas las elecciones juntas; **Deshacer** recupera la dirección anterior en una acción. **Cancelar**, cerrar o pulsar Escape descarta lo que no hayas aplicado. Puedes dejar cualquier campo **Sin indicación**. Al elegir una apertura como f/2.8, Filmma ajusta también la profundidad de campo; si después eliges una profundidad incompatible, retira esa apertura para evitar instrucciones opuestas.

**Directores** ofrece doce referencias: Alfred Hitchcock, Akira Kurosawa, Yasujirō Ozu, Stanley Kubrick, Andréi Tarkovski, Agnès Varda, Wong Kar-wai, Wes Anderson, Sofia Coppola, Chloé Zhao, David Fincher y Pedro Almodóvar. Cada ficha explica una lectura parcial de su lenguaje y muestra una imagen original creada con IA. Elegir una referencia no impone actores, escenarios, época ni utilería de sus películas. Tus elecciones explícitas de encuadre, cámara, movimiento, luz y color tienen prioridad, junto al guion y la continuidad de personajes y objetos.

**Tipos de toma** distingue diez funciones: presentación del lugar, plano maestro, plano secuencia, diálogo, punto de vista · POV, reacción, inserto de detalle, recurso del entorno, revelación y objeto protagonista. La función es independiente del tamaño de encuadre; no añade cortes al montaje. Un plano secuencia sigue limitado a **15 segundos por clip**. Si POV se combina con un encuadre externo, prevalece el encuadre y se conserva la intención subjetiva; la guía avisa para revisar esa combinación.

**Movimiento** ofrece 21 recorridos, desde cámara fija y seguimiento hasta inclinaciones, grúas, zoom, dolly zoom, barrido y elevación vertical. El esquema explica qué gira, qué se desplaza y cuándo cambia la focal. Compara **Inicio** y **Final**, o pulsa **Ver recorrido** para una reproducción que puedes detener y repetir. Con movimiento reducido quedan disponibles los estados estáticos. Describe los puntos de inicio y final en la intención del plano: el esquema orienta, pero no predice el video generado. El ritmo de acción se elige por separado y no cambia la velocidad ni duración del clip.

En **Época**, elige entre 20 periodos: desde Prehistoria hasta Futuro o Época personalizada, con todas las décadas de 1900 a 2019. Añade **Año o periodo concreto**, **Lugar y cultura**, la interpretación —fidelidad histórica como intención, estilizada o historia alternativa— y los detalles que deben permanecer. La fecha de la historia es independiente de la cámara o película que quieras sugerir. No cambia automáticamente guion, rostro, voz, referencias, vestuario u objetos ya fijados.

**Copiar sólo la época anterior** lleva el periodo y su contexto al borrador conservando las lentes, cámara, película, luz y encuadre actuales. Elegir **Sin indicación** guarda las notas inactivas: no se incluyen en las instrucciones, el contexto para Codex ni el storyboard hasta volver a elegir una época. **Quitar época y notas** o **Eliminar esas notas** las retira; estas acciones y **Limpiar** requieren **Aplicar al plano** y se pueden deshacer. Los avisos de fecha o lugar ayudan a revisar sin bloquear. Si un personaje reaparece en otra época o año y ambas apariciones tienen época definida, Continuidad recuerda comprobar si es un salto temporal intencional.

En **Película**, combina uno de cinco formatos —Super 8, 16 mm, Super 16, 35 mm o 65 mm— con ocho intenciones de emulsión y revelado: negativos 50D, 200T y 500T, reversible color, negativo o reversible blanco y negro, retención de plata y proceso cruzado. **Tipo de lente** ofrece ocho familias, desde esféricas modernas o vintage hasta anamórfica, macro, sonda, descentrable, ojo de pez y zoom. **Tipo de cámara** ofrece cine digital, gran sensor, mirrorless, cine fotoquímico, broadcast, DV / MiniDV, cámara de acción y teléfono. Estas elecciones orientan la próxima generación; no cambian resolución, proporción ni el video actual. La guía señala combinaciones que merecen revisión y da prioridad a las decisiones explícitas frente a caracteres anteriores incompatibles. [Catálogo, ejemplos y límites](CINEMA-VISUAL-GUIDE.md).

También puedes comenzar con **Retrato íntimo**, **Noir clásico**, **Llegada al lugar**, **Objeto protagonista** o **Presencia documental**, ajustar cada campo y copiar toda la dirección del plano anterior. Aplicar una propuesta reemplaza las indicaciones actuales y permite deshacer. **Instrucciones de dirección y época** muestra el texto que se añadirá al prompt. Estas indicaciones orientan la siguiente generación: no modifican un video existente ni garantizan una cámara física exacta. Una instrucción antigua aparece como **Dirección heredada** mientras no elijas encuadre o movimiento; esos campos siguen indicando **Sin indicación**. Al elegir uno de ellos, la dirección estructurada sustituye esa instrucción antigua en la generación y los documentos de consulta.

Abre **Tomas** para generar entre una y cuatro alternativas del mismo plano. Usan el modelo, duración y calidad de generación actuales, cambian la semilla y se procesan una a una. Cada original guarda el prompt efectivo, referencias, dirección y estado de continuidad usados. **Cómo se creó** permite consultar esos datos. Las tomas anteriores sin historial se identifican como tales; no se inventan parámetros. Si activaste el acabado IA tras generar, sus copias también aparecerán. Ninguna variante se coloca automáticamente en el montaje.

**Comparar dos tomas** abre dos reproductores independientes. Elige las versiones y comprueba interpretación, cámara, rostro, ropa y objetos. **Usar esta toma** conserva guion, personajes, duración y acabado del plano; una fuente distinta empieza desde el inicio a velocidad normal. Alternar entre un original y su copia mejorada conserva el recorte y la velocidad. **Deshacer** recupera la selección anterior. Las alternativas generadas e importadas permanecen accesibles en Tomas y Biblioteca. La selección de otra fuente obliga a actualizar la revisión de continuidad antes de exportar con IA. **Duplicar este plano en el montaje** sigue creando otro plano; es una operación distinta.

En **Storyboard**, cada ficha reúne la fuente elegida, sus tiempos de montaje, dirección —incluida referencia de autor, función de la toma y movimiento—, época activa y sus notas, acción, diálogo, personajes y continuidad prevista. La vista inicial **Inicio y final** muestra dos instantes del tramo editado de video, respetando recorte, velocidad y FPS; **Punto medio** ofrece una sola muestra. Si la fuente se agota, aparece su límite. Las referencias fijas se identifican y se muestran una sola vez. La hoja reproduce el look y color de previsualización, pero no compone las capas, transiciones ni subtítulos: revísalos en el montaje.

**Descargar hoja imprimible** guarda un HTML con sus imágenes incorporadas, utilizable sin conexión. Ábrelo en un navegador y usa Imprimir para crear un PDF si lo necesitas. **Lista de planos · CSV** exporta los datos de rodaje y continuidad. Ambos son documentos de consulta y conservan intactos los originales; la hoja no es un render de la película. Para transferir todas las tomas y su procedencia utiliza el paquete Filmma.


## Voces del guion y sincronización labial

Abre **Voces** y elige un plano. **Preparar voces del guion** propone intervenciones reconociendo los personajes vinculados, nombres con dos puntos y encabezados de guion. Las acotaciones no se pronuncian; V.O. y O.S. quedan como voz en off. Revisa la propuesta antes de añadirla: el guion escrito se conserva. También puedes añadir una intervención manual.

Sigue el recorrido **Texto → Voz → Labios** de la intervención. Primero define quién habla y sus palabras; después genera, escucha y monta la voz; por último, sincroniza y revisa una copia del video cuando corresponda.

Cada intervención tiene personaje, texto hablado, entrada dentro del plano y tipo: diálogo en escena o voz en off. La voz y el ritmo de un personaje se comparten entre sus planos. Kokoro ofrece Dora, Alex y Santa en español, y Heart y Michael en inglés. Kokoro no clona voces ni interpreta automáticamente susurros o emociones: utiliza presets estables. Qwen permite además usar una referencia propia, como se explica más abajo. Una nueva generación no garantiza una interpretación idéntica. Conserva y reutiliza la grabación que elijas.

**Generar voz** crea un WAV separado. Escúchalo, revisa su forma de onda y su duración real. **Usar voz en montaje** lo coloca en la pista *Voces del guion*, anclado al plano; **Crear subtítulo con esta voz** usa su duración real y conserva los otros subtítulos. Cada intervención admite hasta 600 caracteres y 15 segundos. Si excede el plano, ajusta entrada o ritmo, amplía el plano o divide el texto: la aplicación no trunca la grabación. Cambiar texto, guion, voz o continuidad deja las versiones anteriores para revisión.

**Sincronizar labios** requiere un video seleccionado, un diálogo asociado a un personaje y una voz vigente que quepa en el plano. MuseTalk trabaja localmente en Apple Silicon, sobre una copia, respetando recorte y velocidad. El rostro debe verse durante toda la toma. Si hay varios, utiliza la zona de búsqueda y compruébala reproduciendo la fuente; no es reconocimiento de identidad. La salida conserva encuadre y resolución, a 25 fps, con la región facial procesada a 256 × 256. No equivale a detalle facial 4K nativo: revisa boca, dientes, rostro, ropa, objetos y posibles saltos.

Compara **Toma de origen** y **Copia sincronizada**. Tras revisarlas, marca la comprobación y pulsa **Usar toma sincronizada**. Esa copia lleva la voz seleccionada en lugar del sonido de la toma; se silencia únicamente su pista duplicada para que no suene dos veces. Las demás pistas permanecen. Una ejecución anima una intervención; para varios turnos conserva las voces en pistas separadas o divide el plano. No se presenta como doblaje automático de varios actores.

Las versiones siguen en Biblioteca y Tomas. Retirar una intervención restaura la fuente de las tomas seleccionadas que la tenían incrustada, incluidas sus copias mejoradas; conserva archivos, historial y permite deshacer. Al duplicar, dividir, reordenar o recortar planos se conservan los textos y vínculos. Una intervención fuera del nuevo tiempo o con un personaje desvinculado queda pendiente de ajuste, sin perder sus palabras.

Puedes mejorar la copia labial con el acabado IA existente y exportar en 4K. La copia y su original conservan linaje; elegirla cambia las fuentes del montaje y requiere una nueva revisión de continuidad antes de la exportación. El paquete Filmma conserva audios, videos y sus asociaciones. Motores y pesos son instalaciones locales separadas y no se incluyen en el paquete. Detalles y límites: [voces](VOICES-RUNTIME.md), [labios](LIPSYNC-RUNTIME.md).

### Elegir entre Kokoro, Qwen de Hermes y ElevenLabs

En **Voces → Voces y conexiones** encontrarás los tres proveedores. Kokoro permanece disponible. Qwen utiliza el modelo y el motor ya instalados para Hermes; Filmma no descarga otra copia ni modifica esa instalación. Puedes elegir **Voz de Hermes** o una referencia propia del personaje guardada en la película.

Para ElevenLabs, abre **Obtener clave**, crea una clave de tu cuenta con acceso a voces, modelos y síntesis, y pégala en el campo privado de Filmma. **Conectar cuenta** consulta las voces y modelos disponibles sin generar audio. La clave se conserva en este Mac fuera de las películas y de los archivos ZIP. **Actualizar mis voces** recoge cambios del catálogo; **Desconectar** retira la conexión guardada sin eliminar grabaciones.

En cada intervención elige **Motor de voz**, **Voz estable**, idioma y ritmo. Para ElevenLabs también puedes elegir el modelo compatible. La selección de un personaje se comparte entre sus planos; la narración puede tener una voz individual. **Generar en ElevenLabs** envía el texto de esa intervención al proveedor y consume créditos de tu cuenta. No se envían imágenes, videos ni fichas de personajes. Las solicitudes remotas no se reintentan automáticamente.

Las tres opciones producen una grabación nueva que puedes escuchar, colocar en el montaje, convertir en subtítulos y utilizar para sincronizar labios. El límite sigue siendo 15 segundos: si la voz es más larga, se rechaza completa, sin recortarla. ElevenLabs puede haber consumido créditos aunque el resultado exceda ese límite.

Cambiar proveedor, modelo o voz deja las versiones anteriores para revisión. Qwen fija además la huella de la referencia de Hermes: si reemplazas esa referencia, Filmma pide adoptar explícitamente la nueva voz antes de generar. Las copias de audio y video existentes permanecen en la biblioteca.

### Crear una voz propia para un personaje

En **Personajes**, selecciona la ficha, abre **Voz del personaje**, elige Qwen y despliega **Crear voz desde un audio**. También puedes preparar la voz desde la intervención del personaje en **Voces**.

1. Pulsa **Importar audio** o elige un audio de la biblioteca. Usa una sola persona hablando, con permiso para utilizar su voz y sin música ni ruido fuerte.
2. Escucha el original y ajusta **Inicio** y **Duración**. El fragmento debe durar entre **3 y 30 segundos** y quedar dentro del audio. **Escuchar fragmento** permite revisarlo antes de crear la referencia.
3. Escribe un nombre reconocible y pulsa **Crear y usar voz**. Filmma prepara una referencia local nueva y mantiene el original intacto. Esta acción no genera aún un diálogo.
4. Vuelve a **Voces**, revisa el texto y genera una interpretación. El personaje usa el mismo perfil en todos sus planos. Escucha cada resultado antes de colocarlo en el montaje o utilizarlo para sincronizar labios.

El perfil muestra su nombre, duración y audio de referencia. Si cambias de voz, las grabaciones anteriores se conservan, pero dejan de ser actuales para la selección nueva. Una referencia constante ayuda a mantener el timbre; no garantiza una interpretación idéntica ni una semejanza medida.

**Proyecto completo** incluye el audio original y la referencia preparada, junto con sus vínculos al personaje y a las grabaciones. Al importarlo se recuperan esas relaciones; la instalación de Hermes, sus modelos y las claves de servicios no viajan en el paquete. Puedes consultar los formatos, comprobaciones de integridad y límites en [Voces propias por personaje](VOICE-PROFILES.md).

La [tercera entrega](THIRD-DELIVERY.md) incorpora secuencias y escenas en Guion, plantillas de estado y referencias en Personajes, y revisión del efecto sobre la continuidad antes de mover bloques o aplicar estados.


## Planificación de Dirección · cuarta entrega

En Dirección, escribe **Inicio previsto**, **Final previsto** y **Notas de rodaje**. Los dos primeros guían la próxima generación; las notas pertenecen a producción. Consulta el guion y la continuidad junto a ellos. **Alternativas de intención y encuadre** conserva hasta seis versiones creativas: guárdalas, explora otra opción y compara antes de aplicar. Cambiar dirección conserva el video, guion, voz y estados narrativos actuales.

**Instrucciones finales de generación** muestra el texto compartido con el servidor, el modo y las imágenes utilizadas. Permite copiar, descargar TXT y comparar con el plano anterior. La imagen final sólo actúa como ancla en MiniMax H3 y perfiles compatibles; el texto de final previsto es una intención independiente.

Desde Storyboard, **Planificar este plano** vuelve al campo de inicio. La hoja HTML incluye muestras y planificación y se imprime como PDF; el CSV tiene 24 campos. Guarda **Proyecto completo** para conservar también las alternativas y los originales. Consulta [alcance y verificación de la cuarta entrega](FOURTH-DELIVERY.md).


## Selección, grupos y marcadores · quinta entrega

En **Montaje → Pistas**, usa ⌘/Ctrl + clic para alternar, Mayús para un rango o **Seleccionar varios** para tocar clips. Un grupo se selecciona entero. Sus acciones aparecen debajo de la línea de tiempo: mover por fotogramas, dividir, duplicar, retirar y agrupar con nombre. Los recortes y campos del inspector sólo afectan al clip activo. Un conjunto con una pista bloqueada no se edita parcialmente. Deshacer recupera clips y grupos; los archivos originales nunca se eliminan con estas acciones.

El movimiento conserva los planos de referencia. Una intervención de voz completa y coherente ajusta su entrada y subtítulos vinculados sin cambiar sus palabras. Si hay otros fragmentos o copias en tiempos distintos, se conservan los tiempos editoriales y aparece un aviso para revisar Voces. Los planos principales siguen usando la estructura narrativa del guion.

Abre **Marcadores** o pulsa **M** fuera de un campo: título, tipo, nota, tiempo local y personaje quedan unidos al plano. Al reordenar lo siguen; si un recorte deja la señal fuera, se conserva con aviso. Puedes abrirla desde la regla y descargar su CSV. **Proyecto completo** guarda todo y conserva los vínculos al reimportar.

**Reproducción del visor → Preparar copias ligeras** crea una caché local de hasta 1280 px por lado y precarga el siguiente video. Selecciona **Fluida** para usar copias disponibles y **Original** para revisar detalle/color. Sin copia válida se usa el original. El acabado, análisis de continuidad y exportación conservan las fuentes seleccionadas; el ZIP no incluye esta caché. Consulta [alcance y verificaciones](FIFTH-DELIVERY.md).


## Sonido y color de la película

En **Montaje → Mezcla**, abre el acabado de sonido: atenuación de música durante voces colocadas, objetivo de sonoridad, medición y escucha WAV. La normalización afecta a la copia de entrega; el visor permite revisar la atenuación. Los originales y las voces permanecen completos. Consulta [Sexta entrega](SIXTH-DELIVERY.md).

En **Subtítulos**, Apariencia y zona segura aplica un estilo común al visor y MP4. Dividir por palabras es manual y conserva los vínculos del guion. El SRT no incluye apariencia.

En **Montaje → Ajustes del plano → Acabado**, abre **Scopes y comparación entre planos**. Elige referencia e instantes y captura muestras antes de leer forma de onda, parada RGB o histograma. Tras cambiar color o instante, captura de nuevo. Las notas de continuidad sitúan personajes y objetos; no certifican su identidad. Consulta [Séptima entrega](SEVENTH-DELIVERY.md).


## Continuidad temporal · octava entrega

Abre **Continuidad**, elige tres o cinco instantes por plano y analiza. Las miniaturas distinguen pares entre planos e intervalos dentro de la toma; selecciona Rostro, Vestuario u Objetos. Ajusta zona e instante por muestra y vuelve a analizar. **Lo previsto en el guion** mantiene la acción, el diálogo y el estado del personaje junto a las imágenes.

**Analizar cambios** conserva las revisiones de apariciones idénticas y vuelve a analizar las afectadas. Revisa todos sus intervalos, añade una nota cuando haya diferencias o incertidumbre y confirma el alcance antes de exportar. Un informe nuevo siempre necesita confirmación final. Los originales y los informes anteriores se conservan. Consulta [Octava entrega y límites del análisis local](EIGHTH-DELIVERY.md).


## Material y actividad · novena entrega

En **Archivos**, busca por nombre, etiqueta, plano o personaje. Marca favoritos y abre una ficha para guardar etiquetas, seguir la procedencia y consultar **Dónde se usa**. Los accesos conservan el plano o personaje relacionado. Las etiquetas no cambian la continuidad aprobada.

Pulsa **Comprobar archivos** para registrar o verificar sus huellas locales. Si falta una copia interna y hay huella conocida, elige **Original para reconectar**: sólo se acepta una copia idéntica y nunca se sobrescribe material existente. Para entrar en un proyecto con ausencias, usa **Mis películas → Abrir para reconectar**. Importar ya conserva una copia propia; mover el archivo externo no elimina esa copia.

En **Actividad**, filtra por película, estado o proceso. Los trabajos con fallo ofrecen su contexto para resolverlos; el diagnóstico completo y los resultados están en el desplegable. Los registros antiguos sin película se conservan en **Todo el estudio**. Consulta [Novena entrega, pasos y límites](NINTH-DELIVERY.md).
