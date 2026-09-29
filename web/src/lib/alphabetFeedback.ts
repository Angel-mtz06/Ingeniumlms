import { alphabetFeatures, LETTER_RADIUS, LETTERS_ORDER, type AlphabetPrediction } from "./alphabet";
import { EXTENDED_DEG, FEATURES, FINGER_NAMES, handShape, LETTER_STATS, type FeatureDef, type FeatureKind, type HandShape } from "./handShape";

/**
 * Retroalimentación correctiva del alfabeto, separada de la UI:
 *   captura (captureFeedback / CaptureMonitor) → medidas (handShape) → errores (analyzePose)
 *   → mensaje (describeIssue / poseFeedback).
 * Cada mensaje específico sale de comparar una medida del usuario contra el rango real de las
 * muestras de la letra objetivo (LETTER_STATS). Si nada queda fuera de rango, no se inventa:
 * se devuelve el mensaje general.
 */

export type FeedbackType = "capture" | "orientation" | "finger" | "thumb" | "spread" | "unknown" | "ok";
export interface Feedback {
  correct: boolean;
  type: FeedbackType;
  /** Código estable: no_hand, two_hands, out_of_frame, too_small, unstable, should_extend, should_flex, ... */
  issue: string;
  message: string;
  /** Dedos implicados, en español (índice, medio…). */
  fingers?: string[];
}

export interface PoseIssue {
  def: FeatureDef;
  value: number;
  expected: number;
  /** "increase": el usuario debe aumentar esta medida; "decrease": disminuirla. */
  direction: "increase" | "decrease";
  severity: number;
  big: boolean;
}

const KIND_ORDER: FeatureKind[] = ["orientation", "finger", "thumb", "spread"];

export const GENERIC_MESSAGE = "No se reconoció correctamente. Ajusta la posición e intenta nuevamente.";

/** Measurements outside the letter's range, most important first (orientation → fingers → thumb → spread). */
export function analyzeShape(shape: HandShape, target: string, ignore: FeatureKind[] = []): PoseIssue[] {
  const stats = LETTER_STATS[target];
  if (!stats) return [];
  const issues: PoseIssue[] = [];
  for (const def of FEATURES) {
    const st = stats[def.key];
    if (ignore.includes(def.kind)) continue;
    if (!st) continue;
    // Separación solo entre dedos que el usuario también tiene extendidos: si un dedo está
    // doblado, ese error de dedo va primero y el ángulo entre ellos no significa nada.
    if (def.pair && !def.pair.every((f) => shape[`flex${f}`] < EXTENDED_DEG + 15)) continue;
    const x = shape[def.key], lo = st.lo - def.unit, hi = st.hi + def.unit;
    if (Math.abs(x - st.median) < def.minDiff) continue;
    if (x < lo) issues.push({ def, value: x, expected: st.median, direction: "increase", severity: (lo - x) / def.unit, big: st.median - x >= def.bigDiff });
    else if (x > hi) issues.push({ def, value: x, expected: st.median, direction: "decrease", severity: (x - hi) / def.unit, big: x - st.median >= def.bigDiff });
  }
  return issues.sort((a, b) => KIND_ORDER.indexOf(a.def.kind) - KIND_ORDER.indexOf(b.def.kind) || b.severity - a.severity);
}

export function analyzePose(hand: number[][], target: string, ignore: FeatureKind[] = []): PoseIssue[] {
  const shape = handShape(hand);
  return shape ? analyzeShape(shape, target, ignore) : [];
}

const list = (names: string[]) => names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`;

/** Turns the first issue (grouping fingers with the same correction) into one instruction. */
export function describeIssue(issues: PoseIssue[]): Feedback | null {
  const top = issues[0];
  if (!top) return null;
  const { def, direction, big } = top;
  if (def.kind === "finger") {
    const group = issues.filter((i) => i.def.kind === "finger" && i.direction === direction && (i.big || i === top))
      .sort((a, b) => a.def.finger! - b.def.finger!);
    const names = group.map((i) => FINGER_NAMES[i.def.finger!]);
    const extend = direction === "decrease"; // menos flexión = extender
    const message = names.length > 1
      ? `${extend ? "Extiende" : "Dobla"} los dedos ${list(names)}.`
      : extend ? (big ? `Extiende el dedo ${names[0]}.` : `Estira un poco más el dedo ${names[0]}.`)
        : (big ? `Dobla el dedo ${names[0]}.` : `Dobla un poco más el dedo ${names[0]}.`);
    return { correct: false, type: "finger", issue: extend ? "should_extend" : "should_flex", fingers: names, message };
  }
  if (def.kind === "thumb") {
    const thumb = (issue: string, message: string): Feedback => ({ correct: false, type: "thumb", issue, fingers: ["pulgar"], message });
    if (def.key === "flex0") return direction === "decrease"
      ? thumb("thumb_should_extend", big ? "Extiende el pulgar." : "Estira un poco más el pulgar.")
      : thumb("thumb_should_flex", big ? "Dobla el pulgar hacia la palma." : "Dobla un poco más el pulgar.");
    if (def.key === "thumbAcross") return direction === "increase"
      ? thumb("thumb_toward_palm", big ? "Cruza el pulgar por delante de la palma." : "Acomoda el pulgar más cerca del centro de la palma.")
      : thumb("thumb_toward_index", big ? "Saca el pulgar hacia el lado del índice." : "Lleva el pulgar un poco más hacia el lado del índice.");
    return direction === "increase"
      ? thumb("thumb_apart_index", "Separa el pulgar del índice.")
      : thumb("thumb_touch_index", top.expected < 0.5 ? "Junta la punta del pulgar con la punta del índice." : "Acerca el pulgar al índice.");
  }
  if (def.key === "fingerOrder") {
    const f = ["índice", "medio"];
    if (direction === "decrease") return top.expected < 0.05
      ? { correct: false, type: "spread", issue: "should_cross", fingers: f, message: "Cruza el índice y el medio." }
      : { correct: false, type: "spread", issue: "should_join", fingers: f, message: "Junta más las puntas del índice y el medio." };
    if (top.value < 0) return { correct: false, type: "spread", issue: "should_uncross", fingers: f, message: "No cruces los dedos: pon el índice y el medio uno al lado del otro." };
    return { correct: false, type: "spread", issue: "should_separate", fingers: f, message: big ? "Separa las puntas del índice y el medio." : "Separa un poco las puntas del índice y el medio." };
  }
  if (def.kind === "spread") {
    const [a, b] = def.pair!.map((f) => FINGER_NAMES[f]);
    return direction === "increase"
      ? { correct: false, type: "spread", issue: "should_separate", fingers: [a, b], message: big ? `Separa el ${a} y el ${b}.` : `Separa un poco más el ${a} y el ${b}.` }
      : { correct: false, type: "spread", issue: "should_join", fingers: [a, b], message: `Junta más el ${a} y el ${b}.` };
  }
  if (def.key === "facing") return direction === "increase"
    ? { correct: false, type: "orientation", issue: "face_camera", message: "Gira la mano para que quede de frente a la cámara, como en la referencia." }
    : { correct: false, type: "orientation", issue: "turn_sideways", message: "Gira la mano de lado, como en la referencia." };
  // tilt: 0° = dedos hacia arriba, 180° = hacia abajo.
  const e = top.expected;
  if (e < 45) return { correct: false, type: "orientation", issue: "tilt_up", message: big ? "Endereza la mano: los dedos deben apuntar hacia arriba." : "Endereza un poco la mano." };
  if (e > 135) return { correct: false, type: "orientation", issue: "tilt_down", message: big ? "Apunta los dedos hacia abajo." : "Inclina un poco más los dedos hacia abajo." };
  return direction === "increase"
    ? { correct: false, type: "orientation", issue: "tilt_side", message: "Inclina la mano hacia un costado, como en la referencia." }
    : { correct: false, type: "orientation", issue: "tilt_raise", message: "Levanta un poco los dedos, como en la referencia." };
}

export const CORRECT: Feedback = { correct: true, type: "ok", issue: "ok", message: "¡Correcto!" };

/**
 * Pose feedback for a known target. `recognized` = the classifier already sees the target.
 * Correct requires both: recognized AND no large measurement error.
 */
/** Con la letra ya reconocida, solo un error grande y muy fuera de rango impide aprobarla
 * (en las propias muestras de cada letra esto ocurre en ~3%, casi siempre muestras atípicas). */
export const BLOCK_SEVERITY = 2;

export function poseFeedback(hand: number[][], target: string, recognized: boolean, ignore: FeatureKind[] = []): Feedback {
  const issues = analyzePose(hand, target, ignore);
  if (recognized) return describeIssue(issues.filter((i) => i.big && i.severity >= BLOCK_SEVERITY)) ?? CORRECT;
  return describeIssue(issues) ?? { correct: false, type: "unknown", issue: "not_recognized", message: GENERIC_MESSAGE };
}

/**
 * Estado por dedo para el diagrama de la mano (contrato de HandDiagram: −1 sin datos, 0 bien,
 * 1 regular, 2 mal), derivado de las MISMAS medidas que los mensajes. La orientación no marca dedos.
 */
export function fingerStates(hand: number[][] | null, target: string, ignore: FeatureKind[] = []): number[] {
  if (!hand || !handShape(hand)) return [];
  const out = [0, 0, 0, 0, 0];
  const mark = (f: number, v: number) => { out[f] = Math.max(out[f], v); };
  const issues = analyzePose(hand, target, ignore);
  const indexWrong = issues.some((i) => i.def.kind === "finger" && i.def.finger === 1);
  for (const i of issues) {
    const v = i.big ? 2 : 1;
    // Pulgar–índice es una relación: si el índice ya está mal, la distancia cambia por él, no por el pulgar.
    if (i.def.key === "thumbIndex") { if (!indexWrong) mark(0, 1); }
    else if (i.def.kind === "finger" || i.def.kind === "thumb") mark(i.def.finger!, v);
    else if (i.def.pair) i.def.pair.forEach((f) => mark(f, 1));
  }
  return out;
}

// ─── Verificación contra la letra objetivo ─────────────────────────────────

/**
 * Con letra objetivo conocida no hace falta que el clasificador "gane" contra todas las letras:
 * basta con que la mano sea compatible con la objetivo. Parámetros elegidos con las filas de
 * VALIDACIÓN de letters.npz (180–240) y medidos en las de PRUEBA (240–300), que el clasificador
 * nunca vio (ver docs/alphabet-practice.md).
 *  - kNN: la muestra más cercana de la objetivo está dentro de 3× su radio, a no más del doble de la
 *    mejor otra letra, y la objetivo tiene ≥ 50 % de los votos.
 *  - Geometría: la objetivo está entre las 2 más votadas, dentro de 4× su radio, NINGUNA medida
 *    (dedos, pulgar, separación, orden de dedos, orientación) queda fuera del rango de la letra y
 *    la letra rival más votada sí queda descartada por al menos una medida.
 */
export const VERIFY = { radius: 3, ratio: 2, share: 0.5, geoRadius: 4 };
const POOLED: Record<string, string> = { I: "J", N: "Ñ", D: "Z" };

export function targetMatches(prediction: AlphabetPrediction, hand: number[][], target: string): boolean {
  if (prediction.static?.[0] === target) return true;
  const ti = LETTERS_ORDER.indexOf(target);
  const dT = prediction.letterDistance[ti];
  if (ti < 0 || !Number.isFinite(dT)) return false;
  const other = Math.min(...prediction.letterDistance.filter((_, i) => i !== ti && LETTERS_ORDER[i] !== POOLED[target]));
  const radius = LETTER_RADIUS[ti];
  if (dT <= radius * VERIFY.radius && dT <= other * VERIFY.ratio && prediction.shares[ti] >= VERIFY.share) return true;
  const top2 = prediction.ranking.slice(0, 2).some(([l]) => l === target);
  if (!top2 || dT > radius * VERIFY.geoRadius || analyzePose(hand, target).length) return false;
  // La letra que el clasificador prefiere debe quedar DESCARTADA por alguna medida; si la mano
  // también encaja en ella (p. ej. U vs R), no se aprueba la objetivo.
  const rival = prediction.ranking.find(([l]) => l !== target && l !== POOLED[target]);
  return !rival || analyzePose(hand, rival[0]).length > 0;
}

// ─── Calidad de captura ─────────────────────────────────────────────────────

/** Palma (muñeca–MCP9) menor a esto en píxeles: la mano está demasiado lejos para medir dedos. */
export const MIN_PALM_PX = 22;
/** Ventana y límites de estabilidad: cambio NETO en 300 ms (el temblor de MediaPipe no se acumula). */
export const STABLE_WINDOW_MS = 300, MAX_SHAPE_CHANGE = 0.15, MAX_WRIST_MOVE = 0.5;

export function outOfFrame(hand: number[][], w: number, h: number): { out: boolean; top: boolean; bottom: boolean; sides: boolean } {
  let top = false, bottom = false, sides = false;
  for (const [x, y] of hand) { if (y < 0) top = true; if (y > h) bottom = true; if (x < 0 || x > w) sides = true; }
  return { out: top || bottom || sides, top, bottom, sides };
}

const capture = (issue: string, message: string): Feedback => ({ correct: false, type: "capture", issue, message });

/** Checks 1–2 of the priority list on one frame (presence, visibility, size). */
export function captureFeedback(hands: number[][][], w: number, h: number): Feedback | null {
  if (hands.length === 0) return capture("no_hand", "Coloca tu mano frente a la cámara.");
  if (hands.length > 1) return capture("two_hands", "Usa una sola mano.");
  const hand = hands[0];
  if (!alphabetFeatures(hand)) return capture("no_hand", "Coloca tu mano frente a la cámara.");
  const o = outOfFrame(hand, w, h);
  if (o.out) {
    const where = o.sides ? " Centra la mano." : o.top && !o.bottom ? " Baja un poco la mano." : o.bottom && !o.top ? " Sube un poco la mano." : " Aléjala un poco de la cámara.";
    return capture("out_of_frame", `Mantén toda la mano dentro del cuadro.${where}`);
  }
  if (Math.hypot(hand[9][0] - hand[0][0], hand[9][1] - hand[0][1]) < MIN_PALM_PX) return capture("too_small", "Acerca un poco la mano a la cámara.");
  return null;
}

/** Check 3: landmarks stable. Compares the newest frame with the one ~300 ms earlier. */
export class CaptureMonitor {
  private history: { t: number; shape: number[]; wrist: number[]; scale: number }[] = [];
  reset() { this.history = []; }
  /** Returns capture feedback (including instability) or null when the frame can be analyzed. */
  push(t: number, hands: number[][][], w: number, h: number): Feedback | null {
    const basic = captureFeedback(hands, w, h);
    if (basic) { this.reset(); return basic; }
    const hand = hands[0], f = alphabetFeatures(hand)!;
    if (this.history.length && t <= this.history.at(-1)!.t) this.reset();
    const scale = Math.hypot(...hand[9].map((v, i) => v - hand[0][i]));
    this.history.push({ t, shape: f.slice(0, 63), wrist: hand[0], scale });
    this.history = this.history.filter((x) => t - x.t <= STABLE_WINDOW_MS + 100);
    const old = this.history.find((x) => t - x.t >= STABLE_WINDOW_MS * 0.8);
    if (!old) return null;
    const now = this.history.at(-1)!;
    let change = 0;
    for (let i = 0; i < 21; i++) change += Math.hypot(...[0, 1, 2].map((a) => now.shape[i * 3 + a] - old.shape[i * 3 + a]));
    const wrist = Math.hypot(now.wrist[0] - old.wrist[0], now.wrist[1] - old.wrist[1]) / now.scale;
    return change / 21 > MAX_SHAPE_CHANGE || wrist > MAX_WRIST_MOVE ? capture("unstable", "Mantén la mano estable un momento.") : null;
  }
}

/**
 * Avoids flicker: a new message replaces the shown one only after it is the majority of the
 * last 400 ms. "correct" and capture problems are not delayed more than that window.
 */
export class FeedbackStabilizer {
  private history: { t: number; fb: Feedback }[] = [];
  private shown: Feedback | null = null;
  reset() { this.history = []; this.shown = null; }
  push(t: number, fb: Feedback): Feedback {
    if (this.history.length && t <= this.history.at(-1)!.t) this.reset();
    this.history.push({ t, fb });
    this.history = this.history.filter((x) => t - x.t <= 400);
    const key = (f: Feedback) => `${f.issue}|${f.message}`;
    const counts = new Map<string, number>();
    for (const x of this.history) counts.set(key(x.fb), (counts.get(key(x.fb)) ?? 0) + 1);
    const [bestKey, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
    const span = t - this.history[0].t;
    if (!this.shown || key(this.shown) === key(fb)) this.shown = fb;
    else if (key(this.shown) !== bestKey && n / this.history.length >= 0.6 && span >= 200) {
      for (const x of this.history) if (key(x.fb) === bestKey) this.shown = x.fb;
    }
    return this.shown;
  }
}
