import { useEffect, useRef, useState } from "react";
import { GlossChips } from "../components/GlossChips";
import { IconSpeaker } from "../components/icons";
import { SentencePanel } from "../components/SentencePanel";
import { CameraStage, ServerNotice, useApp, useFrameSink, useSessionMode } from "./shared";

const VOICE_KEY = "lsm.voz";

function readVoice(): boolean {
  try {
    return localStorage.getItem(VOICE_KEY) !== "0";
  } catch {
    return true;
  }
}

const speechSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

/** Lee `text` en español de México con la mejor voz disponible. La voz es para la persona oyente. */
function speak(text: string) {
  if (!speechSupported() || !text.trim()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "es-MX";
  const voices = synth.getVoices();
  const voice = voices.find((v) => v.lang.toLowerCase() === "es-mx") ?? voices.find((v) => v.lang.toLowerCase().startsWith("es"));
  if (voice) u.voice = voice;
  synth.speak(u);
}

/**
 * Traducción: cámara, señas reconocidas (corregibles) y la oración en español. Al llegar una
 * oración nueva se lee en voz alta si el interruptor "Voz" está activo.
 */
export function Translate() {
  const { session, translate, translateDispatch } = useApp();
  const [voice, setVoice] = useState(readVoice);
  const [confirmClear, setConfirmClear] = useState(false);
  const clearBtn = useRef<HTMLButtonElement | null>(null);
  const wasConfirming = useRef(false);
  // Al cerrar la confirmación el foco vuelve a "Borrar todo" (o al panel si ya no hay nada que borrar).
  useEffect(() => {
    if (wasConfirming.current && !confirmClear) (clearBtn.current && !clearBtn.current.disabled ? clearBtn.current : document.getElementById("traduccion-senas"))?.focus();
    wasConfirming.current = confirmClear;
  }, [confirmClear]);
  const canSpeak = speechSupported();

  useSessionMode("translate", null);
  useFrameSink((f) => session.send(f));

  // Solo se leen las oraciones que llegan con la pantalla abierta (no la que ya estaba al entrar).
  const spoken = useRef(translate.sentence);
  useEffect(() => {
    const s = translate.sentence;
    if (!s || s === spoken.current) return;
    spoken.current = s;
    if (voice && canSpeak) speak(s.text);
  }, [translate.sentence, voice, canSpeak]);

  useEffect(() => () => {
    if (speechSupported()) window.speechSynthesis.cancel();
  }, []);

  const toggleVoice = () => {
    const next = !voice;
    setVoice(next);
    if (!next && canSpeak) window.speechSynthesis.cancel();
    try {
      localStorage.setItem(VOICE_KEY, next ? "1" : "0");
    } catch {
      /* sin almacenamiento: la preferencia dura solo esta visita */
    }
  };

  const build = () => {
    translateDispatch({ kind: "build" });
    session.send({ type: "build_sentence" });
  };

  const clearAll = () => {
    setConfirmClear(false);
    if (canSpeak) window.speechSynthesis.cancel();
    translateDispatch({ kind: "clear" });
    session.send({ type: "reset" });
  };

  const s = translate.sentence;
  const hasContent = translate.chips.length > 0 || s !== null;

  return (
    <div className="screen">
      <header className="screen__head">
        <h2 className="screen__title">Traducción en vivo</h2>
        <p className="screen__lead">Haz las señas una tras otra. Cuando haces una pausa, la app forma la oración en español.</p>
      </header>

      <ServerNotice />

      <div className="translate-grid">
        <CameraStage />
        <section className="sheet" aria-labelledby="traduccion-senas">
          <h3 id="traduccion-senas" className="sheet__title" tabIndex={-1}>
            Señas reconocidas
          </h3>
          <p className="sheet__hint">Toca una seña para cambiarla o quitarla. Las dudosas dicen “¿revisar?”.</p>
          <GlossChips
            items={translate.chips}
            onConfirm={(index, gloss) => {
              translateDispatch({ kind: "confirm", index, gloss });
              session.send({ type: "confirm_gloss", index, gloss });
            }}
            onRemove={(index) => {
              translateDispatch({ kind: "remove", index });
              session.send({ type: "remove_gloss", index });
            }}
          />
          <div className="sheet__actions">
            <button type="button" className="btn btn--secondary" onClick={build} disabled={!session.connected}>
              Formar oración ahora
            </button>
            {confirmClear ? (
              <span className="confirm" role="group" aria-label="Confirmar borrado">
                <span className="confirm__text">Se borran las señas y la conversación.</span>
                <button type="button" className="btn btn--secondary" onClick={clearAll} autoFocus>
                  Sí, borrar todo
                </button>
                <button type="button" className="btn btn--quiet" onClick={() => setConfirmClear(false)}>
                  No borrar
                </button>
              </span>
            ) : (
              <button ref={clearBtn} type="button" className="btn btn--quiet" onClick={() => setConfirmClear(true)} disabled={!hasContent}>
                Borrar todo
              </button>
            )}
          </div>
          <p className="sheet__status" role="status">
            {translate.notice === "empty" ? "Todavía no hay señas para formar una oración. Haz una seña primero." : ""}
          </p>
        </section>
      </div>

      <div className="sentence-block">
        <div className="voice-row">
          <button type="button" role="switch" aria-checked={voice && canSpeak} className="switch" onClick={toggleVoice} disabled={!canSpeak}>
            <span className="switch__track" aria-hidden="true">
              <span className="switch__thumb" />
            </span>
            <IconSpeaker />
            <span className="switch__label">Voz</span>
            <span className="switch__state">{!canSpeak ? "no disponible" : voice ? "leer cada oración nueva" : "desactivada"}</span>
          </button>
          {canSpeak ? null : <p className="voice-row__note">Este navegador no puede leer en voz alta.</p>}
        </div>
        <SentencePanel
          text={s?.text ?? ""}
          paragraph={s?.paragraph ?? ""}
          source={s?.source ?? "template"}
          onSpeak={() => s && speak(s.text)}
          onCopy={() => navigator.clipboard.writeText(s?.text ?? "")}
        />
      </div>
    </div>
  );
}
