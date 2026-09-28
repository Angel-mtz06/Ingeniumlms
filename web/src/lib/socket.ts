import type { ClientMsg, ServerMsg } from "./protocol";

export class SessionSocket {
  private ws: WebSocket | null = null;
  private queue: ClientMsg[] = [];
  private hello: ClientMsg | null = null;
  private closed = false;
  private readonly Impl: typeof WebSocket;
  private readonly retryMs: number;

  constructor(private url: string, private onMsg: (m: ServerMsg) => void,
              opts: { WebSocketImpl?: typeof WebSocket; retryMs?: number } = {}) {
    this.Impl = opts.WebSocketImpl ?? WebSocket;
    this.retryMs = opts.retryMs ?? 1000;
    this.connect();
  }

  get open(): boolean { return this.ws?.readyState === 1; }

  private connect() {
    const ws = new this.Impl(this.url);
    this.ws = ws;
    ws.onopen = () => {
      const pending = this.hello && !this.queue.includes(this.hello) ? [this.hello, ...this.queue] : this.queue;
      this.queue = [];
      pending.forEach((m) => ws.send(JSON.stringify(m)));
    };
    ws.onmessage = (e: MessageEvent) => this.onMsg(JSON.parse(String(e.data)) as ServerMsg);
    ws.onclose = () => { if (!this.closed) setTimeout(() => this.connect(), this.retryMs); };
  }

  send(m: ClientMsg): boolean {
    if (m.type === "hello") this.hello = m;
    if (this.open) { this.ws!.send(JSON.stringify(m)); return true; }
    if (m.type !== "frame") this.queue.push(m);
    return false;
  }

  close() { this.closed = true; this.ws?.close(); }
}
