import type { FramePayload } from "./protocol";

type P = { x: number; y: number; z: number; visibility?: number };

export const FACE_IDX: readonly number[] = [1, 234, 454, 70, 63, 105, 66, 107, 336, 296, 334, 293, 300, 61, 291, 0, 17, 13, 14, 78, 308, 152];

/** Redondeo a 1 decimal: 0.1 px sobra para el modelo y el JSON de cada cuadro pesa mucho menos. */
export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function toPixels(lms: P[], w: number, h: number): number[][] {
  return lms.map((p) => [round1(p.x * w), round1(p.y * h), round1(p.z * w)]);
}

/**
 * Línea del guante con los 12 ángulos (pitch/roll de las 6 IMU, campos 4..15) a 1 decimal.
 * El resto (lado, seq, t, giroscopio, Hall, status) queda igual; una línea incompleta pasa tal cual.
 */
export function roundGloveLine(line: string): string {
  const p = line.split(",");
  if (p[0] !== "D" || p.length < 20) return line;
  for (let i = 4; i < 16; i++) {
    const v = Number(p[i]);
    if (p[i] !== "" && Number.isFinite(v)) p[i] = String(round1(v));
  }
  return p.join(",");
}

export function buildFrame(input: {
  w: number; h: number; hands: P[][]; pose: P[] | null; face: P[] | null;
  gloves: { L: string | null; R: string | null };
}): FramePayload {
  const { w, h } = input;
  return {
    type: "frame", w, h,
    hands: input.hands.slice(0, 2).map((hand) => toPixels(hand, w, h)),
    pose: input.pose ? input.pose.map((p) => [round1(p.x * w), round1(p.y * h), round1(p.z * w), round2(p.visibility ?? 0)]) : null,
    face: input.face ? toPixels(FACE_IDX.map((i) => input.face![i]), w, h) : null,
    gloves: {
      L: input.gloves.L === null ? null : roundGloveLine(input.gloves.L),
      R: input.gloves.R === null ? null : roundGloveLine(input.gloves.R),
    },
  };
}
