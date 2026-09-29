import model from "../data/alphabet_samples.json";
import { alphabetFeatures, SEP_HANDS } from "./alphabet";

/**
 * Medidas geométricas de UNA mano, independientes de posición y escala (muñeca como origen,
 * distancia muñeca–MCP9 como unidad; lo mismo que usa el clasificador del alfabeto).
 * Todas son invariantes al espejo en x (mano izquierda/derecha), así que no dependen de
 * con qué mano signa el usuario. Límite conocido: sin la lateralidad de MediaPipe no se puede
 * distinguir palma de dorso (una mano derecha de espaldas y una izquierda de frente se ven
 * iguales), por eso la orientación solo mide "de frente / de lado" e inclinación.
 */
export const FINGER_NAMES = ["pulgar", "índice", "medio", "anular", "meñique"] as const;

export type FeatureKind = "orientation" | "finger" | "thumb" | "spread";
export interface FeatureDef {
  key: string;
  kind: FeatureKind;
  /** Escala mínima para medir la severidad (evita varianzas casi nulas). */
  unit: number;
  /** Diferencia mínima respecto a la mediana de la letra para considerarlo error. */
  minDiff: number;
  /** Diferencia a partir de la cual el mensaje no lleva "un poco". */
  bigDiff: number;
  finger?: number;
  pair?: [number, number];
}

export const FEATURES: FeatureDef[] = [
  // |componente z de la normal de la palma|: 1 = de frente (o de espaldas) a la cámara, 0 = de lado.
  { key: "facing", kind: "orientation", unit: 0.1, minDiff: 0.35, bigDiff: 0.5 },
  // Ángulo en la imagen de muñeca→MCP del medio respecto a la vertical: 0° dedos arriba, 180° abajo.
  { key: "tilt", kind: "orientation", unit: 10, minDiff: 30, bigDiff: 45 },
  // Flexión total del dedo: ángulo entre muñeca→MCP y MCP→punta (0° recto, ~150° cerrado).
  ...[1, 2, 3, 4].map((finger) => ({ key: `flex${finger}`, kind: "finger" as const, unit: 10, minDiff: 30, bigDiff: 50, finger })),
  { key: "flex0", kind: "thumb", unit: 10, minDiff: 30, bigDiff: 45, finger: 0 },
  // Posición de la punta del pulgar a lo ancho de la palma: 0 = junto al MCP del índice, 1 = junto al del meñique.
  { key: "thumbAcross", kind: "thumb", unit: 0.1, minDiff: 0.35, bigDiff: 0.6, finger: 0 },
  // Distancia punta del pulgar – punta del índice, en anchos de palma (MCP5–MCP17).
  { key: "thumbIndex", kind: "thumb", unit: 0.1, minDiff: 0.4, bigDiff: 0.7, finger: 0 },
  // Ángulo entre las direcciones MCP→punta de dedos vecinos. Solo se mide si ambos están extendidos.
  ...([[1, 2], [2, 3], [3, 4]] as [number, number][]).map((pair) => ({ key: `spread${pair[0]}${pair[1]}`, kind: "spread" as const, unit: 4, minDiff: 10, bigDiff: 12, pair })),
  // Orden de las puntas índice→medio a lo ancho de la palma, en anchos de palma: < 0 = cruzados (R),
  // ~0.17 = juntos (U), ~0.55 = separados (V). Medido en letters.npz; distingue R/U/V mejor que el ángulo.
  { key: "fingerOrder", kind: "spread", unit: 0.05, minDiff: 0.15, bigDiff: 0.3, pair: [1, 2] },
];

/** Un dedo cuenta como "extendido" para medir separación si su flexión es menor a esto. */
export const EXTENDED_DEG = 50;

const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const norm = (v: number[]) => Math.hypot(...v);
const cross = (a: number[], b: number[]) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const angle = (a: number[], b: number[]) => Math.atan2(norm(cross(a, b)), dot(a, b)) * 180 / Math.PI;

export type HandShape = Record<string, number>;

/** Normalized landmarks (wrist origin, |MCP9| = 1) → named measurements. null if the hand is degenerate. */
export function shapeFromNormalized(h: number[][]): HandShape | null {
  const palmWidth = norm(sub(h[5], h[17]));
  const n = cross(h[5], h[17]);
  if (palmWidth < 1e-6 || norm(n) < 1e-9) return null;
  const s: HandShape = {};
  s.facing = Math.abs(n[2]) / norm(n);
  s.tilt = Math.abs(Math.atan2(h[9][0], -h[9][1])) * 180 / Math.PI;
  for (const [f, b] of [1, 5, 9, 13, 17].entries()) s[`flex${f}`] = angle(h[b], sub(h[b + 3], h[b]));
  const across = sub(h[17], h[5]);
  s.thumbAcross = dot(sub(h[4], h[5]), across) / dot(across, across);
  s.thumbIndex = norm(sub(h[4], h[8])) / palmWidth;
  s.fingerOrder = dot(sub(h[12], h[8]), across) / (norm(across) * palmWidth);
  for (const [a, b] of [[1, 2], [2, 3], [3, 4]]) {
    const base = (f: number) => 1 + 4 * f;
    s[`spread${a}${b}`] = angle(sub(h[base(a) + 3], h[base(a)]), sub(h[base(b) + 3], h[base(b)]));
  }
  return s;
}

/** Pixel landmarks (21×3) → measurements. */
export function handShape(hand: number[][]): HandShape | null {
  const f = alphabetFeatures(hand);
  if (!f) return null;
  return shapeFromNormalized(Array.from({ length: 21 }, (_, i) => f.slice(i * 3, i * 3 + 3)));
}

export interface FeatureStats { lo: number; median: number; hi: number; n: number }
export type LetterStats = Record<string, FeatureStats | undefined>;

const quantile = (sorted: number[], q: number) => {
  const p = (sorted.length - 1) * q, i = Math.floor(p), r = p - i;
  return sorted[i] + ((sorted[Math.min(i + 1, sorted.length - 1)] ?? sorted[i]) - sorted[i]) * r;
};
/** Rango robusto de la letra: percentiles 2.5–97.5 de sus muestras (180 por letra). */
export const LOW_Q = 0.025, HIGH_Q = 0.975;

function buildStats(): Record<string, LetterStats> {
  const shapes: { letter: string; s: HandShape }[] = [];
  model.samples.forEach((sample, i) => {
    const s = shapeFromNormalized(Array.from({ length: 21 }, (_, j) => sample.slice(j * 3, j * 3 + 3)));
    if (s) shapes.push({ letter: model.letters[model.labels[i]], s });
  });
  const sepShapes = SEP_HANDS.map(({letter, hand}) => ({letter, s: handShape(hand)}))
    .filter((x): x is {letter: string; s: HandShape} => x.s !== null);
  const out: Record<string, LetterStats> = {};
  for (const letter of model.letters) {
    const mine = shapes.filter((x) => x.letter === letter).map((x) => x.s);
    const stats: LetterStats = {};
    for (const def of FEATURES) {
      // La separación solo existe entre dedos extendidos: se mide con esas muestras y únicamente
      // si en la letra ambos dedos están normalmente extendidos.
      const rows = def.pair ? mine.filter((s) => def.pair!.every((f) => s[`flex${f}`] < EXTENDED_DEG)) : mine;
      if (def.pair && rows.length < mine.length * 0.6) continue;
      const values = rows.map((s) => s[def.key]).sort((a, b) => a - b);
      if (values.length < 20) continue;
      // La foto oficial siempre es válida: el rango se amplía para incluirla (no se mueve la mediana).
      const official = sepShapes.filter((x) => x.letter === letter).map((x) => x.s[def.key])
        .filter((_, i) => !def.pair || def.pair.every((f) => sepShapes.filter((x) => x.letter === letter)[i].s[`flex${f}`] < EXTENDED_DEG + 15));
      stats[def.key] = {
        lo: Math.min(quantile(values, LOW_Q), ...official), median: quantile(values, 0.5),
        hi: Math.max(quantile(values, HIGH_Q), ...official), n: values.length,
      };
    }
    out[letter] = stats;
  }
  return out;
}

/** Referencia por letra calculada una sola vez desde las mismas muestras del clasificador. */
export const LETTER_STATS: Record<string, LetterStats> = buildStats();
