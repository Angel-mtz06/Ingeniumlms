# DESIGN.md: LSM, aprende y traduce

Dirección visual de la app web para aprender y traducir Lengua de Señas Mexicana (LSM).
La usan personas sordas y oyentes; se presenta ante un jurado técnico y expertos en LSM.
Debe verse **confiable, clara y humana**, no "tech gamer".

Fuente única de valores: `src/styles/tokens.css`. Este documento explica de dónde salen y cómo se usan.
Ningún archivo fuera de `tokens.css` puede contener colores literales
(`grep -rE "#[0-9a-fA-F]{3,6}|rgb\(" src --include=*.tsx --include=*.css | grep -v tokens.css` debe salir vacío).

## 1. Sistemas de referencia (biblioteca awesome-design)

| Sistema | Qué tomamos | Por qué |
|---|---|---|
| **Wise** | Estructura cálida: lienzo salvia (`canvas-soft #e8ebe6`), tinta casi negra con matiz oliva (`ink #0e0f0c`), texto secundario (`body #454745`), la superficie como elevación (tarjeta clara sobre lienzo salvia), radios generosos (8 / 12 / 24 px), base de espaciado 4 px, familia semántica completa. | Es la referencia más "humana" entre las marcas de confianza: calma escandinava, nada de estética gamer. El lienzo salvia descansa la vista en sesiones largas frente a la cámara. |
| **IBM Carbon** | Un solo acento azul (Carbon blue-70 / blue-40), la tríada semántica verde / amarillo / rojo con sus pasos oscuros y claros, anillo de foco sólido del color de acento, escala tipográfica que empieza en cuerpo 18 px (`body-lg`). | Carbon es el sistema de la biblioteca con la disciplina de accesibilidad más documentada (temas claro y Gray-100, contrastes verificados). Un azul "institucional" transmite confianza y no se confunde con los colores de retroalimentación. |
| **Airbnb** | Un único nivel de sombra suave (más uno para superposiciones), pesos de display moderados, objetivos táctiles de 48 px, sección de 64 px. | Aporta la calidez de producto de consumo y la contención: la cámara y la persona son las protagonistas, no la interfaz. |

Adaptaciones (no clonamos): el lienzo de Wise se aclaró un paso (`#eef1eb`) para que el cuadro de video destaque;
el verde lima de Wise **no** se usa (Wise mismo prohíbe reutilizar el color de marca como "éxito", y aquí el verde es retroalimentación);
las esquinas cuadradas de Carbon se sustituyen por los radios de Wise; las fuentes propietarias se sustituyen por fuentes del sistema.

## 2. Paleta

### Tema claro (por defecto)

| Token | Valor | Origen |
|---|---|---|
| `--color-bg` | `#eef1eb` | Wise canvas-soft, aclarado |
| `--color-surface` | `#fbfcfa` | tarjeta casi blanca (sin `#fff` puro) |
| `--color-surface-2` | `#e1e6dd` | salvia más profundo: pista de pestañas, zonas hundidas, fondo del video |
| `--color-text` | `#0e0f0c` | Wise ink |
| `--color-text-muted` | `#454745` | Wise body |
| `--color-accent` | `#0043ce` | Carbon blue-70 |
| `--color-accent-contrast` | `#fbfcfa` | texto/ícono sobre cualquier relleno saturado |
| `--color-ok` | `#0e6027` | Carbon green-70 |
| `--color-warn` | `#7a5b00` | entre Carbon yellow-60 y yellow-70 |
| `--color-bad` | `#a2191f` | Carbon red-70 |
| `--color-border` | `#7a8076` | gris salvia con ≥ 3:1 para bordes de controles |

### Tema oscuro (`prefers-color-scheme: dark`)

| Token | Valor | Origen |
|---|---|---|
| `--color-bg` | `#0f110e` | Wise ink |
| `--color-surface` | `#191c17` | |
| `--color-surface-2` | `#242821` | |
| `--color-text` | `#eef1ea` | |
| `--color-text-muted` | `#b3b9ae` | |
| `--color-accent` | `#78a9ff` | Carbon blue-40 |
| `--color-accent-contrast` | `#0f110e` | |
| `--color-ok` | `#42be65` | Carbon green-40 |
| `--color-warn` | `#f1c21b` | Carbon yellow-30 |
| `--color-bad` | `#ff8389` | Carbon red-40 |
| `--color-border` | `#767d71` | |

### Contraste verificado (WCAG 2.2, calculado con la fórmula de luminancia relativa)

Tema claro:

| Primer plano | sobre bg | sobre surface | sobre surface-2 |
|---|---|---|---|
| text | 16.86 | 18.68 | 15.16 |
| text-muted | 8.22 | 9.11 | 7.39 |
| accent | 6.84 | 7.57 | 6.15 |
| ok | 6.77 | 7.50 | 6.09 |
| warn | 5.54 | 6.14 | 4.98 |
| bad | 6.83 | 7.57 | 6.15 |
| border (no texto, requiere 3:1) | 3.56 | 3.94 | 3.20 |

`accent-contrast` sobre accent 7.57 · sobre ok 7.50 · sobre warn 6.14 · sobre bad 7.57.

Tema oscuro:

| Primer plano | sobre bg | sobre surface | sobre surface-2 |
|---|---|---|---|
| text | 16.63 | 15.09 | 13.14 |
| text-muted | 9.46 | 8.58 | 7.47 |
| accent | 8.06 | 7.31 | 6.37 |
| ok | 7.94 | 7.20 | 6.27 |
| warn | 11.27 | 10.23 | 8.91 |
| bad | 8.00 | 7.26 | 6.33 |
| border (no texto, requiere 3:1) | 4.47 | 4.05 | 3.53 |

`accent-contrast` sobre accent 8.06 · sobre ok 7.94 · sobre warn 11.27 · sobre bad 8.00.

Todo texto cumple AA (4.5:1) en cualquier superficie y ambos temas; el texto principal y el secundario cumplen AAA (7:1).
El anillo de foco (`--color-accent`) supera 3:1 contra todas las superficies.

### Reglas de color

1. **Un solo acento.** `--color-accent` es para la acción principal de cada pantalla, enlaces y el foco. No se usa como fondo decorativo.
2. **La retroalimentación nunca es solo color.** `ok / warn / bad` siempre van con ícono con forma distinta **y** texto:
   ok = palomita en círculo + "Bien"; warn = triángulo + "Casi"; bad = X en octágono + "Corrige".
   En claro, verde y rojo tienen luminancia parecida: para daltonismo, la forma y el texto son lo que distingue.
3. **Sobre cualquier relleno saturado** (accent, ok, warn, bad) el texto y los íconos usan `--color-accent-contrast`.
   La paleta está calculada para que esa combinación pase AA en ambos temas.
4. **Estados suaves** (fondo tenue de una tarjeta de retroalimentación): `color-mix(in srgb, var(--color-ok) 14%, var(--color-surface))`
   con texto `--color-text` y borde/ícono en `--color-ok`. No crear tokens nuevos para esto.
5. `--color-border` es para bordes de controles y divisores que deben verse. Las tarjetas **no** llevan borde:
   la diferencia `surface` sobre `bg` es la elevación (regla de Wise).

## 3. Tipografía

Fuentes del sistema (la demo no depende de internet; Segoe UI Variable en Windows, San Francisco en macOS/iOS, Roboto en Android):

- `--font-sans`: `"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Roboto, "Noto Sans", Arial, sans-serif`
- `--font-display`: `"Segoe UI Variable Display", "Segoe UI", system-ui, …` a peso 700 (títulos) y 800 (marca).

Escala en `rem` (respeta el zoom del usuario). El cuerpo es de **18 px**, no 16: texto grande por defecto.

| Token | Tamaño | Uso |
|---|---|---|
| `--text-xs` | 14 px | solo metadatos (FPS, versión de modelo). Nunca instrucciones. |
| `--text-sm` | 16 px | etiquetas, pestañas, leyendas |
| `--text-md` | 18 px | cuerpo por defecto, instrucciones |
| `--text-lg` | 20 px | texto destacado, subtítulos |
| `--text-xl` | 24 px | títulos de tarjeta |
| `--text-2xl` | 32 px | título de pantalla |
| `--text-3xl` | 40 px | la palabra traducida / el resultado principal de práctica |

Interlineado: 1.5 en cuerpo, 1.15 en títulos. Títulos con `letter-spacing: -0.01em` y `text-wrap: balance`. Párrafos a 65ch como máximo.

## 4. Espaciado

Base 4 px (Wise / Carbon): `--space-1` 4 · `--space-2` 8 · `--space-3` 12 · `--space-4` 16 · `--space-5` 24 · `--space-6` 32 · `--space-7` 48 · `--space-8` 64.
Interior de tarjeta: `--space-6` (escritorio) / `--space-5` (móvil). Margen lateral de página: `--space-5` / `--space-4` en móvil.

## 5. Radios

Sistema documentado (una regla, aplicada siempre):

- `--radius-sm` 8 px: chips, insignias de estado.
- `--radius-md` 12 px: botones, pestañas, campos.
- `--radius-lg` 24 px: tarjetas y el marco de la cámara (radio insignia de Wise).

## 6. Sombras

Airbnb: una sombra y nada más, tintada con la tinta (nunca negro puro sobre claro).

- `--shadow-1`: pestaña activa, tarjeta flotante, menú.
- `--shadow-2`: superposiciones (diálogos, avisos sobre el video).

La mayor parte de la interfaz es plana: la elevación la da el cambio de superficie.

## 7. Foco, interacción y movimiento

- `--focus-ring` = `3px solid var(--color-accent)`; se aplica como `outline` con `outline-offset: 2px` en `:focus-visible` (Carbon).
- Objetivos táctiles de **al menos 48 px** de alto (la regla del plan pide 44; usamos 48 como Wise y Airbnb).
- Estado activo o seleccionado: siempre con una señal que no sea color (peso, relleno de superficie, borde o ícono).
- Movimiento mínimo (transiciones de 150 ms en color y sombra). Con `prefers-reduced-motion: reduce` se quitan las transiciones decorativas;
  las animaciones esenciales (reproductor de la seña de referencia) siguen, sin adornos.
- Los avisos importantes son visuales (usuarios sordos). La voz (`speechSynthesis`, `es-MX`) es un extra para la persona oyente.

## 8. Composición

- Contenedor máximo 1200 px centrado. Encabezado fijo con marca y la barra de pestañas (control segmentado: pista `surface-2`, pestaña activa `surface` + sombra + borde + peso 700).
- En móvil la barra de pestañas se desplaza horizontalmente; el resto se apila en una columna.
- Pantallas con cámara: el video es el elemento más grande, dentro de un marco `--radius-lg` sobre `--color-surface-2`; la retroalimentación va junto al video, en `--text-3xl` con ícono.
- Sin tarjetas dentro de tarjetas, sin gradientes, sin brillos de neón.

## 9. Capa Liquid Glass (`src/styles/glass.css`)

Capa visual estilo Apple que se carga al final (`main.tsx`) y reemplaza lo anterior solo en apariencia (mismas clases y atributos).
Sustituye a propósito dos reglas de arriba: hay orbes de gradiente desenfocados en el fondo (`body::before/::after`) y las tarjetas
son de cristal translúcido (`backdrop-filter: blur(20px) saturate(180%)`, borde de reflejo y sombra difusa).

- Tokens nuevos en `tokens.css`: `--glass-*`, `--orb-1…4`, `--bezel`, `--radius-xl` (28 px) y `--radius-pill`.
- Los rellenos de cristal salen de `--color-surface` (58–80 % de opacidad), así el contraste de texto de la sección 2 se mantiene.
- Botones, pestañas, chips e insignias son cápsulas con `scale(0.95)` al presionar; la cámara lleva un marco de dispositivo.
- Sin soporte de `backdrop-filter`, los rellenos pasan a casi opacos. Con movimiento reducido no hay deriva de orbes ni rebotes.
- Para volver al diseño anterior basta con quitar el import de `glass.css`.
