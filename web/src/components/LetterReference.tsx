import { MOTION_LETTERS } from "../lib/alphabet";

// Fotografía de la letra dentro del cartel original de SEP, sin alterar la imagen. Se muestra en el
// mismo marco que la referencia animada de Práctica (.ref / .ref__stage). Sin controles: la letra
// solo cambia sola al acertar (Secuencial) o desde el selector (Letra específica).
export function LetterReference({ letter }: { letter: string }) {
  const i = [..."ABCDEFGHIJKLMNÑOPQRSTUVWXYZ"].indexOf(letter);
  const row = Math.floor(i / 6), col = i % 6;
  const x = row === 4 ? [342, 546, 748][col] : [44, 246, 447, 647, 848, 1050][col];
  const y = [315, 608, 892, 1181, 1472][row];
  return (
    <figure className="ref">
      <div className="ref__stage alfa-ref__stage">
        <svg className="alfa-ref__photo" viewBox={`${x} ${y} 186 260`} preserveAspectRatio="xMidYMid meet" role="img"
          aria-label={`Fotografía LSM: letra ${letter}${MOTION_LETTERS.has(letter) ? ", sigue las flechas de movimiento" : ""}`}>
          <image href="/alphabet/lsm-sep.jpg" width="1280" height="1920" />
        </svg>
      </div>
    </figure>
  );
}

/** Videos de una intérprete (SEBIEN · Indiscapacidad CDMX): uno por letra; la Ñ usa "nn" en el nombre de archivo. */
export const TUTORIAL: Record<string, string> = Object.fromEntries(
  [..."ABCDEFGHIJKLMNÑOPQRSTUVWXYZ"].map((l) => [l, l === "Ñ" ? "nn" : l.toLowerCase()]),
);
export function LetterTutorial({ letter }: { letter: string }) {
  return (
    <figure className="ref">
      <div className="ref__stage alfa-ref__stage">
        <video key={letter} className="alfa-ref__video" src={`/alphabet/videos/${TUTORIAL[letter]}.mp4`}
          controls autoPlay muted playsInline loop aria-label={`Video tutorial de la letra ${letter}`} />
      </div>
      <p className="sheet__hint">Video: SEBIEN · Indiscapacidad CDMX</p>
    </figure>
  );
}
