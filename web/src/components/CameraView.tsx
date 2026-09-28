import { useEffect, useRef, type ReactNode } from "react";
import type { HandPoints } from "../hooks/useVision";
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
}

function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

function drawHands(canvas: HTMLCanvasElement, video: HTMLVideoElement, hands: HandPoints) {
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
  if (hands.length === 0) return;
  const line = cssVar(canvas, "--color-accent");
  const halo = cssVar(canvas, "--color-accent-contrast");
  const unit = Math.max(w, h) / 400;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
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
 * Video de la cámara con un lienzo superpuesto que dibuja las manos. Video y lienzo comparten
 * `object-fit: contain` y el tamaño intrínseco del video, así que los puntos coinciden sin cálculos.
 */
export function CameraView({ videoRef, hands, mirrored = true, loading = false, error = null, children }: CameraViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handsRef = useRef(hands);
  handsRef.current = hands;
  const live = typeof hands === "function";

  // Con una función: repintado propio por cuadro de pantalla, sin tocar el estado de React.
  useEffect(() => {
    if (!live) return;
    let id = 0;
    const loop = () => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      const src = handsRef.current;
      if (canvas && video && typeof src === "function") drawHands(canvas, video, src());
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [live, videoRef]);

  // Con un arreglo: se repinta cuando cambia.
  useEffect(() => {
    if (live || typeof hands === "function") return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (canvas && video) drawHands(canvas, video, hands);
  }, [live, hands, videoRef]);

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
      {children ? <div className="camera__slot">{children}</div> : null}
    </div>
  );
}
