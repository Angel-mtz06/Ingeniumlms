export type Mode = "practice" | "translate";
/** Tema de la conversación en Interpretación: sus glosas reciben un empujón al reordenar las candidatas. */
export type Topic = "todo" | "saludos" | "salud" | "emergencias";
export type Glosses = [string, number][];

export interface FramePayload {
  type: "frame";
  w: number;
  h: number;
  hands: number[][][];
  pose: number[][] | null;
  face: number[][] | null;
  gloves: { L: string | null; R: string | null };
  /** Opcional: marca de tiempo del cuadro en ms (monótona, la que recibe MediaPipe). El servidor estima los FPS. */
  t?: number;
}

export type ClientMsg =
  | { type: "hello"; mode: Mode; target: string | null }
  | FramePayload
  | { type: "calibrate"; step: "open" | "fist" | "done" }
  | { type: "confirm_gloss"; index: number; gloss: string }
  | { type: "remove_gloss"; index: number }
  | { type: "build_sentence" }
  | { type: "reset" }
  /** Preferencia de la conexión (sobrevive a hello y reset); el socket la reenvía tras `hello` al reconectar. */
  | { type: "topic"; topic: Topic };

export type Scores = { configuracion: number; ubicacion: number; movimiento: number; orientacion: number };

export type ServerMsg =
  | { type: "ready"; mode: Mode; target: string | null; has_reference: boolean }
  | { type: "live"; fingers: number[][]; hands: boolean[]; segment: "idle" | "active" }
  | { type: "evaluation"; target: string; recognized: Glosses; evaluable: boolean; scores: Scores | Record<string, never>; total: number; tips: string[]; fingers: number[][] }
  /** `reranked`: el contexto (seña anterior) cambió el top-1 del clasificador; `top3` viene reordenado con las probabilidades originales. */
  | { type: "sign"; index: number; gloss: string; top3: Glosses; confident: boolean; reranked?: boolean }
  | { type: "pending"; glosses: string[] }
  /** `glosses`: las elegidas al formar la oración; `corrected`: índices que cambiaron respecto a las señas mostradas. */
  | { type: "sentence"; glosses: string[]; text: string; paragraph: string; source: "llm" | "template"; corrected?: number[] }
  | { type: "calibration"; step: string; status?: string; sides?: { L: boolean; R: boolean } }
  | { type: "warning"; code: string; message: string }
  /** Cuenta regresiva de la pausa de oración (cada ~0.5 s); `remaining: null` la cancela (subió las manos). */
  | { type: "pausing"; remaining: number; total: number }
  | { type: "pausing"; remaining: null; total?: number }
  | { type: "topic"; topic: Topic }
  | { type: "error"; message: string };
