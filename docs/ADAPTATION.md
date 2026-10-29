# Del documento a una producción con continuidad

Abre **Producción → Adaptar con Codex**. Este recorrido prepara la historia y sus referencias antes de gastar generaciones de video o voz.

## 1. Historia y referencias

Elige un modelo de los que devuelve tu sesión real de Codex y su profundidad de razonamiento. Filmma comprueba que sea una sesión de ChatGPT; este recorrido no cambia automáticamente a una API de pago. Codex CLI debe estar instalado y conectado. Su cuota se comparte con el resto del uso de tu cuenta.

Incorpora PDF con texto, Word `.docx` o `.doc`, ODT, RTF, TXT, Markdown, Fountain, subtítulos, CSV, JSON o HTML. La lectura ocurre localmente; no requiere Word instalado. Puedes revisar el texto extraído y descargar el documento original. Al pulsar **Preparar adaptación**, Filmma envía a Codex el texto de los documentos incluidos y el contexto creativo. No envía cookies de Google, claves de ElevenLabs ni archivos de modelos locales.

- Hasta 12 documentos, 20 MiB por archivo, 1.000.000 de caracteres por documento y 1.500.000 en conjunto.
- PDF: hasta 500 páginas. Un PDF escaneado necesita OCR previo; Filmma avisa y no presenta una lectura ficticia.
- No se corta silenciosamente un documento demasiado largo. Para fuentes de más de 120.000 caracteres, pulsa **Preparar lectura completa con Codex**: lee partes contiguas y conserva un índice narrativo de todas ellas. Las partes terminadas se reutilizan si interrumpes la lectura. Se comprueban rangos de caracteres y páginas; revisa igualmente hechos e interpretaciones antes de adaptar. El PDF y el texto íntegros permanecen locales.
- Retirar un documento del contexto no borra su copia local ni el archivo que subiste.

Añade referencias de autores, directores, fotógrafos, épocas, lugares o técnicas. Escribe qué te interesa de cada una. **Investigar con Codex** usa su búsqueda web y devuelve fuentes HTTPS; revisa el resultado y guárdalo en la biblia si quieres conservarlo con el proyecto. La búsqueda complementaria de Firecrawl es opcional por API (`firecrawl: true`), requiere `FIRECRAWL_API_KEY` del servidor y usa su propia cuota. La interfaz habitual utiliza Codex y no necesita esa clave.

## 2. Propuesta revisable

Define cuántos episodios o piezas desarrollar y el máximo de planos nuevos. Codex propone el guion, diálogos, duración, cámara, fichas persistentes y un inventario visual para los episodios adaptados. Las nuevas tomas duran como máximo 15 segundos; el motor elegido puede tener límites menores.

La propuesta se incorpora de forma **aditiva**. Los planos, archivos, voces, referencias y estados existentes se conservan. Si Codex reutiliza un personaje existente, su identificador y voz permanecen intactos. Si editas el proyecto durante la adaptación, Filmma pide preparar una propuesta actualizada para no aplicar un contexto antiguo.

Los episodios son secuencias del mismo proyecto. Personajes, paisajes, espacios y objetos tienen fichas compartidas, vinculadas a sus planos. Época, vestuario, aspecto, utilería y técnica se trasladan a las instrucciones de generación. Esta planificación ayuda a conservar continuidad; la fidelidad final depende del generador y se revisa en Continuidad.

Cada proyecto admite 100 planos y 100 elementos persistentes. Para una obra extensa, adapta bloques o secuencias con un presupuesto de planos explícito. La duración objetivo de un largometraje no elimina esos límites.

## 3. Material visual

Cada insumo permite dos recorridos:

**Buscar imagen** consulta Wikimedia Commons y muestra sólo imágenes JPEG, PNG o WebP con autor identificado y licencia CC0, dominio público, CC BY o CC BY-SA comprobable en sus metadatos. Filmma vuelve a comprobarlos al incorporar y guarda autor, página fuente, licencia, fecha y SHA256 junto a los bytes descargados. Revisa también que lugar y época sean adecuados: la licencia no demuestra autenticidad histórica.

**Crear con Codex** solicita una imagen con la herramienta integrada de la sesión. Si la ficha ya tiene imágenes, se adjuntan hasta tres para guiar su identidad. Filmma recoge sólo los resultados del chat creado para esa tarea, verifica que exista una imagen y copia el resultado a su biblioteca. Un mensaje que diga «imagen creada» no basta. No se usa una API de imágenes de pago como sustitución automática.

Puedes indicar cuántas referencias pendientes crear ahora (hasta 20 por entrega); las demás permanecen en el inventario. La cola reutiliza las referencias que hayan terminado antes de iniciar el siguiente insumo.

Las imágenes web y las creadas con IA se distinguen en la biblioteca y en el inventario. Se conservan las versiones anteriores; una nueva referencia no borra el original ni cambia automáticamente la referencia principal si ya existe. Puedes elegir esa referencia en Personajes.

## 4. Producir por entregas

Selecciona los episodios que necesitas ahora. La vista muestra cuántos planos aún no tienen toma; los demás episodios siguen planificados sin consumir generación.

- **Local:** sólo se envían los planos elegidos, en una cola secuencial de hasta 20 trabajos. Se validan todos antes de reservar la entrega. Se utiliza la duración de cada plano y tu configuración actual de resolución/modelo.
- **Google:** la entrega se conserva y se revisa plano a plano en Dirección. Puedes ver sólo esa entrega y pasar al siguiente plano pendiente. Cada envío requiere revisar el paquete, referencias y perfil de Chrome. Filmma no rota cuentas ni suma cuotas automáticamente.
- **Serie Instagram:** el perfil recomienda 9:16 y 30 fps, con duración por episodio editable. La duración total del episodio se construye con planos; no se fabrica una toma larga repitiendo fotogramas. En **Exportar → Contenido del MP4** puedes escoger un episodio. Sus voces, subtítulos y pistas siguen vinculados al guion; el proyecto completo y los originales se conservan. La revisión de continuidad para 4K sigue siendo la de la película completa.

La cuota restante no se inventa: Google decide la disponibilidad del servicio y Codex informa de sus límites. Puedes detenerte y continuar después con las mismas fichas.

## Voces y sincronización labial

Los paquetes de Google usan la dirección visual concreta del plano y conservan las referencias editoriales de autores/directores en Filmma. Puedes revisar y ajustar el prompt antes de preparar otro paquete: se guardan el texto enviado y el contexto del guion, sin ocultar cambios de continuidad.

El motor de voz se elige por separado del video. Cuando la producción tiene un motor de voz asignado, el prompt de Google solicita ambiente sin diálogo ni música: la voz final se produce con el proveedor elegido. Cada personaje conserva su propia configuración de Kokoro, ElevenLabs o Qwen en su ficha. Los personajes nuevos de ElevenLabs quedan pendientes de una voz real de tu cuenta; Qwen permite vincular su audio de referencia local. No se inventan identificadores de voces ni se reemplaza una voz existente al adaptar.

En **Voces**, prepara las intervenciones desde el guion del plano, escucha y confirma la voz del personaje. Las mismas fichas se usan entre episodios. La sincronización labial utiliza la grabación elegida y crea una copia derivada, conservando audio y video originales.

## Respaldo y portabilidad

La exportación de proyecto incluye los documentos originales y conserva su SHA256, la biblia, el inventario, la investigación guardada y las atribuciones. La importación verifica los archivos y reconecta personajes, episodios, planos y referencias con los nuevos identificadores. Las claves y sesiones de proveedores permanecen fuera del proyecto.

## Documentación de los servicios

- [Catálogo y protocolo de Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Búsqueda web en Codex](https://learn.chatgpt.com/docs/web-search)
- [Generación integrada de imágenes y límites de la cuenta](https://learn.chatgpt.com/docs/image-generation)
- [Metadatos de imágenes de MediaWiki](https://www.mediawiki.org/wiki/API:Imageinfo)
- [Búsqueda opcional de Firecrawl](https://docs.firecrawl.dev/agent-source-of-truth/curl)

Las pruebas locales cubren lectura de texto/PDF/Word/ODT, aplicación sin pérdida de originales, vínculos entre episodios, protección frente a guardados simultáneos y exportación/importación de fuentes. La comprobación real de la sesión, adaptación, investigación, imagen y descarga web se registra en `output/qa/production-adaptation/`; esa carpeta está excluida de Git para conservar aislados los datos de prueba.
