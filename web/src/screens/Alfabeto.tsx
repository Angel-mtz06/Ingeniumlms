/**
 * Alfabeto LSM: cuadricula con las 27 letras del abecedario (A-Z y N) en LSM.
 * Cada carta muestra una vista SVG simplificada de la mano derivada de los centroides
 * en web/src/data/alphabet_references.json y permite ver un detalle al seleccionarla.
 *
 * Todos los cambios de esta pantalla viven en la rama Starfunny.
 */
import { useState } from "react";
import alphabetData from "../data/alphabet_references.json";

// Tipos
type Lm = number[];
const ALPHABET = alphabetData as Record<string, Lm[]>;

const LETTERS: string[] = [
  "A","B","C","D","E","F","G","H","I","J","K","L","M",
  "N","\u00d1","O","P","Q","R","S","T","U","V","W","X","Y","Z",
];

const CONNECTIONS: [number, number][] = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17],[17,13],[13,9],[9,5],
];

interface HandSketchProps {
  landmarks: Lm[];
  size?: number;
  large?: boolean;
}

function HandSketch({ landmarks, size = 80, large = false }: HandSketchProps) {
  const xs = landmarks.map((l) => l[0]);
  const ys = landmarks.map((l) => l[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const pad = size * 0.12;
  const toSvg = (lm: Lm): [number, number] => [
    pad + ((lm[0] - minX) / rangeX) * (size - 2 * pad),
    pad + ((lm[1] - minY) / rangeY) * (size - 2 * pad),
  ];
  const pts = landmarks.map(toSvg);
  const r = large ? 3 : 2;
  const sw = large ? 1.5 : 1;
  return (
    <svg className="alfa-sketch" viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
      {CONNECTIONS.map(([a, b], i) => (
        <line key={i} className="alfa-sketch__bone" x1={pts[a][0]} y1={pts[a][1]} x2={pts[b][0]} y2={pts[b][1]} strokeWidth={sw} />
      ))}
      {pts.map(([cx, cy], i) => (
        <circle key={i} className={i === 0 ? "alfa-sketch__wrist" : "alfa-sketch__joint"} cx={cx} cy={cy} r={i === 0 ? r * 1.5 : r} />
      ))}
    </svg>
  );
}

interface LetterDetailProps {
  letter: string;
  onClose(): void;
}

function LetterDetail({ letter, onClose }: LetterDetailProps) {
  const lms = ALPHABET[letter];
  if (!lms) return null;
  return (
    <div className="alfa-detail sheet" role="region" aria-label={`Detalle de la letra ${letter}`}>
      <div className="alfa-detail__head">
        <h3 className="alfa-detail__letter" translate="no">{letter}</h3>
        <button type="button" className="btn btn--quiet" onClick={onClose} aria-label="Cerrar detalle">{"\u00d7"}</button>
      </div>
      <div className="alfa-detail__sketch">
        <HandSketch landmarks={lms} size={200} large />
      </div>
      <p className="alfa-detail__hint">
        Vista frontal de la mano derecha. Practica frente al espejo y luego busca la letra en el
        {" "}<strong>catálogo de Práctica</strong> si está disponible.
      </p>
    </div>
  );
}

export function Alfabeto() {
  const [selected, setSelected] = useState<string | null>(null);
  const pick = (l: string) => setSelected((prev) => (prev === l ? null : l));
  return (
    <div className="screen">
      <header className="screen__head">
        <h2 className="screen__title">Alfabeto LSM</h2>
        <p className="screen__lead">
          Las 27 letras del abecedario en Lengua de Señas Mexicana. Toca una letra para ver la
          posición de la mano en detalle.
        </p>
      </header>
      <div className="alfa-layout">
        <section className="sheet" aria-label="Cuadricula del alfabeto">
          <ul className="alfa-grid" role="list">
            {LETTERS.map((letter) => {
              const lms = ALPHABET[letter];
              const isSelected = selected === letter;
              return (
                <li key={letter}>
                  <button
                    type="button"
                    id={`alfa-btn-${letter.replace("\u00d1","Nn")}`}
                    className="alfa-card"
                    aria-pressed={isSelected}
                    onClick={() => pick(letter)}
                  >
                    <span className="alfa-card__letter" translate="no">{letter}</span>
                    {lms ? <HandSketch landmarks={lms} size={72} /> : <span className="alfa-card__missing">sin datos</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        {selected && ALPHABET[selected] ? (
          <LetterDetail letter={selected} onClose={() => setSelected(null)} />
        ) : (
          <div className="sheet sheet--empty alfa-placeholder">
            <p className="alfa-placeholder__text">Elige una letra para ver la posicion de la mano en grande.</p>
          </div>
        )}
      </div>
    </div>
  );
}
