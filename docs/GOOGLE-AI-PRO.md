# Google AI Pro en Filmma

Filmma incorpora un flujo asistido para usar la suscripción en **Gemini o Flow**. La generación y descarga se realizan manualmente en Google. No se guardan contraseñas, cookies ni claves API de Google en Filmma. La versión 0.14 añade un puente experimental de Chrome para operar la interfaz de la suscripción; no es una API oficial.

## Puente experimental de Chrome (0.14)

El puente se instala desde **Configuración → Conexiones**. La extensión contiene cinco archivos y su [código completo](../public/google-browser/) forma parte del repositorio. No pide permisos de cookies, historial o debugger. Sí necesita acceso a Gemini, Flow, sus medios visibles y Filmma local, almacenamiento de su token local y avisos periódicos. Abre sus propias pestañas sin solicitar el permiso amplio `tabs`.

1. Descarga la extensión, descomprime el ZIP y abre `chrome://extensions` en Chrome.
2. Activa Modo desarrollador, elige **Cargar descomprimida** y selecciona la carpeta `Filmma-Google-Bridge`. Autoriza únicamente si has revisado esos permisos. No se publica una extensión en la Chrome Web Store en esta entrega.
3. En Filmma crea un código de enlace; en las opciones de la extensión, elige el puerto de tu estudio y pega el código de nueve dígitos. Caduca en dos minutos. El enlace guarda una capacidad local; tu sesión de Google permanece en Chrome.
4. Prepara un plano desde Dirección. El botón **Generar con mi cuota en Chrome** inicia un único trabajo. Chrome puede tardar hasta treinta segundos en recogerlo.
5. El puente prepara una pestaña propia, el prompt y las imágenes. Si no puede establecer inequívocamente el modo de video y un resultado, se detiene. Las duraciones y opciones deben estar disponibles en tu cuenta.
6. La descarga conserva un archivo original y verifica una copia de importación mediante FFprobe, decodificación y SHA256. Si cambió el contexto o la selección del plano, queda como alternativa. Los archivos descargados y los parciales permanecen en `data/google-browser/downloads/`.

Se registra la orden antes de pulsar Generar. Un reinicio, desconexión o doble clic no provoca un reenvío automático. Una toma pendiente puede recuperarse desde su pestaña sin volver a generar. **Detener el puente no garantiza cancelar una solicitud que Google ya recibió.** Ante login, CAPTCHA, acuerdos, cuota o interfaz desconocida, requiere intervención humana; no compra créditos ni cambia de plan.

El máximo de referencias del puente es 16 MB por imagen y 32 MB en total; el paquete manual mantiene su límite de 20 MB por imagen y 50 MB en total. Los videos admitidos conservan el límite de 15 segundos, 4K y 60 fps.

### Estado de comprobación

- Protocolo local y archivos: probado con clips técnicos; incluye emparejamiento privado, orígenes, reserva única bajo concurrencia, descarga por bloques, recuperación y continuidad.
- Sesión real: se observó acceso a Gemini y la marca PRO en Flow. Esto no acredita una generación ni una descarga completa.
- Generación real de Gemini y Flow a través del puente: autorizada por el usuario, pero no completada. Chrome dejó de estar disponible para el control de Codex y Filmma aún no recibió el enlace. No se presenta como verificada.

## Recorrido manual


1. Selecciona un plano en **Dirección → Generar → Google AI Pro**. También puedes entrar por **Configuración → Conexiones → Preparar un plano con Google**.
2. Elige Gemini o Flow, duración deseada entre 1 y 15 segundos y hasta 5 imágenes vinculadas al plano o a sus personajes. La selección inicial incluye las referencias principales; las de apoyo se pueden añadir expresamente. Ajusta la proporción desde Salida de la película. Las duraciones, resoluciones, formatos y costes reales disponibles se consultan en Google.
3. **Preparar paquete** guarda un ZIP local con prompt, imágenes numeradas, huellas SHA256, identificadores del plano y contexto. Prepararlo no sube archivos. Revisa el prompt de ese paquete y cópialo; conserva un registro inmutable aunque después cambies la intención del plano.
4. Abre Gemini o Flow, inicia sesión con tu cuenta AI Pro y elige la función de video. Pega el prompt, adjunta las referencias del ZIP por orden y revisa el consumo antes de generar. Filmma no puede consultar tu saldo ni confirmar tu plan. Descarga el video original.
5. Regresa al paquete y elige **Importar toma de Google**. Se admiten MP4/WebM hasta 512 MB, 15 segundos, 4K y 60 fps. Filmma mide duración/fps/fotogramas/audio, decodifica el archivo completo y calcula su SHA256. No cambia su resolución, velocidad, audio ni bytes.
6. Si marcas Usar en el montaje, se vincula la toma cuando el contexto y la selección siguen coincidiendo. Las tomas anteriores se conservan. Si cambió el guion, los personajes o las referencias, queda como alternativa para revisión. Las modificaciones locales durante la carga tampoco se reemplazan.
7. Comprueba rostro, vestuario y objetos en **Continuidad**. Prepara el acabado con las herramientas locales existentes y exporta en 4K desde Montaje. El video nativo y las copias de mejora permanecen separados. Las referencias orientan la generación; no garantizan la identidad visual ni certifican la calidad.

Biblioteca muestra la procedencia **declarada al importar**, el prompt histórico, parámetros reales y referencias. Filmma no autentica que un archivo provenga de Google. Actividad registra la importación comprobada, no una generación remota que no puede observar. Importar de nuevo el mismo paquete devuelve la copia ya registrada; prepara otro paquete para otra toma.

Los paquetes pendientes se guardan localmente en `data/google-video/` y los ZIP en `data/exports/`. Los paquetes pendientes no forman parte del archivo portátil de película; los videos importados, su procedencia histórica y sus vínculos sí se incluyen y se remapean al importar esa película. Conserva los ZIP si necesitas retomar una generación pendiente en otro equipo.

## Suscripción y API

Verificado el 28 de octubre de 2026: los beneficios de Google AI Pro en las interfaces de Google son distintos del uso de la Gemini API desde aplicaciones externas. La API requiere un proyecto con Cloud Billing y se factura aparte. Las cuentas elegibles pueden activar créditos mensuales de Cloud del Google Developer Program; esos créditos no son los créditos de Flow y no se presuponen activados ni disponibles.

No se usa el antiguo endpoint Veo 3.1 Preview: Google lo retiró el 22 de octubre de 2026. La documentación actual remite a Gemini Omni Flash para API. Este flujo asistido deja que la interfaz de Google muestre los modelos actuales de tu cuenta.

Fuentes oficiales: [planes y facturación](https://ai.google.dev/gemini-api/docs/google-ai-plans), [generación en Gemini](https://support.google.com/gemini/answer/16126339?hl=es), [generación en API y retirada de VeoPreview](https://ai.google.dev/gemini-api/docs/video).

## Validación

Las pruebas automáticas usan videos técnicos locales, sin generar ni consumir créditos de Google. Cubren paquete y referencias, integridad de originales, resolución/fps nativos, rechazo de duración excesiva, contexto cambiado, idempotencia, guardado antiguo y portabilidad de la película. La comprobación de acceso, cuota y generación real requiere completar el paso de Google con la cuenta del usuario.
