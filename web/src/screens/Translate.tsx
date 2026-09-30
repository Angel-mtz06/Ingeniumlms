import { useEffect, useRef, useState } from "react";
import { GlossChips } from "../components/GlossChips";
import { IconSpeaker, IconWarning } from "../components/icons";
import { SentencePanel } from "../components/SentencePanel";
import { TopicPicker } from "../components/TopicPicker";
import { lostMessage, type Pausing, pausingFraction, pausingText } from "../lib/translate";
import { LiveCamera } from "./LiveCamera";
import { ServerNotice, useApp, useFrameSink, useSessionMode } from "./shared";

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
 * Cuenta regresiva de la pausa de oración, sobre el video: texto y una barra que se vacía. Solo visual;
 * el anuncio accesible es una región viva aparte que se escribe una vez al empezar (no cada 0.5 s).
 */
function PauseIndicator({ pausing }: { pausing: Pausing }) {
  return (
    <div className="overlay-pill overlay-pill--pause" aria-hidden="true">
      <span className="tabular">{pausingText(pausing.remaining)}</span>
      <span className="pause-meter">
        <span className="pause-meter__fill" style={{ transform: `scaleX(${pausingFraction(pausing)})` }} />
      </span>
    </div>
  );
}

/**
 * Traducción: cámara, señas reconocidas (corregibles) y la oración en español. Al llegar una
 * oración nueva se lee en voz alta si el interruptor "Voz" está activo.
 */
export function Translate() {
  const { session, translate, translateDispatch, topic, setTopic } = useApp();
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

  // Texto de la región viva de señas borradas: se escribe después de montar la región.
  const [lostAnnounce, setLostAnnounce] = useState("");
  useEffect(() => {
    const text = lostMessage(translate.lost);
    if (!text) {
      setLostAnnounce("");
      return;
    }
    const id = window.setTimeout(() => setLostAnnounce(text), 150);
    return () => window.clearTimeout(id);
  }, [translate.lost]);

  // Anuncio de la pausa: al empezar la cuenta regresiva (no en cada aviso) y vacío al cancelarse.
  const [pauseAnnounce, setPauseAnnounce] = useState("");
  const pauseStartS = translate.pausing ? Math.max(1, Math.ceil(translate.pausing.remaining)) : 0;
  const pauseRunning = pauseStartS > 0;
  useEffect(() => {
    // Solo depende de si corre: los avisos siguientes (cada 0.5 s) no vuelven a escribir la región.
    setPauseAnnounce(pauseRunning ? `Formando oración en ${pauseStartS} segundos. Sube las manos para seguir.` : "");
  }, [pauseRunning]);

  useSessionMode("translate", null);
  // Mientras se corrige una seña dudosa no se mandan cuadros: así el contador de quietud del
  // servidor (pausa automática) no avanza y no forma la oración a media corrección.
  const correcting = useRef(false);
  useFrameSink((f) => {
    if (!correcting.current) session.send(f);
  });

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
        <h2 className="screen__title">Interpretación en vivo</h2>
        <p className="screen__lead">Haz las señas una tras otra. Cuando bajas las manos unos segundos, la app forma la oración en español.</p>
      </header>

      <ServerNotice />
      {/* Región viva siempre montada (vacía al montar) y rellenada después: así sí se anuncia. */}
      <p className="visually-hidden" role="status">
        {lostAnnounce}
      </p>
      <p className="visually-hidden" role="status">
        {pauseAnnounce}
      </p>
      {translate.lost > 0 ? (
        <div className="notice notice--warn notice--action">
          <IconWarning />
          <span className="notice__text">{lostMessage(translate.lost)}</span>
          <button type="button" className="btn btn--quiet" onClick={() => translateDispatch({ kind: "dismissLost" })}>
            Entendido
          </button>
        </div>
      ) : null}

      <div className="translate-grid">
        <LiveCamera>{translate.pausing ? <PauseIndicator pausing={translate.pausing} /> : null}</LiveCamera>
        <section className="sheet" aria-labelledby="traduccion-senas">
          <h3 id="traduccion-senas" className="sheet__title" tabIndex={-1}>
            Señas reconocidas
          </h3>
          <TopicPicker value={topic} onChange={setTopic} />
          <p className="sheet__hint">Toca una seña para cambiarla o quitarla. Las dudosas dicen “¿revisar?”.</p>
          {translate.chips.length > 0 ? (
            <p className="sheet__hint">Forma la oración antes de practicar o calibrar: al cambiar de modo, las señas sin oración se borran.</p>
          ) : null}
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
            onOpenChange={(open) => {
              // El confirm_gloss/remove_gloss ya salió (se envía antes de cerrar): los cuadros siguen detrás.
              correcting.current = open;
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
          glosses={s?.glosses ?? []}
          corrected={s?.corrected ?? []}
          onSpeak={() => s && speak(s.text)}
          onCopy={() => navigator.clipboard.writeText(s?.text ?? "")}
        />
      </div>
    </div>
  );
}
