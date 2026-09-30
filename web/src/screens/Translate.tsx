import { useEffect, useRef, useState } from "react";
import { GlossChips } from "../components/GlossChips";
import { IconSpeaker, IconWarning, ToneIcon } from "../components/icons";
import { ScoreGauge } from "../components/ScoreGauge";
import { SentencePanel } from "../components/SentencePanel";
import { useAlphabetRecognition, useLetterSequence } from "../hooks/useAlphabetRecognition";
import { freeGauge, spellStatus } from "../lib/alphabetView";
import { lostMessage } from "../lib/translate";
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
 * Traducción: cámara, señas reconocidas (corregibles) y la oración en español. Al llegar una
 * oración nueva se lee en voz alta si el interruptor "Voz" está activo.
 *
 * Deletreo: con el interruptor "Deletrear", los cuadros van al reconocimiento del alfabeto (el mismo
 * de Alfabeto → Libre, con las letras con movimiento) en lugar del servidor, para que el deletreo no
 * se tome como señas de palabras. La palabra entra a las señas como "M-A-R-I-O" (add_gloss).
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

  useSessionMode("translate", null);
  // Mientras se corrige una seña dudosa no se mandan cuadros: así el contador de quietud del
  // servidor (pausa automática) no avanza y no forma la oración a media corrección.
  const correcting = useRef(false);
  const [spelling, setSpelling] = useState(false);
  const alpha = useAlphabetRecognition(null, "free", spelling);
  const [letters, setLetters] = useLetterSequence(spelling ? alpha.stable?.[0] ?? null : null);
  useFrameSink((f) => {
    if (spelling) alpha.onFrame(f);
    else if (!correcting.current) session.send(f);
  });
  const word = letters.join("");
  /** Manda la palabra deletreada a las señas pendientes (el servidor responde con un `sign`). */
  const addWord = () => {
    if (!letters.length || !session.connected) return;
    session.send({ type: "add_gloss", gloss: letters.join("-") });
    setLetters([]);
  };
  // Al apagar Deletrear, la palabra que quedó se agrega: apagarlo es "ya terminé de deletrear".
  const toggleSpelling = () => {
    if (spelling) addWord();
    setSpelling(!spelling);
  };
  const status = spelling ? spellStatus(alpha) : null;

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
    addWord(); // una palabra deletreada sin agregar también cuenta
    translateDispatch({ kind: "build" });
    session.send({ type: "build_sentence" });
  };

  const clearAll = () => {
    setConfirmClear(false);
    if (canSpeak) window.speechSynthesis.cancel();
    translateDispatch({ kind: "clear" });
    session.send({ type: "reset" });
    setLetters([]);
  };

  const s = translate.sentence;
  const hasContent = translate.chips.length > 0 || s !== null || letters.length > 0;

  return (
    <div className="screen">
      <header className="screen__head">
        <h2 className="screen__title">Interpretación en vivo</h2>
        <p className="screen__lead">Haz las señas una tras otra. Cuando haces una pausa, la app forma la oración en español.</p>
      </header>

      <ServerNotice />
      {/* Región viva siempre montada (vacía al montar) y rellenada después: así sí se anuncia. */}
      <p className="visually-hidden" role="status">
        {lostAnnounce}
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
        <LiveCamera corner={spelling ? <ScoreGauge view={freeGauge(alpha.stable, alpha.feedback)} /> : undefined}>
          {spelling ? <p className="overlay-pill" role="status"><span>Deletreando</span></p> : null}
        </LiveCamera>
        <div className="translate-side">
        <section className="sheet translate-spell" aria-labelledby="traduccion-deletreo" data-on={spelling || undefined}>
          <div className="translate-spell__head">
            <h3 id="traduccion-deletreo" className="sheet__title">Deletreo</h3>
            <button type="button" role="switch" aria-checked={spelling} className="switch" onClick={toggleSpelling}>
              <span className="switch__track" aria-hidden="true">
                <span className="switch__thumb" />
              </span>
              <span className="switch__label">Deletrear</span>
              <span className="switch__state">{spelling ? "reconociendo letras" : "apagado"}</span>
            </button>
          </div>
          <p className="sheet__hint">
            {spelling
              ? "Haz las letras del alfabeto una por una (J, Ñ, Q, X y Z con su movimiento). Mientras deletreas no se reconocen señas de palabras; al apagarlo, la palabra se agrega a las señas."
              : "Para nombres o palabras sin seña: activa Deletrear y haz las letras del alfabeto."}
          </p>
          {spelling || letters.length ? (
            <>
              <p className="alfa-free-letters__text translate-spell__word" translate="no" aria-live="polite" aria-label={word ? `Palabra: ${word}` : "Sin letras todavía"}>
                {letters.length
                  ? letters.map((l, i) => <span key={i} data-last={i === letters.length - 1 || undefined}>{l}</span>)
                  : <span className="translate-spell__empty">…</span>}
              </p>
              {status ? (
                <p className="translate-spell__status" data-tone={status.tone} role="status">
                  {status.tone === "ok" ? <ToneIcon tone="ok" /> : status.tone === "warn" ? <IconWarning /> : null}
                  <span>{status.text}</span>
                </p>
              ) : null}
              <div className="sheet__actions">
                <button type="button" className="btn btn--primary" onClick={addWord} disabled={!letters.length || !session.connected}>
                  {word ? <>Agregar <span translate="no">«{word}»</span></> : "Agregar palabra"}
                </button>
                <button type="button" className="btn btn--secondary" onClick={() => setLetters((l) => l.slice(0, -1))} disabled={!letters.length}>
                  Borrar letra
                </button>
                <button type="button" className="btn btn--quiet" onClick={() => setLetters([])} disabled={!letters.length}>
                  Borrar palabra
                </button>
              </div>
            </>
          ) : null}
        </section>
        <section className="sheet" aria-labelledby="traduccion-senas">
          <h3 id="traduccion-senas" className="sheet__title" tabIndex={-1}>
            Señas reconocidas
          </h3>
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
