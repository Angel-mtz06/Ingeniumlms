import { useEffect, useRef, useState } from "react";
import { useAlphabetRecognition } from "../hooks/useAlphabetRecognition";
import { handsUp, SpellWord } from "../lib/spell";
import { GlossChips } from "../components/GlossChips";
import { IconSpeaker, IconWarning } from "../components/icons";
import { SentencePanel } from "../components/SentencePanel";
import { TopicPicker } from "../components/TopicPicker";
import { lostMessage, type Pausing, pausingFraction, pausingText, serverIndex, validation } from "../lib/translate";
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

/** Aviso sobre el video mientras hay señas sin validar: la app no manda cuadros hasta que se elija. */
function HoldIndicator({ n }: { n: number }) {
  return (
    <div className="overlay-pill overlay-pill--hold" aria-hidden="true">
      <span>{n === 1 ? "Elige la palabra para seguir" : `Elige las ${n} palabras para seguir`}</span>
    </div>
  );
}

/** Palabra en construcción sobre el video, grande y con la última letra resaltada. */
function SpellIndicator({ word }: { word: string }) {
  const letters = [...word];
  return (
    <div className="overlay-pill overlay-pill--spell" aria-hidden="true">
      {letters.length ? (
        <span className="spell-word" translate="no">
          {letters.map((l, i) => (
            <span key={i} className="spell-word__letter" data-last={i === letters.length - 1 || undefined}>
              {l}
            </span>
          ))}
        </span>
      ) : (
        <span>Deletrea: haz la primera letra</span>
      )}
      <span className="spell-hint">Baja la mano 1 s para terminar</span>
    </div>
  );
}

/** Texto del estado de "Validar cada seña" (vacío si no hay nada pendiente). */
function validateStatus(unvalidated: number): string {
  if (unvalidated <= 0) return "";
  return unvalidated === 1 ? "Valida las palabras para formar la oración (falta 1)." : `Valida las palabras para formar la oración (faltan ${unvalidated}).`;
}

/**
 * Interpretación: cámara, señas reconocidas (validables o corregibles) y la oración en español. Al llegar una
 * oración nueva se lee en voz alta si el interruptor "Voz" está activo.
 */
export function Translate() {
  const { session, translate, translateDispatch, topic, setTopic, validate, setValidate } = useApp();
  const v = validation(translate.chips);
  // "Validar cada seña": con señas sin validar no se mandan cuadros (no se cuela otra seña) ni corre la pausa.
  const holding = validate && v.unvalidated > 0;
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
  // Deletreo: las letras se reconocen en el navegador con el mismo reconocedor de Alfabeto (modo libre). Mientras
  // tanto no se mandan cuadros al servidor (no segmenta señas); la palabra llega con add_word al terminar.
  const [spelling, setSpelling] = useState(false);
  const alpha = useAlphabetRecognition(null, "free", spelling);
  const spell = useRef(new SpellWord());
  const [word, setWord] = useState("");
  const seenLetter = alpha.stable?.[0] ?? null;
  useEffect(() => {
    if (spelling && spell.current.letter(seenLetter)) setWord(spell.current.word);
  }, [seenLetter, spelling]);

  /** Termina la palabra (si tiene letras la manda al servidor) y sale del deletreo. */
  const endSpelling = () => {
    const w = spell.current.take();
    setWord("");
    setSpelling(false);
    if (w) session.send({ type: "add_word", word: w, spelled: true });
  };
  const toggleSpelling = () => {
    if (spelling) {
      endSpelling();
      return;
    }
    spell.current.reset();
    setWord("");
    setSpelling(true);
  };
  const backspace = () => {
    if (spell.current.backspace()) setWord(spell.current.word);
  };
  // Tecla D: activa o termina el deletreo (no mientras se escribe en un campo).
  const toggleRef = useRef(toggleSpelling);
  toggleRef.current = toggleSpelling;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "d" && e.key !== "D") return;
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      e.preventDefault();
      toggleRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Mientras se corrige una seña dudosa (panel abierto) o hay señas sin validar no se mandan cuadros: así el
  // contador de quietud del servidor (pausa automática) no avanza y no se cuela otra seña a media elección.
  const correcting = useRef(false);
  const holdRef = useRef(holding);
  holdRef.current = holding;
  useFrameSink((f) => {
    if (spelling) {
      alpha.onFrame(f);
      // Bajar las manos ~1 s termina la palabra.
      if (spell.current.frame(f.t ?? performance.now(), handsUp(f))) endSpelling();
      return;
    }
    if (!correcting.current && !holdRef.current) session.send(f);
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

  const confirm = (index: number, gloss: string) => {
    const at = serverIndex(translate.chips, index);
    if (at < 0) return;
    translateDispatch({ kind: "confirm", index, gloss });
    session.send({ type: "confirm_gloss", index: at, gloss });
  };

  const remove = (index: number) => {
    const at = serverIndex(translate.chips, index);
    if (at < 0) return;
    translateDispatch({ kind: "remove", index, ghost: validate });
    session.send({ type: "remove_gloss", index: at });
  };

  const acceptAll = () => {
    translate.chips.forEach((c, i) => {
      if (!c.removed && !c.confirmed) session.send({ type: "confirm_gloss", index: serverIndex(translate.chips, i), gloss: c.gloss });
    });
    translateDispatch({ kind: "acceptAll" });
  };

  const s = translate.sentence;
  const hasContent = translate.chips.length > 0 || s !== null;
  const hasSigns = v.live > 0;

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
      <p className="visually-hidden" role="status">
        {spelling && word ? `Palabra: ${[...word].join(" ")}` : ""}
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
        <LiveCamera>
          {spelling ? (
            <SpellIndicator word={word} />
          ) : holding ? (
            <HoldIndicator n={v.unvalidated} />
          ) : translate.pausing ? (
            <PauseIndicator pausing={translate.pausing} />
          ) : null}
        </LiveCamera>
        <section className="sheet" aria-labelledby="traduccion-senas">
          <h3 id="traduccion-senas" className="sheet__title" tabIndex={-1}>
            Señas reconocidas
          </h3>
          <TopicPicker value={topic} onChange={setTopic} />
          <button type="button" role="switch" aria-checked={validate} className="switch switch--inline" onClick={() => setValidate(!validate)}>
            <span className="switch__track" aria-hidden="true">
              <span className="switch__thumb" />
            </span>
            <span className="switch__label">Validar cada seña</span>
            <span className="switch__state">{validate ? "activado" : "automático"}</span>
          </button>
          <div className="spell-row">
            <button type="button" className="btn btn--secondary" aria-pressed={spelling} aria-keyshortcuts="D" onClick={toggleSpelling}>
              {spelling ? "Terminar palabra" : "Deletrear"} <kbd aria-hidden="true">D</kbd>
            </button>
            {spelling ? (
              <button type="button" className="btn btn--quiet" onClick={backspace} disabled={!word}>
                <span aria-hidden="true">⌫</span> Borrar letra
              </button>
            ) : (
              <span className="spell-row__hint">Para nombres: letra por letra con el alfabeto manual.</span>
            )}
          </div>
          {spelling ? (
            <div className="spell">
              <p className="spell__word" translate="no" aria-hidden="true">
                {word ? (
                  [...word].map((l, i) => (
                    <span key={i} className="spell-word__letter" data-last={i === word.length - 1 || undefined}>
                      {l}
                    </span>
                  ))
                ) : (
                  <span className="spell__placeholder">Haz la primera letra</span>
                )}
              </p>
              <p className="sheet__hint">
                Sostén cada letra un momento. Para repetir una letra, mueve la mano entre las dos. Baja la mano 1 s para terminar.
                {seenLetter ? ` Veo: ${seenLetter}.` : ""}
              </p>
            </div>
          ) : null}
          {validate ? (
            <p className="sheet__hint">
              Toca la palabra correcta o <strong>Ninguna</strong>. Con teclado: <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> eligen, <kbd>X</kbd> quita y las flechas{" "}
              <kbd aria-hidden="true">↑</kbd> <kbd aria-hidden="true">↓</kbd>
              <span className="visually-hidden">arriba y abajo</span> cambian de seña.
            </p>
          ) : (
            <p className="sheet__hint">Toca una seña para cambiarla o quitarla. Las dudosas dicen “¿revisar?”.</p>
          )}
          {hasSigns ? (
            <p className="sheet__hint">Forma la oración antes de practicar o calibrar: al cambiar de modo, las señas sin oración se borran.</p>
          ) : null}
          {validate ? (
            <p className="sheet__status" role="status">
              {validateStatus(v.unvalidated)}
            </p>
          ) : null}
          <GlossChips
            items={translate.chips}
            validate={validate}
            onConfirm={confirm}
            onRemove={remove}
            onOpenChange={(open) => {
              // El confirm_gloss/remove_gloss ya salió (se envía antes de cerrar): los cuadros siguen detrás.
              correcting.current = open;
            }}
          />
          <div className="sheet__actions">
            {validate ? (
              <>
                <button type="button" className="btn btn--primary" onClick={build} disabled={!session.connected || !v.ready}>
                  Formar oración
                </button>
                <button type="button" className="btn btn--secondary" onClick={acceptAll} disabled={v.unvalidated === 0}>
                  Aceptar todas las sugeridas
                </button>
              </>
            ) : (
              <button type="button" className="btn btn--secondary" onClick={build} disabled={!session.connected}>
                Formar oración ahora
              </button>
            )}
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
