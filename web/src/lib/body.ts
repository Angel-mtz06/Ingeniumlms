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

/** Máximo de manos de la persona (MediaPipe busca más para que una mano del fondo no le quite el lugar a una suya). */
export const MAX_HANDS = 2;
/** Alcance: el centro de una mano real sin brazo de la pose cerca nunca pasó de 1.55 anchos de hombro de su hombro
 *  más cercano (135 869 manos del dataset); más allá es de alguien más. */
export const MAX_REACH = 1.9;
/** Tamaño mínimo (lado mayor del recuadro de la mano, en anchos de hombro): las manos reales sin brazo cerca midieron
 *  al menos 0.22; una mano del fondo se ve más chica porque está más lejos de la cámara. */
export const MIN_EXTENT = 0.18;

function extent(hand: Pt[], w: number, h: number): number {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of hand) {
    x0 = Math.min(x0, p.x * w); x1 = Math.max(x1, p.x * w);
    y0 = Math.min(y0, p.y * h); y1 = Math.max(y1, p.y * h);
  }
  return Math.max(x1 - x0, y1 - y0);
}

/**
 * Manos que sí son de la persona (máximo 2). Una detección con algún punto de mano de la pose cerca siempre se queda
 * (también frente a la cara: las señas en la cara tienen la muñeca pegada). Sin brazo cerca se descarta si:
 * - las dos muñecas de la pose se ven en otro lado (las dos manos reales ya están ubicadas),
 * - cae dentro de la cara (la cara o el cuello confundidos con una mano),
 * - está fuera del alcance de sus hombros, o
 * - es demasiado chica para su tamaño (una mano de alguien atrás).
 * Si quedan más de 2, se quedan las más cercanas a sus brazos. Sin pose no se descarta nada (solo se limita a 2).
 */
export function realHands<H extends Pt[]>(hands: H[], pose: Pt[] | null, face: Pt[] | null, w: number, h: number): H[] {
  if (!hands.length || !pose) return hands.slice(0, MAX_HANDS);
  const shoulders = shoulderWidth(pose, face, w, h);
  const poseHand = POSE_HAND.flatMap((arm) => arm.filter((i) => visible(pose[i])).map((i) => px(pose[i], w, h)));
  const bothWrists = POSE_WRISTS.every((i) => visible(pose[i]));
  const shoulderPts = SHOULDERS.every((i) => visible(pose[i])) ? SHOULDERS.map((i) => px(pose[i], w, h)) : [];
  const box = faceBox(face, w, h);
  const kept: { hand: H; gap: number; order: number }[] = [];
  hands.forEach((hand, order) => {
    const wrist = px(hand[0], w, h);
    const center = palmCenter(hand, w, h);
    const gap = Math.min(Infinity, ...poseHand.map((p) => Math.min(dist(p, wrist), dist(p, center))));
    if (shoulders !== null && gap <= NEAR_POSE * shoulders) {
      kept.push({ hand, gap, order });
      return;
    }
    if (bothWrists && shoulders !== null) return;
    if (box && center.x >= box.x0 && center.x <= box.x1 && center.y >= box.y0 && center.y <= box.y1) return;
    if (shoulders !== null) {
      if (shoulderPts.length && Math.min(...shoulderPts.map((q) => dist(q, center))) > MAX_REACH * shoulders) return;
      if (extent(hand, w, h) < MIN_EXTENT * shoulders) return;
    }
    kept.push({ hand, gap, order });
  });
  // Las más cercanas a sus brazos primero; con la misma distancia (p. ej. sin brazos a la vista), el orden de MediaPipe.
  kept.sort((a, b) => a.gap - b.gap || a.order - b.order);
  return kept.slice(0, MAX_HANDS).sort((a, b) => a.order - b.order).map((k) => k.hand);
}
