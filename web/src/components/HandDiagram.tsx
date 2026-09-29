import { useId } from "react";
import { fingerLabel, fingerSummary, fingerTone, fiveFingers, type FingerTone } from "../lib/ui";
import "./components.css";

export interface HandDiagramProps {
  /** 5 valores (pulgar → meñique): −1 sin uso, 0 bien, 1 regular, 2 mal. */
  fingers: number[];
  side: "derecha" | "izquierda";
  /** Título visible en lugar de "Mano derecha/izquierda" (p. ej. cuando no se sabe qué mano es). */
  caption?: string;
}

/*
 * Mano vista por el dorso, como la persona ve su propia mano al señar hacia la cámara:
 * la derecha tiene el pulgar a la izquierda; la izquierda se dibuja en espejo.
 * Orden de FINGERS = pulgar, índice, medio, anular, meñique (el mismo del contrato).
 */
const FINGERS = [
  { x: 20, y: 68, w: 15, h: 50, r: 7.5, rotate: "rotate(-38 28 118)" },
  { x: 30, y: 20, w: 15, h: 54, r: 7.5 },
  { x: 48, y: 10, w: 15, h: 64, r: 7.5 },
  { x: 66, y: 16, w: 15, h: 58, r: 7.5 },
  { x: 84, y: 32, w: 13, h: 44, r: 6.5 },
] as const;

/**
 * Diagrama SVG de una mano. Cada dedo: color de estado + patrón propio (liso = bien,
 * rayas = casi, cuadrícula = mal, contorno punteado = no se usa) + etiqueta accesible
 * ("índice: mal"). Debajo, un resumen en texto visible.
 */
export function HandDiagram({ fingers, side, caption }: HandDiagramProps) {
  const uid = useId().replace(/:/g, "");
  const values = fiveFingers(fingers);
  const fill = (t: FingerTone) => (t === "warn" ? `url(#${uid}-warn)` : t === "bad" ? `url(#${uid}-bad)` : undefined);
  const mirror = side === "izquierda" ? "translate(110 0) scale(-1 1)" : undefined;
  return (
    <figure className="hand">
      <svg className="hand__svg" viewBox="-12 0 134 150" role="group" aria-label={caption ?? `Mano ${side}`}>
        <defs>
          <pattern id={`${uid}-warn`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect className="hand__pat-bg hand__pat-bg--warn" width="6" height="6" />
            <rect className="hand__pat-fg--warn" width="3" height="6" />
          </pattern>
          <pattern id={`${uid}-bad`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect className="hand__pat-fg--bad" width="7" height="7" />
            <rect className="hand__pat-bg hand__pat-bg--bad" x="2.2" y="2.2" width="2.6" height="2.6" />
          </pattern>
        </defs>
        <g transform={mirror}>
          <rect className="hand__wrist" x="36" y="124" width="46" height="24" rx="6" />
          <rect className="hand__palm" x="27" y="66" width="72" height="68" rx="18" />
          {FINGERS.map((f, i) => {
            const tone = fingerTone(values[i]);
            return (
              <rect
                key={i}
                role="img"
                aria-label={fingerLabel(i, values[i])}
                className={`hand__finger hand__finger--${tone}`}
                x={f.x}
                y={f.y}
                width={f.w}
                height={f.h}
                rx={f.r}
                transform={"rotate" in f ? f.rotate : undefined}
                style={fill(tone) ? { fill: fill(tone) } : undefined}
              >
                <title>{fingerLabel(i, values[i])}</title>
              </rect>
            );
          })}
        </g>
      </svg>
      <figcaption className="hand__caption">
        <span className="hand__side">{caption ?? `Mano ${side}`}</span>
        <span>{fingerSummary(values)}</span>
      </figcaption>
    </figure>
  );
}
