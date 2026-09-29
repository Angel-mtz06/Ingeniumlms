import { useEffect, useMemo, useRef, useState } from "react";
import { cameraErrorMessage, trackedRef } from "../lib/ui";

export interface CameraHandle {
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  ready: boolean;
  active: boolean;
  error: string | null;
}

const CONSTRAINTS: MediaStreamConstraints = {
  // 960×540 a 30 fps: muchas webcams de laptop bajan a 15 fps en 720p, y MediaPipe reduce la imagen de todos modos.
  video: { width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 30 }, facingMode: "user" },
  audio: false,
};

/**
 * Abre la cámara frontal mientras hay una vista de video y la conecta al `<video>` que tenga `videoRef`
 * en cada momento: si la pantalla vuelve a montar CameraView, el nuevo `<video>` recibe el mismo
 * stream (videoRef avisa cuando React cambia el elemento). `ready` = hay un `<video>` montado
 * reproduciendo con dimensiones. El video se entrega sin espejo (el espejo es solo visual).
 */
export function useCamera(): CameraHandle {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const videoRef = useMemo(() => trackedRef<HTMLVideoElement>(setVideo) as React.MutableRefObject<HTMLVideoElement | null>, []);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<Promise<void>>(Promise.resolve());
  const enabled = video !== null;

  // 1) Un stream compartido mientras existe una vista de video.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let acquired: MediaStream | null = null;
    // Serialize permission requests, including a quick exit/re-entry or StrictMode.
    pending.current = pending.current.then(async () => {
      if (cancelled) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Este navegador no permite usar la cámara. Abre la aplicación en Edge o Chrome desde localhost o https.");
        return;
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
        if (cancelled) {
          // La limpieza ya corrió mientras se esperaba el permiso (StrictMode o desmontaje): no dejar la cámara encendida.
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        acquired = s;
        setError(null);
        setStream(s);
      } catch (err) {
        if (!cancelled) setError(cameraErrorMessage(err));
      }
    });
    return () => {
      cancelled = true;
      acquired?.getTracks().forEach((t) => t.stop());
      setStream(null);
    };
  }, [enabled]);

  // 2) Conectar el stream al `<video>` montado ahora (se repite si el elemento cambia).
  useEffect(() => {
    if (!video || !stream) return;
    let cancelled = false;
    video.muted = true;
    video.playsInline = true;
    if (video.srcObject !== stream) video.srcObject = stream;
    let metadataReady: (() => void) | null = null;
    (async () => {
      if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
        await new Promise<void>((resolve) => {
          metadataReady = () => resolve();
          video.addEventListener("loadedmetadata", metadataReady, { once: true });
        });
      }
      if (cancelled) return;
      try {
        await video.play();
      } catch (err) {
        // AbortError: el elemento se desmontó o cambió de fuente a mitad de play(); no es un fallo.
        const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
        if (!cancelled && name !== "AbortError") setError(cameraErrorMessage(err));
        return;
      }
      if (!cancelled) setPlaying(true);
    })();
    return () => {
      cancelled = true;
      if (metadataReady) {
        video.removeEventListener("loadedmetadata", metadataReady);
        metadataReady();
      }
      setPlaying(false);
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [video, stream]);

  return { videoRef, ready: playing && !!video && !!stream, active: enabled, error };
}
