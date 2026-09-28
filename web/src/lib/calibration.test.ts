import { describe, expect, it } from "vitest";
import { CALIBRATION_INITIAL, calibrationReducer } from "./calibration";

const done = (L: boolean, R: boolean) => ({ kind: "msg" as const, msg: { type: "calibration" as const, step: "done", sides: { L, R } } });

describe("calibrationReducer", () => {
  it("guarda los lados calibrados al terminar", () => {
    const s = calibrationReducer(CALIBRATION_INITIAL, done(false, true));
    expect(s).toEqual({ sides: { L: false, R: true }, lost: false });
    // otros pasos no cambian nada
    expect(calibrationReducer(s, { kind: "msg", msg: { type: "calibration", step: "open", status: "recording" } })).toBe(s);
  });

  it("una reconexión borra la calibración y avisa solo si había algo calibrado", () => {
    expect(calibrationReducer(CALIBRATION_INITIAL, { kind: "reconnect" })).toBe(CALIBRATION_INITIAL);
    let s = calibrationReducer(CALIBRATION_INITIAL, done(true, true));
    s = calibrationReducer(s, { kind: "reconnect" });
    expect(s).toEqual({ sides: { L: false, R: false }, lost: true });
    // calibrar de nuevo quita el aviso
    expect(calibrationReducer(s, done(true, false))).toEqual({ sides: { L: true, R: false }, lost: false });
  });
});
