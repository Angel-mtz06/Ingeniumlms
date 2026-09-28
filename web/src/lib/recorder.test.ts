import { describe, expect, it } from "vitest";
import type { FramePayload } from "./protocol";
import { Recorder, upload } from "./recorder";

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

  it("sube la grabación", async () => {
    const calls: { url: string; body: string }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ sample_id: "a_HOLA_000", frames: 1 }));
    }) as unknown as typeof fetch;
    const res = await upload("hola", "a", [frame], fake);
    expect(res.sample_id).toBe("a_HOLA_000");
    expect(calls[0].url).toBe("/api/recordings");
    expect(JSON.parse(calls[0].body)).toMatchObject({ label: "hola", signer: "a" });
  });
});
