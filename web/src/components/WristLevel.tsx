import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { FramePayload } from "../lib/protocol";
import { parseGloveLine } from "../lib/diagnostics";

type Side = "L" | "R";
const SIDES: readonly Side[] = ["R", "L"];
const SIDE_SHORT: Record<Side, string> = { R: "Der.", L: "Izq." };
const SIDE_NAME: Record<Side, string> = { R: "derecha", L: "izquierda" };
const REFRESH_MS = 100;
/** Grados que llenan media barra (0 al centro, ±FULL_TILT en los extremos). */
const FULL_TILT = 90;

export interface WristReading {
  /** Inclinación arriba/abajo (grados, 0 = plana sobre la mesa al calibrar). */
  pitch: number;
  /** Inclinación de lado (grados, 0 = plana sobre la mesa al calibrar). */
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

/** Fracción de media barra: −1 (todo a la izquierda) … 1 (todo a la derecha). */
export function tiltFraction(deg: number): number {
  return Math.max(-1, Math.min(1, deg / FULL_TILT));
}

const AXES = [
  { key: "pitch", label: "Arriba / abajo", glyph: "↕" },
  { key: "roll", label: "De lado", glyph: "↔" },
] as const;
const OPEN_KEY = "lsm.inclinacion.abierta";

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Barras de inclinación: cada una parte del centro (la mesa donde se calibró = 0°) y crece hacia el lado de la
 * inclinación. Con `values` se dibujan con React; sin ellos quedan vacías y WristLevel las actualiza en el DOM.
 * `compact`: en vez del nombre de la barra, una flecha (↕ arriba/abajo, ↔ de lado).
 */
function TiltRows({ values, compact = false }: { values?: { pitch: number; roll: number }; compact?: boolean }) {
  return (
    <div className="tilt__rows">
      {AXES.map(({ key, label, glyph }) => {
        const v = values?.[key];
        const style = v === undefined ? undefined : ({ "--v": tiltFraction(v).toFixed(3) } as CSSProperties);
        return (
          <div key={key} className="tilt__row" data-axis={key} style={style}>
            {compact ? (
              <span className="tilt__label tilt__label--glyph" title={label}>
                <span aria-hidden="true">{glyph}</span>
                <span className="visually-hidden">{label}</span>
              </span>
            ) : (
              <span className="tilt__label">{label}</span>
            )}
            <span className="tilt__track" aria-hidden="true">
              <span className="tilt__fill" />
            </span>
            <span className="tilt__value tabular">{v === undefined ? "…" : formatTilt(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Barras de inclinación dibujadas con React (pantalla Diagnóstico). */
export function TiltBars({ pitch, roll }: { pitch: number; roll: number }) {
  return (
    <div className="tilt tilt--inline" role="group" aria-label="Inclinación de la muñeca">
      <TiltRows values={{ pitch, roll }} />
    </div>
  );
}

/**
 * Inclinación de la muñeca en la esquina inferior izquierda de la cámara, por cada pulsera con datos: dos barras
 * (arriba/abajo y de lado) que parten del 0 de la mesa donde se calibró, con los grados. Compacta por defecto (las
 * pulseras una junto a otra, barras cortas con flechas); el botón «Inclinación» la despliega con los nombres y barras
 * largas, y se recuerda en este navegador. Los valores cambian 10 veces por segundo y se escriben directo en el DOM;
 * React solo re-renderiza cuando aparece o desaparece una pulsera o se despliega.
 */
export function WristLevel({ read }: { read: () => FramePayload["gloves"] }) {
  const [present, setPresent] = useState<Record<Side, boolean>>({ L: false, R: false });
  const [open, setOpen] = useState(readOpen);
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(OPEN_KEY, o ? "0" : "1");
      } catch {
        /* sin almacenamiento: dura esta visita */
      }
      return !o;
    });
  };
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
        for (const { key } of AXES) {
          const row = el.querySelector<HTMLElement>(`[data-axis="${key}"]`);
          if (!row) continue;
          row.style.setProperty("--v", tiltFraction(w[key]).toFixed(3));
          const value = row.querySelector(".tilt__value");
          const text = formatTilt(w[key]);
          if (value && value.textContent !== text) value.textContent = text;
        }
      }
      setPresent((p) => (p.L === next.L && p.R === next.R ? p : next));
    };
    tick();
    const id = window.setInterval(tick, REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  if (!present.L && !present.R) return null;
  return (
    <div className="tilt" data-open={open}>
      <button type="button" className="tilt__toggle" aria-expanded={open} aria-controls="tilt-cards" onClick={toggle}>
        Inclinación
        <span className="tilt__caret" aria-hidden="true" />
      </button>
      <div id="tilt-cards" className="tilt__cards">
        {SIDES.filter((s) => present[s]).map((side) => (
          <div key={side} ref={(el) => { nodes.current[side] = el; }} className="tilt__card" role="group"
            aria-label={`Inclinación de la muñeca ${SIDE_NAME[side]}`}>
            <p className="tilt__title">{open ? `Muñeca ${SIDE_NAME[side]}` : SIDE_SHORT[side]}</p>
            <TiltRows compact={!open} />
          </div>
        ))}
      </div>
    </div>
  );
}
