import { describe, expect, it } from "vitest";
import { LineBuffer, parseIdLine } from "./lines";

describe("LineBuffer", () => {
  it("une fragmentos y separa líneas", () => {
    const b = new LineBuffer();
    expect(b.push("D,R,1,2")).toEqual([]);
    expect(b.push(",3\r\nID,R,fw=1.0,imus=6,halls=8\nD,")).toEqual(["D,R,1,2,3", "ID,R,fw=1.0,imus=6,halls=8"]);
    expect(b.push("L\n\n")).toEqual(["D,L"]);
  });

  it("no crece sin límite", () => {
    const b = new LineBuffer();
    b.push("x".repeat(10000));
    expect(b.push("\n")[0].length).toBeLessThanOrEqual(4096);
  });
});

describe("parseIdLine", () => {
  it("lee la identidad del guante", () => {
    expect(parseIdLine("ID,L,fw=1.0,imus=6,halls=8")).toEqual({ side: "L", fw: "1.0", imus: 6, halls: 8 });
  });
  it("rechaza otras líneas", () => {
    expect(parseIdLine("D,R,1,2")).toBeNull();
    expect(parseIdLine("ID,X,fw=1")).toBeNull();
  });
});
