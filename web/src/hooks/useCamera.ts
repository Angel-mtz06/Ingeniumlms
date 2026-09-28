import { useEffect, useMemo, useState } from "react";
import { cameraErrorMessage, trackedRef } from "../lib/ui";

export interface CameraHandle {
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  ready: boolean;
  error: string | null;
}

const CONSTRAINTS: MediaStreamConstraints = {
  video: { width: 1280, height: 720, facingMode: "user" },
  audio: false,
};

/**
 * Abre la cámara frontal (1280×720) una vez y la conecta al `<video>` que tenga `videoRef`
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

  // 1) Pedir la cámara una sola vez por dueño del hook.
  useEffect(() => {
    let cancelled = false;
    let acquired: MediaStream | null = null;
    (async () => {
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
    })();
    return () => {
      cancelled = true;
      acquired?.getTracks().forEach((t) => t.stop());
      setStream(null);
    };
  }, []);

  // 2) Conectar el stream al `<video>` montado ahora (se repite si el elemento cambia).
  useEffect(() => {
    if (!video || !stream) return;
    let cancelled = false;
    video.muted = true;
    video.playsInline = true;
    if (video.srcObject !== stream) video.srcObject = stream;
    (async () => {
      if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
        await new Promise<void>((resolve) => video.addEventListener("loadedmetadata", () => resolve(), { once: true }));
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
      setPlaying(false);
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [video, stream]);

  return { videoRef, ready: playing && !!video && !!stream, error };
}
