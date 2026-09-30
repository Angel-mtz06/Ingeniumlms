import { useEffect, useRef, useState } from "react";
import { GlossChips } from "../components/GlossChips";
import { IconSpeaker, IconWarning, ToneIcon } from "../components/icons";
import { ScoreGauge } from "../components/ScoreGauge";
import { SentencePanel } from "../components/SentencePanel";
import { useAlphabetRecognition } from "../hooks/useAlphabetRecognition";
import { useFrameRecorder } from "../hooks/useFrameRecorder";
import { freeGauge, spellStatus } from "../lib/alphabetView";
import { SpellingTracker, type SpellEvent } from "../lib/spelling";
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
 * Palabras y letras a la vez: cada cuadro va al servidor (señas de palabras) y al reconocimiento del
 * alfabeto del navegador (el de Alfabeto → Libre, con J, Ñ, Q, X y Z). La primera letra empieza un
 * deletreo (SpellingTracker): el servidor aparta las señas de esos cuadros, que eran el deletreo, y
 * al terminar entra la palabra como "M-A-R-I-O" (mensaje `spelling`).
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
  // Letras: siempre activas, junto con las palabras del servidor.
  const alpha = useAlphabetRecognition(null, "free", true);
  const recorder = useFrameRecorder(10000);
  useFrameSink((f) => {
    if (!correcting.current) session.send(f);
    alpha.onFrame(f);
    recorder.push(f);
  });
  const speller = useRef(new SpellingTracker());
  const [letters, setLetters] = useState<string[]>([]);
  const [spelling, setSpelling] = useState(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const sendSpell = (ev: SpellEvent) => sessionRef.current.send(
    ev.kind === "start" ? { type: "spelling", active: true } : { type: "spelling", active: false, word: ev.word });
  const syncSpell = () => { setLetters(speller.current.letters); setSpelling(speller.current.active); };
  const sendSpellRef = useRef(sendSpell);
  sendSpellRef.current = sendSpell;
  const liveLetter = useRef({ stable: null as string | null, busy: false });
  liveLetter.current = { stable: alpha.stable?.[0] ?? null, busy: alpha.phase === "capturing" };
  useEffect(() => {
    const id = window.setInterval(() => {
      speller.current.push(performance.now(), liveLetter.current.stable, liveLetter.current.busy).forEach((ev) => sendSpellRef.current(ev));
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
  const status = showLetter ? spellStatus({ ...alpha, freeReady: spelling ? alpha.freeReady : "" }) : null;

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
        <LiveCamera corner={showLetter ? <ScoreGauge view={freeGauge(alpha.stable, alpha.feedback)} /> : undefined}>
          {spelling ? <p className="overlay-pill" role="status"><span>Deletreando</span></p> : null}
        </LiveCamera>
        <div className="translate-side">
        <section className="sheet translate-spell" aria-labelledby="traduccion-deletreo" data-on={spelling || undefined}>
          <h3 id="traduccion-deletreo" className="sheet__title">Letras (deletreo)</h3>
          <p className="sheet__hint">
            Se reconocen palabras y letras a la vez. Para deletrear un nombre, haz cada letra y sostenla un momento
            (J, Ñ, Q, X y Z con su movimiento); al bajar la mano, la palabra entra a las señas.
          </p>
          <p className="alfa-free-letters__text translate-spell__word" translate="no" aria-live="polite" aria-label={word ? `Deletreando: ${word}` : "Sin letras"}>
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
          <p className="sheet__hint">
            ¿Algo salió mal?{" "}
            <button type="button" className="btn btn--quiet btn--small" onClick={() => recorder.download("interpretacion", {
              screen: "interpretacion", letters, chips: translate.chips.map((c) => c.gloss), sentence: translate.sentence?.text ?? null,
            })}>Descargar intento</button>{" "}
            (últimos 10 s, solo puntos de la mano).
          </p>
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
