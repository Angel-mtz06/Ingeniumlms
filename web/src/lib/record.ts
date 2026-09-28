/*
 * record.ts: validación y envío de grabaciones propias (pantalla Grabar). Funciones puras salvo `saveRecording`,
 * que recibe `fetch` inyectable. Las reglas son las mismas que aplica el servidor en POST /api/recordings.
 */
import type { FramePayload } from "./protocol";

/** Igual que SIGNER_RE del servidor: sin "_" porque separa persona_glosa_toma en el nombre del archivo. */
export const SIGNER_RE = /^[A-Za-z0-9-]{1,32}$/;
/** Igual que LABEL_RE del servidor, aplicado a la glosa ya canonizada. */
export const LABEL_RE = /^[A-ZÑ0-9_]{1,40}$/;
export const MAX_REC_FRAMES = 1800;
export const NONE_LABEL = "NINGUNA";

/** Misma canonización que `lsm.vocab.canonical`: NFC, mayúsculas, espacios → "_", sin acentos salvo la Ñ. */
export function canonicalGloss(name: string): string {
  const s = name.normalize("NFC").trim().toUpperCase().replace(/ /g, "_").replace(/Ñ/g, "\0");
  return s.normalize("NFD").replace(/\p{Mn}/gu, "").replace(/\0/g, "Ñ");
}

/** Mensaje de error visible para el campo "Glosa", o null si es válida. */
export function labelError(raw: string): string | null {
  const g = canonicalGloss(raw);
  if (g === "") return "Escribe la glosa que vas a grabar.";
  if (g.length > 40) return "La glosa puede tener como máximo 40 caracteres.";
  if (!LABEL_RE.test(g)) return "Usa solo letras, números, espacios o guion bajo en la glosa (sin signos).";
  return null;
}

/** Mensaje de error visible para el campo "Persona", o null si es válido. */
export function signerError(raw: string): string | null {
  const s = raw.trim();
  if (s === "") return "Escribe un nombre o apodo para la persona que graba.";
  if (s.length > 32) return "El nombre puede tener como máximo 32 caracteres.";
  if (s.includes("_")) return "No uses guion bajo (_). Puedes usar un guion (-) para separar.";
  if (/\s/.test(s)) return "No uses espacios. Puedes usar un guion (-), por ejemplo ana-lopez.";
  if (!SIGNER_RE.test(s)) return "Usa solo letras sin acento, números y guiones, por ejemplo ana-lopez.";
  return null;
}

/** Traduce la respuesta de error del servidor a un mensaje en español con el siguiente paso. */
export function recordingErrorMessage(status: number, detail: string | null): string {
  const d = (detail ?? "").toLowerCase();
  if (status === 0) return "No hay conexión con el servidor. Revisa que esté encendido y vuelve a grabar.";
  if (d.includes("sin cuadros")) return "No se capturó ningún cuadro. Revisa que la cámara funcione y vuelve a grabar.";
  if (d.includes("demasiados")) return "La grabación es demasiado larga. Graba una toma más corta.";
  if (d.includes("glosa o persona")) return "El servidor rechazó la glosa o el nombre de la persona. Revísalos y vuelve a grabar.";
  if (d.includes("cuadros inv")) return "Los cuadros llegaron con datos inválidos. Recarga la página y vuelve a grabar.";
  if (status === 409) return "No se pudo reservar un número de toma. Vuelve a grabar.";
  // 5xx sin detalle: típico del proxy de desarrollo cuando el servidor está apagado.
  if (status >= 500 && !detail) return "El servidor no respondió. Revisa que esté encendido y vuelve a grabar.";
  return `No se pudo guardar la grabación (error ${status}). Vuelve a intentarlo.`;
}

export interface SavedRecording {
  sample_id: string;
  frames: number;
}

/** Envía la toma a /api/recordings. Lanza un Error cuyo `message` ya es el texto para la persona. */
export async function saveRecording(
  label: string,
  signer: string,
  frames: FramePayload[],
  fetchImpl: typeof fetch = fetch,
): Promise<SavedRecording> {
  let r: Response;
  try {
    r = await fetchImpl("/api/recordings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: canonicalGloss(label), signer: signer.trim(), frames }),
    });
  } catch {
    throw new Error(recordingErrorMessage(0, null));
  }
  if (!r.ok) {
    let detail: string | null = null;
    try {
      const body = (await r.json()) as { detail?: unknown };
      detail = typeof body.detail === "string" ? body.detail : null;
    } catch {
      detail = null;
    }
    throw new Error(recordingErrorMessage(r.status, detail));
  }
  return (await r.json()) as SavedRecording;
}
