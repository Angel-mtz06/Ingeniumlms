import { useEffect, useState, type ReactNode } from "react";
import { type GloveState, statusAnnouncement } from "../lib/ui";
import { IconCamera, IconConnection, IconGlove, ToneIcon } from "./icons";
import "./components.css";

export type CameraStatus = "ready" | "loading" | "error" | "off";
type ItemTone = "ok" | "warn" | "bad" | "off";

export interface StatusBarProps {
  camera: CameraStatus;
  gloves: { L: GloveState; R: GloveState; supported?: boolean };
  connected: boolean;
  fps: number | null;
  /** La visión está en pausa porque la pantalla no usa la cámara: se muestra "en pausa" en vez de FPS. */
  paused?: boolean;
}

const CAMERA_TEXT: Record<CameraStatus, [string, ItemTone]> = {
  off: ["apagada", "off"],
  ready: ["lista", "ok"],
  loading: ["abriendo", "warn"],
  error: ["sin acceso", "bad"],
};

function gloveText(g: GloveState, supported: boolean): [string, ItemTone] {
  if (!supported) return ["no disponible", "off"];
  if (!g.connected) return ["sin conectar", "off"];
  return g.stale ? ["sin datos", "warn"] : ["conectado", "ok"];
}

/** Retraso del anuncio a lectores de pantalla: un cambio debe durar ≥ 1 s para anunciarse. */
const ANNOUNCE_DELAY_MS = 1200;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
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
 * ícono con forma propia y texto; el color solo refuerza. A lectores de pantalla solo se anuncian
 * cambios de conexión (no el parpadeo "sin datos" de los guantes ni los FPS), y solo si duran ≥ 1 s.
 */
export function StatusBar({ camera, gloves, connected, fps, paused = false }: StatusBarProps) {
  const supported = gloves.supported ?? true;
  const [camText, camTone] = CAMERA_TEXT[camera];
  const [rText, rTone] = gloveText(gloves.R, supported);
  const [lText, lTone] = gloveText(gloves.L, supported);
  const announcement = useDebounced(statusAnnouncement({ camera, gloves, connected }), ANNOUNCE_DELAY_MS);
  return (
    <div className="status-bar">
      <ul className="status-bar__list" aria-label="Estado del sistema">
        <Item icon={<IconCamera />} label="Cámara" value={camText} tone={camTone} />
        {/* Izquierdo antes que derecho, igual que la cámara en espejo y los paneles de guantes. */}
        <Item icon={<IconGlove style={{ transform: "scaleX(-1)" }} />} label="Guante izquierdo" value={lText} tone={lTone} />
        <Item icon={<IconGlove />} label="Guante derecho" value={rText} tone={rTone} />
        <Item icon={<IconConnection />} label="Servidor" value={connected ? "conectado" : "sin conexión"} tone={connected ? "ok" : "bad"} />
      </ul>
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
      <p className="status-bar__fps">
        <abbr title="cuadros por segundo">FPS</abbr> <span className="tabular">{fps ?? (paused ? "en pausa" : "…")}</span>
      </p>
    </div>
  );
}
