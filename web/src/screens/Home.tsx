import type { MouseEvent } from "react";
import { IconBook, IconCamera, IconGamepad, IconHeartPulse, IconPeople, IconSpeaker } from "../components/icons";
import { StatusBar } from "../components/StatusBar";
import { GloveControls, HealthNotice, useApp } from "./shared";

/**
 * Inicio: para qué sirve SingLink, las entradas principales (Práctica, Interpretación y Juegos),
 * a quién buscamos ayudar, el estado del sistema y la conexión de los guantes.
 */
export function Home() {
  const { gloves, session, vision, cameraStatus, go } = useApp();
  const anyGlove = gloves.sides.L.connected || gloves.sides.R.connected;
  // Enlaces reales (Ctrl/clic medio abren otra pestaña); el clic normal cambia de pestaña y mueve el foco.
  const link = (tab: "practica" | "traduccion" | "juegos" | "calibracion") => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    go(tab);
  };

  return (
    <div className="screen">
      <section className="home-about" aria-label="Qué es SingLink">
        <p className="home-about__text">
          <strong className="home-about__name" translate="no">SingLink:</strong> sirve para aprender Lengua de Señas
          Mexicana y comunicarte con ella. La cámara lee tus manos, te dice qué corregir y convierte tus señas en texto
          y voz.
        </p>
      </section>

      <HealthNotice />

      <h2 className="home-section-title">¿Qué quieres hacer?</h2>
      <div className="entries">
        <a href="#practica" className="entry" onClick={link("practica")}>
          <span className="entry__icon">
            <IconCamera size={40} strokeWidth={1.75} />
          </span>
          <span className="entry__title">Práctica</span>
          <span className="entry__text">Aprende señas y recibe consejos al momento.</span>
          <span className="entry__go">Ir a Práctica</span>
        </a>
        <a href="#traduccion" className="entry" onClick={link("traduccion")}>
          <span className="entry__icon">
            <IconSpeaker size={40} strokeWidth={1.75} />
          </span>
          <span className="entry__title">Interpretación</span>
          <span className="entry__text">Haz señas y conviértelas en texto y voz.</span>
          <span className="entry__go">Ir a Interpretación</span>
        </a>
        <a href="#juegos" className="entry" onClick={link("juegos")}>
          <span className="entry__icon">
            <IconGamepad size={40} strokeWidth={1.75} />
          </span>
          <span className="entry__title">Juegos</span>
          <span className="entry__text">Aprende jugando con letras y señas.</span>
          <span className="entry__go">Ir a Juegos</span>
        </a>
      </div>

      <section className="home-help" aria-labelledby="inicio-ayudar">
        <h2 id="inicio-ayudar" className="home-section-title">A quién buscamos ayudar</h2>
        <p className="home-help__lead">Que más personas oyentes aprendan LSM y que la comunidad sorda se comunique sin barreras.</p>
        <ul className="home-help__cards">
          <li className="home-help__card">
            <span className="entry__icon" aria-hidden="true"><IconPeople size={36} strokeWidth={1.75} /></span>
            <h3 className="home-help__title">Familias</h3>
            <p className="home-help__text">Para que en casa todos puedan hablar en señas.</p>
          </li>
          <li className="home-help__card">
            <span className="entry__icon" aria-hidden="true"><IconBook size={36} strokeWidth={1.75} /></span>
            <h3 className="home-help__title">Escuelas</h3>
            <p className="home-help__text">Para enseñar y practicar LSM en clase.</p>
          </li>
          <li className="home-help__card">
            <span className="entry__icon" aria-hidden="true"><IconHeartPulse size={36} strokeWidth={1.75} /></span>
            <h3 className="home-help__title">Salud y emergencias</h3>
            <p className="home-help__text">Para pedir ayuda y entenderse cuando más importa.</p>
          </li>
        </ul>
      </section>

      <div className="home-panels">
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
    </div>
  );
}
