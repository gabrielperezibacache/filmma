# Filmma Studio

Un estudio de cine local para Mac: escribe el guion, conserva la identidad de tus personajes y objetos, dirige cada plano y exporta el montaje. Interfaz en español e inglés, con un visor cinematográfico y animaciones de Motion.

## Abrir

La versión de macOS se instala desde el DMG más reciente de las [releases privadas](https://github.com/gabrielperezibacache/filmma/releases). Arrastra Filmma a Aplicaciones. Este paquete requiere Apple Silicon y macOS 27 o posterior; tiene firma ad hoc y todavía no está notarizado por Apple.

En **Configuración** (⌘,) puedes cambiar apariencia, idioma y espacio de trabajo. **Motores** guía la elección de disco, revisión de licencia y espacio, descarga reanudable, verificación y prueba local. El botón de proporción y FPS de la cabecera cambia el formato de toda la película conservando originales y tiempos. Consulta [configuración, modelos y actualizaciones](docs/APPLICATION_SETTINGS.md).

Haz doble clic en **Abrir Filmma.command**. La aplicación se abre en el navegador y guarda los archivos en este Mac. También puedes abrir `http://127.0.0.1:4318` si el servidor está activo.

Para desarrollo:

```sh
npm install
npm run dev
```

Estudio: `http://127.0.0.1:4317`. Servidor: `http://127.0.0.1:4318`. Para usar la versión compilada: `npm run build` y `npm start`.

Consulta la [guía de uso](docs/GUIA.md) para recorrer todas las etapas.

La [primera entrega de recuperación y calidad nativa](docs/FIRST-DELIVERY.md) añade historial verificable de proyectos, un recorrido según el estado de la película, recomendaciones por objetivo y una comparación local de resoluciones sin sustituir los originales.

La [segunda entrega de montaje, mezcla y subtítulos](docs/SECOND-DELIVERY.md) amplía la línea de tiempo, añade bloqueo y división de clips con fundidos conservados, mesa de mezcla, escucha aislada e importación SRT revisable. Guion, personaje e intervención vocal siguen asociados al guardar y reabrir el proyecto.

## Del guion a la película

1. **Guion**: escribe la premisa y las escenas, diálogos y duraciones. Codex propone una secuencia que puedes revisar antes de incorporarla. Exporta el texto del guion.
2. **Elementos**: crea personajes, objetos, productos o lugares; define rasgos, añade imágenes y vincula cada elemento a sus planos.
3. **Biblioteca**: importa imágenes, videos y sonido. Se conservan los archivos originales sin recomprimir. Selecciona una banda sonora y su volumen.
4. **Estudio**: selecciona una referencia, afina el prompt, cámara y restricciones; crea variantes y cambia el orden. El visor reproduce videos o una animática con imágenes fijas. Los ajustes avanzados separan la duración del clip generado de la duración en montaje.
5. **Motores**: comprueba disponibilidad, espacio y descarga. Selecciona LTX para una alternativa ligera o MiniMax H3 para el motor preparado en el SSD externo.
6. **Exportar**: crea un MP4 H.264/AAC hasta 4K, horizontal, vertical o cuadrado. La resolución nativa del clip se selecciona antes de generar; el acabado con IA y el lienzo de exportación se eligen por separado. La exportación respeta orden, duración, recorte inicial, audio de clips y banda sonora. El ZIP conserva guion y originales.

El proyecto «La última función» contiene cuatro imágenes originales creadas con GPT y una toma de prueba creada localmente con LTX. Los originales de demostración y sus prompts se documentan en [DEMO_ASSETS.md](docs/DEMO_ASSETS.md). MiniMax ya completó una toma continua de 14,375 s a 512 × 320 y un piloto de 22 fotogramas a 1024 × 576 en este Mac. Cada validación acredita únicamente su configuración exacta; consulta [resolución nativa y pruebas](docs/NATIVE_RESOLUTION.md).

## MiniMax local y Mac de 36 GB

Integración real con **MiniMax H3**, pesos abiertos, y el motor comunitario **h3.c** compilado para Metal. No es una conexión clandestina a los servidores de Higgsfield. La carpeta acordada es:

```
/Volumes/SSD Externo/Filmma/models/minimax-h3
```

Los pesos base necesitan aproximadamente **144 GB**; el transformador de referencias suma aproximadamente **66 GB**. Se comparten componentes para no duplicar el encoder y los VAE. Hay comprobación de espacio con reserva de 20 GiB, descargas reanudables, revisión de tamaños y SHA-256 y una sola generación usando la GPU a la vez.

El perfil conservador transmite bloques desde SSD. **La cantidad de pesos en disco no equivale a la memoria de inferencia.** El tiempo depende del equipo y de la velocidad del SSD. Tener el motor compilado no acredita una generación completa: consulta Actividad y las evidencias de `runtime/validation/`.

Dirección y Montaje ofrecen un selector de resolución nativa. Los perfiles experimentales de mayor resolución mantienen el control de presión, memoria e intercambio del sistema. Una combinación que exceda su presupuesto se bloquea sin acortar la duración ni reducir las dimensiones silenciosamente. El acabado 4K no convierte una fuente pequeña en una generación nativa 4K.

También se integra **LTX-Video 2B distilled con MLX**, que necesita aproximadamente 25.4 GB de pesos. Sus clips no contienen audio nativo. La guía [LOCAL_MODELS.md](docs/LOCAL_MODELS.md) explica capacidades, límites, instalación y reproducción de las pruebas.

## Codex conectado

El asistente ejecuta la CLI oficial usando la sesión local de ChatGPT para escribir guion, mejorar prompts y revisar continuidad. No copia tokens al navegador. Usa una configuración aislada del modelo global del usuario para evitar incompatibilidades de cuenta, conservando la autenticación gestionada por Codex.

Además, se registró el conector MCP local **filmma**. En una nueva sesión de Codex, permite leer el proyecto y enviar imágenes ya generadas directamente al estudio. Las imágenes también pueden importarse desde el navegador. La suscripción no se presenta como una API universal de imágenes o video.

Consulta [CODEX.md](docs/CODEX.md). El uso de Codex necesita Internet y está sujeto a los límites de la cuenta; el montaje y la inferencia local permanecen en el equipo.

## Archivos y recuperación

- `data/project.json`: proyecto abierto, guardado mediante escritura atómica.
- `data/projects/`: respaldos de proyectos al cambiar entre ellos.
- `data/media/`: originales y nuevas tomas.
- `data/exports/`: películas y paquetes exportados.
- `data/jobs.json`: actividad y errores reales.
- `runtime/local-config.json`: ubicación de los modelos de este equipo.

El menú del título permite reabrir proyectos guardados. Cada generación crea una toma nueva. Cambiar una referencia o desvincular un clip no borra el original. La exportación ZIP es un respaldo portable con los originales. Puedes importarlo desde «Mis películas»; se abre como un proyecto nuevo y conserva el proyecto anterior. No borres `data/` para actualizar la aplicación.

## Alcance de esta versión

Funciona el circuito de guion, elementos persistentes, imágenes, cola de generación, montaje por planos, banda sonora, exportación y asistencia. El montaje incluye desplazamiento por fotogramas, división de tomas, cortes, fundidos a negro y aspectos de color que preservan los originales. La generación por secuencias procesa los planos pendientes uno a uno. Puedes llevar los cortes a otro editor mediante EDL y exportar los diálogos temporizados como SRT. No incluye todavía máscaras, edición por capas ni una estación de audio multipista. Las herramientas propietarias de Higgsfield, Katana, lip sync y su catálogo comercial no se convierten en funciones locales por inspeccionar el sitio. Las referencias y semillas ayudan a mantener identidad, pero requieren revisar las tomas.

El análisis de REA, sus capturas y la distinción entre comportamiento observado e inferido están en [REVERSE_ENGINEERING.md](docs/REVERSE_ENGINEERING.md). El código inspeccionado de Higgsfield no se incorpora al producto.

## Verificación

```sh
npm run build
npm test
node --import tsx --test scripts/filmma-mcp.test.mjs
python3 -m unittest discover -s runtime/tests
```

Las pruebas comprueban exportación MP4 real, audio, originales, respaldos, cancelación, exclusión de orígenes remotos y las herramientas MCP. Las pruebas de inferencia son independientes y sus resultados sólo se acreditan con un archivo de video validado.

El acabado **Restauración estable** está disponible por toma y para toda la película, con un inicio al65%, compensación de movimiento del detalle y conservación de originales. [Preparación, límites y evidencia](docs/STABLE_RESTORATION.md).
