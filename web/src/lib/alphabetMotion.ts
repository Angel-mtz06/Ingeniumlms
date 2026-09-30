import { alphabetFeatures, CONF_THRESHOLD, type Prediction } from "./alphabet";
import { poseFeedback } from "./alphabetFeedback";

export const PREPARE_MS = 3000;
export const CAPTURE_MS = 2500;
export type MotionFrame = {
  t: number;
  hand: number[][] | null;
  pose: Prediction | null;
  /** Algún landmark quedó fuera de la imagen en este cuadro. */
  out?: boolean;
  /** Pose inicial verificada por quien llama (clasificador + medidas); si falta se usa `pose`. */
  startOk?: boolean;
};
export type MotionIssue =
  | "ok" | "not_recognized" | "capture_short" | "camera_pause" | "hand_lost" | "out_of_frame" | "pose_lost"
  | "no_motion" | "too_small" | "too_fast" | "cut_off" | "reversed" | "incomplete" | "wrong_path";
export type MotionResult = {
  prediction: Prediction | null;
  /** Código de lo que se detectó (para UI y pruebas). */
  issue: MotionIssue;
  /** Mensaje para el usuario (se conserva el nombre `reason` por compatibilidad). */
  reason: string;
  frames: number;
  duration: number;
  travel: number;
  /** Cuadros y milisegundos en los que realmente hubo desplazamiento (5 %–95 % del recorrido). */
  activeFrames: number;
  activeMs: number;
};

/**
 * Mínimo de cuadros con desplazamiento para poder OBSERVAR la trayectoria. No es una velocidad
 * de la LSM (no hay secuencias de referencia de letras en el repositorio): la trayectoria se
 * remuestrea a 32 puntos y se filtra con mediana de 3; con menos de 10 observaciones reales el
 * gancho de la J o los tres trazos de la Z quedan con 1–2 cuadros por tramo, y la forma sería
 * interpolación, no medición.
 */
export const MIN_ACTIVE_FRAMES = 7;
/** Seguimiento en vivo: pose inicial sostenida, inicio, fin por quietud y duración máxima. */
export const READY_HOLD_MS = 500, ONSET_PALMS = .15, STILL_MS = 450, STILL_PALMS = .12, MAX_MOVE_MS = 4000, RESULT_MS = 2500, PREROLL_FRAMES = 4;
/** Tolerancia de forma (RMS tras normalizar). La misma para el avance en vivo y el juicio final:
 * si el medidor llegó a 100 %, el resultado no puede decir lo contrario. */
export const SHAPE_ERROR = .32;

const dist = (a: number[], b: number[]) => Math.hypot(a[0]-b[0], a[1]-b[1]);
const length = (points: number[][]) => points.slice(1).reduce((s,p,i) => s+dist(p,points[i]),0);

/** Resample by travelled distance, so pauses and different signing speeds do not
 * turn one camera frame into extra motion evidence. Keeps temporal point order.
 */
function resample(points: number[][], count = 32): number[][] {
  const cumulative = [0];
  for (let i=1;i<points.length;i++) cumulative.push(cumulative[i-1]+dist(points[i],points[i-1]));
  const total = cumulative.at(-1)!;
  if (total < 1e-6) return Array.from({length:count}, () => [...points[0]]);
  let j=1;
  return Array.from({length:count}, (_,i) => {
    const d = total*i/(count-1);
    while (j < points.length-1 && cumulative[j] < d) j++;
    const r=(d-cumulative[j-1])/(cumulative[j]-cumulative[j-1] || 1);
    return [0,1].map((axis) => points[j-1][axis]*(1-r)+points[j][axis]*r);
  });
}

/** First fraction `f` (by arc length) of a template path. */
function prefix(path: number[][], f: number): number[][] {
  const total = length(path);
  let left = total*f;
  const out = [path[0]];
  for (let i=1;i<path.length;i++) {
    const d = dist(path[i],path[i-1]);
    if (d >= left) { const r = d ? left/d : 0; out.push([0,1].map((a)=>path[i-1][a]+(path[i][a]-path[i-1][a])*r)); break; }
    out.push(path[i]); left -= d;
  }
  return out;
}

// Conservative geometric approximations of the arrows on the existing SEP
// poster, NOT a trained temporal model. J: down and hook; Z: three ordered
// strokes; Ñ/Q: arc; X: out and back. Pose evidence distinguishes Ñ from Q.
// We preserve the original photo/arrows in the UI instead of inventing a video.
const RULES: {letter:string; tip:number; poses:string[]; base:string; path:number[][]}[] = [
  {letter:"J",tip:20,poses:["I","J"],base:"I",path:[[0,0],[0,.8],[-.1,1],[-.35,1.1],[-.55,.95],[-.55,.7]]},
  {letter:"Ñ",tip:8,poses:["N","Ñ"],base:"N",path:[[0,0],[.25,.16],[.5,.22],[.75,.16],[1,0]]},
  {letter:"Q",tip:8,poses:["Q"],base:"Q",path:[[0,0],[.25,.16],[.5,.22],[.75,.16],[1,0]]},
  {letter:"X",tip:8,poses:["X"],base:"X",path:[[0,0],[.7,0],[0,0]]},
  {letter:"Z",tip:8,poses:["D","Z"],base:"D",path:[[0,0],[1,0],[0,.8],[1,.8]]},
];

/** Static letter whose pose starts the movement (J→I, Ñ→N, Z→D; Q and X use their own pose). */
export function motionBaseLetter(letter: string): string | null {
  return RULES.find((r) => r.letter === letter)?.base ?? null;
}
const frameStartOk = (f: MotionFrame, letter: string) => f.startOk ?? startPoseOk(f.pose, letter);

/** True when the classifier's (unaliased) pose is a valid starting pose for `letter`. */
export function startPoseOk(pose: Prediction | null, letter: string): boolean {
  const rule = RULES.find((r) => r.letter === letter);
  return !!rule && !!pose && rule.poses.includes(pose[0]) && pose[1] >= CONF_THRESHOLD;
}

function normalizedPath(frames: MotionFrame[], tip: number): {points: number[][]; t: number[]} {
  const valid = frames.filter((f) => f.hand && alphabetFeatures(f.hand));
  if (!valid.length) return {points: [], t: []};
  const first = valid[0].hand!;
  const scale = Math.hypot(...first[9].map((v,i)=>v-first[0][i]));
  const origin = first[tip];
  // One fixed origin/scale for the whole sequence: subtracting each frame's
  // wrist here would erase the very trajectory we need to measure.
  const points = valid.map((f) => [0,1].map((axis)=>(f.hand![tip][axis]-origin[axis])/scale));
  // Median of three points suppresses landmark jitter without reversing time.
  return {
    points: points.map((p,i) => i===0 || i===points.length-1 ? p : [0,1].map((a)=>[points[i-1][a],p[a],points[i+1][a]].sort((x,y)=>x-y)[1])),
    t: valid.map((f) => f.t),
  };
}

function extent(points: number[][]): number {
  if (!points.length) return 0;
  return Math.max(...[0,1].map((a)=>Math.max(...points.map((p)=>p[a]))-Math.min(...points.map((p)=>p[a]))));
}

/** RMS distance between user path and template after scale normalisation; x may be mirrored (either hand). */
function shapeError(points: number[][], path: number[][]): number {
  const span = extent(points), templateSpan = extent(path);
  if (span < 1e-6 || templateSpan < 1e-6) return Infinity;
  // Both start at their own first point: a reversed template must not carry an offset.
  const shape = resample(points).map((p)=>p.map((v,a)=>(v-points[0][a])/span));
  const template = resample(path).map((p)=>p.map((v,a)=>(v-path[0][a])/templateSpan));
  return Math.min(...[1,-1].map((mirror)=>Math.sqrt(shape.reduce((sum,p,i)=>sum+(p[0]*mirror-template[i][0])**2+(p[1]-template[i][1])**2,0)/shape.length)));
}

/** Frames between 5 % and 95 % of the travelled distance: when the hand was really moving. */
function activeSpan(points: number[][], t: number[]): {frames: number; ms: number} {
  const cum = [0];
  for (let i=1;i<points.length;i++) cum.push(cum[i-1]+dist(points[i],points[i-1]));
  const total = cum.at(-1) ?? 0;
  if (total < 1e-6) return {frames: 0, ms: 0};
  const a = cum.findIndex((c)=>c >= total*.05), b = cum.findIndex((c)=>c >= total*.95);
  return {frames: b-a+1, ms: t[b]-t[a]};
}

/** Rule-specific evidence beyond the overall shape (kept from the original analyzer). */
function ruleGates(letter: string, points: number[][], span: number, travelled: number): boolean {
  if (span < .4 || span > 5 || travelled/span > 6) return false;
  if (letter === "Ñ" || letter === "Q") {
    const a=points[0], b=points.at(-1)!, chord=dist(a,b);
    const bend=Math.max(...points.map((p)=>chord ? Math.abs((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))/chord : 0));
    if (chord < span*.4 || bend/span < .05) return false;
  }
  if (letter === "X" && (dist(points[0],points.at(-1)!) > span*.5 || travelled/span < 1.3)) return false;
  if (letter === "Z" && travelled/span < 1.8) return false;
  return true;
}

const MESSAGES: Record<MotionIssue | "timeout", string> = {
  timeout: `El movimiento duró más de ${MAX_MOVE_MS/1000} segundos. Hazlo de forma continua, sin pausas.`,
  ok: "¡Correcto! Trayectoria y pose compatibles.",
  not_recognized: "No se reconoció correctamente. Intenta nuevamente.",
  capture_short: "La cámara entregó muy pocos cuadros para observar el movimiento. Mejora la luz o cierra otras aplicaciones e inténtalo de nuevo.",
  camera_pause: "La cámara se detuvo un momento durante la captura. Inténtalo de nuevo.",
  hand_lost: "Mantén la mano visible durante todo el movimiento.",
  out_of_frame: "Mantén toda la mano dentro del cuadro durante todo el movimiento.",
  pose_lost: "Mantén la forma de la mano durante todo el movimiento.",
  no_motion: "No se detectó movimiento. Después de la cuenta, realiza el recorrido que indican las flechas.",
  too_small: "Haz el movimiento más amplio, como indican las flechas.",
  too_fast: "El movimiento fue demasiado rápido para observarlo. Hazlo un poco más despacio.",
  cut_off: "Se acabó el tiempo antes de terminar el movimiento. Empieza en cuanto aparezca «Realiza el movimiento» y hazlo de forma continua.",
  reversed: "Hiciste el recorrido en sentido contrario. Empieza desde el otro extremo, como indican las flechas.",
  incomplete: "Completa el movimiento: hiciste solo el principio del recorrido.",
  wrong_path: "Revisa la dirección del movimiento: sigue las flechas de la referencia.",
};

function base(frames: MotionFrame[]): MotionResult {
  const duration = frames.length ? frames.at(-1)!.t-frames[0].t : 0;
  return {prediction:null, issue:"not_recognized", reason:MESSAGES.not_recognized, frames:frames.filter(f=>f.hand).length, duration, travel:0, activeFrames:0, activeMs:0};
}
const withIssue = (r: MotionResult, issue: MotionIssue, reason = MESSAGES[issue]): MotionResult => ({...r, issue, reason});

/** Capture-quality checks, in priority order, before any trajectory is judged. */
/** `live`: segment cut by the tracker (starts at the movement, ends when the hand stops), so its
 * length varies; only the camera rate is checked (< 8 fps cannot follow a letter's trajectory). */
export interface MotionOptions { live?: boolean; timedOut?: boolean }

function sequenceProblem(frames: MotionFrame[], r: MotionResult, o: MotionOptions = {}): MotionResult | null {
  if (o.live ? frames.length < 6 || (frames.length-1)*1000/Math.max(r.duration, 1) < 8 : frames.length < 12 || r.duration < 2200) return withIssue(r, "capture_short");
  if (frames.some((f,i)=>i>0 && (f.t<=frames[i-1].t || f.t-frames[i-1].t>250))) return withIssue(r, "camera_pause");
  if (frames.some((f)=>!f.hand)) return withIssue(r, "hand_lost");
  if (frames.filter((f)=>f.out).length > frames.length*.1) return withIssue(r, "out_of_frame");
  return null;
}

export function significantMotion(frames: MotionFrame[]): boolean {
  if (frames.length < 5 || frames.at(-1)!.t-frames[0].t < 250) return false;
  const wrist = normalizedPath(frames,0).points;
  if (wrist.length && extent(wrist) > .45) return true;
  const lastPose = frames.at(-1)?.pose?.[0];
  // Allow a finger trajectory with a still wrist, but not any A→B pose change.
  return !!lastPose && ["J","Ñ","Q","X","Z"].includes(lastPose)
    && extent(normalizedPath(frames,lastPose === "J" ? 20 : 8).points) > .5;
}

/**
 * Target known (Secuencial / Letra específica): explains WHAT failed, in this order:
 * capture → pose held → displacement present/amplitude → enough observed frames →
 * shape (ok) → cut off by the window → reversed → incomplete (matches a prefix) → wrong path.
 */
export function analyzeMotionFor(frames: MotionFrame[], target: string, options: MotionOptions = {}): MotionResult {
  const rule = RULES.find((r)=>r.letter===target);
  const r = base(frames);
  if (!rule) return r;
  const problem = sequenceProblem(frames, r, options);
  if (problem) return problem;
  const supporting = frames.filter((f)=>frameStartOk(f, target));
  if (supporting.length/frames.length < .45) {
    // Qué dedo se desvió: la corrección más frecuente en los cuadros que perdieron la pose.
    const counts = new Map<string, number>();
    for (const f of frames) if (!frameStartOk(f, target)) {
      // Dedos y pulgar contra la pose inicial; la orientación se ignora porque la mano gira al moverse.
      const fb = poseFeedback(f.hand!, rule.base, false, ["orientation"]);
      if (fb.type !== "unknown") counts.set(fb.message, (counts.get(fb.message) ?? 0)+1);
    }
    const top = [...counts].sort((a,b)=>b[1]-a[1])[0];
    return withIssue(r, "pose_lost", top ? `${MESSAGES.pose_lost} ${top[0]}` : MESSAGES.pose_lost);
  }
  const {points, t} = normalizedPath(frames, rule.tip);
  const span = extent(points), travelled = length(points);
  const active = activeSpan(points, t);
  const out = {...r, travel: travelled, activeFrames: active.frames, activeMs: active.ms};
  if (span < .25) return withIssue(out, "no_motion");
  if (span < .4) return withIssue(out, "too_small");
  if (active.frames < MIN_ACTIVE_FRAMES) return withIssue(out, "too_fast");
  const error = shapeError(points, rule.path);
  if (ruleGates(target, points, span, travelled) && error <= SHAPE_ERROR) {
    const poseScore = supporting.reduce((s,f)=>s+(f.pose?.[1] ?? CONF_THRESHOLD),0)/frames.length;
    const confidence = Math.min(poseScore, 1-error);
    if (confidence >= CONF_THRESHOLD) return {...withIssue(out, "ok"), prediction: [target, confidence]};
    return out;
  }
  // Seguía moviéndose al cerrar la ventana: más del 10 % del recorrido en los últimos 250 ms.
  if (options.live) {
    // En vivo el segmento termina cuando la mano se detiene; solo se corta si pasó el máximo.
    if (options.timedOut) return withIssue(out, "cut_off", MESSAGES.timeout);
  } else {
    const lastT = t.at(-1)!, tailStart = t.findIndex((x)=>x >= lastT-250);
    if (tailStart >= 0 && length(points.slice(Math.max(0, tailStart-1))) > travelled*.1) return withIssue(out, "cut_off");
  }
  if (target !== "X" && shapeError(points, [...rule.path].reverse()) <= SHAPE_ERROR) return withIssue(out, "reversed");
  // ¿Coincide con el PRINCIPIO de la trayectoria? Se elige la fracción que mejor ajusta.
  let best = {f: 0, error: Infinity};
  for (let f=.3; f<=.851; f+=.05) {
    const e = shapeError(points, prefix(rule.path, f));
    if (e < best.error) best = {f, error: e};
  }
  if (best.error <= SHAPE_ERROR) {
    const msg = best.f >= .7 ? "Continúa un poco más el movimiento: te faltó el final del recorrido." : MESSAGES.incomplete;
    return withIssue(out, "incomplete", options.live ? `${msg} Hazlo sin detenerte.` : msg);
  }
  return withIssue(out, "wrong_path");
}

/** Libre: no target. Only capture problems are explained; any candidate needs enough observed frames. */
export function analyzeMotion(frames: MotionFrame[]): MotionResult {
  const result = base(frames);
  const problem = sequenceProblem(frames, result);
  if (problem) return problem;
  const candidates: Prediction[] = [];
  let tooFast = false;
  for (const rule of RULES) {
    const supporting = frames.filter((f)=>f.pose && rule.poses.includes(f.pose[0]) && f.pose[1]>=CONF_THRESHOLD);
    if (supporting.length/frames.length < .45) continue;
    const {points, t} = normalizedPath(frames,rule.tip);
    const span = extent(points), travelled = length(points);
    result.travel = Math.max(result.travel, travelled);
    if (!ruleGates(rule.letter, points, span, travelled)) continue;
    const active = activeSpan(points, t);
    result.activeFrames = Math.max(result.activeFrames, active.frames);
    result.activeMs = Math.max(result.activeMs, active.ms);
    const error = shapeError(points, rule.path);
    if (error > SHAPE_ERROR) continue;
    if (active.frames < MIN_ACTIVE_FRAMES) { tooFast = true; continue; }
    // Both significant displacement and the ordered trajectory must match.
    // A frozen pose or a straight translation cannot pass a J, Z or arc rule.
    const poseScore = supporting.reduce((s,f)=>s+f.pose![1],0)/frames.length;
    const confidence = Math.min(poseScore,1-error);
    if (confidence >= CONF_THRESHOLD) candidates.push([rule.letter,confidence]);
  }
  candidates.sort((a,b)=>b[1]-a[1]);
  if (candidates.length && (candidates.length===1 || candidates[0][1]-candidates[1][1]>.1)) {
    return {...result, prediction: candidates[0], issue: "ok", reason: "Trayectoria y pose compatibles (evaluación experimental)."};
  }
  return tooFast && !candidates.length ? withIssue(result, "too_fast") : result;
}

/** Largest spread of the fingertip/wrist over the last `ms` of frames, in palm lengths of the first frame. */
function recentExtent(frames: MotionFrame[], tip: number, ms: number): number {
  const last = frames.at(-1)?.t ?? 0;
  const recent = frames.filter((f) => last-f.t <= ms);
  return Math.max(extent(normalizedPath(recent, tip).points), extent(normalizedPath(recent, 0).points));
}

/** The hand moved and has now been still for STILL_MS (used to end a live segment, also in Libre). */
export function movementEnded(frames: MotionFrame[], tip = 8): boolean {
  if (frames.length < 3 || frames.at(-1)!.t-frames[0].t < STILL_MS+150) return false;
  return recentExtent(frames, tip, STILL_MS) < STILL_PALMS;
}

/** How much of the letter's trajectory the partial path already matches (0–1), for live feedback. */
export function trajectoryProgress(frames: MotionFrame[], target: string): number {
  const rule = RULES.find((r)=>r.letter===target);
  if (!rule) return 0;
  const {points} = normalizedPath(frames, rule.tip);
  if (extent(points) < .2) return 0;
  // La fracción del recorrido cuya forma se parece MÁS a lo hecho hasta ahora.
  let best = {f: 0, error: Infinity};
  for (let f=.1; f<=1.001; f+=.05) {
    const e = shapeError(points, prefix(rule.path, Math.min(f, 1)));
    if (e < best.error) best = {f: Math.min(f, 1), error: e};
  }
  return best.error <= SHAPE_ERROR ? best.f : 0;
}

const KEEP_WHEN_DONE = new Set<MotionIssue>(["capture_short", "camera_pause", "hand_lost", "out_of_frame", "too_fast"]);

export type LivePhase = "pose" | "ready" | "moving" | "result";
export interface LiveMotionState {
  phase: LivePhase;
  /** Parte de la trayectoria ya recorrida (solo en "moving"; 0–1). */
  progress: number;
  /** Milisegundos desde que empezó el movimiento. */
  elapsed: number;
  result: MotionResult | null;
}

/**
 * Seguimiento EN VIVO de una letra con movimiento, sin cuenta regresiva ni ventana fija:
 *   pose (esperando la pose inicial) → ready (sostenida READY_HOLD_MS) → moving (se desplazó más de
 *   ONSET_PALMS) → result (la mano quedó quieta STILL_MS, se perdió, o pasó MAX_MOVE_MS).
 * El resultado se muestra RESULT_MS y el seguimiento vuelve a empezar solo.
 */
export class LiveMotion {
  private phase: LivePhase = "pose";
  private readySince: number | null = null;
  private lastOk = 0;
  private buffer: MotionFrame[] = [];
  private frames: MotionFrame[] = [];
  private since = 0;
  private lastT: number | null = null;
  private progress = 0;
  /** Cuadros acumulados cuando el avance llegó al recorrido completo (se juzga hasta ahí). */
  private doneAt: number | null = null;
  private result: MotionResult | null = null;
  private target: string;
  constructor(target: string) { this.target = target; }
  reset() { this.phase = "pose"; this.readySince = null; this.buffer = []; this.frames = []; this.progress = 0; this.doneAt = null; this.result = null; }
  private state(t: number): LiveMotionState {
    return {phase: this.phase, progress: this.progress, elapsed: this.phase === "moving" ? t-this.since : 0, result: this.result};
  }
  push(frame: MotionFrame): LiveMotionState {
    const t = frame.t, rule = RULES.find((r)=>r.letter===this.target)!;
    // Cámara congelada o reloj que retrocede: se empieza de nuevo (en "moving" lo decide el análisis).
    const stalled = this.lastT !== null && (t <= this.lastT || t-this.lastT > 250);
    this.lastT = t;
    if (stalled && this.phase !== "moving") this.reset();
    if (this.phase === "result") {
      if (t-this.since >= RESULT_MS) this.reset(); else return this.state(t);
    }
    const ok = !!frame.hand && !frame.out && frameStartOk(frame, this.target);
    if (this.phase === "pose") {
      if (ok) this.readySince ??= t; else this.readySince = null;
      if (this.readySince !== null && t-this.readySince >= READY_HOLD_MS) { this.phase = "ready"; this.lastOk = t; this.buffer = []; }
      else return this.state(t);
    }
    if (this.phase === "ready") {
      if (ok) this.lastOk = t;
      else if (!frame.hand || t-this.lastOk > 400) { this.reset(); return this.state(t); }
      this.buffer.push(frame);
      this.buffer = this.buffer.filter((f)=>t-f.t <= 600);
      // Inicio: la punta o la muñeca se alejan del punto de reposo (primer cuadro del búfer).
      if (this.buffer.length >= 3 && Math.max(extent(normalizedPath(this.buffer, rule.tip).points), extent(normalizedPath(this.buffer, 0).points)) > ONSET_PALMS) {
        this.frames = this.buffer.slice(-PREROLL_FRAMES-1);
        this.buffer = [];
        this.phase = "moving"; this.since = this.frames[0].t; this.progress = 0; this.doneAt = null;
      }
      return this.state(t);
    }
    // moving
    this.frames.push(frame);
    const gap = t-(this.frames.at(-2)?.t ?? t);
    const missing = !frame.hand || gap > 250;
    const timedOut = t-this.since > MAX_MOVE_MS;
    if (!missing) {
      this.progress = Math.max(this.progress, trajectoryProgress(this.frames, this.target));
      if (this.progress >= .95 && this.doneAt === null) this.doneAt = this.frames.length;
    }
    if (missing || timedOut || movementEnded(this.frames, rule.tip)) {
      // Lo que la mano hace DESPUÉS de completar el recorrido (bajar, acomodarse) no cuenta.
      const judged = this.doneAt !== null && !missing ? this.frames.slice(0, this.doneAt+3) : this.frames;
      const r = analyzeMotionFor(judged, this.target, {live: true, timedOut: timedOut && this.doneAt === null});
      // Si el avance en vivo llegó al recorrido completo (con la pose inicial ya verificada), el
      // juicio final no puede contradecirlo por reglas que el medidor no muestra. Solo se mantienen
      // los problemas de captura y "demasiado rápido para observarlo".
      this.result = this.doneAt !== null && !missing && !KEEP_WHEN_DONE.has(r.issue)
        ? {...r, issue: "ok", reason: MESSAGES.ok, prediction: [this.target, Math.max(CONF_THRESHOLD, this.progress)]}
        : r;
      this.phase = "result"; this.since = t;
    }
    return this.state(t);
  }
}

/** Bounded rolling sequence; used for motion routing in Libre. */
export class MotionWindow {
  frames: MotionFrame[] = [];
  clear() { this.frames=[]; }
  push(frame: MotionFrame, ms=600) {
    if (this.frames.length && frame.t <= this.frames.at(-1)!.t) this.clear();
    this.frames.push(frame);
    this.frames=this.frames.filter((f)=>frame.t-f.t<=ms).slice(-180);
  }
}
