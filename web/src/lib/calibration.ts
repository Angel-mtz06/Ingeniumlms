/*
 * calibration.ts: estado de calibración de los guantes visto por la UI (función pura).
 * La calibración vive en la Session del servidor, que es una por conexión WebSocket: si el socket se
 * reconecta, el servidor ya no la tiene y la UI debe pedir calibrar de nuevo.
 */
import type { ServerMsg } from "./protocol";

export interface CalibrationState {
  /** Guantes calibrados en la sesión actual del servidor. */
  sides: { L: boolean; R: boolean };
  /** Había guantes calibrados y se perdieron por una reconexión: mostrar el aviso. */
  lost: boolean;
}

export type CalibrationAction = { kind: "msg"; msg: ServerMsg } | { kind: "reconnect" };

export const CALIBRATION_INITIAL: CalibrationState = { sides: { L: false, R: false }, lost: false };

export function calibrationReducer(s: CalibrationState, a: CalibrationAction): CalibrationState {
  if (a.kind === "reconnect") {
    if (!s.sides.L && !s.sides.R) return s;
    return { sides: { L: false, R: false }, lost: true };
  }
  const m = a.msg;
  if (m.type === "calibration" && m.step === "done" && m.sides) {
    // Una calibración nueva (aunque falle un lado) reemplaza el estado y quita el aviso.
    return { sides: { L: m.sides.L, R: m.sides.R }, lost: false };
  }
  return s;
}
