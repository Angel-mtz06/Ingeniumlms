import type { ReactNode } from "react";
import { CameraView } from "../components/CameraView";
import { WristLevel } from "../components/WristLevel";
import { GloveGate, useApp, useGlovesReady } from "./shared";

/**
 * Como `CameraStage` (shared.tsx), pero con los medidores de las pantallas de trabajo: FPS en la
 * esquina superior izquierda y, opcionalmente, algo en la superior derecha (el puntaje en Práctica). Solo dibuja
 * las manos: la cara y el torso se siguen detectando (filtran manos falsas y dan la zona de los consejos), pero
 * solo se dibujan en Calibración.
 */
export function LiveCamera({ corner, children }: { corner?: ReactNode; children?: ReactNode }) {
  const { camera, vision, gloves } = useApp();
  // Sin las dos pulseras no se monta el video: la cámara y MediaPipe no se encienden (rúbrica).
  if (!useGlovesReady()) return <GloveGate />;
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
      gauge={<WristLevel read={gloves.latest} />}
    >
      {children}
    </CameraView>
  );
}
