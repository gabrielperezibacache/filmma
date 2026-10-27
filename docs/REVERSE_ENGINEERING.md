# Investigación de Higgsfield con REA

Fecha de observación: **17 de octubre de 2026**. Alcance: navegación pública y análisis estático de JavaScript entregado públicamente. Esta investigación guía una implementación propia; no establece equivalencia con todos los servicios de Higgsfield.

La ampliación de esta investigación se mantiene en [Cobertura funcional de Higgsfield y Filmma](HIGGSFIELD-COVERAGE.md): inventario por familias, fuentes oficiales actuales, lectura del catálogo MCP, estado real del editor y trabajo pendiente. Distingue las capacidades locales de los servicios externos y documenta Dirección, Storyboard y Tomas como funciones implementadas, validadas y activas, con sus límites.

## Método y evidencia reproducible

Se descargó [REA del repositorio oficial](https://github.com/morluto/rea), commit `3fcba07962a1f9f23130a5210dba242f6a331a5b`, y se ejecutó el paquete oficial `rea-agents@6.5.0`, instalado únicamente en `research/rea-cli`. Se leyeron su README, AGENTS y las instrucciones de observación de navegador. No se ejecutó `rea setup` ni se alteró la configuración global de agentes.

1. Petición HTTP anónima a [Higgsfield en español](https://higgsfield.ai/es), guardada en `research/evidence/higgsfield-es.html`.
2. Selección del script de arranque y su importación directa desde `assets.higgsfield.ai`; originales preservados en `research/evidence/public-scripts/`.
3. Análisis REA de los dos archivos como texto inerte: **203.081 bytes, 48.363 nodos AST visitados, 0 fallos de parseo**. El grafo contiene 1.639 nodos y 2.359 relaciones. Evidencia: `ev_ae6e2c5cbff258205774a2f2c36433375581e368da9c7b06d5a1dc47df755247`.
4. Capturas reales de Cinema Studio y Katana con `capture-browser-scenario`, Chrome 155 y perfiles anónimos efímeros. REA confirmó la terminación de los procesos que había creado. Se conservaron DOM, accesibilidad y URL; no se solicitaron valores de almacenamiento, cookies de usuario ni cuerpos de peticiones.

La evidencia estática completa está comprimida sin pérdida en `research/evidence/rea-javascript.json.gz`; el resumen y los SHA-256 están en `rea-summary.json`. Las capturas están en `rea-cinema-scenario.json` y `rea-katana-scenario.json`. Los extractos de accesibilidad permiten revisar el texto sin procesar todo el DOM.

Comandos reproducibles desde la raíz:

```sh
npm install --prefix research/rea-cli --ignore-scripts --no-audit --no-fund rea-agents@6.5.0
research/rea-cli/node_modules/.bin/rea analyze-javascript-application research/evidence/public-scripts --format json
research/rea-cli/node_modules/.bin/rea capture-browser-scenario research/evidence/cinema-scenario.json --format json
research/rea-cli/node_modules/.bin/rea capture-browser-scenario research/evidence/katana-scenario.json --format json
```

El primer análisis estático no pudo compilar el auxiliar de identificación de procesos de macOS dentro del sandbox. La repetición con acceso de ejecución aprobado terminó correctamente. Firecrawl estaba instalado, pero su comprobación devolvió créditos insuficientes; no se utilizó para producir los resultados siguientes.

## Funciones observadas

| Área | Evidencia pública observada | Consecuencia para una aplicación propia |
|---|---|---|
| Organización | Cinema Studio muestra proyectos, búsqueda, ordenación, elementos, favoritos y comunidad. | Proyecto como unidad persistente; activos y tomas con identificadores estables. |
| Dirección visual | Controles de película, cámara, paleta, iluminación y movimiento de cámara. | Separar intención cinematográfica de parámetros técnicos y guardar ambos por plano. |
| Referencias | Cinema Studio muestra «Referencias 0/50», selección de elementos y entradas de imagen/video. | Biblioteca de personajes, objetos y lugares; referencias versionadas por plano. |
| Generación | Selector de modelo, resolución 1080p, proporción 16:9, duración 5 s, audio y lote de 1 a 4, coste visible antes de generar. | Validación por capacidad real del proveedor, cola serial local y estimaciones claramente identificadas. |
| Katana | Solicita video de referencia, imágenes de personajes/detalles e instrucciones opcionales. Su acción dirige la generación a Claude. | Inspiración para recrear estructura de montaje y mantener referencias; no demuestra que Katana sea un motor local descargable. |
| Presets | Katana presenta ediciones personalizadas, transferencia de estilo y de movimiento, con ejemplos reproducibles. | Presets propios que almacenen decisiones de montaje, cámara y color. |
| Catálogo | La navegación pública enlaza imagen, video, audio, Genjutsu, Ads Studio, Marketing Studio, efectos, capas, Canvas y Cinema Studio. | Dividir capacidades de planificación, generación, composición y entrega; no fingir paridad por añadir botones. |

Fuentes de interfaz: [Cinema Studio](https://higgsfield.ai/es/generate), evidencia `ev_b3f6df17e1ce02aba3ca48686d5c0124c1eeebdffa311150deafdfab43f311ab`; [Katana](https://higgsfield.ai/es/katana), evidencia `ev_986a41be9d9ed7a1fdc5ae1939c68128594a9e8065fe887c33617ec2aacd8d6a`.

## Hallazgos estáticos y límites de interpretación

El módulo público contiene declaraciones de modelos y puertos de entrada para texto, imagen, fotograma inicial, fotograma final, video y audio. La extracción complementaria mediante AST, sin ejecutar el bundle, está en `public-model-declarations.json`, con posición de origen. Estas declaraciones describen configuración enviada al cliente; **no verifican que un modelo esté disponible para una cuenta ni cómo se ejecuta en los servidores**.

- `minimax`, `minimax-fast` y `minimax-2.3-fast` declaran un fotograma inicial obligatorio. `minimax-2.3` declara uno opcional. Las dos primeras variantes declaran un límite de prompt de 2.500 caracteres.
- `cinematic_studio_video_4_0` declara fotogramas inicial/final y hasta 15 referencias de cada tipo: imagen, video y audio. La interfaz observada presenta un límite agregado distinto. Son contratos de capas diferentes y no deben sumarse o confundirse.
- El paquete contiene puertos tipados para Canvas y referencias a operaciones como relight, cambio de paleta, recast, swaps, transición y storyboard. Su presencia es evidencia de código distribuido, no una prueba de funcionamiento end-to-end de cada operación.
- REA marca cobertura **parcial**: no se descargó cada chunk, no se resolvieron todas las importaciones y no se ejecutó el código durante el análisis estático. Candidatos de endpoint inferidos por REA no se trataron como APIs documentadas ni se invocaron.

No se inició sesión, generó contenido, compró crédito, interrogó endpoints privados, extrajo pesos de modelos ni reutilizó material audiovisual, marca o diseño de Higgsfield como activos de la aplicación. No se observó el comportamiento de exportación, colaboración o edición autenticada.

## Mejoras propuestas para Filmma

Estas son decisiones propias de producto, no funciones atribuidas a Higgsfield:

1. **Guión como fuente del proyecto:** escenas y beats vinculados a planos, duración objetivo, diálogo, voz y intención. Los cambios del guión deben indicar qué planos quedan pendientes de revisión.
2. **Continuidad explícita:** cada personaje/objeto tiene identidad, referencias, rasgos invariantes, vestuario y notas. Un plano almacena las versiones concretas usadas, además de semilla y parámetros. Una referencia ayuda a consistencia; no garantiza identidad perfecta en cualquier modelo.
3. **Montaje trazable:** una toma generada conserva su prompt expandido, imágenes de entrada, modelo, parámetros, estado y archivo original. El montaje puede cambiar sin perder la generación anterior.
4. **Capacidades honestas:** el selector de proveedor informa T2V/I2V, imagen final, duración, audio, referencias, resolución y dispositivo realmente admitidos. Los controles incompatibles se explican antes de lanzar un trabajo.
5. **Presupuesto local:** generar de a un trabajo, comenzar con borradores cortos, descargar pesos una vez, comprobar espacio y memoria, poder cancelar y conservar el resultado original antes de renderizar el montaje final.
6. **Herramientas de cine y publicidad:** mantener guión, biblioteca y visor a la vista, cambiar relación de aspecto por entrega y crear variantes de CTA/producto desde una misma estructura de escenas.

## Conexión directa de Codex

Comprobación local: existe `codex-cli 0.155.1`; `codex login status` devolvió autenticación mediante ChatGPT. Solo se consultó ese estado y las ayudas de comandos; no se leyeron ni copiaron archivos de credenciales. Esto no verifica todavía que un turno concreto pueda completarse ni su cuota disponible.

La integración local recomendada usa un proceso hijo de `codex app-server --listen stdio://`. Tras `initialize`/`initialized`, puede consultar `account/read`, `account/rateLimits/read` y `model/list`; abrir un hilo con `thread/start`, iniciar trabajo mediante `turn/start`, mostrar deltas y terminar solo cuando `turn/completed` indique éxito. Codex gestiona su autenticación ChatGPT. Mantener el proceso en el backend local evita exponer credenciales en el navegador. El esquema JSON del protocolo debe obtenerse de la versión instalada. [Documentación oficial de App Server](https://learn.chatgpt.com/docs/app-server).

Para operaciones cortas existe `codex exec --json --output-schema`, adecuado para solicitar un desglose estructurado de guión y revisarlo antes de incorporarlo al proyecto. La aplicación debe enviar contexto acotado, tratar el resultado como una propuesta validable y usar un sandbox de lectura para trabajo puramente editorial. No debe permitir que una cadena de prompt se convierta en un comando de shell interpolado.

Una aplicación que gestione su propio «Sign in with ChatGPT» tiene otro contrato: debe registrar cliente, obtener autorización y manejar renovación de tokens. La documentación oficial permite conectar ese flujo a App Server y aclara que el catálogo de modelos no prueba acceso efectivo. Esa opción no debe confundirse con reutilizar credenciales de otra aplicación. [App Server con Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server).

La ruta de uso del plan por Sign in with ChatGPT **no soporta generación nativa de imágenes**, transcripción, entrada de audio/video ni conectores hospedados según sus limitaciones publicadas. Puede recibir imágenes en modelos compatibles y ejecutar herramientas locales. Por ello, el flujo básico de Filmma puede usar Codex para guión, prompts, continuidad y análisis de imágenes, e importar imágenes generadas por el usuario en Codex. Un botón de generación GPT dentro de la app necesita una integración explícitamente compatible; no se debe presentarlo como un derecho ilimitado incluido por el mero hecho de tener suscripción. [Limitaciones oficiales](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

## Frontera de verificación

| Afirmación | Estado |
|---|---|
| REA instalado localmente y ejecutado sobre Higgsfield | Verificado. |
| Captura real anónima de Cinema Studio y Katana | Verificado. |
| Análisis estático de los dos scripts públicos seleccionados | Verificado, cobertura parcial. |
| Presencia de modelos MiniMax en catálogo cliente | Verificado; no prueba pesos locales. |
| Login local de Codex mediante ChatGPT | Verificado sin exponer credenciales. |
| Cuota e inferencia Codex desde Filmma | Debe verificarse mediante un turno real de la aplicación. |
| Paridad de todos los módulos comerciales | No demostrada. |
| Motor MiniMax de video ejecutándose localmente | No demostrado por esta investigación; requiere pesos y runtime oficialmente disponibles. |
