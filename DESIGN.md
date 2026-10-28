---
name: Filmma — sala de dailies
description: Estudio local de cine con la imagen como centro del trabajo.
colors:
  jade: "#bdd2c2"
  jade-dark: "#26372f"
  action-ink: "#181e27"
  ink: "#10141c"
  panel: "#191f29"
  panel-raised: "#242c37"
  border: "#333d4b"
  ivory: "#f0f2f4"
  silver: "#a2afbf"
  viewer: "#080b10"
typography:
  brand:
    fontFamily: "FilmmaDisplay, Georgia, serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "22px"
    fontWeight: 550
    lineHeight: 1.3
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
  timecode:
    fontFamily: "ui-monospace, SFMono-Regular, monospace"
    fontSize: "11px"
    letterSpacing: "0.2px"
  status-mobile:
    fontSize: "9px"
  metadata-small:
    fontSize: "10px"
  context-label:
    fontSize: "14px"
  panel-title:
    fontSize: "16px"
  avatar-initial:
    fontSize: "18px"
  empty-title-mobile:
    fontSize: "19px"
  section-title:
    fontSize: "20px"
  shot-title-mobile:
    fontSize: "21px"
  detail-title-mobile:
    fontSize: "23px"
  dialog-title:
    fontSize: "26px"
  headline-compact:
    fontSize: "27px"
  brand-mobile:
    fontSize: "28px"
rounded:
  flat: "0"
  indicator: "2px"
  time-label: "3px"
  badge: "4px"
  example-label: "5px"
  thumbnail: "6px"
  navigation: "7px"
  control: "8px"
  editor-viewer: "10px"
  panel: "12px"
  modal: "16px"
spacing:
  badge-inset: "1px"
  tight: "2px"
  example-inset: "3px"
  micro: "4px"
  text-gap: "5px"
  compact: "6px"
  icon-gap: "7px"
  small: "8px"
  project-inset: "9px"
  row-inset: "10px"
  primary-inset: "11px"
  control: "12px"
  mobile-row: "13px"
  row-gap: "14px"
  heading-inset: "15px"
  panel: "16px"
  mobile: "18px"
  section: "20px"
  advance: "22px"
  shell: "24px"
  fact-label-indent: "25px"
  section-offset: "26px"
  page: "28px"
  section-bottom: "30px"
  empty-action-indent: "36px"
  page-bottom-mobile: "40px"
  page-bottom: "52px"
components:
  button-primary:
    backgroundColor: "{colors.jade}"
    textColor: "{colors.action-ink}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  button-quiet:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ivory}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  button-text:
    textColor: "{colors.ivory}"
    padding: "4px 0"
  input:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ivory}"
    rounded: "{rounded.control}"
    padding: "10px 11px"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ivory}"
    rounded: "{rounded.panel}"
    padding: "20px"
---

# Design System: Filmma

## Overview

**Creative North Star: "Sala de dailies"**

Filmma es una mesa de trabajo para escribir, dirigir, montar y revisar una película local. La imagen ocupa el centro; tinta azul, marfil y jade mate ordenan las herramientas durante sesiones largas. El recuerdo del cine procede de la marca, del lenguaje y del material audiovisual, con controles actuales y precisos.

Este documento registra el mundo construido en la versión (0.12.0), aprobado como A para Inicio y B para Dirección/Montaje. Sustituye la antigua dirección verde. Las composiciones orientan la jerarquía; los planos, personajes, tiempos, trabajos y estados proceden del proyecto real. Las superficies conservadas mantienen sus funciones y patrones especializados.

**Key Characteristics:**

- Visor amplio, material real y encuadre completo en las vistas principales.
- Herramientas compactas en sans, con navegación agrupada y contexto del plano.
- Superficies mates con un borde, selección discreta y acciones concretas.
- Edición reversible, originales accesibles y estados explícitos.

Evidencia: [contrato aprobado](output/ui-redesign/approved-contract.md), [revisión final](output/ui-redesign/finish-review.md), `src/screening-room.css`, `src/screening-palette.css`, `src/styles.css` y `src/appearance.css`. La revisión final cierra M1–M3; no certifica accesibilidad integral, aplicación nativa ni calidad de los modelos.

## Colors

La paleta predeterminada es tinta azul con texto claro y jade contenido; la calidez fotográfica pertenece al material.

### Primary

- **Jade mate** (`jade`): acción principal, foco, selección y pequeños indicadores. **Jade oscuro** (`jade-dark`) y **tinta de acción** (`action-ink`) acompañan sus estados y texto.

### Neutral

- **Tinta de sala** (`ink`): fondo común y campos. **Panel** y **panel elevado**: contexto, inspectores y selección. **Borde**: separación precisa entre áreas.
- **Marfil** (`ivory`): contenido principal. **Plata** (`silver`): ayuda y metadatos. **Negro de visor** (`viewer`): respaldo del medio, sin teñir la imagen.

**The Semantic Theme Rule.** Los componentes compartidos consumen `--bg`, `--panel`, `--panel-light`, `--border`, `--text`, `--muted` y `--accent`; no fijan la paleta de Cinema dentro de cada pantalla.

Cinema usa los tokens anteriores. Grafito, Luz de día y Sistema siguen disponibles; Sistema responde a la apariencia del equipo. Los acentos configurables conservan sus identificadores Salvia, Ámbar, Océano y Rosa; Salvia resuelve al jade en Cinema. Las variantes claras y de contraste viven en `appearance.css` e `interface-palette.css`; no se convierten en otra composición ni cambian el color del medio. Las etiquetas históricas de Configuración no son autoridad para restituir el antiguo verde.

## Typography

La sans del sistema sostiene títulos de operación, texto y controles. FilmmaDisplay usa Baskerville local, con Georgia/serif como respaldo, en la marca pequeña. Inicio, Dirección, Montaje, Configuración y Motores comparten encabezados sans; no añaden un antetítulo que repita su nombre.

- **Marca:** token `brand`; en móvil baja a (28px).
- **Encabezado:** token `headline`; en móvil (27px, interlínea 1.25). Montaje usa (27px) también en escritorio.
- **Títulos contextuales:** `title` y `panel-title`; `section-title` para secuencia y errores de medio; `dialog-title` para diálogos. En móvil, `shot-title-mobile`, `empty-title-mobile` y `detail-title-mobile` corresponden a plano, vacío de Dirección y detalle de Biblioteca. Son ajustes por superficie, no una escala que deba aplicarse completa en cada pantalla.
- **Texto y acciones:** `body`, `label` y `context-label`; texto operativo (12–14px), con campos de Dirección en móvil (16px) para entrada nativa. La descripción de página limita la lectura a (70ch).
- **Medidas y etiquetas pequeñas:** (11px) para tiempos, ayudas y títulos de grupo; `metadata-small` para contador de trabajos, duraciones sobre miniaturas, metadatos de plano y datos compactos. `status-mobile` queda reservado al pie de estado móvil. El rango (9–11px) no sustituye al texto operativo. La inicial de un retrato ausente usa `avatar-initial`.
- **Tiempos:** monoespaciados y cifras tabulares; no darles el mismo peso que la acción. `headline-compact` y `brand-mobile` registran las variantes ya descritas del encabezado y la marca.

El tamaño cero de los botones que sólo muestran un icono en móvil oculta su texto visual; no es un escalón de lectura ni sustituye su nombre accesible.

El guion mantiene su papel claro, campos Courier New y título editorial; otros paneles editoriales conservados pueden mantener su serif existente. Esta excepción no se extiende a nuevos encabezados de herramientas.

## Layout

La cabecera persistente mide (64px), el pie (28px) y la navegación agrupada (198px). Las páginas tienen ancho máximo (1600px) y relleno horizontal (28px). Historia, Rodaje, Montaje y entrega, y Estudio reúnen los destinos existentes. La selección combina fondo, texto, indicador jade y `aria-current`; el contador de trabajos representa actividad real.

Inicio combina visor y siguiente paso en dos columnas, con panel lateral de (300px); debajo aparecen los datos reales, la secuencia horizontal y el recorrido de producción desplegable. El siguiente paso cambia según el proyecto. Dirección organiza secuencia, visor y controles en columnas de (148px / flexible / 320px), con Intención, Cámara y Generar en pestañas contextuales. La entrada de referencias de cámara es una fila abierta con miniatura (64px), texto y flecha, sin tarjeta anidada.

Montaje usa (144px / flexible / 304px), con la línea de tiempo debajo a todo el ancho. Por encima de (1180px), el área de trabajo ocupa la altura de la ventana y cada región contiene su propio desplazamiento. Secuencia, Pistas, Mezcla, Subtítulos y Marcadores permanecen en el mismo dock; el inspector puede ocultarse sin cambiar de plano.

El marco del visor de Montaje conserva la proporción del proyecto: en escritorio ocupa la altura de su región con ancho automático y límite del ancho disponible; en móvil ocupa el ancho con altura automática. La adaptación no estira ni recorta la fuente.

- Hasta (1350px), las columnas y márgenes se estrechan. Entre (761px y 1180px), Inicio se apila, Dirección mueve el inspector debajo y Montaje conserva secuencia/visor, dock e inspector en ese orden.
- Hasta (960px), la navegación mide (176px). La preferencia de sólo iconos usa (72px) en escritorio; los botones conservan nombre accesible y ayuda.
- Hasta (760px), el menú nativo de secciones reemplaza la barra lateral; muestra el destino actual, cierra al elegir y admite Escape con retorno al resumen. Cabecera (60px) y márgenes (18px).
- En móvil, Inicio presenta el visor antes del siguiente paso. Dirección presenta una tira de planos y apila visor, controles y cuaderno. Montaje ordena visor, tira de planos, dock e inspector, que comienza oculto en esta vista.
- Las tiras, pestañas y líneas de tiempo desplazan dentro de su región. Las acciones principales, secundarias y de texto alcanzan (44px) de alto en móvil; los campos de Dirección usan (16px).

Las preferencias de escala ampliada, densidad compacta, idioma e inicio siguen vigentes. El idioma cambia la interfaz disponible, conservando guiones, nombres y prompts escritos por el usuario.

El espaciado construido combina detalle fino (1–7px), controles y separaciones compactas (8–16px), flujo entre áreas (18–30px) y cierres o sangrías puntuales (36px, 40px y 52px). La escala enumera los pasos observados; no impone incrementos uniformes. Los desplazamientos izquierdos del pie (96px, 196px y 222px) alinean el contenido con las variantes de navegación y son medidas de composición, no pasos de espaciado reutilizables.

## Elevation & Depth

Las superficies de trabajo usan tono, borde y espacio, sin resplandores ni gradientes decorativos. Los paneles principales no acumulan elevación. Los diálogos y avisos conservan sombra funcional: modal (`0 24px 90px #00000077`), aviso (`0 10px 35px #00000055`); el papel de guion mantiene su sombra (`0 12px 30px #00000033`). El fondo modal aplica desenfoque (4px).

Las transiciones de botón duran (150ms). El cambio de medio en Inicio usa una apertura por recorte de (350ms), sin alterar color ni geometría del archivo. La preferencia del sistema y el ajuste de movimiento reducido suprimen esta animación; las animaciones existentes respetan sus controles de pausa y reducción.

## Shapes

Controles y miniaturas generales usan `control`, paneles y visores de Dirección `panel`, diálogos `modal`. La navegación usa `navigation`, los retratos `thumbnail` y el visor de Montaje `editor-viewer`. Las formas pequeñas también pertenecen al sistema: `indicator` para la marca lateral seleccionada, `time-label` para número/duración de Dirección, `badge` para contadores y rótulos sobre miniaturas, `example-label` para el aviso de proyecto de ejemplo. `flat` registra las filas abiertas de secuencia y referencias de cámara. Son funciones distintas, no radios intercambiables. Líneas finas y esquinas moderadas delimitan el trabajo; no se convierten todos los elementos en cápsulas.

## Components

- **Acciones:** jade para avanzar o confirmar; secundarias con borde y fondo de panel; acciones de texto para vínculos contextuales. Las principales aclaran su verbo y estado. Hover aclara el jade o eleva el tono del panel; deshabilitado conserva opacidad (.45). Foco visible con contorno de acento (2px) y separación (3px).
- **Campos:** etiquetas visibles, fondo de sala, borde único y radio `control`. El foco cambia el borde y añade el anillo existente. Selectores conservan affordance nativa; las condiciones no disponibles y los errores se explican junto a la acción.
- **Navegación y pestañas:** iconos Lucide de línea, texto legible, selección con más de una señal. Las pestañas de Dirección muestran subrayado y `aria-pressed`; las del inspector conservan la herramienta seleccionada. El menú móvil mantiene Configuración, Mis películas y Nuevo proyecto.
- **Planos y chips:** miniatura real, número, duración y título identifican cada plano; una selección visible conecta secuencia, visor e inspector. Los chips de personajes conservan texto, vínculo y marca de selección, sin inventar retratos.
- **Medios y vacíos:** los visores principales preservan encuadre con `contain`; las miniaturas de navegación pueden usar `cover`. Inicio prioriza la toma seleccionada o la referencia existente. Sólo cuando falta fuente muestra `public/studio/sala-de-cine-v1.webp` con etiqueta de imagen creada con IA; un archivo fallido muestra error y acceso a Biblioteca. Dirección presenta un vacío con importación. La ilustración (1672×941) conserva original y prompt en su procedencia; no representa un plano generado del usuario.
- **Google AI Pro (construido en 0.13):** Dirección → Generar ofrece el traspaso a Gemini o Flow; Configuración → Conexiones abre ese recorrido. Preparar, generar en Google y volver con la toma forman tres pasos numerados sólo dentro de este panel. El paquete ZIP se prepara localmente con referencias elegidas y prompt inmutable, separado del prompt actual; prepararlo no envía archivos. La generación y descarga son manuales en Google: Filmma no autentica la cuenta ni consulta suscripción o créditos. La importación conserva los bytes, dimensiones y fps nativos, muestra medidas reales y permite usar la toma conservando anteriores; un contexto cambiado la deja como alternativa. «Salida de la película» agrupa en un desplegable los ajustes de todo el montaje y aclara que sólo la exportación adapta la cadencia. La procedencia es declarada; este flujo no certifica el origen Google, la continuidad ni una generación remota.
- **Flujos conservados:** Guion, personajes/objetos, storyboard, voces, continuidad, biblioteca, trabajos, motores, recuperación y exportación mantienen sus herramientas. Recorte, reordenación, tomas, color, capas, audio, subtítulos, marcadores y versiones siguen vinculados a sus fuentes; la nueva organización visual no altera sus IDs ni semántica. Los diálogos de comparación conservan foco, cierre y límites explícitos; las revisiones pendientes o antiguas no aparentan aprobación.

**The Original Frame Rule.** Una nueva interpretación es una versión identificada; el visor y los estados nunca presentan una ilustración o una copia derivada como el original del usuario.

## Do's and Don'ts

### Do:

- **Do** dar prioridad al medio real y conservar su encuadre en el visor principal.
- **Do** reutilizar tokens semánticos, jerarquía sans y variantes de apariencia existentes.
- **Do** mantener datos, vínculos, estados de trabajo y acciones reversibles junto al contexto del plano.
- **Do** identificar los ejemplos, ilustraciones IA, versiones y límites de cada revisión.

### Don't:

- **Don't** restituir el antiguo grafito verde como paleta predeterminada ni decorar herramientas con neón, resplandores o gradientes.
- **Don't** servir capturas de las composiciones como interfaz ni extraer sus personajes, cifras o actividad ficticia.
- **Don't** recortar el medio principal para imitar la maqueta ni repetir la ilustración para aparentar varios planos.
- **Don't** prometer identidad, calidad, rendimiento, revisión completada o pruebas integrales sin evidencia.
