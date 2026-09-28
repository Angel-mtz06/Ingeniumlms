/*
 * diagnostics.ts: lectura de las líneas del guante SOLO para mostrarlas en la pantalla Diagnóstico.
 * El servidor (lsm/glove/protocol.py) sigue siendo la fuente de verdad; este parser replica su formato:
 * D,lado,seq,t_ms, 6×(pitch,roll), 3 gyro, N hall, status  (bit i de status = IMU i funciona).
 */

export const IMU_NAMES = ["Dorso", "Pulgar", "Índice", "Medio", "Anular", "Meñique"] as const;
const N_IMU = 6;
const BASE_FIELDS = 20;

export interface GloveLine {
  side: "L" | "R";
  seq: number;
  tMs: number;
  pitch: number[];
  roll: number[];
  gyro: number[];
  hall: number[];
  status: number;
  imuOk: boolean[];
}

export function parseGloveLine(line: string | null | undefined): GloveLine | null {
  if (typeof line !== "string") return null;
  const p = line.trim().split(",");
  if (p[0] !== "D" || p.length < BASE_FIELDS || (p[1] !== "L" && p[1] !== "R")) return null;
  const nums = p.slice(2).map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const seq = nums[0];
  const tMs = nums[1];
  const pr = nums.slice(2, 2 + N_IMU * 2);
  const status = nums[nums.length - 1];
  if (!Number.isInteger(seq) || !Number.isInteger(status)) return null;
  return {
    side: p[1],
    seq,
    tMs,
    pitch: pr.filter((_, i) => i % 2 === 0),
    roll: pr.filter((_, i) => i % 2 === 1),
    gyro: nums.slice(2 + N_IMU * 2, 5 + N_IMU * 2),
    hall: nums.slice(5 + N_IMU * 2, -1),
    status,
    imuOk: Array.from({ length: N_IMU }, (_, i) => ((status >> i) & 1) === 1),
  };
}

/**
 * Líneas por segundo a partir del contador `seq` del firmware y el reloj del navegador:
 * no depende de con qué frecuencia se consulte la última línea (que se sondea a menos Hz que el guante).
 * Devuelve el valor al cerrar cada ventana, null mientras tanto.
 */
export class SeqRate {
  private start: { seq: number; t: number } | null = null;
  constructor(private readonly windowMs = 1000) {}

  push(seq: number, nowMs: number): number | null {
    if (this.start === null || seq < this.start.seq) {
      this.start = { seq, t: nowMs }; // primera lectura o el guante reinició su contador
      return null;
    }
    const dt = nowMs - this.start.t;
    if (dt < this.windowMs) return null;
    const rate = ((seq - this.start.seq) * 1000) / dt;
    this.start = { seq, t: nowMs };
    return Math.round(rate);
  }

  reset() {
    this.start = null;
  }
}

/** Ángulo con signo y un decimal, con signo menos tipográfico. */
export function formatAngle(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "sin dato";
  const s = Math.abs(v).toFixed(1);
  return `${v < 0 ? "−" : ""}${s}°`;
}
