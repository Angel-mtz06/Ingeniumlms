import { useEffect, useRef, useState } from "react";
import type { FramePayload } from "../lib/protocol";
import { parseGloveLine } from "../lib/diagnostics";

type Side = "L" | "R";
const SIDES: readonly Side[] = ["R", "L"];
const SIDE_NAME: Record<Side, string> = { R: "derecha", L: "izquierda" };
const REFRESH_MS = 100;
/**
 * Sentido del eje en pantalla: 1 = gira como el giro lateral que manda la pulsera, -1 = al revés. Si en la cámara
 * el eje se inclina hacia el lado contrario que la mano, se cambia aquí.
 */
const AXIS_SIGN = 1;

export interface WristReading {
  /** Inclinación (grados, 0 = plana sobre la mesa al calibrar). */
  pitch: number;
  /** Giro lateral (grados, 0 = plana sobre la mesa al calibrar). */
  roll: number;
  /** Velocidad de giro total (°/s). */
  speed: number;
}

/** Lectura de la IMU de la muñeca (la 0 de la línea D); null sin línea fresca o si la IMU no responde. */
export function readWrist(line: string | null | undefined): WristReading | null {
  const d = parseGloveLine(line);
  if (!d || !d.imuOk[0]) return null;
  const [gx, gy, gz] = d.gyro;
  return { pitch: d.pitch[0], roll: d.roll[0], speed: Math.hypot(gx, gy, gz) };
}

/** "−12°" con signo menos tipográfico. */
export function formatTilt(deg: number): string {
  const n = Math.round(deg);
  return `${n < 0 ? "−" : ""}${Math.abs(n)}°`;
}

/**
 * Eje de inclinación de la muñeca en la parte de abajo de la cámara, por cada pulsera con datos: una línea que gira
 * con el giro lateral de la muñeca sobre una referencia horizontal (la mesa donde se calibró) y los grados. Los valores
 * cambian 10 veces por segundo y se escriben directo en el DOM; React solo re-renderiza cuando aparece o desaparece
 * una pulsera.
 */
export function WristLevel({ read }: { read: () => FramePayload["gloves"] }) {
  const [present, setPresent] = useState<Record<Side, boolean>>({ L: false, R: false });
  const readRef = useRef(read);
  readRef.current = read;
  const nodes = useRef<Partial<Record<Side, HTMLDivElement | null>>>({});

  useEffect(() => {
    const tick = () => {
      const lines = readRef.current();
      const next: Record<Side, boolean> = { L: false, R: false };
      for (const side of SIDES) {
        const w = readWrist(lines[side]);
        next[side] = w !== null;
        const el = nodes.current[side];
        if (!w || !el) continue;
        const deg = Math.max(-90, Math.min(90, w.roll)) * AXIS_SIGN;
        el.style.setProperty("--tilt", `${deg.toFixed(1)}deg`);
        const label = el.querySelector("[data-v]");
        const text = formatTilt(w.roll);
        if (label && label.textContent !== text) label.textContent = text;
      }
      setPresent((p) => (p.L === next.L && p.R === next.R ? p : next));
    };
    tick();
    const id = window.setInterval(tick, REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  if (!present.L && !present.R) return null;
  const both = present.L && present.R;
  return (
    <div className="tilt">
      {SIDES.filter((s) => present[s]).map((side) => (
        <div key={side} ref={(el) => { nodes.current[side] = el; }} className="tilt__item" role="group"
          aria-label={`Inclinación de la muñeca ${SIDE_NAME[side]}`}>
          <span className="tilt__axis" aria-hidden="true">
            <span className="tilt__line" />
          </span>
          <span className="tilt__value">
            {both ? <span className="tilt__side">{side === "R" ? "Der." : "Izq."}</span> : null}
            <span className="tabular" data-v>…</span>
          </span>
        </div>
      ))}
    </div>
  );
}
