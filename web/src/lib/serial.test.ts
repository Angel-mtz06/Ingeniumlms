import { describe, expect, it } from "vitest";
import { acceptLine } from "./serial";

describe("acceptLine", () => {
  it("actualiza seen con una línea D nueva", () => {
    const state = { last: null, seen: 0 };
    const now = 100;
    const result = acceptLine(state, "D,L,1,2,3", now);
    expect(result).toBe(true);
    expect(state.last).toBe("D,L,1,2,3");
    expect(state.seen).toBe(100);
  });

  it("ignora repeticiones idénticas", () => {
    const state = { last: "D,R,1,2", seen: 50 };
    const now = 200;
    const result = acceptLine(state, "D,R,1,2", now);
    expect(result).toBe(false);
    expect(state.seen).toBe(50); // no cambió
  });

  it("no modifica last/seen para líneas ID", () => {
    const state = { last: null, seen: 0 };
    const now = 100;
    const result = acceptLine(state, "ID,L,fw=1.0,imus=6,halls=8", now);
    expect(result).toBe(false);
    expect(state.last).toBeNull();
    expect(state.seen).toBe(0);
  });
});
