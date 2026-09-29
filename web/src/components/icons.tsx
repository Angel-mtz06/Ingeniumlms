/*
 * icons.tsx: juego mínimo de íconos SVG en línea (decisión del controlador: sin dependencias npm nuevas).
 * Una sola familia: retícula 24×24, trazo 2 px redondeado, `currentColor`. Decorativos por defecto
 * (aria-hidden): el significado siempre va también en texto visible.
 */
import type { ReactNode, SVGProps } from "react";
import type { Tone } from "../lib/ui";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number; title?: string };

function Icon({ size = 20, title, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      className="icon"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/** Palomita en círculo: estado "Bien". */
export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.5 2.5 2.5L16 9.5" />
  </Icon>
);

/** Triángulo con signo de admiración: estado "Casi" / aviso. */
export const IconWarning = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9.5v4" />
    <path d="M12 17h.01" />
  </Icon>
);

/** X en octágono: estado "Corrige" / error. */
export const IconError = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8.2 2.8h7.6l5.4 5.4v7.6l-5.4 5.4H8.2l-5.4-5.4V8.2Z" />
    <path d="m9 9 6 6" />
    <path d="m15 9-6 6" />
  </Icon>
);

export const IconCamera = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    <circle cx="12" cy="13" r="3.5" />
  </Icon>
);

/** Guante: palma con cuatro dedos y pulgar, y el puño del guante. */
export const IconGlove = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 13V6.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M10 11V4.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M13 11V5.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M16 11V8a1.5 1.5 0 0 1 3 0v6a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7l-2.6-4a1.5 1.5 0 0 1 2.4-1.8L7 13" />
  </Icon>
);

/** Conexión con el servidor. */
export const IconConnection = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 9a14 14 0 0 1 19 0" />
    <path d="M5.5 12.5a9.5 9.5 0 0 1 13 0" />
    <path d="M8.5 16a5 5 0 0 1 7 0" />
    <path d="M12 19.5h.01" />
  </Icon>
);

export const IconPlay = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 4.5v15l12-7.5Z" />
  </Icon>
);

export const IconPause = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 5v14" />
    <path d="M16 5v14" />
  </Icon>
);

export const IconSpeaker = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" />
    <path d="M15.5 9a4 4 0 0 1 0 6" />
    <path d="M18.5 6.5a8 8 0 0 1 0 11" />
  </Icon>
);

export const IconCopy = (p: IconProps) => (
  <Icon {...p}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </Icon>
);

export const IconSearch = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Icon>
);

/** Ícono de estado con forma distinta por tono (DESIGN.md §2 regla 2). */
/** Ojo abierto (trazo fino, minimalista): mostrar. */
export const IconEye = (p: IconProps) => (
  <Icon strokeWidth={1.6} {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.75" />
  </Icon>
);

/** Ojo tachado (trazo fino, minimalista): ocultar. */
export const IconEyeOff = (p: IconProps) => (
  <Icon strokeWidth={1.6} {...p}>
    <path d="M9.9 5.8A9.9 9.9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.2 7.4C3.9 9.1 2.5 12 2.5 12S6 18.5 12 18.5c1.9 0 3.5-.6 4.9-1.5" />
    <path d="M10.1 10.1a2.75 2.75 0 0 0 3.8 3.8" />
    <path d="m3.5 3.5 17 17" />
  </Icon>
);

export function ToneIcon({ tone, ...p }: IconProps & { tone: Tone }) {
  if (tone === "ok") return <IconCheck {...p} />;
  if (tone === "warn") return <IconWarning {...p} />;
  return <IconError {...p} />;
}
