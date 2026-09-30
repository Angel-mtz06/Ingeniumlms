import { useEffect, useRef, useState } from "react";
import { GlossChips } from "../components/GlossChips";
import { IconSpeaker, IconWarning } from "../components/icons";
import { ScoreGauge } from "../components/ScoreGauge";
import { SentencePanel } from "../components/SentencePanel";
import { TopicPicker } from "../components/TopicPicker";
import { useAlphabetRecognition } from "../hooks/useAlphabetRecognition";
import { freeGauge } from "../lib/alphabetView";
import { QXAttempt, qxInProgress, SpellingTracker, type SpellEvent } from "../lib/spelling";
import { bestCandidate, lostMessage, NewSignDetector, type Pausing, pausingFraction, pausingText, pendingKeys, serverIndex, validation } from "../lib/translate";
import type { FramePayload } from "../lib/protocol";
import { LiveCamera } from "./LiveCamera";
import { ServerNotice, useApp, useFrameSink, useSessionMode } from "./shared";

const VOICE_KEY = "lsm.voz";
/** "Validar cada seña": si nadie elige, a los AUTO_PICK_MS se queda la candidata de mayor %. */
const AUTO_PICK_MS = 5000;
/** Una seña que era en realidad la 1a letra de un deletreo (p. ej. SÍ con la S): durante este tiempo tras
 *  aparecer, las letras siguen leyéndose; si empieza el deletreo, el servidor la aparta. */
const LETTER_GRACE_MS = 2500;

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
function HoldIndicator({ n, left }: { n: number; left: number | null }) {
  return (
    <div className="overlay-pill overlay-pill--hold" aria-hidden="true">
      <span>{n === 1 ? "Elige la palabra para seguir" : `Elige las ${n} palabras para seguir`}</span>
      {left !== null ? <span className="spell-hint">Si no eliges, en {left} s queda la de mayor % · si haces otra seña, se descarta</span> : null}
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
      <span className="spell-hint">Baja la mano para terminar</span>
    </div>
  );
}

/**
 * Interpretación: cámara, señas reconocidas (validables o corregibles) y la oración en español. Al llegar una
 * oración nueva se lee en voz alta si el interruptor "Voz" está activo.
 *
 * Palabras y letras a la vez: cada cuadro va al servidor (señas de palabras) y al reconocimiento del
 * alfabeto del navegador (el de Alfabeto → Libre, con J, Ñ, Q, X y Z). La primera letra empieza un
 * deletreo (SpellingTracker): el servidor aparta las señas de esos cuadros, que eran el deletreo, y
 * al terminar entra la palabra como "M-A-R-I-O" (mensaje `spelling`).
 */
export function Translate() {
  const { session, translate, translateDispatch, topic, setTopic, validate, setValidate } = useApp();
  const v = validation(translate.chips);
  // "Validar cada seña": con señas sin validar no se mandan cuadros (no se cuela otra seña) ni corre la pausa.
  // Si la persona ya empezó otra seña sin elegir, esas señas se descartan (como si no se hubieran guardado).
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
  // Mientras se corrige una seña dudosa (panel abierto) o hay señas sin validar no se mandan cuadros: así el
  // contador de quietud del servidor (pausa automática) no avanza y no se cuela otra seña a media elección.
  const correcting = useRef(false);
  const holdRef = useRef(holding);
  holdRef.current = holding;
  // Letras: siempre activas, junto con las palabras del servidor. Mientras se elige una seña no se leen,
  // salvo en los primeros LETTER_GRACE_MS (esa "seña" pudo ser la 1a letra) o si ya se está deletreando.
  const alpha = useAlphabetRecognition(null, "free", true);
  const speller = useRef(new SpellingTracker());
  // Q y X no dejan letra mientras se forman (solo al terminar el movimiento): su intento en curso mantiene
  // abiertas las letras y el deletreo, y si la palabra empieza con ellas el servidor aparta desde su inicio.
  const qxActive = useRef("");
  qxActive.current = alpha.freeActive;
  const qxAttempt = useRef(new QXAttempt());
  const holdSince = useRef<number | null>(null);
  const newSign = useRef(new NewSignDetector());
  const held = useRef<FramePayload[]>([]);
  const chipsRef = useRef(translate.chips);
  chipsRef.current = translate.chips;
  /** Quita las señas sin validar (de la última a la primera: así los índices siguen valiendo). */
  const discardPending = () => {
    const chips = chipsRef.current;
    for (const p of pendingKeys(chips).reverse()) {
      translateDispatch({ kind: "remove", index: p.index });
      session.send({ type: "remove_gloss", index: serverIndex(chips, p.index) });
    }
  };
  useEffect(() => {
    holdSince.current = holding ? performance.now() : null;
    newSign.current.start(performance.now());
    held.current = [];
  }, [holding]);
  const lettersOpen = () => !holdRef.current || holdSince.current === null || speller.current.active
    || performance.now() - holdSince.current < LETTER_GRACE_MS || qxInProgress(qxActive.current);
  useFrameSink((f) => {
    if (correcting.current) return;
    if (!holdRef.current) session.send(f);
    else {
      // Esperando la elección: se guardan los últimos cuadros por si la persona ya empezó otra seña; entonces
      // la espera se salta y el servidor recibe también el inicio de esa seña (no se pierde).
      const t = f.t ?? performance.now();
      held.current.push(f);
      held.current = held.current.filter((x) => t - (x.t ?? t) <= 900);
      if (newSign.current.push(t, f.hands)) {
        // Ya empezó otra seña sin elegir: la anterior se descarta y la nueva llega completa al servidor.
        holdRef.current = false;
        discardPending();
        held.current.forEach((x) => session.send(x));
        held.current = [];
      }
    }
    if (lettersOpen()) alpha.onFrame(f);
  });
  const [letters, setLetters] = useState<string[]>([]);
  const [spelling, setSpelling] = useState(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const sendSpell = (ev: SpellEvent) => {
    if (ev.kind === "end") {
      sessionRef.current.send(ev.lone ? { type: "spelling", active: false, word: null, letter: ev.lone } : { type: "spelling", active: false, word: ev.word });
      return;
    }
    const lookback = qxAttempt.current.lookback(performance.now(), speller.current.letters[0]);
    sessionRef.current.send(lookback === undefined ? { type: "spelling", active: true } : { type: "spelling", active: true, lookback_s: lookback });
  };
  const syncSpell = () => { setLetters(speller.current.letters); setSpelling(speller.current.active); };
  const sendSpellRef = useRef(sendSpell);
  sendSpellRef.current = sendSpell;
  const liveLetter = useRef({ stable: null as string | null, busy: false });
  liveLetter.current = { stable: alpha.stable?.[0] ?? null, busy: alpha.phase === "capturing" };
  useEffect(() => {
    const id = window.setInterval(() => {
      // Mientras se elige una seña (pasada la gracia) el reconocedor no recibe cuadros: su última letra no cuenta.
      const open = lettersOpen(), now = performance.now();
      const l = open ? liveLetter.current : { stable: null, busy: false };
      // Formando una Q o X (sin letra todavía) el deletreo tampoco termina.
      const qx = qxAttempt.current.push(now, open ? qxActive.current : "");
      speller.current.push(now, l.stable, l.busy || qx).forEach((ev) => sendSpellRef.current(ev));
      syncSpell();
    }, 100);
    return () => {
      window.clearInterval(id);
      // Al salir de la pantalla a media palabra, la palabra se agrega (o se regresan las señas apartadas).
      if (speller.current.active) sendSpellRef.current(speller.current.finish());
    };
  }, []);
  const finishWord = (keep = true) => {
    if (speller.current.active) sendSpell(speller.current.finish(keep));
    syncSpell();
  };
  const word = letters.join("");
  const showLetter = spelling || alpha.stable !== null || alpha.phase !== "idle";

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
    finishWord(); // una palabra a media deletreo también cuenta
    translateDispatch({ kind: "build" });
    session.send({ type: "build_sentence" });
  };

  const clearAll = () => {
    setConfirmClear(false);
    if (canSpeak) window.speechSynthesis.cancel();
    translateDispatch({ kind: "clear" });
    session.send({ type: "reset" });
    speller.current.clear();
    syncSpell();
  };

  const confirm = (index: number, gloss: string) => {
    const at = serverIndex(translate.chips, index);
    if (at < 0) return;
    translateDispatch({ kind: "confirm", index, gloss });
    session.send({ type: "confirm_gloss", index: at, gloss });
  };

  // "Validar cada seña" sin elegir: a los AUTO_PICK_MS la seña pendiente más antigua se queda con la de mayor %
  // (no mientras se deletrea ni con el panel de corrección abierto). Cada seña cuenta desde que apareció.
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;
  const arrivedAt = useRef(new Map<string, number>());
  const [autoLeft, setAutoLeft] = useState<number | null>(null);
  useEffect(() => {
    const pend = pendingKeys(translate.chips);
    const keys = new Set(pend.map((p) => p.key));
    if (!validate || !pend.length) { arrivedAt.current.clear(); setAutoLeft(null); return; }
    const now = performance.now();
    for (const k of [...arrivedAt.current.keys()]) if (!keys.has(k)) arrivedAt.current.delete(k);
    for (const k of keys) if (!arrivedAt.current.has(k)) arrivedAt.current.set(k, now);
    const first = pend[0];
    const tick = () => {
      if (speller.current.active || correcting.current) { setAutoLeft(null); return; }
      const left = (arrivedAt.current.get(first.key) ?? performance.now()) + AUTO_PICK_MS - performance.now();
      if (left <= 0) { window.clearInterval(id); confirmRef.current(first.index, bestCandidate(translate.chips[first.index])); return; }
      setAutoLeft(Math.ceil(left / 1000));
    };
    const id = window.setInterval(tick, 250);
    tick();
    return () => window.clearInterval(id);
  }, [translate.chips, validate]);

  const remove = (index: number) => {
    const at = serverIndex(translate.chips, index);
    if (at < 0) return;
    // "Ninguna" la quita de la lista: la siguiente lectura ocupa su lugar (misma posición y número).
    translateDispatch({ kind: "remove", index });
    session.send({ type: "remove_gloss", index: at });
  };

  const acceptAll = () => {
    translate.chips.forEach((c, i) => {
      if (!c.removed && !c.confirmed) session.send({ type: "confirm_gloss", index: serverIndex(translate.chips, i), gloss: c.gloss });
    });
    translateDispatch({ kind: "acceptAll" });
  };

  const s = translate.sentence;
  const hasContent = translate.chips.length > 0 || s !== null || letters.length > 0;

  return (
    <div className="screen translate-screen">
      <div className="translate-grid">
        <div className="translate-main">
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
          <LiveCamera corner={showLetter ? <ScoreGauge view={freeGauge(alpha.stable, alpha.feedback)} /> : undefined}>
            {spelling ? (
              <SpellIndicator word={word} />
            ) : holding ? (
              <HoldIndicator n={v.unvalidated} left={autoLeft} />
            ) : translate.pausing ? (
              <PauseIndicator pausing={translate.pausing} />
            ) : null}
          </LiveCamera>
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
        <div className="translate-side">
        <section className="sheet translate-spell" aria-labelledby="traduccion-deletreo" data-on={spelling || undefined}>
          <h3 id="traduccion-deletreo" className="sheet__title">Letras (deletreo)</h3>
          <p className="alfa-free-letters__text translate-spell__word" translate="no" aria-live="polite" aria-label={word ? `Deletreando: ${word}` : "Sin letras"}>
            {letters.length
              ? letters.map((l, i) => <span key={i} data-last={i === letters.length - 1 || undefined}>{l}</span>)
              : <span className="translate-spell__empty">…</span>}
          </p>
          {letters.length ? (
            <div className="sheet__actions">
              <button type="button" className="btn btn--primary" onClick={() => finishWord()} disabled={!session.connected}>
                {letters.length >= 2 ? <>Agregar <span translate="no">«{word}»</span></> : "Terminar"}
              </button>
              <button type="button" className="btn btn--secondary" onClick={() => { speller.current.removeLast(); syncSpell(); }}>
                Borrar letra
              </button>
              <button type="button" className="btn btn--quiet" onClick={() => finishWord(false)}>
                No era deletreo
              </button>
            </div>
          ) : null}
        </section>
        <section className="sheet" aria-labelledby="traduccion-senas">
          <h3 id="traduccion-senas" className="sheet__title" tabIndex={-1}>
            Señas reconocidas
          </h3>
          <div className="translate-controls">
            <TopicPicker value={topic} onChange={setTopic} />
            <button type="button" role="switch" aria-checked={validate} className="switch switch--inline" onClick={() => setValidate(!validate)}>
              <span className="switch__track" aria-hidden="true">
                <span className="switch__thumb" />
              </span>
              <span className="switch__label">Validar cada seña</span>
              <span className="switch__state">{validate ? "activado" : "automático"}</span>
            </button>
          </div>
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
      </div>
    </div>
  );
}
