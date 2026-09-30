import { useEffect, useRef, type ReactNode } from "react";
import type { HandPoints } from "../hooks/useVision";
import type { BodyPoints } from "../lib/vision";
import { useThemeColors } from "../hooks/useThemeColors";
import { HAND_CONNECTIONS } from "../lib/ui";
import { IconCamera, IconError } from "./icons";
import "./components.css";

export interface CameraViewProps {
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  /** Manos normalizadas (0..1, sin espejo): un arreglo, o una función que se consulta en cada repintado. */
  hands: HandPoints | (() => HandPoints);
  /** Espejo solo visual (CSS). Los cuadros que van a MediaPipe nunca se voltean. */
  mirrored?: boolean;
  loading?: boolean;
  error?: string | null;
  /** Avisos superpuestos (p. ej. "No se ven tus manos"). */
  children?: ReactNode;
  /** Cuadros por segundo de MediaPipe: si se pasa (aunque sea null), se muestra en la esquina superior izquierda. */
  fps?: number | null;
  /** Detalle opcional junto a los FPS (p. ej. "cámara 15 · 38 ms"). */
  fpsDetail?: string | null;
  /** Contenido de la esquina superior derecha (p. ej. el medidor de puntaje de Práctica). */
  corner?: ReactNode;
  /** Cara y cuerpo (se consulta en cada repintado, como `hands`): se dibujan debajo de las manos, en otros colores. */
  body?: () => BodyPoints;
  /** Medidor de la esquina inferior izquierda (el nivel de la muñeca de las pulseras). */
  gauge?: ReactNode;
}

const COLOR_VARS = ["--color-accent", "--color-accent-contrast", "--color-face", "--color-torso"] as const;
type Colors = Record<(typeof COLOR_VARS)[number], string>;

const MIN_VIS = 0.5;
/** Pose: hombros, brazos (hombro, codo, muñeca) y caderas. */
const TORSO_LINES: readonly [number, number][] = [[11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16]];
const TORSO_POINTS = [11, 12, 13, 14, 15, 16, 23, 24] as const;
const CHIN = 152; // malla de la cara
const MOUTH = [9, 10] as const; // pose, si no hay malla

type Pt = { x: number; y: number };

/** Cuello (barbilla → mitad de los hombros), hombros, brazos y torso; luego los puntos de la cara. */
function drawBody(ctx: CanvasRenderingContext2D, body: BodyPoints, w: number, h: number, colors: Colors, unit: number) {
  const halo = colors["--color-accent-contrast"];
  const { pose, face } = body;
  if (pose) {
    const seen = (i: number) => (pose[i]?.visibility ?? 0) > MIN_VIS;
    const at = (p: Pt) => [p.x * w, p.y * h] as const;
    const segs: [readonly [number, number], readonly [number, number]][] = [];
    for (const [a, b] of TORSO_LINES) if (seen(a) && seen(b)) segs.push([at(pose[a]), at(pose[b])]);
    const chin: Pt | null = face?.[CHIN] ?? (seen(MOUTH[0]) && seen(MOUTH[1])
      ? { x: (pose[MOUTH[0]].x + pose[MOUTH[1]].x) / 2, y: (pose[MOUTH[0]].y + pose[MOUTH[1]].y) / 2 } : null);
    if (chin && seen(11) && seen(12)) segs.push([at(chin), at({ x: (pose[11].x + pose[12].x) / 2, y: (pose[11].y + pose[12].y) / 2 })]);
    for (const [stroke, width] of [[halo, unit * 4], [colors["--color-torso"], unit * 2.2]] as const) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (const [[x0, y0], [x1, y1]] of segs) {
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
      }
      ctx.stroke();
    }
    ctx.beginPath();
    for (const i of TORSO_POINTS) {
      if (!seen(i)) continue;
      const [x, y] = at(pose[i]);
      ctx.moveTo(x + unit * 2.6, y);
      ctx.arc(x, y, unit * 2.6, 0, Math.PI * 2);
    }
    ctx.fillStyle = colors["--color-torso"];
    ctx.fill();
    ctx.lineWidth = unit;
    ctx.strokeStyle = halo;
    ctx.stroke();
  }
  if (face) {
    // Un solo trazo para los 478 puntos: halo claro y punto de color encima.
    for (const [fill, r] of [[halo, unit * 1.3], [colors["--color-face"], unit * 0.8]] as const) {
      ctx.beginPath();
      for (const p of face) {
        const x = p.x * w, y = p.y * h;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = fill;
      ctx.fill();
    }
  }
}

function drawHands(canvas: HTMLCanvasElement, video: HTMLVideoElement, hands: HandPoints, colors: Colors | null, body: BodyPoints | null = null) {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  if (!colors) return;
  const unit = Math.max(w, h) / 400;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (body) drawBody(ctx, body, w, h, colors, unit);
  if (hands.length === 0) return;
  const line = colors["--color-accent"];
  const halo = colors["--color-accent-contrast"];
  for (const hand of hands) {
    // Halo claro debajo y trazo de acento encima: se lee sobre fondos claros u oscuros.
    for (const [stroke, width] of [[halo, unit * 3.2], [line, unit * 1.6]] as const) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        const p = hand[a];
        const q = hand[b];
        if (!p || !q) continue;
        ctx.moveTo(p.x * w, p.y * h);
        ctx.lineTo(q.x * w, q.y * h);
      }
      ctx.stroke();
    }
    for (const p of hand) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, unit * 2.2, 0, Math.PI * 2);
      ctx.fillStyle = line;
      ctx.fill();
      ctx.lineWidth = unit;
      ctx.strokeStyle = halo;
      ctx.stroke();
    }
  }
}

/**
 * Video de la cámara con un lienzo superpuesto que dibuja las manos (y, con `body`, la cara y el torso debajo). Video y lienzo comparten
 * `object-fit: contain` y el tamaño intrínseco del video, así que los puntos coinciden sin cálculos.
 */
export function CameraView({ videoRef, hands, mirrored = true, loading = false, error = null, children, fps, fpsDetail, corner, body, gauge }: CameraViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handsRef = useRef(hands);
  handsRef.current = hands;
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const live = typeof hands === "function";
  const colors = useThemeColors(canvasRef, COLOR_VARS);

  // Con una función: se consulta por cuadro de pantalla, pero solo se repinta si cambian las manos
  // (MediaPipe entrega un arreglo nuevo por resultado), el tamaño del video o el tema.
  useEffect(() => {
    if (!live) return;
    let id = 0;
    let prev: { hands: HandPoints | null; body: BodyPoints | null; w: number; h: number; v: number } = { hands: null, body: null, w: 0, h: 0, v: -1 };
    const loop = () => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      const src = handsRef.current;
      if (canvas && video && typeof src === "function") {
        const next = src();
        const nextBody = bodyRef.current?.() ?? null;
        const w = video.videoWidth;
        const h = video.videoHeight;
        const v = colors.version();
        const sameHands = next === prev.hands || (next.length === 0 && prev.hands !== null && prev.hands.length === 0);
        if (!sameHands || nextBody !== prev.body || w !== prev.w || h !== prev.h || v !== prev.v) {
          drawHands(canvas, video, next, colors.get(), nextBody);
          prev = { hands: next, body: nextBody, w, h, v };
        }
      }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [live, videoRef, colors]);

  // Con un arreglo: se repinta cuando cambia.
  useEffect(() => {
    if (live || typeof hands === "function") return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (canvas && video) drawHands(canvas, video, hands, colors.get());
  }, [live, hands, videoRef, colors]);

  return (
    <div className="camera" data-mirrored={mirrored}>
      <video ref={videoRef} className="camera__media" autoPlay muted playsInline aria-label="Vista de tu cámara" />
      <canvas ref={canvasRef} className="camera__media camera__overlay" aria-hidden="true" />
      {error ? (
        <div className="camera__notice" role="alert">
          <IconError size={32} />
          <p>{error}</p>
        </div>
      ) : loading ? (
        <div className="camera__notice" role="status">
          <IconCamera size={32} />
          <p>Preparando la cámara…</p>
        </div>
      ) : null}
      {!error && !loading && fps !== undefined ? (
        // Metadato discreto: cambia una vez por segundo y no se anuncia (no es región viva).
        <p className="camera__fps">
          <abbr title="cuadros por segundo">FPS</abbr> <span className="tabular">{fps ?? "…"}</span>
          {fpsDetail ? <span className="camera__fps-detail tabular"> · {fpsDetail}</span> : null}
        </p>
      ) : null}
      {!error && !loading && corner ? <div className="camera__corner">{corner}</div> : null}
      {!error && !loading && gauge ? <div className="camera__gauge">{gauge}</div> : null}
      {children ? <div className="camera__slot">{children}</div> : null}
    </div>
  );
}
