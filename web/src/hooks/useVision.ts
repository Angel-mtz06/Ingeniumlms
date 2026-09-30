import { useCallback, useEffect, useRef, useState } from "react";
import type { FramePayload } from "../lib/protocol";
import { FpsMeter, monotonic } from "../lib/ui";
import { type BodyPoints, createVision, type Delegate, type Vision } from "../lib/vision";

export type HandPoints = { x: number; y: number; z: number }[][];

const NO_BODY: BodyPoints = { face: null, pose: null };

export interface VisionHandle {
  loading: boolean;
  error: string | null;
  fps: number | null;
  /** Delegado activo de MediaPipe: "GPU" o, si la GPU falló, "CPU". null mientras carga. */
  delegate: Delegate | null;
  /** Últimas manos detectadas (normalizadas 0..1, sin espejo). Función estable: no provoca renders. */
  lastHands: () => HandPoints;
  /** Última cara y pose detectadas (mismo objeto mientras no cambien). Función estable. */
  lastBody: () => BodyPoints;
  /** Mediciones de rendimiento (una vez por segundo): qué limita los FPS, la cámara o MediaPipe. */
  stats: VisionStats | null;
}

export interface VisionStats {
  /** Cuadros por segundo que entrega la cámara (null si el navegador no lo informa). */
  cameraFps: number | null;
  /** Milisegundos promedio que tarda MediaPipe en procesar un cuadro. */
  detectMs: number;
  width: number;
  height: number;
}

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta?: { presentedFrames?: number }) => void) => number;
  cancelVideoFrameCallback?: (h: number) => void;
};

/**
 * Carga MediaPipe (GPU, con reintento en CPU) y procesa cada cuadro del video:
 * `requestVideoFrameCallback` si existe, si no `requestAnimationFrame` saltando cuadros repetidos.
 * Por cada cuadro llama `onFrame` con el payload del contrato WebSocket. El estado de React
 * solo cambia una vez por segundo (fps), nunca por cuadro.
 *
 * `paused` (opcional): detiene el bucle por cuadro sin descargar el modelo ni cerrar la cámara;
 * al volver a `false` el bucle arranca de nuevo sobre el `<video>` vigente.
 */
export function useVision(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  ready: boolean,
  onFrame: (f: FramePayload) => void,
  gloves: () => FramePayload["gloves"],
  base = "/mediapipe",
  paused = false,
): VisionHandle {
  const [vision, setVision] = useState<Vision | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [delegate, setDelegate] = useState<Delegate | null>(null);
  const [stats, setStats] = useState<VisionStats | null>(null);

  const onFrameRef = useRef(onFrame);
  const glovesRef = useRef(gloves);
  onFrameRef.current = onFrame;
  glovesRef.current = gloves;
  const visionRef = useRef<Vision | null>(null);

  // Carga del modelo: GPU primero; si la inicialización lanza, CPU.
  useEffect(() => {
    let cancelled = false;
    let created: Vision | null = null;
    setLoading(true);
    setError(null);
    (async () => {
      let d: Delegate = "GPU";
      try {
        created = await createVision(base, "GPU");
      } catch (gpuErr) {
        console.warn("MediaPipe: la GPU no está disponible, se usa CPU.", gpuErr);
        if (cancelled) return;
        try {
          d = "CPU";
          created = await createVision(base, "CPU");
        } catch (cpuErr) {
          console.error("MediaPipe: no se pudo inicializar.", cpuErr);
          if (!cancelled) {
            setError("No se pudo cargar el modelo de visión. Recarga la página; si sigue fallando, revisa que la carpeta mediapipe esté instalada.");
            setLoading(false);
          }
          return;
        }
      }
      if (cancelled) {
        created.close();
        return;
      }
      visionRef.current = created;
      setVision(created);
      setDelegate(d);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
      created?.close();
      visionRef.current = null;
      setVision(null);
    };
  }, [base]);

  // Bucle por cuadro. Sigue al `<video>` vivo de `videoRef` en cada paso: si la pantalla
  // vuelve a montar CameraView, el bucle pasa al elemento nuevo sin reiniciarse.
  useEffect(() => {
    if (!ready || !vision || paused) return;
    let stopped = false;
    let handle = 0;
    let scheduledOn: VideoWithRvfc | null = null;
    let usedRvfc = false;
    let lastVideo: HTMLVideoElement | null = null;
    let lastTs = -1;
    let lastMediaTime = -1;
    let failures = 0;
    const meter = new FpsMeter();
    // Rendimiento: cuadros que presenta la cámara (presentedFrames de rVFC) y tiempo de MediaPipe.
    let camStart: { t: number; frames: number } | null = null;
    let camLast: { t: number; frames: number } | null = null;
    let detectSum = 0;
    let detectN = 0;

    const schedule = () => {
      const v = videoRef.current as VideoWithRvfc | null;
      scheduledOn = v;
      usedRvfc = !!v && typeof v.requestVideoFrameCallback === "function";
      handle = usedRvfc ? v!.requestVideoFrameCallback!(step) : requestAnimationFrame(step);
    };

    function step(_now?: number, meta?: { presentedFrames?: number }) {
      if (stopped) return;
      if (meta?.presentedFrames !== undefined) {
        camLast = { t: performance.now(), frames: meta.presentedFrames };
        if (!camStart) camStart = camLast;
      }
      const video = videoRef.current;
      if (video !== lastVideo) {
        lastVideo = video;
        lastMediaTime = -1;
      }
      // Con rVFC cada llamada es un cuadro nuevo del mismo elemento; con rAF se saltan los repetidos.
      const fresh = !!video && ((usedRvfc && video === scheduledOn) || video.currentTime !== lastMediaTime);
      if (video && fresh && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        lastMediaTime = video.currentTime;
        const now = performance.now();
        lastTs = monotonic(lastTs, now);
        try {
          const t0 = performance.now();
          const frame = vision!.detect(video, lastTs, glovesRef.current());
          detectSum += performance.now() - t0;
          detectN++;
          failures = 0;
          onFrameRef.current(frame);
          const f = meter.tick(now);
          if (f !== null) {
            setFps(f);
            const dt = camStart && camLast ? camLast.t - camStart.t : 0;
            setStats({
              cameraFps: camStart && camLast && dt > 0 ? Math.round(((camLast.frames - camStart.frames) * 1000) / dt) : null,
              detectMs: detectN ? Math.round(detectSum / detectN) : 0,
              width: video.videoWidth,
              height: video.videoHeight,
            });
            camStart = camLast;
            detectSum = 0;
            detectN = 0;
          }
        } catch (err) {
          failures++;
          if (failures === 1) console.error("MediaPipe: error al procesar un cuadro.", err);
          if (failures >= 30) {
            setError("La detección de manos dejó de funcionar. Recarga la página.");
            return;
          }
        }
      }
      schedule();
    }

    schedule();
    return () => {
      stopped = true;
      if (usedRvfc) scheduledOn?.cancelVideoFrameCallback?.(handle);
      else cancelAnimationFrame(handle);
      setFps(null);
      setStats(null);
    };
  }, [ready, vision, videoRef, paused]);

  const lastHands = useCallback((): HandPoints => visionRef.current?.lastHands() ?? [], []);
  const lastBody = useCallback((): BodyPoints => visionRef.current?.lastBody() ?? NO_BODY, []);

  return { loading, error, fps, delegate, lastHands, lastBody, stats };
}
