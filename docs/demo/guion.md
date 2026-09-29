# Guion de la demo (4–5 min)

Roles en la demo: **presentador** (habla), **señante** (frente a la cámara, con guantes), **operador** (laptop). Ensayarlo al menos 3 veces completo.

## 0. Apertura (30 s)
Presentador: el problema (comunicación entre personas sordas y oyentes; aprender LSM sin retroalimentación es difícil) y la solución en una frase: *"Una app con cámara y guantes con sensores que corrige tus señas en tiempo real y traduce señas a oraciones completas en español."*

## 1. Guantes y calibración (40 s)
- Operador: pestaña **Calibración** → conectar guante derecho e izquierdo → mano abierta → puño.
- Presentador: cada guante lleva 6 IMU (MPU-6050, flexión por dedo) y sensores Hall (contacto entre dedos); los datos se fusionan con la visión por computadora.
- Si los guantes fallan: seguir sin ellos (la app funciona solo con cámara) y decirlo con naturalidad.

## 2. Práctica con retroalimentación (1 min 20 s)
- Operador: **Práctica** → elegir `DOLOR` (o `HOLA`). Se reproduce la seña de referencia.
- Señante: la hace **mal a propósito** (p. ej. mano en otro lugar) → la app baja el puntaje, marca el dedo/parámetro y da el consejo en español.
- Señante: la hace bien → puntaje alto y "La app reconoció: DOLOR".
- Presentador: evalúa 5 parámetros de la LSM (configuración de la mano, ubicación, orientación, movimiento, contactos) comparando contra referencias de personas señantes.

## 3. Traducción palabra a palabra → oración (1 min)
- Operador: **Traducción**.
- Señante (pausas cortas entre señas, manos al reposo al final): `HOLA` · `YO` · `DOLOR` · `CABEZA` → aparecen las glosas → pausa → *"Hola, yo tengo dolor de cabeza."* (voz).
- Si una glosa sale con "¿revisar?": el operador la corrige con un clic (mostrar esto es un plus: la persona sorda mantiene el control).

## 4. Párrafo (1 min)
Dos o tres oraciones seguidas; la IA mantiene el contexto:
1. `MAÑANA` · `YO` · `IR` · `DOCTOR`
2. `YO` · `TENER` · `FIEBRE` · `TOS`
3. (con grabaciones propias) `YO` · `ESTUDIANTE` · `UNIVERSIDAD` / `HOY` · `YO` · `QUERER` · `AGUA`

## 5. Cierre (30 s)
Cifras honestas: 121 señas del dataset público + vocabulario propio; 90 % de acierto entre las 3 primeras opciones con una persona que el modelo nunca vio; cómo crece (grabar → reentrenar en 30 min). Invitar a los jueces a probarla (celular/VPS si está arriba).

## Si algo falla
| Falla | Qué hacer |
|---|---|
| No reconoce bien | Más luz de frente, alejarse un paso, señas más marcadas y volver al reposo entre señas |
| Sin internet / OpenAI caído | Las oraciones salen con plantillas (más simples); seguir |
| Se reinició el servidor | Recargar la página y volver a calibrar |
| Guante no responde | Desconectar/conectar; si no, seguir solo con cámara |
