# Filmma — sala de montaje
La referencia fijada por el usuario es cine antiguo con interfaz moderna. Entorno: creador trabajando durante sesiones largas frente a un visor; superficies oscuras evitan competir con la imagen. Dirección: mesa de visionado de una cinemateca, no reproducción decorativa de un proyector.

## Sistema
Grafito verdoso #171a19 y #202421, bordes #343a34, texto marfil #eceee5, secundario #a3afa2, acento celuloide #d3dba7. El guion se lee en papel claro. Marca con serif editorial local; controles con sans del sistema, tiempos con monospace. Navegación lateral con iconos y nombres legibles, cabecera discreta, visor amplio y un panel de dirección de 320px en el montaje. Planos usan imágenes y numeración funcional. Una transición con Motion mantiene identidad entre selección y visor; reduced-motion obligatorio. Sin datos falsos de rendimiento ni generaciones simuladas.

## Comportamiento
Guion y casting editables, montaje ordenable, biblioteca de originales, export real y estado del motor visible. Demo explícita. Controles con nombres accesibles, foco y estados fallidos recuperables. Pantallas pequeñas reorganizan visor, inspector y timeline verticalmente.

## Components
### Montaje y audio
El montaje conserva el grafito, la salvia y el marfil, con el visor como centro de atención. Los controles de transición de entrada permanecen bajo V1 y describen el enlace entre el plano anterior y el seleccionado; los marcadores en los cortes permiten localizarlo. Tipo, duración e «Ir a la transición» se agrupan en el mismo panel.

Los tiradores de los bordes de cada clip distinguen recorte de desplazamiento. Durante el arrastre muestran una previsualización local y tiempos legibles; al soltar aplican un único cambio deshacible. Mantienen alternativa de teclado y foco visible. Las ondas representan la amplitud del audio y reflejan recorte, volumen, silenciamiento y fundidos. Análisis pendiente, ausencia de pista, silencio y error tienen estados explícitos; el inspector permite reintentar el análisis fallido.

En móvil, los controles se apilan, los tiradores permanecen visibles y el desplazamiento horizontal queda dentro de las líneas de tiempo. El visor y el resto de la página conservan el ancho disponible.

### Acabado y animación de capas
«Acabado» vive en el inspector del plano, dentro del editor de tres columnas y sin restar protagonismo al visor. Agrupa exposición, contraste, saturación y temperatura con etiquetas visibles, valores monoespaciados y deslizadores en el acento existente. Comparar sin corrección, restablecer y copiar el color anterior son acciones discretas; los separadores y el espacio distinguen color, velocidad y mejora sobre las superficies de grafito, salvia y marfil.

La velocidad se expresa de 0,25× a 4× junto a la duración conservada del plano. La ayuda explica el recorrido por el original y el último fotograma en silencio al agotarse la toma. «Mejorar imagen» presenta limpieza y reescalado como procesos locales convencionales, muestra progreso, fallos y dimensiones de cada versión, identifica cuál está en uso y permite volver al original. No atribuye al reescalado detalles reales ausentes de la toma.

«Encuadre y animación» permanece en el inspector de la capa visual junto a su color. Posición horizontal, posición vertical, escala y opacidad muestran su valor; los rombos y tiempos localizan fotogramas clave, con selección actual visible y curvas «Lineal», «Suave» y «Mantener». Las acciones permiten añadir, actualizar, localizar, eliminar y restablecer; los puntos fuera del tramo se identifican expresamente. En móvil el flujo continúa vertical, los ajustes de encuadre pasan a dos columnas y las acciones conservan nombres accesibles y áreas táctiles amplias.

### Resolución de entrega
El diálogo de exportación conserva su composición y controles existentes. Un selector nativo con etiqueta visible muestra Full HD o 4K y sus dimensiones exactas según el formato del proyecto. La ayuda distingue ampliación de detalle nativo y anticipa el mayor tiempo y espacio. El botón de película repite las dimensiones elegidas; el proyecto completo conserva sus originales. El formato cuadrado se identifica por dimensiones, sin llamarlo 4K UHD.

## IA local y revisión de continuidad

«Detalle con IA local» conserva el ritmo visual del inspector y separa instalación, intensidad y creación de una copia. El 35 % inicial es conservador; copiar la intensidad del plano anterior facilita coherencia entre tomas. El progreso se muestra junto al proceso. «Versiones y continuidad» reúne los resultados sin aplicarlos automáticamente.

La comparación abre un diálogo nativo con foco contenido y Escape para cerrar. Superpone las versiones sincronizadas, con separación, avance por fotograma y zoom de 1×, 2× o 4×. Los nombres de personajes aportan contexto de revisión; no se presentan como prueba de reconocimiento facial. La interfaz explica que pueden variar texturas, ofrece volver al original y conserva guion y tiempos.

### Acabado de la película
El acabado común se abre bajo la línea de tiempo, antes de las pistas adicionales. Una intensidad compartida conecta la mejora automática después de generar, la preparación de planos y capas y la exportación 4K. El panel muestra cuántas fuentes pueden prepararse, progreso real y resultados reutilizados o fallidos; volver a originales conserva la edición y admite deshacer. Las revisiones de escenas y capas abren el mismo contexto de personajes.

En exportación, la opción de IA aparece al elegir 4K y guía el orden de trabajo: preparar y usar las versiones, revisar exactamente las fuentes seleccionadas y exportarlas. El diálogo muestra si la revisión está vigente y ofrece acceso directo a Continuidad; la exportación aprobada no crea otra versión ni sustituye material revisado. Los controles se apilan en móvil sin desplazamiento horizontal de la página. Las fuentes limitadas a 15 segundos, SDR y Full HD se describen antes de comenzar; la interfaz no promete identidad facial ni estabilidad temporal garantizadas.

### Apariciones y revisión visual

«Continuidad» tiene un espacio propio bajo «Lo que permanece», con la misma tipografía editorial, grafito, marfil y acento de celuloide. Una lista de apariciones sitúa cada personaje u objeto entre el plano anterior y el actual; la comparación ocupa el área principal. Se conserva la diferencia entre la revisión escrita del guion, la comparación original-versión y esta comparación visual entre planos.

Rostro, vestuario y objetos se alternan mediante controles con etiquetas. Cada imagen identifica su plano y el instante de fuente, y permite dibujar una zona normalizada sobre la imagen visible o editar coordenadas e instante. Las zonas elegidas se distinguen de las estimadas; la ayuda pide comparar la misma parte en ambos planos. Cambiar una zona o el instante deja la revisión pendiente hasta analizar de nuevo. En móvil, ambas imágenes y sus controles se apilan, con foco visible y áreas táctiles amplias.

Los estados dicen «Posible diferencia», «No concluyente» y «Sin diferencia evidente», con texto que explica su alcance. No usan porcentajes de identidad ni convierten la ausencia de evidencia en aprobación. El muestreo cubre un fotograma por plano y muestra el color del plano; las capas y transiciones requieren visionado. Los objetos se comparan con zonas manuales, sin prometer reconocimiento semántico.

El estado previsto en el guion permanece junto a la imagen. Cada pareja admite revisión o cambio intencional, con nota cuando hay diferencias o límites. La confirmación final exige reconocer el alcance del análisis. La interfaz distingue informe pendiente, análisis activo, cancelado, incompleto, obsoleto y revisado; reabrir una decisión retira la aprobación final. Cambios en las fuentes, la edición visual, los vínculos o las regiones requieren nueva revisión antes de exportar en 4K. Los originales se conservan y el análisis no corrige ni reemplaza material automáticamente.


### Dirección, tomas y storyboard
La dirección cinematográfica amplía el inspector existente y dispone de un espacio propio con diecisiete decisiones opcionales y cinco propuestas propias. Debe explicar que son instrucciones para generar, no una corrección del clip actual. Las tarjetas de secuencia, el TXT y la hoja visual muestran la dirección efectiva, sin contradecirla con indicaciones antiguas.

Tomas conserva la selección del montaje mientras llegan alternativas. La comparación usa un diálogo nativo con foco, cierre por Escape y reproductores independientes. Los originales importados permanecen en la galería después de cambiar de toma; las copias IA permanecen vinculadas a su fuente. No se fabrica procedencia para archivos antiguos. Abrir la comparación pausa los reproductores de la galería.

Storyboard es una mesa de lectura editorial dentro del sistema grafito, salvia y marfil. Muestras reales de las fuentes seleccionadas, tiempos monoespaciados, acción y continuidad forman la ficha. Decodificación serial y miniaturas hasta 720 px de lado mayor; los errores se muestran como ausencia de muestra, sin sustituir un video faltante por otra imagen. En móvil la navegación horizontal se desplaza dentro de su propia barra y el contenido no desborda. Los controles mantienen teclado, foco y movimiento reducido.


### Voces e interpretación
Voces continúa la mesa de guion: papel marfil para las palabras, fondo grafito para interpretar y comparar. La secuencia permanece visible; una intervención concentra personaje, entrada y texto, seguida por voz y labios. El guion original se consulta y la preparación propone antes de añadir. No se calcula una duración inventada: la grabación real determina la forma de onda y el subtítulo.

La voz elegida pertenece al personaje, y el estado de cada grabación muestra si sigue correspondiendo al texto y su continuidad. Las versiones antiguas se pueden escuchar, pero no aplicar como actuales. Motores muestran disponibilidad real y preparación local, sin sugerir acceso a modelos propietarios de otro servicio. La copia labial requiere revisión explícita y conserva acceso al original; explica el audio sustituido y el límite de una intervención. Los reproductores son independientes y no presentan una comparación temporal como sincronizada automáticamente.

Controles de al menos 44 px, etiquetas explícitas, foco visible, navegación horizontal contenida en móvil. La forma de onda debe estar en su sección, nunca usar la posición absoluta de las miniaturas del montaje. El estado vacío no requiere recursos generados ni modifica el proyecto.

### Inicio y recorrido de producción

«Película» es la entrada al trabajo: título editorial, premisa, recuentos de planos y material, siguiente paso y secuencia. La sugerencia usa el contenido guardado: escribir el primer plano o completar uno vacío, preparar el siguiente sin material, dar voz a un diálogo sin grabación vigente y, después, volver al montaje. El recorrido «Escribe → Define → Dirige → Interpreta → Monta → Revisa» mantiene acceso directo a cada tarea. Los estados de material y los trabajos activos describen datos reales del proyecto.

El conjunto es una herramienta de operación: la serif FilmmaDisplay queda en títulos y marca; texto, campos y acciones usan la sans del sistema. Los rótulos de navegación tienen 12 px en escritorio y 11 px en móvil. La barra lateral de 158 px ofrece icono y nombre en una fila; hasta 1000 px se reduce a 142 px y, hasta 760 px, pasa a navegación horizontal contenida. La selección se reconoce por texto, fondo y acento, sin depender sólo del icono. No se añaden antetítulos que repitan el nombre visible de una sección.

Las superficies de Inicio y Dirección comparten un ancho máximo de 1500 px y márgenes interiores de 40 px en escritorio, 24 px en el ancho intermedio y 18 px en móvil. La secuencia se presenta en filas con número, muestra, acción, personajes y estado. El recorrido pasa de seis a tres y después a dos columnas; las filas y acciones se reorganizan sin sacar el desplazamiento horizontal de sus barras.

### Dirección visual progresiva

«Dirección» reúne visor, acción y diálogo del guion, personajes vinculados, intención y preparación de la siguiente toma. «Montaje» conserva edición, tiempos, sonido y acabado. En escritorio, la toma y su contexto se sitúan a la izquierda; la dirección ocupa una columna de 320–420 px. Hasta 1100 px se apilan visor y controles, y en móvil el flujo continúa verticalmente.

«Explorar referencias» abre una guía nativa en ocho grupos: Dirección, Encuadre, Época, Óptica y foco, Luz y color, Película, Cámara y Movimiento. Sus 17 campos contienen 139 opciones. Cada elección ofrece imagen o esquema, nombre y explicación, con un selector nativo equivalente. Las referencias combinan 37 archivos WebP de 36 imágenes únicas creadas con IA —el plano medio y la paleta natural comparten la misma base— con diagramas conceptuales. Doce imágenes originales ilustran lecturas parciales de referentes de dirección; cuatro sitúan ejemplos ficticios de época. Los originales se conservan. Son ejemplos orientativos, sin verificación histórica, reproducción exacta de un autor ni simulación óptica; reutilizar una imagen para ilustrar otra decisión exige explicar su alcance.

La guía mantiene un borrador local: explorar, limpiar, copiar época o quitar notas no altera el plano hasta aplicar. «Aplicar al plano» guarda el conjunto en una acción deshacible. La selección se señala con borde, acento y marca de verificación; el pie mantiene estado pendiente, límite de las imágenes y acciones. Una lista desplegable de cambios compara las elecciones anteriores y pendientes. El diálogo usa foco visible, Escape y retorno al control que lo abrió. A 800 px se apila la guía; a 540 px ocupa la pantalla y muestra referencias en dos columnas, con los campos de contexto histórico en una sola columna.

«Directores», «Tipos de toma» y «Movimiento» forman una fila de tres accesos discretos antes de las decisiones de época y captura. Cada uno muestra su elección actual y abre el campo correspondiente en el mismo borrador. Los referentes de autor explican una decisión formal concreta; no sustituyen la identidad, el guion o las elecciones explícitas de encuadre, óptica, luz y cámara. El tipo de toma describe su función narrativa y permanece separado del tamaño de plano.

«Movimiento» reúne 21 trayectorias y cuatro ritmos de acción. Al elegir una trayectoria, «Recorrido de cámara» presenta un esquema con vista superior o lateral, explicación y estados «Inicio» y «Final». El rectángulo representa la cámara, el círculo al sujeto y la línea discontinua el recorrido. «Ver recorrido» reproduce una sola animación a petición; se puede detener o repetir. Se detiene cuando el esquema deja de ser visible o la pestaña se oculta. Con movimiento reducido se conservan los estados estáticos y no se ofrece reproducción animada. El esquema y las notas se muestran en paralelo en escritorio y se apilan en móvil; los controles mantienen 44 px mínimos. Es una ayuda conceptual sin escala, no una previsualización del video ni una trayectoria física garantizada.

Los accesos «Época», «Película · FILM», «Lentes» y «Cámaras» son filas compactas en dos columnas dentro del inspector. Cada acceso muestra el nombre de la decisión y su selección actual, o «Elegir…», con separadores discretos. Abren el mismo borrador directamente en su campo; conservan foco visible y etiquetas además del icono. El año de la historia y el carácter de captura se presentan como decisiones independientes.

«Época» reúne 20 periodos y permite precisar año o intervalo, lugar y cultura, interpretación y detalles que deben permanecer. La selección incluye todas las décadas de 1900 a 2019. La fidelidad histórica se expresa como intención de verosimilitud; la estilización y la historia alternativa tienen nombres explícitos. Las notas no presuponen vestuario, voz ni identidad. «Copiar sólo la época anterior» conserva las decisiones de captura del destino; «Sin indicación» conserva notas inactivas y lo explica, mientras «Quitar época y notas» las retira del borrador. Los avisos de fecha, lugar y combinación son orientativos, sin bloquear ni corregir automáticamente el plano.

«Película» distingue cinco formatos de ocho familias de emulsión y revelado; «Tipo de lente» y «Tipo de cámara» ofrecen ocho opciones cada uno. Las ayudas describen el efecto buscado y sus límites junto al control. No se presenta una elección de película como resolución nativa, una lente como simulación medida ni una cámara como hardware disponible. Las decisiones explícitas tienen prioridad sobre caracteres heredados incompatibles, conservando el dato anterior y explicando por qué queda inactivo.

Cuando dos apariciones consecutivas del mismo personaje tienen época definida y cambia su periodo o año, Continuidad muestra un recordatorio editorial del salto temporal. El contexto activo acompaña a Codex y al storyboard. Ese recordatorio no altera identidad, voz, vestuario u objetos, y no funciona como aprobación visual.

«Apertura sugerida» y «Profundidad de campo» comunican una sola intención coherente: escoger un valor f ajusta la profundidad y escoger una profundidad incompatible retira el valor f anterior. Una indicación antigua de cámara se muestra aparte como «Dirección heredada» mientras no exista encuadre o movimiento nuevo. El selector permanece en «Sin indicación» hasta que se elija un valor estructurado; no interpreta libremente el texto heredado como una selección. Las instrucciones y los documentos de consulta respetan esa misma prioridad.

### Voz propia del personaje

«Voz del personaje» vive en su ficha y se reutiliza en Voces. Motor, voz, idioma y ritmo permanecen asociados al personaje en todas sus escenas. Para Qwen, «Crear voz desde un audio» reúne importación o selección del original, reproducción, inicio, duración de 3–30 segundos, escucha del fragmento y nombre. «Crear y usar voz» muestra preparación real y conserva el original; el perfil resultante se identifica por nombre, duración y referencia local, con su propio reproductor.

Qwen reutiliza la instalación de Hermes. La interfaz distingue esa voz predeterminada de los perfiles propios guardados en la película. Crear una referencia no genera una interpretación; cada grabación se escucha antes de aplicarla. Las versiones anteriores permanecen accesibles y pierden vigencia cuando ya no corresponden a texto, voz o continuidad. La persistencia, integridad de las referencias y transferencia en el paquete Filmma se describen en [Voces propias por personaje](docs/VOICE-PROFILES.md).

Voces presenta «Texto → Voz → Labios» como accesos a las tres partes de una intervención: quién dice qué, escuchar y montar, sincronizar y revisar. El papel marfil conserva el texto y el grafito contiene reproducción y procesos. Los campos tienen etiquetas, errores junto a la acción y controles de al menos 44 px; en móvil la selección de proveedor y la importación se apilan, mientras inicio y duración mantienen una pareja legible. La referencia ayuda a conservar el timbre; la interfaz no afirma semejanza medida ni actuación idéntica.

### Perfil de generación y duración nativa

Esta ampliación de Dirección y del pie de generación en Montaje conserva grafito, marfil, salvia y controles nativos con etiquetas visibles. El límite solicitado se distingue de la duración nativa prevista, sus fotogramas, cadencia y dimensiones. MiniMax H3 mantiene el perfil breve de 1–4 segundos y permite escribir límites de hasta 15 segundos mediante el perfil largo experimental: con el límite de 15 segundos, su cadencia produce 345 fotogramas a 24 fps, es decir, 14,375 segundos. El acabado UHD posterior no se presenta como generación nativa 4K.

Antes de generar, «Ajustar montaje» conserva exactamente la duración nativa prevista, sin redondearla al reloj del montaje ni reducirla en aplicaciones sucesivas. Si el montaje excede la toma prevista, se avisa de que mantendrá el último fotograma. Para una toma existente, el aviso considera recorte y velocidad, explica que el último fotograma queda en silencio y ofrece ajustar el montaje al tramo disponible cuando alcanza su duración mínima.

El perfil largo admite sólo texto. Las imágenes iniciales, finales y referencias visuales de personajes se conservan; su presencia bloquea ese perfil y la ayuda permite volver al límite breve para utilizarlas. El botón distingue preparación, cola y generación, muestra el mensaje real del trabajo y mantiene «Ver progreso». El envío simple de la misma escena se bloquea mientras su solicitud o trabajo sigue activo; las variantes intencionales conservan su flujo propio.

Registro de esta ampliación: revisión de acabado **SHIP**, sin corrección material, sobre las capturas [escritorio](output/qa/minimax-scene/controls-desktop-final.png) y [móvil](output/qa/minimax-scene/controls-mobile-final.png). La validación larga está activa y pendiente; no hay resultado largo aprobado. La [prueba breve MiniMax → IA local → UHD](output/qa/minimax-scene/short-4k/README.md) está verificada en su alcance documentado y no acredita la duración larga ni detalle nativo 4K.

> El detector registra un aviso `side-tab` preexistente en el borde del bloque de diálogo (`blockquote`). Se conserva como indicio estático, sin convertirlo en un fallo material de estos controles ni alterar la identidad existente.

### Duración editable y salida de la película

La duración de generación y la duración en montaje tienen campos y ayudas propios. Los campos aceptan coma o punto decimal, conservan un borrador mientras se escribe y confirman con Enter o al salir; Escape restaura el valor guardado. Los errores aparecen junto al campo, explican el rango y conservan el valor anterior. La recomendación de 3 segundos pertenece a la solicitud de generación. La duración en montaje admite 1–120 segundos y sólo cuantiza una edición confirmada al fotograma; enfocar un valor existente no lo modifica.

«Salida de la película» reúne «Proporción» y «FPS de salida» en Dirección, Montaje, Guion y Exportar. Las opciones recomendadas, 16:9 y 24 fps, llevan ese texto visible; restaurarlas exige pulsar la acción correspondiente. Los proyectos existentes conservan sus elecciones y las películas nuevas usan los valores recomendados. La ayuda distingue la cadencia de salida de los 24 fps nativos y no promete interpolación ni movimiento adicional. El cambio de cadencia conserva la configuración anterior si invalida subtítulos o hace coincidir fotogramas clave.

Los selectores comparten etiquetas persistentes, foco salvia y un mínimo de 44 px de altura. Se disponen en dos columnas y se apilan cuando el contenedor mide hasta 420 px; conservan grafito, marfil y tipografía operativa. El guion mantiene sus campos sobre papel marfil. Las dimensiones exactas acompañan a la resolución de entrega; «4K UHD» se reserva para 3840 × 2160 en 16:9, con nombres específicos para vertical y panorámico, y «Alta resolución» para los demás formatos.

### Reglas para ampliar estas superficies

- Mantener grafito, marfil y salvia; reservar la serif editorial para marca y títulos.
- Mostrar nombres de tareas y estados además de iconos y color.
- Conservar originales, borradores separados y aplicación explícita de las decisiones.
- Distinguir una referencia ilustrativa, una indicación de generación y una toma del proyecto.
- Mostrar Inicio y Final para explicar el movimiento; reproducir un recorrido sólo a petición y respetar movimiento reducido.
- No convertir la cámara heredada en una selección estructurada que el usuario no ha elegido.
- No presentar disponibilidad local, referencia vocal o estado visual como una garantía de resultado.
- No presentar una imagen de referencia de autor ni un esquema de cámara como predicción de la toma generada.

### Recuperación, recorrido guiado y calidad nativa

Estas superficies prolongan la cinemateca moderna: títulos con serif editorial, operación en sans, grafito y marfil, salvia para acciones y selección. La jerarquía usa ritmo y separadores discretos; los medios y los datos del proyecto conservan el protagonismo.

«Recuperación» ordena guardar un punto, elegir un guardado, revisar sus cambios y recuperar mediante una acción explícita. La fila seleccionada tiene fondo diferenciado y estado accesible; la marca de coincidencia con el estado actual tiene otro significado. La vista previa reúne título, fecha, planos, personajes y diferencias antes de «Recuperar esta versión». Junto a esa acción se explica que el estado actual quedará como punto de retorno y que se conservarán originales y tomas nuevas. Los archivos ausentes bloquean la recuperación con una indicación para reconectar su disco. En escritorio, lista y vista previa comparten dos columnas; en móvil se apilan, la vista previa deja de ser fija y el campo para nombrar el punto mantiene su etiqueta sobre el control.

El recorrido conserva las seis etapas con acceso libre y añade preparación expresada en texto y recuentos. «Preparado» describe los datos disponibles para trabajar; calidad y continuidad requieren comprobar el resultado. El siguiente paso reconoce trabajos activos, personajes pendientes, modelo o disco ausente e imágenes que aún pueden convertirse en tomas; ofrece montar una animática cuando ya hay imágenes. En móvil, el recorrido permanece en dos columnas y las acciones y accesos de ayuda continúan en vertical.

Las recomendaciones parten de tres objetivos: detalle nativo, personajes y referencias, o probar movimiento. «Disponible ahora» se distingue de «Perfil objetivo al preparar el modelo». Cada propuesta muestra dimensiones, duración y pasos, junto al alcance exacto de su evidencia y la admisión de imagen o sólo texto. «Usar perfil», «Conectar disco» y «Preparar modelo» responden a su disponibilidad real. Una prueba registrada corresponde a esos parámetros: no acredita calidad estética, identidad facial ni una toma más larga. La comparación HD de MiniMax mantiene visible su límite de sólo texto y ausencia de referencias del reparto.

«Comparar calidad nativa» reúne motor, motivo de observación y parámetros comunes antes de iniciar. Los videos de prueba permanecen fuera de la película, con acceso a sus originales, dimensiones, fotogramas, FPS y tiempo medido de proceso y verificación. El pico de asignación MLX se identifica como una medida parcial de memoria. «Medios verificados» describe comprobación técnica; la evaluación visual se registra aparte mediante perfil preferido y notas, tras observar varios fotogramas, formas, texturas, movimiento y texto inventado, además de rostros y manos cuando aparezcan. No hay puntuación automática de calidad. Controles y videos se apilan en móvil; las nuevas acciones conservan etiquetas, foco visible y áreas táctiles de al menos 44 px.

### Montaje integrado: pistas, mezcla y subtítulos

La segunda entrega conserva la cinemateca moderna y concentra la edición bajo un visor compacto. En escritorio, la imagen permanece visible mientras el panel inferior tiene desplazamiento propio; transporte y pestañas «Secuencia», «Pistas», «Mezcla» y «Subtítulos» permanecen en su cabecera y comparten cabezal. «Ajustes del plano» abre la interfaz extensa existente. En móvil, «Ver visor» amplía el mismo visor y «Volver a herramientas» devuelve a la pestaña, selección, cabezal y posición de lectura conservados. Las líneas de tiempo contienen su desplazamiento horizontal.

«Guion y continuidad de este plano» despliega acción, diálogo y personajes junto a la edición, con vestuario, objetos y cambios previstos o pendientes. Sus accesos llevan a Guion, Voces y la ficha del personaje. El contexto se distribuye en dos columnas en escritorio y una en móvil, con la serif editorial reservada para títulos y la sans operativa para datos y acciones.

En Pistas, los candados protegen posición, recortes y edición de clips; dividir, duplicar y eliminar se desactivan durante el bloqueo. El aviso aclara que sus vínculos siguen al guion cuando se reordena. Nivel y silencio de pista conservan controles propios. Los clips vinculados identifican su plano y personaje, y retirar un clip conserva el archivo original en la biblioteca.

Mezcla reúne audio del plano, banda sonora y pistas en filas separadas por líneas discretas. Cada fuente presenta nivel porcentual, dB de ganancia, silencio y «Aislar». La escucha aislada se identifica en texto y afecta sólo al visor; la mezcla guardada conserva su destino de exportación. Las ondas representan fuentes y ajustes, sin atribuirles medición de pico combinado ni sonoridad LUFS. Ausencia de fuente, ausencia de clip en el cabezal y voces que requieren revisión tienen estados distintos. En móvil, filas y acciones se reorganizan manteniendo etiquetas accesibles y controles táctiles.

Subtítulos combina bloques temporales con extremos de recorte, selección salvia y campos de texto, entrada, salida y personaje. Arrastre, división en el cabezal y pasos de teclado conservan el vínculo al plano y al personaje. «Importar SRT» presenta desplazamiento global, observaciones y tramos por plano antes de «Añadir subtítulos revisados»; la aplicación añade al contenido existente y conserva el diálogo del guion. Un cambio del montaje, guion o subtítulos exige revisar otra vez la propuesta.

«Voz y guion de este texto» asocia una intervención y ofrece escuchar su audio y ver su onda. «Usar tiempos de esta voz» requiere una grabación vigente y ajusta entrada y salida conservando las palabras editadas; las voces pendientes de revisión muestran la causa y mantienen sus originales. La revisión independiente de [acabado de esta entrega](output/qa/second-delivery/finish-verdict.md) registra **SHIP** y resuelve la incidencia de visor fuera de pantalla sobre las recapturas suministradas; este registro describe decisiones visibles, sin ampliar la evidencia funcional de la entrega.

### Historia, estados y conexiones del plano

La tercera entrega amplía la cinemateca moderna con estructura narrativa y estados del reparto. Conserva grafito, marfil y salvia, FilmmaDisplay en títulos y sans en campos y acciones. «Estructura de la historia» ocupa una sección desplegable antes del guion; las líneas discretas separan creación, contexto y organización, mientras la escritura permanece sobre papel marfil.

La organización opcional «Secuencia → escena narrativa → plano» acompaña al índice y a la lectura. Lugar, momento, objetivo y notas pertenecen a la escena narrativa. El orden del montaje permanece como referencia y admite planos intercalados de una misma escena; reunir y mover un bloque abre una revisión. Retirar la organización conserva los planos.

La revisión nativa presenta repercusiones con nombres y recuentos: posiciones, estado heredado, vigencia de voces, labios, subtítulos y material para volver a mirar. Las posiciones anteriores y nuevas y los valores de estado antes y después se escriben junto al plano y personaje afectados. «Volver sin aplicar» y «Aplicar cambios revisados» mantienen la decisión explícita; una propuesta pierde vigencia si cambia el proyecto. Las grabaciones anteriores siguen disponibles para escuchar y los archivos y vínculos se conservan. En móvil, las diferencias pasan de columnas a lectura vertical y las acciones permanecen al pie del diálogo.

La ficha distingue la referencia principal que utiliza el motor de las referencias de apoyo para comparar. «Estados narrativos» guarda plantillas independientes de identidad y voz; editar una plantilla conserva las copias ya aplicadas. Cada aparición recibe una copia editable mediante motivo narrativo y revisión, con herencia hasta el siguiente cambio explícito. «Apariciones en el guion» abre el selector de estado del plano con foco visible y conserva su fuente original.

El contexto narrativo acompaña a Guion, Storyboard y Montaje. «Qué está conectado con este plano» reúne accesos con etiquetas y cantidades a Voces, Subtítulos, Pistas y Continuidad, manteniendo el plano seleccionado. La ayuda explica qué cambios pueden dejar voces o labios pendientes y que acortar afecta los tramos visibles, mientras los archivos completos permanecen en la biblioteca. En móvil, formularios y contexto se apilan, los accesos se distribuyen en dos columnas y los controles mantienen áreas de al menos 44 px y foco salvia.

La [revisión independiente de acabado](output/qa/third-delivery/finish-review.md), sobre fuentes y las catorce capturas r2 suministradas, registra **SHIP**, sin correcciones materiales. Este registro describe las decisiones visibles y conserva el alcance de esa evidencia: un estado narrativo escrito no acredita semejanza visual, reconocimiento de personajes ni sincronización labial.

### Dirección y storyboard: intención, alternativas y muestras

La cuarta entrega conserva la cinemateca de grafito, marfil y salvia, con FilmmaDisplay en títulos y sans operativa en campos y acciones. «Inicio previsto» y «Final previsto» se leen en paralelo en escritorio y en vertical en móvil. Son intenciones para la próxima generación; las imágenes inicial y final son anclas visuales separadas. La ayuda distingue el ancla final compatible con MiniMax H3 en modo imagen de una imagen conservada que el perfil no utiliza. «Notas de rodaje» mantiene su carácter editorial: se guarda y se imprime, sin incorporarse al prompt.

Cada plano admite hasta seis alternativas nombradas. La comparación presenta las decisiones «Actual» y «Alternativa» y permite desplegar sus instrucciones completas antes de «Aplicar esta alternativa». En móvil las diferencias se leen en secuencia y las acciones permanecen al pie. El acento destaca la aplicación explícita; «Volver sin aplicar» conserva una salida clara. La ayuda identifica guion, personajes, voces, notas y material seleccionado como contenido preservado; el video existente conserva su aspecto.

«Instrucciones finales de generación» separa modo, imágenes asociadas, decisiones inactivas, restricciones y prompt final. Copiar y descargar TXT tienen acciones propias. La comparación con el plano anterior mantiene nombres e instrucciones independientes, en columnas que se apilan en móvil.

Storyboard distingue «Inicio editado» y «Último instante editado» de las intenciones escritas; cada muestra conserva fuente e instante. Las parejas se muestran en paralelo y se apilan en móvil. Una imagen fija aparece una sola vez como «Imagen de referencia». Planificación, escena, acción, diálogo, personajes y continuidad siguen una lectura editorial continua, con acceso a «Planificar este plano». La hoja imprimible HTML se identifica como copia independiente con imágenes; la lista CSV conserva el contexto escrito y las fuentes. Los originales permanecen en la biblioteca.

La [revisión independiente de acabado](output/qa/fourth-delivery/finish-review.md), sobre fuentes y nueve recortes r2 de escritorio y móvil, registra **SHIP**, sin incidencias materiales. Este registro conserva ese alcance: documenta decisiones visibles y no acredita ejecución del motor ni equivalencia visual de personajes.
