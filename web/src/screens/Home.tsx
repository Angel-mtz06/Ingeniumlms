import type { MouseEvent } from "react";
import { IconCamera, IconSpeaker } from "../components/icons";
import { StatusBar } from "../components/StatusBar";
import { GloveControls, HealthNotice, useApp } from "./shared";

/**
 * Inicio: las dos entradas principales (Práctica y Traducción), el estado del sistema
 * y la conexión opcional de los guantes.
 */
export function Home() {
  const { gloves, session, vision, cameraStatus, go } = useApp();
  const anyGlove = gloves.sides.L.connected || gloves.sides.R.connected;
  // Enlaces reales (Ctrl/clic medio abren otra pestaña); el clic normal cambia de pestaña y mueve el foco.
  const link = (tab: "practica" | "traduccion" | "calibracion") => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    go(tab);
  };

  return (
    <div className="screen">
      <header className="screen__head">
        <h2 className="screen__title">¿Qué quieres hacer?</h2>
        <p className="screen__lead">Todo funciona con tu cámara. Los guantes son opcionales y ayudan a leer mejor los dedos.</p>
      </header>

      <HealthNotice />

      <div className="entries">
        <a href="#practica" className="entry" onClick={link("practica")}>
          <span className="entry__icon">
            <IconCamera size={32} />
          </span>
          <span className="entry__title">Práctica</span>
          <span className="entry__text">Elige una seña, mira el ejemplo y recibe una calificación con lo que debes corregir.</span>
          <span className="entry__go">Ir a Práctica</span>
        </a>
        <a href="#traduccion" className="entry" onClick={link("traduccion")}>
          <span className="entry__icon">
            <IconSpeaker size={32} />
          </span>
          <span className="entry__title">Traducción</span>
          <span className="entry__text">Haz varias señas seguidas y la app forma la oración en español, lista para leerse en voz alta.</span>
          <span className="entry__go">Ir a Traducción</span>
        </a>
      </div>

      <section className="sheet" aria-labelledby="inicio-estado">
        <h3 id="inicio-estado" className="sheet__title">
          Estado del sistema
        </h3>
        <StatusBar
          camera={cameraStatus}
          gloves={{ L: gloves.sides.L, R: gloves.sides.R, supported: gloves.supported }}
          connected={session.connected}
          fps={vision.fps}
          paused
        />
      </section>

      <section className="sheet" aria-labelledby="inicio-guantes">
        <h3 id="inicio-guantes" className="sheet__title">
          Guantes <span className="sheet__aside">(opcional)</span>
        </h3>
        <GloveControls />
        {anyGlove ? (
          <p className="sheet__next">
            Antes de practicar, calibra los guantes para que la app conozca tu mano abierta y tu puño.{" "}
            <a href="#calibracion" className="btn btn--quiet btn--inline" onClick={link("calibracion")}>
              Ir a Calibración
            </a>
          </p>
        ) : null}
      </section>
    </div>
  );
}
