import type { ReactNode } from "react";
import { CameraView } from "../components/CameraView";
import { useApp } from "./shared";

/**
 * Como `CameraStage` (shared.tsx), pero con los medidores de las pantallas de trabajo: FPS en la
 * esquina superior izquierda y, opcionalmente, algo en la superior derecha (el puntaje en Práctica).
 */
export function LiveCamera({ corner, children }: { corner?: ReactNode; children?: ReactNode }) {
  const { camera, vision } = useApp();
  return (
    <CameraView
      videoRef={camera.videoRef}
      hands={vision.lastHands}
      loading={!camera.error && !vision.error && (!camera.ready || vision.loading)}
      error={camera.error ?? vision.error}
      fps={vision.fps}
      fpsDetail={
        vision.stats
          ? `cámara ${vision.stats.cameraFps ?? "?"} · ${vision.stats.detectMs} ms · ${vision.stats.width}×${vision.stats.height}`
          : null
      }
      corner={corner}
    >
      {children}
    </CameraView>
  );
}
