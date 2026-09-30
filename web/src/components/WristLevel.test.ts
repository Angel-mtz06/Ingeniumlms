import { describe, expect, it } from "vitest";
import { readWrist } from "./WristLevel";

const line = (status: number) => `D,R,5,1000,-80.0,12.5${",0.0,0.0".repeat(5)},3.0,4.0,12.0,${status}`;

describe("readWrist", () => {
  it("lee la IMU de la muñeca (la 0) y la velocidad de giro total", () => {
    expect(readWrist(line(1))).toEqual({ pitch: -80, roll: 12.5, speed: 13 });
  });

  it("sin línea o con la muñeca sin responder no hay lectura", () => {
    expect(readWrist(null)).toBeNull();
    expect(readWrist(line(0))).toBeNull();
    expect(readWrist("ID,R,fw=1.3,imus=1,halls=0")).toBeNull();
  });
});
