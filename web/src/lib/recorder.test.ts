import { describe, expect, it } from "vitest";
import type { FramePayload } from "./protocol";
import { Recorder } from "./recorder";

const frame: FramePayload = { type: "frame", w: 1, h: 1, hands: [], pose: null, face: null, gloves: { L: null, R: null } };

describe("Recorder", () => {
  it("graba solo mientras está activo y respeta el máximo", () => {
    const r = new Recorder(3);
    r.add(frame);
    r.start();
    for (let i = 0; i < 5; i++) r.add(frame);
    expect(r.recording).toBe(false);
    expect(r.stop()).toHaveLength(3);
  });
});
