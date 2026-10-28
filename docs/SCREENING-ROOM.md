# Filmma 0.12 — sala de visionado

La interfaz aprobada combina **El visor** para Película y **Mesa de trabajo** para Dirección y Montaje. Conserva el proyecto existente, sus identificadores y sus archivos. La navegación agrupa Historia, Rodaje, Montaje y entrega, y las herramientas del estudio.

## Retomar una película

En **Película**, el visor muestra una toma o imagen vinculada a la secuencia. Elegir una miniatura cambia la vista local; «Abrir montaje» y «Dirigir» llevan al plano elegido. «Tu siguiente paso» se calcula con el contenido y los trabajos del proyecto. Desde aquí también se abre la ficha del personaje o el diálogo de proporción y FPS.

Cuando falta material, la nueva imagen de cine se identifica como ilustración creada con IA. No se incorpora a los planos, no cuenta como una generación del proyecto y no sustituye archivos. Si una fuente no se puede abrir, se ofrece revisar la biblioteca y se conservan sus vínculos.

## Dirigir y montar

**Dirección** reúne secuencia, visor y tres grupos de controles: Intención, Cámara y Generar. Explorar referencias sigue siendo un borrador hasta aplicar. Guion, planificación y personajes permanecen vinculados al mismo plano.

**Montaje** conserva secuencia, visor e inspector simultáneos en escritorio y la línea de tiempo debajo. Pistas, mezcla, subtítulos y marcadores mantienen sus herramientas. Acabado de la película, recorte de fuente, copias de reproducción y contexto narrativo siguen disponibles debajo. «Ocultar inspector» amplía la vista; en móvil empieza oculto y «Mostrar inspector» permite localizarlo.

En pantallas pequeñas, «Cambiar sección» abre el menú agrupado. Las miniaturas se desplazan en su propia fila. Inicio muestra el visor antes del panel extenso; los controles de Dirección aparecen antes de las notas de planificación. Al cambiar de espacio se vuelve al comienzo y se enfoca su título.

## Apariencia y conservación

Cinema usa tinta azul oscura, texto claro y jade contenido. Los temas Grafito, Luz de día y Sistema, los acentos, idiomas y preferencias siguen disponibles. La interfaz usa sans para operar y conserva la marca serif. Los temas no cambian los colores de la fuente.

El rediseño conserva los perfiles del motor, el máximo de 15 segundos por generación, revisión de continuidad y copias de mejora/exportación. No descarga modelos ni genera video automáticamente.

## Referencias y recursos

- [Higgsfield Cinema Studio](https://higgsfield.ai/blog/cinema-studio-4-0-complete-guide): dirección conectada con referencias y escena.
- [Runway Edit Studio](https://runway.com/product/ai-video-editor): revisión visual de la fuente y sus versiones.
- [DaVinci Resolve Edit](https://www.blackmagicdesign.com/products/davinciresolve/edit): material, visor, inspector y edición contextual.

La nueva ilustración está en `public/studio/sala-de-cine-v1.webp`, con procedencia y prompt en su sidecar. El PNG original se conserva localmente en `output/ui-redesign/originals/`. Las maquetas no se usan como controles ni como material del usuario.

## Comprobación

TypeScript y Vite correctos. Se comprobaron navegación, selección de fuente, personaje, formato/FPS, duración/deshacer, reproducción/pausa, pistas, subtítulos, tema claro, inglés y reorganización móvil en un proyecto aislado. Siete archivos de producción y 103 medios de prueba conservaron sus SHA-256; el proyecto QA quedó igual salvo la fecha de guardado.

Revisión independiente **ship**, M1–M3 resueltos. Registros en `output/ui-redesign/`. La regresión de 480 casos tuvo dos tiempos límite de FFmpeg en pasadas completas distintas; ambos casos aprobaron aislados y todos aprobaron en alguna pasada. No se presenta como una ejecución local completa sin incidencias. No se ejecutó el instalador nativo ni se certificaron lector de pantalla, accesibilidad global o calidad de modelos.
