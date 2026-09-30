/*
 * alphabetView.ts: qué muestran el medidor de la esquina y la nota bajo la cámara en la práctica del
 * alfabeto (lógica pura; la pantalla solo dibuja). Mismo lenguaje visual que Práctica de señas:
 * el medidor nunca comunica solo con color, siempre lleva cifra o texto e ícono.
 */
import type { Feedback } from "./alphabetFeedback";
import type { LiveMotionState, MotionIssue } from "./alphabetMotion";
import type { GaugeView } from "./gauge";
import { scoreTone, type Tone, TONE_WORD } from "./ui";

const CAPTURE_SHORT: Record<string, string> = {
  no_hand: "Coloca tu mano", two_hands: "Usa una sola mano", out_of_frame: "Mano fuera del cuadro",
  too_small: "Acércate a la cámara", unstable: "Mantén la mano quieta",
};

const MOTION_SHORT: Partial<Record<MotionIssue, string>> = {
  capture_short: "Pocos cuadros de cámara", camera_pause: "La cámara se detuvo", hand_lost: "Se perdió la mano",
  out_of_frame: "Mano fuera del cuadro", pose_lost: "Cambió la forma", no_motion: "Sin movimiento",
  too_small: "Más amplio", too_fast: "Demasiado rápido", cut_off: "Hazlo continuo", reversed: "Sentido contrario",
  incomplete: "Incompleto", wrong_path: "Revisa la dirección", not_recognized: "No reconocido",
};

const score = (value: number, tone: Tone, caption: string, word = TONE_WORD[tone]): GaugeView =>
  ({ kind: "score", value, tone, word, label: `${value} %`, detail: `${word}, ${value} de 100`, caption });

/** Letra estática con objetivo: confianza relativa de la objetivo; verde solo si ya es correcta. */
export function staticGauge(feedback: Feedback | null, targetShare: number, holdProgress: number): GaugeView {
  if (!feedback || feedback.issue === "no_hand") return { kind: "idle", label: "Haz la letra…", detail: "Coloca tu mano en el cuadro" };
  if (feedback.type === "capture") return { kind: "guide", label: "Ajusta la mano", detail: CAPTURE_SHORT[feedback.issue] ?? feedback.message };
  const value = Math.round(Math.max(0, Math.min(1, targetShare)) * 100);
  if (feedback.correct) return score(value, "ok", holdProgress >= 1 ? "¡Correcto!" : "Mantén la posición");
  const tone = scoreTone(value) === "ok" ? "warn" : scoreTone(value);
  return score(value, tone, "Confianza");
}

/** Letra con movimiento, en vivo: pose inicial → listo → avance del recorrido → resultado. */
export function motionGauge(live: LiveMotionState | null, feedback: Feedback | null, complete: boolean): GaugeView {
  if (!live) return { kind: "idle", label: "Haz la letra…", detail: "Coloca tu mano en el cuadro" };
  if (live.phase === "result" && live.result) {
    const r = live.result;
    if (r.issue === "ok" || complete) return score(Math.round((r.prediction?.[1] ?? 1) * 100), "ok", "¡Correcto!");
    return { kind: "guide", label: "Corrige", detail: MOTION_SHORT[r.issue] ?? "Inténtalo de nuevo" };
  }
  if (live.phase === "moving") return score(Math.round(live.progress * 100), "warn", "del recorrido", "Moviendo…");
  if (live.phase === "ready") return { kind: "idle", label: "¡Listo!", detail: "Haz el movimiento" };
  if (feedback?.type === "capture") return { kind: "guide", label: "Ajusta la mano", detail: CAPTURE_SHORT[feedback.issue] ?? feedback.message };
  return { kind: "guide", label: "Posición inicial", detail: feedback?.correct ? "Mantén la posición" : "Corrige la forma de la mano" };
}

export interface SpellInput {
  feedback: Feedback | null;
  phase: "idle" | "capturing" | "result";
  motionResult: { prediction: [string, number] | null; reason: string } | null;
  /** Letras con movimiento cuya pose inicial ya está lista (p. ej. "J"). */
  freeReady: string;
  stable: [string, number] | null;
}

/** Una línea de estado para el deletreo en Interpretación (mismo orden de prioridad que Libre). */
export function spellStatus(r: SpellInput): { tone?: "ok" | "warn"; text: string } {
  if (r.feedback?.type === "capture" && r.feedback.issue !== "no_hand") return { tone: "warn", text: r.feedback.message };
  if (r.phase === "capturing") return { text: "Siguiendo el movimiento…" };
  if (r.motionResult) {
    return r.motionResult.prediction ? { tone: "ok", text: `Letra ${r.motionResult.prediction[0]} (con movimiento).` }
      : { tone: "warn", text: `Movimiento de la ${r.motionResult.reason}` };
  }
  if (r.freeReady) return { tone: "ok", text: `Pose de ${[...r.freeReady].join(" / ")} lista: haz el movimiento.` };
  if (r.stable) return { tone: "ok", text: `Letra ${r.stable[0]}.` };
  if (!r.feedback || r.feedback.issue === "no_hand") return { text: "Coloca tu mano en el cuadro y haz una letra." };
  return { text: "Mantén la letra un momento." };
}

/** Libre: la letra estable, sin decir cómo cambiarla (no se sabe qué quería hacer el usuario). */
export function freeGauge(stable: [string, number] | null, feedback: Feedback | null): GaugeView {
  if (feedback?.type === "capture") return { kind: "guide", label: "Ajusta la mano", detail: CAPTURE_SHORT[feedback.issue] ?? feedback.message };
  if (!stable) return { kind: "idle", label: "Haz una letra…", detail: "Mantén la pose" };
  const value = Math.round(stable[1] * 100);
  return score(value, "ok", `Letra ${stable[0]}`, stable[0]);
}
