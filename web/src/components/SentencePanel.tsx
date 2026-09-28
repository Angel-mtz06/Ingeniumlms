import { useEffect, useRef, useState } from "react";
import { IconCheck, IconCopy, IconSpeaker } from "./icons";
import "./components.css";

export interface SentencePanelProps {
  text: string;
  paragraph: string;
  source: "llm" | "template";
  onSpeak(): void;
  /** Puede devolver una promesa (portapapeles); al resolverse se muestra "Copiado". */
  onCopy(): void | Promise<void>;
}

const COPY_OK_MS = 2500;
const COPY_ERROR_MS = 8000;

const SOURCE_TEXT = {
  llm: { badge: "Generado por IA", hint: "Redactado por un modelo de lenguaje a partir de las señas." },
  template: { badge: "Plantilla", hint: "Armado con reglas fijas a partir de las señas." },
} as const;

/**
 * Oración traducida en texto grande, con el párrafo ampliado debajo, la procedencia
 * ("Generado por IA" o "Plantilla") y las acciones para la persona oyente: leer en voz alta y copiar.
 */
export function SentencePanel({ text, paragraph, source, onSpeak, onCopy }: SentencePanelProps) {
  const [copied, setCopied] = useState<"ok" | "error" | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => setCopied(null), [text]);

  const empty = text.trim() === "";
  const src = SOURCE_TEXT[source];

  const copy = async () => {
    window.clearTimeout(timer.current);
    let result: "ok" | "error" = "ok";
    try {
      await onCopy();
    } catch {
      result = "error";
    }
    setCopied(result);
    // El error se queda más tiempo (≥ 6 s) para que dé tiempo de leerlo y copiar a mano.
    timer.current = window.setTimeout(() => setCopied(null), result === "error" ? COPY_ERROR_MS : COPY_OK_MS);
  };

  return (
    <section className="sentence" aria-label="Traducción">
      {/* Región viva siempre montada: si naciera junto con el texto, la primera oración no se anunciaría. */}
      <p className="visually-hidden" aria-live="polite">
        {empty ? "" : `Traducción: ${text}`}
      </p>
      {empty ? (
        <p className="sentence__empty">La oración aparecerá aquí cuando termines de señar.</p>
      ) : (
        <>
          <p className="sentence__meta">
            <span className="badge" data-source={source}>
              {src.badge}
            </span>
            <span className="sentence__hint">{src.hint}</span>
          </p>
          <p className="sentence__text">{text}</p>
          {paragraph && paragraph !== text ? <p className="sentence__paragraph">{paragraph}</p> : null}
        </>
      )}
      <div className="sentence__actions">
        <button type="button" className="btn btn--primary" onClick={onSpeak} disabled={empty}>
          <IconSpeaker />
          Leer en voz alta
        </button>
        <button type="button" className="btn btn--secondary" onClick={copy} disabled={empty}>
          {copied === "ok" ? <IconCheck /> : <IconCopy />}
          {copied === "ok" ? "Copiado" : "Copiar texto"}
        </button>
        <span className="sentence__status" role="status">
          {copied === "error" ? "No se pudo copiar. Selecciona el texto y cópialo a mano." : ""}
        </span>
      </div>
    </section>
  );
}
