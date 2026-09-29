/*
 * ui.ts: funciones puras que usan los hooks y componentes (sin React, sin DOM),
 * para poder probarlas con Vitest en entorno node.
 */

/** Estado semántico de retroalimentación. Nunca se comunica solo con color: siempre ícono + texto. */
export type Tone = "ok" | "warn" | "bad";
export type FingerTone = Tone | "unused";

export const FINGER_NAMES = ["pulgar", "índice", "medio", "anular", "meñique"] as const;

/** Estado de un dedo según el contrato `live`/`evaluation`: −1 sin uso, 0 bien, 1 regular, 2 mal. */
export function fingerTone(v: number | null | undefined): FingerTone {
  if (v === 0) return "ok";
  if (v === 1) return "warn";
  if (v === 2) return "bad";
  return "unused";
}

export const FINGER_TONE_TEXT: Record<FingerTone, string> = {
  ok: "bien",
  warn: "casi",
  bad: "mal",
  unused: "no se usa",
};

/** Etiqueta accesible de un dedo, p. ej. "índice: mal". */
export function fingerLabel(i: number, v: number | null | undefined): string {
  return `${FINGER_NAMES[i] ?? `dedo ${i + 1}`}: ${FINGER_TONE_TEXT[fingerTone(v)]}`;
}

/** Normaliza a exactamente 5 valores (rellena con −1). */
export function fiveFingers(fingers: readonly number[] | null | undefined): number[] {
  return Array.from({ length: 5 }, (_, i) => fingers?.[i] ?? -1);
}

/** Resumen visible de una mano: qué dedos corregir. */
export function fingerSummary(fingers: readonly number[]): string {
  const f = fiveFingers(fingers);
  if (f.every((v) => fingerTone(v) === "unused")) return "Sin datos de los dedos todavía.";
  const off = f
    .map((v, i) => ({ i, t: fingerTone(v) }))
    .filter((x) => x.t === "warn" || x.t === "bad")
    .map((x) => `${FINGER_NAMES[x.i]} (${FINGER_TONE_TEXT[x.t]})`);
  return off.length === 0 ? "Todos los dedos bien." : `Revisa: ${off.join(", ")}.`;
}

/** Nivel de un puntaje 0..100 (umbrales de la pantalla de práctica). */
export function scoreTone(score: number): Tone {
  if (score >= 80) return "ok";
  if (score >= 50) return "warn";
  return "bad";
}

/** Palabra de estado de DESIGN.md: ok = "Bien", warn = "Casi", bad = "Corrige". */
export const TONE_WORD: Record<Tone, string> = { ok: "Bien", warn: "Casi", bad: "Corrige" };

export const SCORE_PARAMS = [
  { key: "configuracion", label: "Configuración" },
  { key: "ubicacion", label: "Ubicación" },
  { key: "movimiento", label: "Movimiento" },
  { key: "orientacion", label: "Orientación" },
] as const;

export function clampScore(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return Math.min(100, Math.max(0, n));
}

// Las glosas se guardan sin acentos (lsm.vocab.canonical); aquí solo se acentúan para mostrarlas.
const ACCENTED: Record<string, string> = Object.fromEntries(
  `DÍA DÍAS MAMÁ PAPÁ BEBÉ CÓMO DÓNDE CUÁNTO QUÉ SÍ ÉL TÚ MÁS ADIÓS PERDÓN AHÍ PRÓXIMO TELÉFONO CORAZÓN
   ESTÓMAGO INFECCIÓN PRESIÓN OPRESIÓN PALPITACIÓN VÓMITO CÁNCER DIFÍCIL POLICÍA EXPLOSIÓN QUÍMICOS OÍDO
   CALIFICACIÓN LECCIÓN LÁPIZ AUTOBÚS CAMIÓN AVIÓN HELICÓPTERO MIÉRCOLES SÁBADO CAFETERÍA MÉXICO MICHOACÁN
   LEÓN QUERÉTARO POTOSÍ YUCATÁN MECÁNICO PANTALÓN`
    .split(/\s+/)
    .map((w) => [w.normalize("NFD").replace(/\p{M}/gu, ""), w]),
);

/** Glosa legible y acentuada: "BUENOS_DIAS" → "BUENOS DÍAS", "MAMA" → "MAMÁ". */
export function glossLabel(gloss: string): string {
  return gloss
    .split("_")
    .map((w) => ACCENTED[w] ?? w)
    .join(" ");
}

export function percent(p: number): string {
  return `${Math.round(Math.min(1, Math.max(0, p)) * 100)} %`;
}

/** Quita acentos y pasa a minúsculas para buscar sin importar tildes. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

export interface VocabItem {
  gloss: string;
  category: string;
  has_reference: boolean;
}

export const NO_CATEGORY = "Otras";

/** Categoría legible: "salud_y_frecuentes" → "Salud y frecuentes". */
export function categoryLabel(category: string): string {
  const t = category.replace(/_/g, " ").trim();
  return t ? t[0].toLocaleUpperCase("es") + t.slice(1) : NO_CATEGORY;
}

/** Filtra por glosa o categoría y agrupa por categoría (orden alfabético, "Otras" al final). */
export function groupVocab(vocab: readonly VocabItem[], query: string): { category: string; items: VocabItem[] }[] {
  const q = fold(query);
  const groups = new Map<string, VocabItem[]>();
  for (const v of vocab) {
    const cat = categoryLabel(v.category);
    if (q && !fold(glossLabel(v.gloss)).includes(q) && !fold(cat).includes(q)) continue;
    const list = groups.get(cat) ?? [];
    list.push(v);
    groups.set(cat, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === NO_CATEGORY ? 1 : b === NO_CATEGORY ? -1 : a.localeCompare(b, "es")))
    .map(([category, items]) => ({ category, items: [...items].sort((a, b) => a.gloss.localeCompare(b.gloss, "es")) }));
}

/** URL del WebSocket de sesión a partir de la ubicación de la página. */
export function wsUrl(loc: { protocol: string; host: string }): string {
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/ws`;
}

export const GLOVE_STALE_MS = 500;

export interface GloveState {
  connected: boolean;
  stale: boolean;
}

/** Un guante conectado está "sin datos" si no llegó una línea nueva en 500 ms (tiempos de performance.now()). */
export function gloveState(connected: boolean, lastSeenMs: number, nowMs: number): GloveState {
  return { connected, stale: connected && nowMs - lastSeenMs > GLOVE_STALE_MS };
}

export function sameGloveState(a: GloveState, b: GloveState): boolean {
  return a.connected === b.connected && a.stale === b.stale;
}

/** Línea que se envía al servidor: null si el guante está sin datos (el servidor lo toma como ausente). */
export function selectLatest(line: string | null, lastSeenMs: number, nowMs: number): string | null {
  return line !== null && !gloveState(true, lastSeenMs, nowMs).stale ? line : null;
}

const SIDE_NAME = { L: "izquierdo", R: "derecho" } as const;

/** Segundo guante que se identifica con un lado ya conectado: se rechaza (no se reemplaza en silencio). */
export function duplicateGloveMessage(side: "L" | "R"): string {
  return `Ya hay un guante ${SIDE_NAME[side]} conectado. Revisa que el otro guante esté configurado como ${SIDE_NAME[side === "L" ? "R" : "L"]}, o desconecta el primero antes.`;
}

/** Guante que se desenchufó o dejó de responder mientras estaba conectado. */
export function gloveLostMessage(side: "L" | "R"): string {
  return `El guante ${SIDE_NAME[side]} se desconectó. Revisa el cable y vuelve a conectarlo.`;
}

/**
 * Mensaje para un fallo al conectar un guante, sin depender del texto del error de serial.ts.
 * null = no es un error para la persona usuaria (cerró el selector de puertos sin elegir).
 */
export function gloveErrorMessage(err: unknown): string | null {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  switch (name) {
    case "NotFoundError":
    case "AbortError":
      return null;
    case "NotAllowedError":
    case "SecurityError":
      return "El navegador no dio permiso para usar el puerto del guante. Vuelve a intentarlo y elige el puerto.";
    case "NetworkError":
    case "InvalidStateError":
      return "No se pudo abrir el puerto del guante; puede estar en uso por otra pestaña o programa. Ciérralo e inténtalo de nuevo.";
    default:
      return "El guante no respondió. Revisa que esté encendido, desconéctalo, vuelve a conectarlo e inténtalo de nuevo.";
  }
}

/**
 * Referencia con la forma de `useRef` (`{ current }`) que avisa cuando cambia el elemento.
 * React asigna `current` al montar y null al desmontar; así un hook puede seguir al elemento vivo
 * sin cambiar su API pública.
 */
export function trackedRef<T>(onChange: (v: T | null) => void): { current: T | null } {
  let value: T | null = null;
  return {
    get current() {
      return value;
    },
    set current(v: T | null) {
      if (v === value) return;
      value = v;
      onChange(v);
    },
  };
}

/** Índice de la etiqueta que recibe el foco tras quitar `removed`; null = no quedan etiquetas (foco al contenedor). */
export function focusAfterRemove(removed: number, newLength: number): number | null {
  if (newLength <= 0) return null;
  return Math.min(Math.max(0, removed - 1), newLength - 1);
}

/**
 * Texto que se anuncia a lectores de pantalla en la barra de estado. Solo incluye si cada cosa
 * está conectada o no: el parpadeo de "sin datos" de los guantes no cambia el anuncio.
 */
export function statusAnnouncement(s: {
  camera: "ready" | "loading" | "error" | "off";
  gloves: { L: GloveState; R: GloveState };
  connected: boolean;
}): string {
  const cam = s.camera === "off" ? "Cámara apagada" : s.camera === "ready" ? "Cámara lista" : s.camera === "error" ? "Cámara sin acceso" : "Abriendo la cámara";
  const g = (x: GloveState) => (x.connected ? "conectado" : "sin conectar");
  return `${cam}. Guante izquierdo ${g(s.gloves.L)}. Guante derecho ${g(s.gloves.R)}. Servidor ${s.connected ? "conectado" : "sin conexión"}.`; // mismo orden que la pantalla (espejo)
}

/** Mensaje en español para un fallo de getUserMedia. */
export function cameraErrorMessage(err: unknown): string {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "No diste permiso para usar la cámara. Actívalo en el ícono de la barra de direcciones y recarga la página.";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "No se encontró una cámara. Conecta una cámara y recarga la página.";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "La cámara está en uso por otra aplicación. Ciérrala y recarga la página.";
    default:
      return "No se pudo abrir la cámara. Recarga la página e inténtalo de nuevo.";
  }
}

/** Mide cuadros por segundo en ventanas de ~1 s; `tick` devuelve el nuevo valor al cerrar cada ventana. */
export class FpsMeter {
  private frames = 0;
  private start: number | null = null;
  constructor(private readonly windowMs = 1000) {}

  tick(now: number): number | null {
    if (this.start === null) {
      this.start = now;
      return null;
    }
    this.frames++;
    const dt = now - this.start;
    if (dt < this.windowMs) return null;
    const fps = (this.frames * 1000) / dt;
    this.frames = 0;
    this.start = now;
    return Math.round(fps);
  }
}

/** Marca de tiempo estrictamente creciente para MediaPipe en modo VIDEO. */
export function monotonic(prev: number, now: number): number {
  return now > prev ? now : prev + 1;
}

type Pt = [number, number, number] | number[] | null;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Caja que contiene todos los puntos presentes de `example_hands` (T×2×21×3, unidades de cabeza,
 * origen en el centro de la cabeza) más una cabeza de referencia en el origen.
 */
export function referenceBounds(
  hands: (Pt[] | null)[][],
  present: (boolean | null)[][] | null | undefined,
  head = { rx: 0.5, ry: 0.65 },
): Bounds {
  const b: Bounds = { minX: -head.rx, minY: -head.ry, maxX: head.rx, maxY: head.ry };
  hands.forEach((frame, t) =>
    frame.forEach((hand, s) => {
      if (!hand || present?.[t]?.[s] === false) return;
      for (const p of hand) {
        if (!p || p[0] == null || p[1] == null || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
        b.minX = Math.min(b.minX, p[0]);
        b.maxX = Math.max(b.maxX, p[0]);
        b.minY = Math.min(b.minY, p[1]);
        b.maxY = Math.max(b.maxY, p[1]);
      }
    }),
  );
  return b;
}

/** Transformación que ajusta `b` dentro de un lienzo w×h con margen, conservando proporción. */
export function fitBounds(b: Bounds, w: number, h: number, pad = 0.08) {
  const bw = Math.max(b.maxX - b.minX, 1e-6);
  const bh = Math.max(b.maxY - b.minY, 1e-6);
  const scale = Math.min((w * (1 - 2 * pad)) / bw, (h * (1 - 2 * pad)) / bh);
  const ox = (w - bw * scale) / 2 - b.minX * scale;
  const oy = (h - bh * scale) / 2 - b.minY * scale;
  return { scale, ox, oy };
}

/** Duración de cada cuadro de referencia (16 cuadros ≈ 1.6 s a 1×). */
export const REFERENCE_FRAME_MS = 100;
/** Pausa al final de cada repetición para separar las vueltas del bucle. */
export const REFERENCE_HOLD_MS = 500;

/**
 * Posición en la animación de referencia: índice de cuadro fraccional (para interpolar)
 * a partir del tiempo transcurrido y la velocidad.
 */
export function referencePosition(elapsedMs: number, frames: number, speed: number): number {
  if (frames <= 1) return 0;
  const frameMs = REFERENCE_FRAME_MS / speed;
  const run = (frames - 1) * frameMs;
  const cycle = run + REFERENCE_HOLD_MS;
  const t = ((elapsedMs % cycle) + cycle) % cycle;
  return t >= run ? frames - 1 : t / frameMs;
}

/** Conexiones de la mano de MediaPipe (21 puntos). */
export const HAND_CONNECTIONS: readonly [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
