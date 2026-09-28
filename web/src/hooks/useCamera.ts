import { useEffect, useRef, useState } from "react";
import { cameraErrorMessage } from "../lib/ui";

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
 * Abre la cámara frontal (1280×720) y la conecta al `<video>` de `videoRef`.
 * `ready` pasa a true cuando el video ya tiene dimensiones y está reproduciendo.
 * El video se entrega sin espejo (el espejo es solo visual, en CameraView).
 */
export function useCamera(): CameraHandle {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Este navegador no permite usar la cámara. Abre la aplicación en Edge o Chrome desde localhost o https.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
        if (cancelled) return;
        const video = videoRef.current;
        if (!video) {
          setError("No se encontró el área de video en la pantalla.");
          return;
        }
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
          await new Promise<void>((resolve) => video.addEventListener("loadedmetadata", () => resolve(), { once: true }));
        }
        await video.play();
        if (cancelled) return;
        setError(null);
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        setReady(false);
        setError(cameraErrorMessage(err));
      }
    };
    void start();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      const video = videoRef.current;
      if (video && video.srcObject === stream) video.srcObject = null;
      setReady(false);
    };
  }, []);

  return { videoRef, ready, error };
}
