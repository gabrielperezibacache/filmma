# Google AI Pro en Filmma

Filmma 0.13 incorpora un flujo asistido para usar la suscripción en **Gemini o Flow**. La generación y descarga se realizan manualmente en Google. No hay una conexión API automática ni se guardan contraseñas, cookies o claves de Google en Filmma.

## Recorrido

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
