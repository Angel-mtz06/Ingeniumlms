/*
 * gyroCal.ts: respuestas del comando CAL del firmware (calibración de giroscopios). Lógica pura.
 *   CAL,<L|R>,midiendo,<ms>   ·   CAL,<L|R>,ok,<variación máx °/s>   ·   CAL,<L|R>,error,<motivo>,<imu>
 */
export type Side = "L" | "R";

export type GyroCal =
  | { phase: "idle" }
  | { phase: "waiting" }
  | { phase: "measuring"; ms: number }
  | { phase: "ok"; spread: number }
  | { phase: "error"; reason: "movimiento" | "no_responde" | "sin_iniciar" | "sin_respuesta" | "otro"; imu: number | null };

/** IMU del protocolo: 0 = dorso, 1–5 = pulgar→meñique. */
export const IMU_NAMES = ["el dorso", "el pulgar", "el índice", "el medio", "el anular", "el meñique"] as const;

/** Respuesta a CAL, o null si la línea no es una. */
export function parseCalLine(line: string): { side: Side; cal: GyroCal } | null {
  const p = line.trim().split(",");
  if (p[0] !== "CAL" || (p[1] !== "L" && p[1] !== "R")) return null;
  const side = p[1];
  if (p[2] === "midiendo") return { side, cal: { phase: "measuring", ms: Number(p[3]) || 2000 } };
  if (p[2] === "ok") return { side, cal: { phase: "ok", spread: Number(p[3]) || 0 } };
  if (p[2] === "error") {
    const reason = p[3] === "movimiento" || p[3] === "no_responde" || p[3] === "sin_iniciar" ? p[3] : "otro";
    const imu = Number.isInteger(Number(p[4])) && p[4] !== undefined && p[4] !== "" ? Number(p[4]) : null;
    return { side, cal: { phase: "error", reason, imu } };
  }
  return null;
}

/** Texto para la persona. */
export function gyroCalText(cal: GyroCal): string {
  switch (cal.phase) {
    case "idle": return "";
    case "waiting": return "Enviando…";
    case "measuring": return "Midiendo: no muevas la pulsera.";
    case "ok": return `Calibrado: la mesa es el cero de la inclinación (variación ${cal.spread.toFixed(1)} °/s).`;
    case "error": {
      const where = cal.imu !== null && IMU_NAMES[cal.imu] ? ` (${IMU_NAMES[cal.imu]})` : "";
      if (cal.reason === "movimiento") return `Se movió un sensor${where}: deja la pulsera plana en la mesa y repite sin moverla.`;
      if (cal.reason === "no_responde") return `Un sensor no responde${where}: revisa su cable y repite.`;
      if (cal.reason === "sin_iniciar") return "El guante todavía espera el WiFi: sus sensores aún no arrancan.";
      if (cal.reason === "sin_respuesta") return "El guante no respondió: carga el firmware 1.1 o más nuevo.";
      return "No se pudo calibrar: repite.";
    }
  }
}
