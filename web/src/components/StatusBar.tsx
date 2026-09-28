import type { ReactNode } from "react";
import type { GloveState } from "../lib/ui";
import { IconCamera, IconConnection, IconGlove, ToneIcon } from "./icons";
import "./components.css";

export type CameraStatus = "ready" | "loading" | "error";
type ItemTone = "ok" | "warn" | "bad" | "off";

export interface StatusBarProps {
  camera: CameraStatus;
  gloves: { L: GloveState; R: GloveState; supported?: boolean };
  connected: boolean;
  fps: number | null;
}

const CAMERA_TEXT: Record<CameraStatus, [string, ItemTone]> = {
  ready: ["lista", "ok"],
  loading: ["abriendo", "warn"],
  error: ["sin acceso", "bad"],
};

function gloveText(g: GloveState, supported: boolean): [string, ItemTone] {
  if (!supported) return ["no disponible", "off"];
  if (!g.connected) return ["sin conectar", "off"];
  return g.stale ? ["sin datos", "warn"] : ["conectado", "ok"];
}

function Item({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: ItemTone }) {
  return (
    <li className="status-item" data-tone={tone}>
      <span className="status-item__icon">{icon}</span>
      <span className="status-item__label">{label}</span>
      <span className="status-item__value">
        {tone === "off" ? null : <ToneIcon tone={tone} size={16} />}
        {value}
      </span>
    </li>
  );
}

/**
 * Barra de estado: cámara, guante derecho e izquierdo, servidor y FPS. Cada estado lleva
 * ícono con forma propia y texto; el color solo refuerza. Los cambios se anuncian con cortesía,
 * los FPS no (cambian cada segundo).
 */
export function StatusBar({ camera, gloves, connected, fps }: StatusBarProps) {
  const supported = gloves.supported ?? true;
  const [camText, camTone] = CAMERA_TEXT[camera];
  const [rText, rTone] = gloveText(gloves.R, supported);
  const [lText, lTone] = gloveText(gloves.L, supported);
  return (
    <div className="status-bar">
      <ul className="status-bar__list" aria-label="Estado del sistema" aria-live="polite">
        <Item icon={<IconCamera />} label="Cámara" value={camText} tone={camTone} />
        <Item icon={<IconGlove />} label="Guante derecho" value={rText} tone={rTone} />
        <Item icon={<IconGlove style={{ transform: "scaleX(-1)" }} />} label="Guante izquierdo" value={lText} tone={lTone} />
        <Item icon={<IconConnection />} label="Servidor" value={connected ? "conectado" : "sin conexión"} tone={connected ? "ok" : "bad"} />
      </ul>
      <p className="status-bar__fps">
        <abbr title="cuadros por segundo">FPS</abbr> <span className="tabular">{fps ?? "…"}</span>
      </p>
    </div>
  );
}
