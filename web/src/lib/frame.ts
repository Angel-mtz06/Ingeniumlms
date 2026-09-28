import type { FramePayload } from "./protocol";

type P = { x: number; y: number; z: number; visibility?: number };

export const FACE_IDX: readonly number[] = [1, 234, 454, 70, 63, 105, 66, 107, 336, 296, 334, 293, 300, 61, 291, 0, 17, 13, 14, 78, 308, 152];

export function toPixels(lms: P[], w: number, h: number): number[][] {
  return lms.map((p) => [p.x * w, p.y * h, p.z * w]);
}

export function buildFrame(input: {
  w: number; h: number; hands: P[][]; pose: P[] | null; face: P[] | null;
  gloves: { L: string | null; R: string | null };
}): FramePayload {
  const { w, h } = input;
  return {
    type: "frame", w, h,
    hands: input.hands.slice(0, 2).map((hand) => toPixels(hand, w, h)),
    pose: input.pose ? input.pose.map((p) => [p.x * w, p.y * h, p.z * w, p.visibility ?? 0]) : null,
    face: input.face ? toPixels(FACE_IDX.map((i) => input.face![i]), w, h) : null,
    gloves: input.gloves,
  };
}
