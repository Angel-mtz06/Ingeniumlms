/*
 * body.ts: descarta "manos" falsas que MediaPipe ve en la cara, el cuello o la ropa (la detección de manos corre con
 * confianza baja, 0.3, para no perder manos reales en movimiento). Una mano real tiene su muñeca en el cuerpo: la pose
 * marca muñeca, pulgar, índice y meñique de cada brazo. Lógica pura, en píxeles del cuadro.
 */

export type Pt = { x: number; y: number; z?: number; visibility?: number };

const MIN_VIS = 0.5;
/** Puntos de la mano en la pose, por brazo: muñeca, meñique, índice, pulgar. */
const POSE_HAND = [
  [15, 17, 19, 21],
  [16, 18, 20, 22],
] as const;
const POSE_WRISTS = [15, 16] as const;
const SHOULDERS = [11, 12] as const;
/** Mejillas en la malla completa de la cara (FaceLandmarker, 478 puntos). */
const CHEEKS = [234, 454] as const;
/** Distancia máxima (en anchos de hombros) entre la mano y la mano de la pose. La pose se calcula cada 2 cuadros:
 *  con movimientos rápidos va un cuadro atrás, por eso es amplia. */
export const NEAR_POSE = 0.6;
/** Anchos de cara ≈ un ancho de hombros, cuando los hombros no se ven. */
const FACE_TO_SHOULDERS = 2.8;

const px = (p: Pt, w: number, h: number) => ({ x: p.x * w, y: p.y * h });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const visible = (p: Pt | undefined): p is Pt => !!p && (p.visibility ?? 0) > MIN_VIS;

/** Centro de la palma: muñeca y nudillos. */
function palmCenter(hand: Pt[], w: number, h: number) {
  const idx = [0, 5, 9, 13, 17];
  const pts = idx.map((i) => px(hand[i], w, h));
  return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
}

/** Recuadro de la cara (px, malla completa: incluye la frente), 10 % más grande. null sin cara. */
export function faceBox(face: Pt[] | null, w: number, h: number) {
  if (!face || face.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of face) {
    x0 = Math.min(x0, p.x * w); x1 = Math.max(x1, p.x * w);
    y0 = Math.min(y0, p.y * h); y1 = Math.max(y1, p.y * h);
  }
  const mx = (x1 - x0) * 0.1, my = (y1 - y0) * 0.1;
  return { x0: x0 - mx, y0: y0 - my, x1: x1 + mx, y1: y1 + my };
}

/** Ancho de hombros en px (con la cara si los hombros no se ven); null si no hay referencia. */
function shoulderWidth(pose: Pt[] | null, face: Pt[] | null, w: number, h: number): number | null {
  if (pose && visible(pose[SHOULDERS[0]]) && visible(pose[SHOULDERS[1]])) {
    return dist(px(pose[SHOULDERS[0]], w, h), px(pose[SHOULDERS[1]], w, h));
  }
  if (face && face[CHEEKS[0]] && face[CHEEKS[1]]) return dist(px(face[CHEEKS[0]], w, h), px(face[CHEEKS[1]], w, h)) * FACE_TO_SHOULDERS;
  return null;
}

/**
 * Manos que sí son manos. Se descarta una detección si ningún punto de mano de la pose queda cerca y además:
 * - las dos muñecas de la pose se ven en otro lado (las dos manos reales ya están ubicadas), o
 * - cae dentro de la cara (la cara o el cuello confundidos con una mano).
 * Sin pose no se descarta nada: una mano real frente a la cara no tendría con qué confirmarse.
 */
export function realHands<H extends Pt[]>(hands: H[], pose: Pt[] | null, face: Pt[] | null, w: number, h: number): H[] {
  if (!hands.length || !pose) return hands;
  const shoulders = shoulderWidth(pose, face, w, h);
  const poseHand = POSE_HAND.flatMap((arm) => arm.filter((i) => visible(pose[i])).map((i) => px(pose[i], w, h)));
  const bothWrists = POSE_WRISTS.every((i) => visible(pose[i]));
  const box = faceBox(face, w, h);
  return hands.filter((hand) => {
    const wrist = px(hand[0], w, h);
    const center = palmCenter(hand, w, h);
    if (shoulders !== null && poseHand.some((p) => Math.min(dist(p, wrist), dist(p, center)) <= NEAR_POSE * shoulders)) return true;
    if (bothWrists && shoulders !== null) return false;
    if (box && center.x >= box.x0 && center.x <= box.x1 && center.y >= box.y0 && center.y <= box.y1) return false;
    return true;
  });
}
