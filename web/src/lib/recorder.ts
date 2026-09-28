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
