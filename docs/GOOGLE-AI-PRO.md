# Google AI Pro en Filmma

Filmma permite usar tu suscripción en **Gemini o Flow** mediante un flujo asistido o un puente experimental de Chrome. La versión 0.15 incorpora detección y enlace persistente desde la aplicación; Gemini recupera el original directamente y Flow puede requerir confirmar el guardado nativo. No se guardan contraseñas, cookies ni claves API de Google en Filmma. Este puente opera la interfaz de la suscripción y no es una API oficial.

## Puente experimental de Chrome (0.15 · extensión 0.2.0)

El puente se instala desde **Configuración → Conexiones**. La extensión contiene cinco archivos y su [código completo](../public/google-browser/) forma parte del repositorio. No pide permisos de cookies, historial o debugger. Sí necesita acceso a Gemini, Flow, sus medios visibles y Filmma local, almacenamiento de su token local y avisos periódicos. Abre sus propias pestañas sin solicitar el permiso amplio `tabs`. El acceso multimedia incluye el dominio exacto `contribution.usercontent.google.com`, observado en el reproductor de Gemini; no se solicita acceso general a `google.com`.

1. Descarga la extensión, descomprime el ZIP y abre `chrome://extensions` en Chrome.
2. Activa Modo desarrollador, elige **Cargar descomprimida** y selecciona la carpeta `Filmma-Google-Bridge`. Autoriza únicamente si has revisado esos permisos. No se publica una extensión en la Chrome Web Store en esta entrega.
3. En Filmma pulsa **Detectar Chrome** y después **Enlazar este Chrome** cuando aparezca la extensión. La detección dura cinco minutos y el navegador suele aparecer en menos de treinta segundos. No necesitas copiar códigos; el enlace se conserva entre reinicios y sólo se muestra conectado después de confirmar el token. El código de nueve dígitos permanece como alternativa para instalaciones anteriores.
4. Prepara un plano desde Dirección. El botón **Generar con mi cuota en Chrome** inicia un único trabajo. Chrome puede tardar hasta treinta segundos en recogerlo.
5. El puente prepara una pestaña propia, el prompt y las imágenes. Si no puede establecer inequívocamente el modo de video y un resultado, se detiene. Las duraciones y opciones deben estar disponibles en tu cuenta.
6. En Gemini, el puente intenta conservar el archivo original y verifica una copia de importación mediante FFprobe, decodificación y SHA256. Si cambió el contexto o la selección del plano, queda como alternativa. Los archivos descargados y los parciales permanecen en `data/google-browser/downloads/`.

Se registra la orden antes de pulsar Generar. Un reinicio, desconexión o doble clic no provoca un reenvío automático. Una toma pendiente puede recuperarse desde su pestaña sin volver a generar. **Detener el puente no garantiza cancelar una solicitud que Google ya recibió.** Ante login, CAPTCHA, acuerdos, cuota o interfaz desconocida, requiere intervención humana; no compra créditos ni cambia de plan.

El máximo de referencias del puente es 16 MB por imagen y 32 MB en total; el paquete manual mantiene su límite de 20 MB por imagen y 50 MB en total. Los videos admitidos conservan el límite de 15 segundos, 4K y 60 fps.

Flow usa un agente y un editor sin un elemento de video accesible al puente. La subida sigue requiriendo **Añadir a petición** y la aprobación se hace por toma, evitando «Aprobar siempre». El puente puede pulsar **Descargar contenido multimedia → 720p Tamaño original** y esperar un único MP4 nuevo en Descargas para importarlo. Si Chrome pide dónde guardar, cambia el nombre o usa otra carpeta, hace falta completar ese paso o importar el archivo manualmente. La prueba real verificó esta recepción con confirmación nativa, manteniendo los pasos manuales de referencias y aprobación.

### Estado de comprobación

- Protocolo local y archivos: pruebas con clips técnicos cubren enlace privado, orígenes, reserva única, descarga por bloques, recuperación y continuidad. No acreditan por sí mismas la sesión de Google.
- **Prueba real del 28 de octubre de 2026:** se generó una toma por proveedor mediante los controles visibles de Chrome, usando un paquete inmutable de Filmma y la misma referencia ficticia de Elena. Se aceptaron los avisos de imágenes con autorización expresa del usuario. No se usó la API de pago ni se compraron créditos.
- **Gemini:** original 1280×720, 24 fps, 240 fotogramas, 10 segundos de video (10,005 s de contenedor), una pista AAC. Se solicitaron 8 s; se conservó la salida nativa de 10 s.
- **Flow:** Omni 1.1 Flash, una toma aprobada de 12 puntos de la suscripción. Original 1280×720, 24 fps, 192 fotogramas, 8 segundos de video (8,042667 s de contenedor), una pista AAC. Se eligió «720p Tamaño original».
- Ambos MP4 se decodificaron completos, se copiaron sin cambios y se importaron mediante la interfaz de Filmma al proyecto aislado `qa-google-live-20261028`. SHA256 coincide entre Descargas, copia conservada y medio importado. Los dos planos conservan a Elena, la referencia y el prompt histórico. Se revisaron visualmente cinco fotogramas por toma; esto no certifica todos los detalles de todos los fotogramas.
- **Enlace persistente comprobado:** la extensión real 0.2.0 fue detectada y autorizada desde Filmma; confirmó `configured:true, connected:true`. Se verificó la reconexión después de reiniciar tanto QA como la instancia principal de puerto 4318. El usuario cargó manualmente la carpeta correcta, `public/google-browser` (la carpeta de pruebas `output/google-browser` no contiene el manifiesto).
- **Recuperación real de Gemini:** el puente abrió su propia pestaña y conservó 3.295.446 bytes del resultado existente, con SHA256 idéntico al original. No se envió otra generación ni se cambió el plano seleccionado.
- **Recuperación real de Flow con confirmación nativa:** Chrome mostró «Guardar como». Tras desbloquear el Mac se confirmó un nombre nuevo en Descargas y el puente recibió e importó automáticamente 3.031.716 bytes, con SHA256 idéntico al original. Se verificó la decodificación completa, 192 fotogramas y audio. El intento anterior agotado durante el bloqueo permanece registrado; no se borró ni se volvió a generar. Con esta configuración de Chrome hay que confirmar el guardado en menos de tres minutos.
- **Alcance:** generación inicial asistida y recuperación de resultados existentes mediante la extensión real. Las referencias y la aprobación por toma de Flow siguen requiriendo intervención en Google; no se acredita una generación completamente autónoma de Flow.
- Evidencia local: `output/google-live/media-validation.json`, `originals/`, `*-submission.json`, `project-verified.json` `continuity-contact-sheet.png`, `bridge-verification.json` y `production-bridge-verification.json`. No se publican cuentas, códigos de enlace ni URLs firmadas de medios.

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


## Enlace persistente 0.2.0

En Configuración → Conexiones, pulsa **Detectar Chrome**. La extensión actualizada consulta sólo los puertos locales 4318/4320 y aparece con su identificador y versión. Pulsa **Enlazar este Chrome**: la aprobación ocurre en la aplicación, sin copiar códigos. La ventana de detección dura cinco minutos; no autoriza por sí sola a un navegador. Sólo después de aprobar se entrega un token al navegador que posee su prueba aleatoria. Filmma conserva su hash en el archivo privado; Chrome guarda el token localmente y comprueba el enlace al iniciar y cada 30 segundos. La pantalla muestra «Chrome conectado» únicamente después de recibir confirmación real. Revocar invalida también las detecciones pendientes.

Si ya cargaste la carpeta `public/google-browser`, recarga una vez la extensión en `chrome://extensions` para pasar a 0.2.0; esa operación debe hacerse manualmente cuando el control de navegador no permite páginas internas. No cambian los permisos: Gemini, Flow, sus medios y Filmma local, sin cookies ni contraseñas. No se editan perfiles de Chrome para forzar un enlace.

La recepción nativa de Flow espera un único MP4 nuevo de nombre concordante en la carpeta Descargas durante un máximo de tres minutos, exige estabilidad y archivo regular, lo copia sin borrar el original y verifica el contenido con el importador habitual. Ante varios candidatos, un enlace simbólico, otra carpeta de descarga o un nombre ambiguo, requiere importación manual. No usa endpoints de generación privados ni permisos globales de descargas. El modo de recuperación de una página existente no tiene permiso para enviar una generación; tampoco inventa una fecha de envío.

Estas rutas tienen pruebas automatizadas de protocolo, copia exacta, revocación y conservación de vínculos. La conexión con la extensión instalada se valida por separado de esas pruebas y del recorrido asistido de Gemini/Flow ya documentado.
