# Grabaciones propias: qué grabar y cómo

El modelo ya reconoce **121 señas**, casi todas de salud, emergencias y frases frecuentes (lista completa en la pestaña Práctica). Para que la demo cubra "todos los temas" hay que grabar vocabulario general. Con estas palabras + las 121 existentes se pueden formar las oraciones del guion (`guion.md`).

> **Importante:** que la seña sea la correcta en LSM. Confírmenla con un diccionario de LSM confiable o, mejor, con una persona sorda o intérprete. Una seña mal aprendida se entrena mal y los expertos lo notarán.

## Lista de palabras (40)

Escribe la glosa **exactamente así** en el campo "Glosa" de la pantalla Grabar (mayúsculas, `_` en vez de espacios).

| Tema | Glosas |
|---|---|
| Saludos y cortesía | `BUENOS_DIAS` · `ADIOS` · `DE_NADA` · `PERDON` · `BIENVENIDO` |
| Personas | `TU` · `NOSOTROS` · `NOMBRE` · `MAMA` · `PAPA` · `HERMANO` · `FAMILIA` · `MAESTRO` · `ESTUDIANTE` |
| Escuela y lugares | `ESCUELA` · `UNIVERSIDAD` · `CLASE` · `OAXACA` |
| Verbos | `COMER` · `BEBER` · `QUERER` · `SABER` · `APRENDER` · `ESTUDIAR` · `VIVIR` · `VER` · `HACER` |
| Tiempo | `HOY` · `AYER` · `MAÑANA` · `SEMANA` |
| Preguntas | `QUE` · `QUIEN` · `POR_QUE` |
| Estados | `BIEN` · `FELIZ` · `TRISTE` · `CANSADO` · `AGUA` |

### También grabar las palabras del guion que ya existen

Aunque el modelo ya conoce estas 10 señas, aprendió de otras personas y otra cámara. Grabarlas con **la misma laptop, cámara y luz de la demo** adapta el modelo al equipo y es lo que más mejora el acierto en vivo:

`HOLA` · `YO` · `DOLOR` · `CABEZA` · `IR` · `DOCTOR` · `TENER` · `FIEBRE` · `TOS` · `MAÑANA` (esta última es nueva)

**Estas van primero**, antes que las 40 nuevas.

Si no alcanza el tiempo, prioricen en este orden: `BUENOS_DIAS`, `NOMBRE`, `TU`, `ESTUDIANTE`, `UNIVERSIDAD`, `ESTUDIAR`, `QUERER`, `COMER`, `AGUA`, `HOY`, `MAÑANA`, `BIEN`, `MAMA`, `FAMILIA`, `QUE`.

## Protocolo

- **Personas:** mínimo 3 del equipo (más personas = mejor con desconocidos, como los jueces). En "Persona" usen un apodo corto sin `_` (p. ej. `angel`, `ana-l`).
- **Tomas:** 10 por palabra por persona (cada toma dura 3 s; la app hace la cuenta regresiva). La toma 5 y la 10 se usan para medir, no para entrenar.
- **Cada toma:** empezar con las manos abajo en reposo → hacer la seña una vez, natural → volver al reposo. No repetir la seña dos veces en la misma toma.
- **NINGUNA** (muy importante): cada persona graba **6 tomas de 10 s** con el botón "Grabar 10 s de NINGUNA": rascarse, acomodarse el cabello, tomar el mouse, gesticular hablando, cruzar brazos, estar quieto. Esto enseña al modelo a **no** inventar señas cuando no las hay.
- **Condiciones:** luz de frente (no ventana detrás), fondo liso, encuadre de la cintura a arriba de la cabeza, ropa lisa que contraste con la piel. Varíen un poco la distancia y la posición entre tomas.
- **Tiempo aproximado:** ~40 min por persona para las 40 palabras.

## Después de grabar

Avisen al responsable de software. Él corre:

```bash
bash /d/Ingenium/tools/retrain.sh --dry-run    # revisa que llegaron todas las tomas
bash /d/Ingenium/tools/retrain.sh --activate   # reentrena (~30 min) y activa el modelo nuevo
```

El script compara el modelo nuevo contra el anterior y solo lo activa con `--activate`.
