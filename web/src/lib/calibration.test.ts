import { describe, expect, it } from "vitest";
import { CALIBRATION_INITIAL, calibrationOutcome, calibrationReducer } from "./calibration";
import type { ServerMsg } from "./protocol";

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

describe("calibrationOutcome", () => {
  const doneMsg = (L: boolean, R: boolean): ServerMsg => ({ type: "calibration", step: "done", sides: { L, R } });
  const err = (message: string): ServerMsg => ({ type: "error", message });

  it("solo mira los mensajes que llegaron después de pedir el resultado", () => {
    const oldErr = err("paso de calibración inválido: done");
    const oldDone = doneMsg(true, true);
    const before = new Set<ServerMsg>([oldErr, oldDone]);
    expect(calibrationOutcome([oldErr, oldDone], before)).toBeNull();
    const fresh = doneMsg(false, true);
    expect(calibrationOutcome([oldErr, oldDone, fresh], before)).toEqual({ kind: "done", sides: { L: false, R: true } });
  });

  it("un error ajeno no marca fallo y, si llega done, gana done", () => {
    const before = new Set<ServerMsg>();
    const ajeno = err("error interno: ValueError");
    expect(calibrationOutcome([ajeno], before)).toBeNull();
    const calErr = err("paso de calibración inválido: done");
    expect(calibrationOutcome([ajeno, calErr], before)).toEqual({ kind: "error" });
    expect(calibrationOutcome([calErr, doneMsg(true, false)], before)).toEqual({ kind: "done", sides: { L: true, R: false } });
  });

  it("ignora pasos que no son done", () => {
    expect(calibrationOutcome([{ type: "calibration", step: "fist", status: "recording" }], new Set())).toBeNull();
  });
});

