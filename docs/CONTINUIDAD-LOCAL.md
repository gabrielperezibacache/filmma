# Comparación visual de continuidad

Filmma compara zonas de dos fotogramas con Apple Vision en el Mac. Ayuda a localizar posibles diferencias de rostro, vestuario y objetos para su revisión antes de exportar. No identifica personas ni certifica que un personaje sea el mismo.

El flujo integrado lee la fuente seleccionada de cada plano, que puede ser el original o una copia mejorada con IA. Prepara fotogramas auxiliares orientados de hasta 1024 píxeles de lado mayor, con el color y aspecto del plano; el motor por separado admite hasta 1536 píxeles en memoria. No escribe sobre los medios, no cambia el montaje y no sustituye las versiones de video. El motor usa CPU en todas las etapas disponibles, por lo que no necesita cargar otro modelo en la GPU mientras se prepara MiniMax.

## Qué compara

- **Rostro:** usa el recorte marcado por el usuario o la única cara que Apple Vision detecte con confianza suficiente. Con varias caras, ninguna cara o varios personajes vinculados, necesita selección manual o un fotograma más claro. Una similitud de la zona no equivale a una identificación.
- **Vestuario:** compara una zona manual. Puede sugerir el torso debajo de una sola cara, siempre que el área no esté muy recortada. Esta sugerencia es geométrica; no segmenta prendas. Conviene marcar la misma prenda en ambos planos cuando cambian la postura o el encuadre.
- **Objetos:** requiere marcar el mismo objeto en las dos imágenes. Compara la apariencia del recorte; no detecta automáticamente qué objeto es ni demuestra su presencia o ausencia.

Una alerta puede deberse a un cambio real, pero también a la luz, el ángulo, una oclusión o una zona mal seleccionada. El análisis cubre los fotogramas y zonas elegidos, no toda la duración de los clips ni los efectos de la composición final.

## Muestreo integrado y decisiones

La [octava entrega](EIGHTH-DELIVERY.md) solicita tres o cinco momentos de cada aparición y construye intervalos entre planos y dentro de cada toma. Cada muestra conserva tiempo y zonas propios. El resumen de cada aspecto mantiene la peor señal observada, sin promediar avisos. Una imagen fija o un final de fuente agotado no aportan evolución adicional por repetir la misma posición de fotograma.

Las huellas del archivo, referencias, guion, escena narrativa, personaje, color, tiempos y zonas permiten reutilizar sólo análisis y decisiones que siguen vigentes. Una aparición afectada necesita revisión nueva; un informe nuevo siempre exige confirmar de nuevo el alcance final. El análisis completo forzado conserva los informes anteriores y calcula uno nuevo sin copiar sus decisiones. No modifica el guion ni los originales.

## Resultados y medidas

Los resultados son `possible-change` (posible diferencia), `no-obvious-change` (sin diferencia marcada en esta muestra) e `insufficient` (evidencia insuficiente o no concluyente). Un fallo del motor, un recorte menor de 40 × 40 píxeles útiles o una zona prácticamente uniforme nunca se convierten en un resultado positivo.

Se usa `VNGenerateImageFeaturePrintRequest`, revisión 2, con `scaleFit`. La distancia entre representaciones visuales y el cambio absoluto medio de color son señales distintas. Los umbrales son heurísticos de Filmma, no porcentajes de identidad, probabilidades ni umbrales clínicamente o biométricamente validados.

| Zona | Sin diferencia marcada: distancia máxima | Posible diferencia: distancia mínima |
| --- | ---: | ---: |
| Rostro | 0,18 | 0,42 |
| Vestuario | 0,20 | 0,45 |
| Objeto | 0,22 | 0,50 |

Una diferencia media de color de al menos 0,18 también genera alerta; para mostrar «sin diferencia marcada» se exige como máximo 0,10. Los valores intermedios se mantienen como no concluyentes. El color usa medias RGB sRGB normalizadas, no una métrica perceptual Delta E.

## Contrato del proceso local

```sh
python3 runtime/filmma_continuity.py --doctor --json
python3 runtime/filmma_continuity.py --input solicitud.json
```

El lanzador compila el pequeño ejecutable Swift en `runtime/vendor/continuity/`, con caché por SHA-256 de su código y un bloqueo para impedir compilaciones simultáneas. La cancelación alcanza directamente al ejecutable una vez preparado. No descarga pesos.

Solicitud:

```json
{
  "leftPath": "/ruta/fotograma-a.png",
  "rightPath": "/ruta/fotograma-b.png",
  "allowAutomatic": true,
  "categories": ["face", "wardrobe", "object"],
  "regions": {
    "object": {
      "left": {"x": 0.2, "y": 0.3, "width": 0.25, "height": 0.4},
      "right": {"x": 0.4, "y": 0.2, "width": 0.25, "height": 0.4}
    }
  }
}
```

Las coordenadas son proporciones de la imagen **ya orientada**, con origen arriba a la izquierda. Nunca se calculan sobre las bandas de un visor. Las cajas de Vision se convierten desde su origen inferior izquierdo. Un recorte inválido devuelve evidencia insuficiente en esa categoría y no activa un recorte automático alternativo. Si se marca una zona manual, también hay que marcar la zona correspondiente del otro plano; no se mezcla una selección manual con otra automática.

La salida JSON incluye `version`, `engine`, `featureRevision`, `faces`, `imageSizes`, `checks`, `elapsedMs` y `limitations`. Cada comprobación contiene categoría, estado, mensaje, origen del recorte y, cuando hay medición, distancia, cambio de color, umbrales y zonas utilizadas.

## Validación realizada

El 17 de octubre de 2026, en este Mac M4 Max, pasaron **8 pruebas reales con Apple Vision en CPU**: rostro y torso idénticos; múltiples caras y automatismo desactivado; recortes inválidos, diminutos y sin detalle; diferencia entre zonas de objetos; orientación EXIF; cambio de color de vestuario; coordenadas con origen superior izquierdo; y rechazo de una selección manual presente sólo en un lado. El hash de la imagen fuente permaneció igual. La suite tardó 4,90 segundos incluyendo recompilación; esto no mide precisión sobre películas completas.

Una comparación con la caché preparada, dos imágenes de 1536 × 864 y comprobaciones de rostro y torso tardó **279 ms dentro del motor, 0,32 s de proceso**. El máximo RSS del proceso fue **205 242 368 bytes** y la huella máxima declarada por macOS **293 913 632 bytes**. Son medidas de ese caso y proceso, no una promesa de rendimiento ni de consumo total del sistema.

Evidencia: `output/qa/continuity-runtime/face-identical-result.json` y `face-identical-resources.txt`.

## Referencias

- [Apple: generación de representaciones visuales](https://developer.apple.com/documentation/vision/vngenerateimagefeatureprintrequest).
- [Apple: observación y distancia entre representaciones](https://developer.apple.com/documentation/vision/vnfeatureprintobservation).
- [Apple: detección de rectángulos faciales](https://developer.apple.com/documentation/vision/vndetectfacerectanglesrequest).
- [Apple: dispositivos de cómputo de una solicitud Vision](https://developer.apple.com/documentation/vision/vnrequest).
