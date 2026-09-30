import { useRef } from "react";
import type { FramePayload } from "../lib/protocol";

/** Un cuadro para diagnóstico: solo lo que usa el reconocimiento (landmarks de manos en píxeles). */
export interface RecordedFrame { t: number; w: number; h: number; hands: number[][][] }

/**
 * Guarda los últimos `ms` milisegundos de cuadros en memoria y los descarga como JSON cuando la
 * persona lo pide ("Descargar intento"). Sirve para reproducir fuera de la app un intento real que
 * no se reconoció. No guarda video ni la cara: solo los puntos de las manos y el tiempo de cada cuadro.
 */
export function useFrameRecorder(ms = 8000) {
  const frames = useRef<RecordedFrame[]>([]);
  const push = (f: FramePayload) => {
    const t = f.t ?? performance.now();
    const buf = frames.current;
    if (buf.length && t <= buf[buf.length - 1].t) buf.length = 0;
    buf.push({ t, w: f.w, h: f.h, hands: f.hands.map((h) => h.map((p) => p.map((v) => Math.round(v * 10) / 10))) });
    while (buf.length && t - buf[0].t > ms) buf.shift();
  };
  const download = (name: string, meta: Record<string, unknown>) => {
    const data = { version: 1, savedAt: new Date().toISOString(), ...meta, frames: frames.current };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
    a.href = url;
    a.download = `ingenium_${name}_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return { push, download, count: () => frames.current.length };
}
