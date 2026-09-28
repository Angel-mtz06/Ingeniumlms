import { describe, expect, it } from "vitest";
import { formatAngle, parseGloveLine, SeqRate } from "./diagnostics";

// Mismo formato que lsm/glove/simulator.py: simulate_line("R", 7, 1234, flex=(10,20,30,40,50), halls=8, status=0b111101)
const LINE = "D,R,7,1234,0.0,0.0,10.0,0.0,20.0,0.0,30.0,0.0,40.0,0.0,50.0,0.0,0.0,0.0,0.0,2648,2048,2048,2048,2048,2048,2048,2048,61";

describe("parseGloveLine", () => {
  it("lee pitch/roll, hall y bits de estado", () => {
    const g = parseGloveLine(LINE)!;
    expect(g.side).toBe("R");
    expect(g.seq).toBe(7);
    expect(g.pitch).toEqual([0, 10, 20, 30, 40, 50]);
    expect(g.roll).toEqual([0, 0, 0, 0, 0, 0]);
    expect(g.gyro).toHaveLength(3);
    expect(g.hall).toEqual([2648, 2048, 2048, 2048, 2048, 2048, 2048, 2048]);
    expect(g.imuOk).toEqual([true, false, true, true, true, true]);
  });
  it("rechaza líneas que no son de datos", () => {
    expect(parseGloveLine("ID,R,fw=1.0,imus=6,halls=8")).toBeNull();
    expect(parseGloveLine("D,R,1,2")).toBeNull();
    expect(parseGloveLine(LINE.replace("10.0", "x"))).toBeNull();
    expect(parseGloveLine(null)).toBeNull();
  });
});

describe("SeqRate", () => {
  it("mide líneas por segundo con el contador del guante", () => {
    const r = new SeqRate(1000);
    expect(r.push(100, 0)).toBeNull();
    expect(r.push(150, 500)).toBeNull();
    expect(r.push(200, 1000)).toBe(100);
    expect(r.push(10, 1100)).toBeNull(); // reinicio del contador
    expect(r.push(60, 2100)).toBe(50);
  });
});

it("formatAngle", () => {
  expect(formatAngle(-12.34)).toBe("−12.3°");
  expect(formatAngle(NaN)).toBe("sin dato");
});
