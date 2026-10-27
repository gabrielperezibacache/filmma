# Continuidad por aparición

Filmma distingue la identidad general de un elemento y el estado con el que aparece en un plano. Un personaje puede seguir siendo reconocible aunque se quite el abrigo; un objeto puede conservar su forma y cambiar de posición o estado.

## Estado y herencia

La ficha de un personaje, objeto o lugar puede incluir `continuity` con `costume`, `appearance`, `props` y `notes`. Son sus valores iniciales de vestuario/materiales, aspecto/estado, objetos/accesorios y notas.

Cada plano puede tener `continuity`, un diccionario cuya clave es el identificador del elemento. Un campo omitido hereda el último valor de su aparición anterior en el orden actual del montaje. En su primera aparición utiliza la ficha inicial. Los planos en los que el elemento no está vinculado no alteran la cadena.

Un texto vacío es una decisión explícita: deja de heredar ese campo. El botón «Heredar» elimina la modificación local y recupera el valor anterior. Reordenar los planos recalcula la herencia. `intentionalChange` y `changeReason` pertenecen a una sola aparición y no se propagan a las siguientes.

```json
{
  "characterIds": ["elena"],
  "continuity": {
    "elena": {
      "costume": "Camisa marfil, sin abrigo",
      "props": "",
      "intentionalChange": true,
      "changeReason": "Dejó el abrigo y la lata de película en la cabina."
    }
  }
}
```

El resto del proyecto permanece compatible con versiones anteriores: todos estos campos son opcionales. Las cadenas se conservan al guardar, exportar o recuperar el proyecto. Los datos de elementos no vinculados se conservan y se señalan para que la persona pueda volver a vincularlos o retirar sus notas.

## Revisión

La revisión local compara las fichas, no analiza visualmente los clips. Avisa de cambios de estado sin explicación, referencias visuales ausentes, elementos inexistentes o notas no vinculadas. Un cambio marcado como intencional deja de contarse como una diferencia pendiente. Ninguno de estos recordatorios bloquea una generación; las validaciones técnicas de un modo de referencia siguen comprobando que existan los archivos que necesita ese modo.

## Prompt y modelos

El prompt real incluye el identificador y nombre exactos del elemento, su descripción estable, el estado efectivo del plano y la razón de los cambios intencionales. El estado del plano tiene prioridad sobre detalles circunstanciales de la ficha general. Las referencias de MiniMax mantienen la misma ordenación que el array de imágenes y se identifican como `<Picture 1>`, `<Picture 2>`, etcétera. El contexto de Codex incluye los estados resueltos y los recordatorios locales.

Conservar las fichas y los prompts no garantiza que un modelo reproduzca la identidad con exactitud. Cada toma debe revisarse en el visor. El motor puede rechazar un prompt que supere su capacidad de texto; Filmma no elimina silenciosamente notas de continuidad para hacerlo caber.

## Componente

`ContinuityPanel` recibe `project`, `sceneId`, `onChangeProject(nextProject)` y `onSelectScene?(sceneId)`. Incluye un editor por elemento, comparación con su aparición anterior, herencia por campo, cambio intencional con motivo y revisión del plano o proyecto completo. La edición de la ficha base pertenece a la sección Elementos.

Los helpers puros de `src/continuity.ts` comparten la misma lógica entre interfaz y servidor. Las pruebas verifican herencia, planos intermedios sin aparición, valores vacíos, reordenación, cambios intencionales, avisos, persistencia y el contenido del JSON enviado al proceso de generación, sin ejecutar inferencia.
