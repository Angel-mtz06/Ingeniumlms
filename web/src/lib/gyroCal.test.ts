import { describe, expect, it } from "vitest";
import { gyroCalText, parseCalLine } from "./gyroCal";

describe("parseCalLine", () => {
  it("lee las respuestas del firmware", () => {
    expect(parseCalLine("CAL,R,midiendo,2000")).toEqual({ side: "R", cal: { phase: "measuring", ms: 2000 } });
    expect(parseCalLine("CAL,L,ok,0.42")).toEqual({ side: "L", cal: { phase: "ok", spread: 0.42 } });
    expect(parseCalLine("CAL,R,error,movimiento,2")).toEqual({ side: "R", cal: { phase: "error", reason: "movimiento", imu: 2 } });
    expect(parseCalLine("CAL,R,error,no_responde,5\r")).toEqual({ side: "R", cal: { phase: "error", reason: "no_responde", imu: 5 } });
  });

  it("ignora otras líneas", () => {
    expect(parseCalLine("D,R,1,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,63")).toBeNull();
    expect(parseCalLine("CAL,X,ok,1")).toBeNull();
  });

  it("dice qué sensor falló", () => {
    expect(gyroCalText({ phase: "error", reason: "movimiento", imu: 2 })).toContain("el índice");
    expect(gyroCalText({ phase: "ok", spread: 0.42 })).toContain("0.4 °/s");
  });
});
