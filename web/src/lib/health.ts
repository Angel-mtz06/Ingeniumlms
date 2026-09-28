/** Respuesta de GET /api/health del servidor. */
export interface Health {
  ok: boolean;
  classifier: boolean;
  references: number;
  llm: boolean;
}

export function parseHealth(x: unknown): Health | null {
  if (!x || typeof x !== "object") return null;
  const h = x as Record<string, unknown>;
  if (typeof h.ok !== "boolean" || typeof h.classifier !== "boolean" || typeof h.llm !== "boolean") return null;
  if (typeof h.references !== "number" || !Number.isFinite(h.references)) return null;
  return { ok: h.ok, classifier: h.classifier, references: h.references, llm: h.llm };
}

/** Aviso visible si el servidor arrancó sin clasificador o sin señas de referencia; null si todo está bien. */
export function healthWarning(h: Health | null): string | null {
  if (!h) return null;
  const noRefs = h.references <= 0;
  if (!h.classifier && noRefs)
    return "El modelo de reconocimiento no está cargado: falta el clasificador y no hay señas de referencia. La app no podrá reconocer ni calificar señas. Revisa la carpeta models del servidor y reinícialo.";
  if (!h.classifier)
    return "El modelo de reconocimiento no está cargado: falta el clasificador, así que la app no podrá reconocer señas. Revisa models/classifier_v1.pt en el servidor y reinícialo.";
  if (noRefs)
    return "El modelo de reconocimiento no está cargado por completo: no hay señas de referencia, así que Práctica no podrá calificar ni mostrar ejemplos. Revisa models/references.json en el servidor y reinícialo.";
  return null;
}

/** Cómo forma las oraciones el servidor. */
export function sentencesLabel(llm: boolean): string {
  return llm ? "frases con IA (modelo de lenguaje)" : "frases con plantillas";
}
