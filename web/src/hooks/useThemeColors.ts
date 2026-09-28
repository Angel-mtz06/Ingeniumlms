import { useCallback, useEffect, useMemo, useRef } from "react";

export interface ThemeColors<K extends string> {
  /** Colores leídos de las variables CSS del elemento; se leen una vez por tema (null sin elemento). */
  get(): Record<K, string> | null;
  /** Sube cada vez que cambia el tema claro/oscuro: quien dibuja sabe que debe repintar. */
  version(): number;
}

/**
 * Cachea variables CSS de color para dibujar en <canvas> sin llamar a getComputedStyle en cada
 * cuadro. La caché se invalida al cambiar `prefers-color-scheme` (el único cambio de tema de la app).
 */
export function useThemeColors<K extends string>(ref: { current: Element | null }, names: readonly K[]): ThemeColors<K> {
  const cache = useRef<Record<K, string> | null>(null);
  const ver = useRef(0);
  const namesRef = useRef(names);
  namesRef.current = names;

  useEffect(() => {
    const mq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    if (!mq) return;
    const onChange = () => {
      cache.current = null;
      ver.current++;
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const get = useCallback((): Record<K, string> | null => {
    if (cache.current) return cache.current;
    const el = ref.current;
    if (!el) return null;
    const style = getComputedStyle(el);
    const out = {} as Record<K, string>;
    let complete = true;
    for (const n of namesRef.current) {
      const v = style.getPropertyValue(n).trim();
      if (!v) complete = false;
      out[n] = v;
    }
    // Si la hoja de estilos aún no carga, no se guarda: se vuelve a leer en el siguiente cuadro.
    if (complete) cache.current = out;
    return out;
  }, [ref]);

  const version = useCallback(() => ver.current, []);
  // Objeto estable: se usa como dependencia de los efectos de dibujo sin reiniciarlos en cada render.
  return useMemo(() => ({ get, version }), [get, version]);
}
