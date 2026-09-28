const MAX = 4096;

export class LineBuffer {
  private buf = "";
  push(chunk: string): string[] {
    this.buf = (this.buf + chunk).slice(-MAX);
    const parts = this.buf.split("\n");
    this.buf = parts.pop() ?? "";
    return parts.map((l) => l.replace(/\r$/, "").slice(0, MAX)).filter((l) => l.length > 0);
  }
}

export function parseIdLine(line: string) {
  const p = line.split(",");
  if (p[0] !== "ID" || (p[1] !== "L" && p[1] !== "R")) return null;
  const kv = Object.fromEntries(p.slice(2).map((s) => s.split("=")).filter((a) => a.length === 2));
  return { side: p[1] as "L" | "R", fw: kv.fw ?? "", imus: Number(kv.imus ?? 6), halls: Number(kv.halls ?? 0) };
}
