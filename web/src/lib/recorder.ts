import type { FramePayload } from "./protocol";

export class Recorder {
  private frames: FramePayload[] = [];
  recording = false;
  constructor(private maxFrames = 90) {}
  start() { this.frames = []; this.recording = true; }
  add(f: FramePayload) {
    if (!this.recording) return;
    this.frames.push(f);
    if (this.frames.length >= this.maxFrames) this.recording = false;
  }
  stop(): FramePayload[] { this.recording = false; return this.frames; }
}

export async function upload(label: string, signer: string, frames: FramePayload[], fetchImpl: typeof fetch = fetch) {
  const r = await fetchImpl("/api/recordings", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, signer, frames }),
  });
  if (!r.ok) throw new Error(`Error al guardar la grabación (${r.status})`);
  return (await r.json()) as { sample_id: string; frames: number };
}
