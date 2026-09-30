export type Mode = "practice" | "translate";
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
  | { type: "reset" };

export type Scores = { configuracion: number; ubicacion: number; movimiento: number; orientacion: number };

export type ServerMsg =
  | { type: "ready"; mode: Mode; target: string | null; has_reference: boolean }
  | { type: "live"; fingers: number[][]; hands: boolean[]; segment: "idle" | "active" }
  | { type: "evaluation"; target: string; recognized: Glosses; evaluable: boolean; scores: Scores | Record<string, never>; total: number; tips: string[]; fingers: number[][] }
  | { type: "sign"; index: number; gloss: string; top3: Glosses; confident: boolean }
  | { type: "pending"; glosses: string[] }
  | { type: "sentence"; glosses: string[]; text: string; paragraph: string; source: "llm" | "template" }
  | { type: "calibration"; step: string; status?: string; sides?: { L: boolean; R: boolean } }
  | { type: "warning"; code: string; message: string }
  /** Cuenta regresiva de la pausa de oración (cada ~0.5 s); `remaining: null` la cancela (subió las manos). */
  | { type: "pausing"; remaining: number; total: number }
  | { type: "pausing"; remaining: null; total?: number }
  | { type: "error"; message: string };
