import { useEffect, useMemo, useRef, useState } from "react";
import { useThemeColors } from "../hooks/useThemeColors";
import { fitBounds, glossLabel, HAND_CONNECTIONS, referenceBounds, referencePosition } from "../lib/ui";
import { IconError, IconPause, IconPlay } from "./icons";
import "./components.css";

export interface ReferencePlayerProps {
  gloss: string;
  /** Espejo visual, igual que la cámara: la mano derecha del modelo aparece del mismo lado que la tuya. */
  mirrored?: boolean;
}

type P3 = (number | null)[] | null;
interface ReferenceData {
  gloss: string;
  example_hands: P3[][][]; // T × 2 × 21 × 3 (unidades de cabeza, origen en el centro de la cabeza)
  example_present: (boolean | null)[][] | null;
  n_samples: number;
}

type Load = { state: "loading" } | { state: "missing" } | { state: "error" } | { state: "ok"; data: ReferenceData };

const SPEEDS = [
  { value: 1, label: "Normal", short: "1×" },
  { value: 0.5, label: "Lenta", short: "0.5×" },
] as const;

const HEAD = { rx: 0.5, ry: 0.65 };
const REF_COLOR_VARS = ["--color-accent", "--color-text", "--color-border"] as const;

function point(frames: P3[][][], t: number, s: number, j: number): [number, number] | null {
  const p = frames[t]?.[s]?.[j];
  if (!p || p[0] == null || p[1] == null || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
  return [p[0], p[1]];
}

function isPresent(d: ReferenceData, t: number, s: number): boolean {
  return d.example_present?.[t]?.[s] !== false && !!d.example_hands[t]?.[s];
}

/**
 * Reproduce en bucle la seña de referencia (`example_hands`, 16 cuadros) en un lienzo,
 * interpolando entre cuadros, con pausa breve al final de cada vuelta y velocidad 1× o 0.5×.
 * Es una animación esencial: sigue activa con movimiento reducido (no tiene adornos).
 */
export function ReferencePlayer({ gloss, mirrored = true }: ReferencePlayerProps) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<number>(1);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Tiempo de animación acumulado: cambiar la velocidad o pausar no hace saltar la figura.
  const clock = useRef({ elapsed: 0, last: 0 });
  const colors = useThemeColors(canvasRef, REF_COLOR_VARS);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoad({ state: "loading" });
    clock.current = { elapsed: 0, last: 0 };
    fetch(`/api/reference/${encodeURIComponent(gloss)}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (r.status === 404) return setLoad({ state: "missing" });
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as ReferenceData;
        if (!Array.isArray(data.example_hands) || data.example_hands.length === 0) return setLoad({ state: "missing" });
        setLoad({ state: "ok", data });
      })
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) {
          console.error("No se pudo cargar la referencia", err);
          setLoad({ state: "error" });
        }
      });
    return () => ctrl.abort();
  }, [gloss]);

  const data = load.state === "ok" ? load.data : null;
  const bounds = useMemo(() => (data ? referenceBounds(data.example_hands as never, data.example_present, HEAD) : null), [data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || !bounds) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const frames = data.example_hands;
    const T = frames.length;
    let raf = 0;

    const draw = (now: number) => {
      const c = clock.current;
      if (c.last === 0) c.last = now;
      if (playing) c.elapsed += (now - c.last) * speed;
      c.last = now;

      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (w === 0 || h === 0) {
        raf = requestAnimationFrame(draw);
        return;
      }
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const palette = colors.get();
      const accent = palette?.["--color-accent"] ?? "";
      const text = palette?.["--color-text"] ?? "";
      const guide = palette?.["--color-border"] ?? "";
      const { scale, ox, oy } = fitBounds(bounds, w, h);
      const X = (x: number) => ox + x * scale;
      const Y = (y: number) => oy + y * scale;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (mirrored) ctx.setTransform(-1, 0, 0, 1, w, 0);

      // Cabeza de referencia (da el contexto de ubicación).
      ctx.setLineDash([6 * dpr, 6 * dpr]);
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = guide;
      ctx.beginPath();
      ctx.ellipse(X(0), Y(0), HEAD.rx * scale, HEAD.ry * scale, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      const pos = referencePosition(c.elapsed, T, 1);
      const t0 = Math.floor(pos);
      const t1 = Math.min(T - 1, t0 + 1);
      const k = pos - t0;

      for (let s = 0; s < 2; s++) {
        const a = isPresent(data, t0, s);
        const b = isPresent(data, t1, s);
        if (!a && !b) continue;
        // Si la mano solo existe en uno de los dos cuadros, se usa ese sin interpolar.
        const ta = a ? t0 : t1;
        const tb = b ? t1 : t0;
        const pts: ([number, number] | null)[] = [];
        for (let j = 0; j < 21; j++) {
          const p = point(frames, ta, s, j);
          const q = point(frames, tb, s, j);
          pts.push(p && q ? [X(p[0] + (q[0] - p[0]) * k), Y(p[1] + (q[1] - p[1]) * k)] : p ? [X(p[0]), Y(p[1])] : null);
        }
        // Slot 0 = mano derecha del signante (acento); slot 1 = izquierda (tinta).
        const color = s === 0 ? accent : text;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = 3 * dpr;
        ctx.beginPath();
        for (const [i, j] of HAND_CONNECTIONS) {
          const p = pts[i];
          const q = pts[j];
          if (!p || !q) continue;
          ctx.moveTo(p[0], p[1]);
          ctx.lineTo(q[0], q[1]);
        }
        ctx.stroke();
        for (const p of pts) {
          if (!p) continue;
          ctx.beginPath();
          ctx.arc(p[0], p[1], 3.5 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(draw);
    };

    clock.current.last = 0;
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [data, bounds, playing, speed, mirrored, colors]);

  const label = glossLabel(gloss);

  return (
    <figure className="ref">
      <div className="ref__stage">
        {load.state === "ok" ? (
          <canvas ref={canvasRef} className="ref__canvas" role="img" aria-label={`Animación de referencia de la seña ${label}`} />
        ) : load.state === "loading" ? (
          <div className="ref__notice" role="status">
            <span className="skeleton skeleton--stage" />
            <span className="visually-hidden">Cargando la referencia…</span>
          </div>
        ) : (
          <div className="ref__notice" role="alert">
            <IconError size={32} />
            <p>
              {load.state === "missing"
                ? `La seña ${label} todavía no tiene referencia.`
                : "No se pudo cargar la referencia. Revisa que el servidor esté encendido."}
            </p>
          </div>
        )}
      </div>

      <figcaption className="ref__bar">
        <span className="ref__title">
          Referencia: <strong translate="no">{label}</strong>
        </span>
        <div className="ref__controls">
          <button
            type="button"
            className="btn btn--secondary btn--icon"
            onClick={() => setPlaying((p) => !p)}
            disabled={load.state !== "ok"}
            aria-label={playing ? "Pausar referencia" : "Reproducir referencia"}
          >
            {playing ? <IconPause /> : <IconPlay />}
            <span aria-hidden="true">{playing ? "Pausar" : "Reproducir"}</span>
          </button>
          <div className="segmented" role="group" aria-label="Velocidad">
            {SPEEDS.map((s) => (
              <button
                key={s.value}
                type="button"
                className="segmented__item"
                aria-pressed={speed === s.value}
                onClick={() => setSpeed(s.value)}
                disabled={load.state !== "ok"}
              >
                {s.label} <span className="tabular">{s.short}</span>
              </button>
            ))}
          </div>
        </div>
      </figcaption>
    </figure>
  );
}
