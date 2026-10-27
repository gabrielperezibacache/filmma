# Proveedores de voz en Filmma

Filmma conserva la voz elegida para cada personaje junto al guion. Cambiar de proveedor, voz, modelo o velocidad invalida la interpretación anterior para que el usuario pueda revisarla; no borra las versiones existentes ni sustituye tomas automáticamente. Las voces importadas siguen entrando en el mismo flujo de pistas, subtítulos, sincronización labial y exportación que Kokoro.

## ElevenLabs: cuenta propia

La conexión se hace con una **clave API creada en la cuenta de ElevenLabs**, introducida en el campo privado de Filmma. No se solicita la contraseña de la cuenta ni se necesita pegar la clave en el chat. La clave necesita acceso de lectura a voces y modelos, y permiso de texto a voz para generar. La lectura de suscripción es opcional: una respuesta 403 en esa consulta permite seguir usando una clave restringida.

Conectar o actualizar sólo consulta voces, modelos y, cuando está permitido, el resumen de uso. **No genera una muestra ni consume síntesis de voz.** La generación ocurre exclusivamente al pulsar el botón correspondiente a una intervención. Envía a ElevenLabs el texto de esa intervención, el identificador de voz, el modelo y sus ajustes; no envía videos, imágenes, fichas de personajes ni el guion completo. Las solicitudes están sujetas al acceso API, créditos y condiciones de la cuenta de ElevenLabs.

El catálogo incluye las voces accesibles de la cuenta, con paginación hasta 2000. Filmma ofrece Multilingual v2, Flash v2.5 y Turbo v2.5 sólo si aparecen como modelos TTS compatibles con español en el catálogo de la cuenta. Multilingual v2 es la opción inicial. Este alcance no pretende incluir todos los modelos nuevos o todas las herramientas de ElevenLabs.

La identidad vocal se conserva mediante el mismo identificador de voz y modelo por personaje, estabilidad 0,5, similitud 0,75, estilo 0 y refuerzo de hablante. La velocidad admitida por Filmma es 0,7–1,2. Una interpretación nueva puede variar aunque use los mismos ajustes; no se promete una salida determinista.

## Credenciales y datos

- La clave vive en `~/.config/filmma/providers/elevenlabs.json`, fuera del proyecto, de la biblioteca multimedia y de los ZIP exportados. El directorio se crea con permisos 0700 y el archivo con 0600.
- La respuesta de estado sólo contiene un identificador opaco de conexión, disponibilidad, fecha de consulta, catálogo y resumen de uso. Nunca contiene la clave, correos, información de pago, facturas o cuerpos de error del proveedor.
- El estado normal usa el catálogo local guardado; no llama a ElevenLabs en cada actualización de la pantalla. La fecha `checkedAt` indica la última comprobación. Un error de credenciales o cuota al generar exige una actualización explícita, sin reintento automático.
- Un identificador nuevo al reconectar impide que una intervención que esperaba en cola utilice silenciosamente otra cuenta. Desconectar elimina la credencial y cancela las solicitudes activas de este proveedor; conserva todos los audios ya creados.
- Sólo se aceptan conexiones HTTPS a `api.elevenlabs.io`. El cliente no puede enviar una URL de destino y el servicio rechaza redirecciones.

## Audio y límites

El proveedor solicita **PCM de 24 kHz, mono, 16 bits** y construye un WAV sin compresión intermedia. El servidor verifica después el audio antes de añadirlo a la biblioteca. Cada salida usa una ruta nueva y la escritura no puede sobrescribir un archivo existente.

El máximo es **15 segundos**. La descarga se lee por partes y se cancela si supera 720000 bytes PCM; una intervención excesiva no se recorta ni se publica parcialmente. La duración sólo se conoce con precisión después de sintetizar. Cancelar, superar la duración o agotar el tiempo de espera no garantiza que ElevenLabs devuelva créditos. Filmma no reintenta automáticamente una generación para evitar cargos duplicados.

## Contrato del servidor

`server/speech-providers.ts` exporta `createElevenLabsProvider(options)`:

```ts
provider.status({ refresh?: boolean, signal?: AbortSignal })
provider.connect(apiKey, signal?)
provider.disconnect()
provider.synthesize({
  text, voiceId, modelId, language: 'es' | 'en', speed,
  outputPath, signal?, seed?, expectedConnectionId?
})
```

`status()` es local; `status({refresh:true})` hace consultas remotas de lectura. `synthesize()` devuelve `{ok:true,provider:'elevenlabs',model,duration,sampleRate,outputPath}`. La capa de diálogos captura `connectionId` antes de encolar y lo pasa como `expectedConnectionId` para la comprobación final. Las opciones de inyección de directorio y transporte sólo son de servidor y pruebas.

Rutas de integración: `GET /api/speech/elevenlabs`, `POST /api/speech/elevenlabs/connect`, `POST /api/speech/elevenlabs/refresh` y `POST /api/speech/elevenlabs/disconnect`. La generación sigue usando `POST /api/speech/generate` con el proyecto y la intervención; la clave nunca forma parte de ese trabajo, del proyecto ni de su procedencia.

## Validación

Doce pruebas automatizadas usan un transporte simulado, **sin una clave real ni generaciones facturadas**. Verifican permisos de archivo, ausencia de secretos en respuestas y errores, conservación de la conexión previa si una nueva falla, paginación, catálogo por cuenta, estado sin red, WAV PCM, límite por descarga, cancelación y tiempos de espera, conservación de originales y rechazo de trabajos ligados a una cuenta reemplazada. Esta evidencia comprueba la integración; no afirma haber escuchado una voz de la cuenta del usuario.

## Referencias oficiales consultadas

- [Crear voz: PCM, ajustes, idioma y semilla](https://elevenlabs.io/docs/api-reference/text-to-speech/convert).
- [Voces de la cuenta y paginación](https://elevenlabs.io/docs/api-reference/voices/search).
- [Modelos y capacidades TTS](https://elevenlabs.io/docs/api-reference/models/list).
- [Resumen de suscripción](https://elevenlabs.io/docs/api-reference/user/subscription/get).
- [Control de velocidad](https://help.elevenlabs.io/hc/en-us/articles/13416271012497-Can-I-slow-down-the-pace-of-the-voice).

Para el motor local existente de Hermes, véase el adaptador Qwen TTS y su diagnóstico específico. ElevenLabs es opcional y no reemplaza los motores locales.
