/*
 * gauge.ts: lógica pura del medidor de puntaje que va sobre la cámara en Práctica.
 * El medidor nunca comunica solo con color: siempre lleva cifra o texto y el ícono del estado.
 */
import { clampScore, scoreTone, type Tone, TONE_WORD } from "./ui";

/** Lo mínimo de un mensaje `evaluation` que necesita el medidor. */
export interface GaugeInput {
  evaluable: boolean;
  total: number;
  tips: readonly string[];
}

export type GaugeView =
  /** Todavía no hay toma calificada de esta seña. */
  | { kind: "idle"; label: string; detail: string }
  /** La toma no se pudo calificar (falta una mano, sin referencia…). */
  | { kind: "guide"; label: string; detail: string }
  | { kind: "score"; value: number; tone: Tone; word: string; label: string; detail: string;
      /** Texto bajo la palabra (por omisión "Tu puntaje"); p. ej. "Confianza" en el alfabeto. */
      caption?: string };

/**
 * Qué muestra el medidor. `canScore` es false si la seña no tiene referencia: entonces nunca
 * habrá cifra, y se dice desde el principio.
 */
export function gaugeView(result: GaugeInput | null, canScore = true): GaugeView {
  if (!canScore) return { kind: "guide", label: "No evaluable", detail: "Esta seña no tiene referencia" };
  if (!result) return { kind: "idle", label: "Haz la seña…", detail: "Tu puntaje aparece aquí" };
  if (!result.evaluable) return { kind: "guide", label: "No evaluable", detail: "Repite la toma" };
  const value = Math.round(clampScore(result.total));
  const tone = scoreTone(value);
  return { kind: "score", value, tone, word: TONE_WORD[tone], label: `${value} %`, detail: `${TONE_WORD[tone]}, ${value} de 100` };
}

/** Primer consejo no vacío de la toma, o null. */
export function firstTip(result: GaugeInput | null): string | null {
  const tip = result?.tips.find((t) => t.trim().length > 0);
  return tip ? tip.trim() : null;
}

/**
 * Desplazamiento del trazo (`stroke-dashoffset`) de un anillo de `circumference` para mostrar
 * `value` de 100. 0 = anillo lleno; `circumference` = vacío.
 */
export function ringOffset(value: number, circumference: number): number {
  return circumference * (1 - clampScore(value) / 100);
}
