import { useEffect, useRef, type MutableRefObject } from "react";
import { useAlphabetRecognition } from "../hooks/useAlphabetRecognition";
import type { FramePayload } from "../lib/protocol";

export interface SpellRecognizerProps {
  /** Aquí se registra quién recibe cada cuadro mientras se deletrea (null al desmontar). */
  frameRef: MutableRefObject<((f: FramePayload) => void) | null>;
  /** Letra estable que ve el reconocedor (null = ninguna), en cada cambio. */
  onLetter(letter: string | null): void;
}

/**
 * Deletreo de Interpretación: el reconocedor de letras de Alfabeto (useAlphabetRecognition en modo libre) sin
 * interfaz propia. Se carga aparte (lazy) porque trae el modelo k-NN del alfabeto (~3 MB), igual que la práctica
 * del alfabeto, así no pesa en la carga inicial de la app.
 */
export default function SpellRecognizer({ frameRef, onLetter }: SpellRecognizerProps) {
  const alpha = useAlphabetRecognition(null, "free", true);
  const onFrame = useRef(alpha.onFrame);
  onFrame.current = alpha.onFrame;
  useEffect(() => {
    frameRef.current = (f) => onFrame.current(f);
    return () => {
      frameRef.current = null;
    };
  }, [frameRef]);
  const letter = alpha.stable?.[0] ?? null;
  const report = useRef(onLetter);
  report.current = onLetter;
  useEffect(() => {
    report.current(letter);
  }, [letter]);
  return null;
}
