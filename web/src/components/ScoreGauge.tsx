import type { GaugeView } from "../lib/gauge";
import { ringOffset } from "../lib/gauge";
import { IconWarning, ToneIcon } from "./icons";
import "./components.css";

const R = 30;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * Medidor de puntaje de la última toma: anillo con el porcentaje dentro y, al lado, la palabra de
 * estado con su ícono ("Bien", "Casi", "Corrige"). Va sobre la esquina de la cámara para que el
 * resultado se vea sin bajar. Sin toma dice "Haz la seña…"; si la toma no se pudo calificar,
 * "No evaluable". No es región viva: el detalle de abajo (ScoreCard) es el que se anuncia.
 */
export function ScoreGauge({ view }: { view: GaugeView }) {
  const score = view.kind === "score" ? view : null;
  return (
    <div className="gauge" data-kind={view.kind} data-tone={score?.tone}>
      <span className="gauge__ring">
        <svg className="gauge__svg" viewBox="0 0 72 72" aria-hidden="true" focusable="false">
          <circle className="gauge__track" cx="36" cy="36" r={R} />
          {score ? (
            <circle
              className="gauge__fill"
              cx="36"
              cy="36"
              r={R}
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={ringOffset(score.value, CIRCUMFERENCE)}
            />
          ) : null}
        </svg>
        <span className="gauge__center">
          {score ? (
            <span className="gauge__num tabular">
              {score.value}
              <span className="gauge__pct"> %</span>
            </span>
          ) : view.kind === "guide" ? (
            <IconWarning size={24} />
          ) : null}
        </span>
      </span>
      <span className="gauge__text">
        <span className="gauge__label">
          {score ? <ToneIcon tone={score.tone} size={20} /> : null}
          <span>{score ? score.word : view.label}</span>
        </span>
        <span className="gauge__detail">{score ? score.caption ?? "Tu puntaje" : view.detail}</span>
      </span>
    </div>
  );
}
