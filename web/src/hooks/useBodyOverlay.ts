import { useCallback, useSyncExternalStore } from "react";

const KEY = "lsm.cuerpo";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

let value = read();

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * "Mostrar cara y torso" sobre la cámara de Práctica, Alfabeto e Interpretación (activado por defecto). Se cambia
 * en Calibración y se recuerda en este navegador; todas las pantallas lo leen del mismo lugar.
 */
export function useBodyOverlay(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, () => value, () => true);
  const set = useCallback((next: boolean) => {
    value = next;
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      /* sin almacenamiento: dura solo esta visita */
    }
    listeners.forEach((l) => l());
  }, []);
  return [on, set];
}
