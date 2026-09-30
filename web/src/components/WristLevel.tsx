import { useEffect, useRef, useState } from "react";
import type { FramePayload } from "../lib/protocol";
import { parseGloveLine } from "../lib/diagnostics";

type Side = "L" | "R";
const SIDES: readonly Side[] = ["R", "L"];
const SIDE_NAME: Record<Side, string> = { R: "derecha", L: "izquierda" };
const REFRESH_MS = 100;
/** Grados que llevan la burbuja al borde del nivel. */
const FULL_TILT = 90;
/** °/s a partir de los que la muñeca cuenta como en movimiento (el ruido quieto ronda 1–3 °/s tras calibrar). */
const MOVING = 15;
/** °/s que llenan la barra de velocidad. */
const FULL_SPEED = 300;

export interface WristReading {
  pitch: number;
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

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Nivel de la muñeca sobre la cámara, por cada pulsera con datos: burbuja (inclinación y giro lateral respecto a la
 * gravedad), los dos ángulos y la velocidad de giro. Los valores cambian 10 veces por segundo y se escriben directo
 * en el DOM; React solo re-renderiza cuando aparece o desaparece una pulsera.
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
        const x = clamp(w.roll / FULL_TILT, -1, 1);
        const y = clamp(-w.pitch / FULL_TILT, -1, 1);
        el.style.setProperty("--bubble-x", x.toFixed(3));
        el.style.setProperty("--bubble-y", y.toFixed(3));
        const moving = w.speed >= MOVING;
        // Quieta: la barra desaparece (el ruido de 1–3 °/s no se dibuja).
        el.style.setProperty("--speed", moving ? clamp(w.speed / FULL_SPEED, 0, 1).toFixed(3) : "0");
        el.dataset.moving = String(moving);
        const set = (k: string, text: string) => {
          const n = el.querySelector(`[data-v="${k}"]`);
          if (n && n.textContent !== text) n.textContent = text;
        };
        set("pitch", `${Math.round(w.pitch)}°`);
        set("roll", `${Math.round(w.roll)}°`);
        set("speed", w.speed >= MOVING ? `${Math.round(w.speed)} °/s` : "quieta");
      }
      setPresent((p) => (p.L === next.L && p.R === next.R ? p : next));
    };
    tick();
    const id = window.setInterval(tick, REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  if (!present.L && !present.R) return null;
  return (
    <div className="wrist">
      {SIDES.filter((s) => present[s]).map((side) => (
        <div key={side} ref={(el) => { nodes.current[side] = el; }} className="wrist__card" role="group"
          aria-label={`Nivel de la muñeca ${SIDE_NAME[side]}`}>
          <p className="wrist__title">Muñeca {side === "R" ? "der." : "izq."}</p>
          <span className="wrist__level" aria-hidden="true">
            <span className="wrist__bubble" />
          </span>
          <dl className="wrist__values">
            <div>
              <dt>Inclinación</dt>
              <dd className="tabular" data-v="pitch">…</dd>
            </div>
            <div>
              <dt>Giro</dt>
              <dd className="tabular" data-v="roll">…</dd>
            </div>
            <div>
              <dt>Velocidad</dt>
              <dd className="tabular" data-v="speed">…</dd>
            </div>
          </dl>
          <span className="wrist__speed" aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}
