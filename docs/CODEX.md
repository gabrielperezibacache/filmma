# Codex y Filmma

Filmma tiene dos conexiones diferentes. El asistente dentro del estudio utiliza tu **Codex CLI local** para guion, prompts y continuidad. El conector **MCP** permite que Codex lea el proyecto y envíe imágenes locales al estudio. Registrar MCP no es necesario para usar el asistente interno.

## Asistente dentro de Filmma

En la máquina de desarrollo se verificó Codex CLI `0.155.1` y una sesión iniciada con ChatGPT. Filmma consulta ese estado y ejecuta las tareas creativas a través de la CLI, sin copiar credenciales al navegador. La disponibilidad de una sesión no garantiza cuota restante ni acceso a todos los modelos.

En otro equipo, instala Codex siguiendo su [guía oficial](https://learn.chatgpt.com/docs/cli) e inicia sesión:

```sh
codex login
codex login status
```

El asistente devuelve propuestas de texto para revisar. Para guiones, añade una propuesta estructurada de planos que se puede revisar antes de incorporarla al proyecto; la respuesta no modifica por sí sola el montaje. Filmma utiliza `--ignore-user-config` para evitar heredar un modelo no disponible o la configuración personal de herramientas, sin modificar esa configuración ni la sesión iniciada. No fija un modelo por nombre. Se verificó una respuesta real con la cuenta conectada. La generación de video sigue siendo una tarea del motor local de Filmma. La [documentación de App Server](https://learn.chatgpt.com/docs/app-server) describe la integración programática y el estado de cuenta.

## Conectar Codex al estudio mediante MCP

El archivo `scripts/filmma-mcp.mjs` está preparado y probado. **El conector `filmma` ya se registró en Codex en este equipo**, con la ruta absoluta de Node y del script. Los pasos siguientes permiten reproducir la conexión en otro equipo o actualizarla si cambia la ubicación del proyecto.

1. Instala las dependencias del proyecto y abre Filmma:

   ```sh
   cd "/Users/gabrielsimonpi/Documents/Filmma IA"
   npm install
   npm run dev
   ```

2. En otra terminal, registra el conector una vez:

   ```sh
   codex mcp add filmma -- node "/Users/gabrielsimonpi/Documents/Filmma IA/scripts/filmma-mcp.mjs"
   ```

   Si moviste Filmma, sustituye la ruta. El comando registra un proceso local stdio; no publica un servicio en Internet ni requiere una clave API de OpenAI.

3. Inicia un nuevo chat de Codex o vuelve a cargar su conexión MCP. Revisa la lista de herramientas del conector `filmma`. La API de Filmma debe seguir abierta en `http://127.0.0.1:4318`.

Si cambiaste el puerto de la API, proporciona el destino explícito al registrar:

```sh
codex mcp add filmma --env FILMMA_URL=http://127.0.0.1:4318 -- node "/Users/gabrielsimonpi/Documents/Filmma IA/scripts/filmma-mcp.mjs"
```

El script rechaza destinos remotos, credenciales en la URL y redirecciones. Todas sus peticiones llevan `X-Filmma-Client: filmma`. La comunicación de Codex con modelos de OpenAI requiere Internet y está sujeta a tu plan; la comunicación del conector con Filmma permanece en tu Mac.

## Herramientas disponibles

| Herramienta | Función | Cambia el proyecto |
|---|---|---|
| `filmma_read_project` | Lee guion, planos, referencias y archivos del proyecto abierto. | No. |
| `filmma_list_elements` | Busca personajes, objetos/lugares representados como elementos y archivos por nombre o rol. | No. |
| `filmma_import_image` | Importa un archivo de imagen local a la biblioteca y devuelve su identificador. | Añade una imagen; conserva los originales. |
| `filmma_propose_scene` | Valida una propuesta de plano y sus referencias contra el proyecto. | No: devuelve `saved: false`, para revisión y aplicación en el editor. |

Una propuesta contiene título, acción/diálogo, prompt y negativo, duración, cámara, semilla, personajes y referencia visual. Su respuesta distingue expresamente una propuesta de un plano ya guardado. No inicia generación de video ni sobreescribe el proyecto con un snapshot antiguo.

## Pasar una imagen de Codex a Filmma

Puedes pedir a Codex:

> Lee mi proyecto de Filmma. Prepara una imagen para el plano de apertura con los personajes y el estilo indicados. Cuando el archivo esté creado, impórtalo al estudio mediante `filmma_import_image` y propón el plano usando el identificador devuelto.

La creación de la imagen depende de las herramientas realmente disponibles en ese chat. El conector de Filmma **importa un archivo ya existente**; no convierte tu suscripción en un endpoint universal de generación de imágenes. La ruta de uso de plan mediante Sign in with ChatGPT tiene [limitaciones oficiales sobre herramientas de imagen, audio y video](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

También puedes indicar una imagen creada previamente:

```json
{
  "path": "/ruta/absoluta/a/la/imagen.png",
  "name": "Elena · referencia de continuidad"
}
```

Se comprueba que sea un archivo regular, que la firma y extensión correspondan a una imagen y que el decodificador reconozca dimensiones válidas. Se aceptan PNG, JPEG, WebP, GIF, AVIF y HEIC compatibles con el decodificador instalado, hasta **32 MiB y 60 megapíxeles**. No se aceptan URLs, SVG ni enlaces simbólicos como archivo final. La importación no recomprime el contenido. Si Filmma está abierto, la biblioteca incorpora el recurso al actualizarse; asígnalo al plano o elemento deseado.

## Verificación realizada

El servidor MCP utiliza el transporte stdio y negocia el protocolo `2025-11-25`. Se comprobó inicialización y descubrimiento con el cliente oficial `@modelcontextprotocol/client` 2.3.1 en una prueba aislada; posteriormente se registró el conector real en Codex. El protocolo usa JSON-RPC delimitado por líneas; stdout contiene únicamente respuestas MCP. [Especificación de transporte](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

La prueba contra una instancia real de la API con datos temporales verificó lectura, listado, importación con igualdad exacta de bytes, propuesta sin cambios de escenas y referencias inexistentes. También verificó rechazo de archivos falsos, extensión incorrecta, enlaces simbólicos, URL remota y redirecciones. Las cuatro pruebas pasaron:

```sh
node --import tsx --test scripts/filmma-mcp.test.mjs
```

Esto verifica el conector y la API local; no acredita que tu chat activo ya haya cargado MCP ni que se haya generado una imagen o un video nuevo con la cuenta.

## Adaptación, referencias e imágenes

Producción → Adaptar con Codex consulta el catálogo real mediante App Server y comprueba una sesión ChatGPT. Usa Codex CLI con el modelo elegido para devolver propuestas estructuradas, investigar con búsqueda web y crear imágenes con su herramienta integrada. Los documentos se extraen localmente; sólo se envía su texto al solicitar la adaptación. No se activa una API de pago como alternativa. Cada imagen se copia a Filmma y se verifica antes de vincularla. Consulta [el recorrido completo](ADAPTATION.md) para límites, revisión, referencias reutilizables y producción por episodios.
