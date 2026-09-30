import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconWarning, ToneIcon } from "../components/icons";
import { LetterReference } from "../components/LetterReference";
import { ReferencePlayer } from "../components/ReferencePlayer";
import { ScoreGauge } from "../components/ScoreGauge";
import { useAlphabetRecognition } from "../hooks/useAlphabetRecognition";
import { MOTION_LETTERS } from "../lib/alphabet";
import { motionGauge, staticGauge } from "../lib/alphabetView";
import {
  availablePhrases, lettersOf, lettersPerMinute, pickOther, RACE_TEXTS, RIVALS, rivalFinishMs, rivalProgress,
  SPELL_WORDS, spellable, standings, wordCorrect, type RaceLevel, type Racer,
} from "../lib/games";
import type { GaugeView } from "../lib/gauge";
import type { Glosses } from "../lib/protocol";
import { glossLabel } from "../lib/ui";
import { LiveCamera } from "./LiveCamera";
import { ServerNotice, useApp, useFrameSink, useSessionMode } from "./shared";

type Game = "menu" | "letras" | "senas" | "carrera";

/**
 * Juegos: "Completa la palabra" (con letras del alfabeto o con señas de palabras) y "Carrera" (deletrear
 * un texto para que avance tu carro). Las letras usan el mismo reconocedor que Alfabeto con la letra
 * objetivo (el modo más preciso); las palabras, el servidor en modo Práctica (una seña por toma).
 */
export default function Games() {
  const [game, setGame] = useState<Game>("menu");
  const back = useCallback(() => { setGame("menu"); window.scrollTo({ top: 0 }); }, []);
  if (game === "letras") return <SpellGame onBack={back} />;
  if (game === "senas") return <SignGame onBack={back} />;
  if (game === "carrera") return <RaceGame onBack={back} />;
  const open = (g: Game) => { setGame(g); window.scrollTo({ top: 0 }); };
  return (
    <div className="screen">
      <header className="screen__head">
        <h2 className="screen__title">Juegos</h2>
        <p className="screen__lead">Practica jugando: forma palabras con el alfabeto o con señas, o gana una carrera deletreando.</p>
      </header>
      <div className="game-menu">
        <section className="sheet game-card" aria-labelledby="juego-completa">
          <p className="game-card__icon" aria-hidden="true">🧩</p>
          <h3 id="juego-completa" className="sheet__title">Completa la palabra</h3>
          <p className="sheet__hint">La app te pide algo y tú lo formas frente a la cámara, paso por paso.</p>
          <div className="game-card__actions">
            <button type="button" className="btn btn--primary" onClick={() => open("letras")}>Con letras</button>
            <button type="button" className="btn btn--secondary" onClick={() => open("senas")}>Con señas</button>
          </div>
          <ul className="game-card__list">
            <li><strong>Con letras:</strong> deletrea una palabra (p. ej. CARRERA) letra por letra.</li>
            <li><strong>Con señas:</strong> haz las señas de una frase (p. ej. HOLA MAMÁ), una tras otra.</li>
          </ul>
        </section>
        <section className="sheet game-card" aria-labelledby="juego-carrera">
          <p className="game-card__icon" aria-hidden="true">🏎️</p>
          <h3 id="juego-carrera" className="sheet__title">Carrera de letras</h3>
          <p className="sheet__hint">Deletrea el texto lo más rápido que puedas: cada letra correcta hace avanzar tu carro. Compite contra tres rivales.</p>
          <div className="game-card__actions">
            <button type="button" className="btn btn--primary" onClick={() => open("carrera")}>Jugar</button>
          </div>
        </section>
      </div>
    </div>
  );
}

function GameHead({ title, lead, onBack, right }: { title: string; lead: string; onBack(): void; right?: React.ReactNode }) {
  return (
    <header className="screen__head screen__head--row screen__head--compact">
      <div className="screen__head-text">
        <h2 className="screen__title">{title}</h2>
        <p className="screen__lead">{lead}</p>
      </div>
      <div className="game-head__right">
        {right}
        <button type="button" className="btn btn--change btn--small" onClick={onBack}>← Juegos</button>
      </div>
    </header>
  );
}

/* ------------------------------ Letras (reconocedor del alfabeto) ------------------------------ */

/**
 * Recorre `letters` una por una con el reconocedor del alfabeto y la letra actual como objetivo.
 * Una letra hecha pasa a la siguiente sola; la misma letra seguida (CARRERA: RR) reinicia el
 * reconocedor, que si no seguiría "completo".
 */
function useLetterRun(letters: string[], active: boolean) {
  const { camera, vision } = useApp();
  const [index, setIndex] = useState(0);
  const target = active && index < letters.length ? letters[index] : null;
  const rec = useAlphabetRecognition(target, "specific", active && camera.ready && !vision.loading && !vision.error);
  useFrameSink(active ? (f) => rec.onFrame(f) : null);
  const restart = useRef(rec.restart);
  restart.current = rec.restart;
  useEffect(() => { restart.current(); }, [index, letters]);
  useEffect(() => {
    if (!rec.complete || !target) return;
    const id = window.setTimeout(() => setIndex((i) => i + 1), MOTION_LETTERS.has(target) ? 600 : 250);
    return () => window.clearTimeout(id);
  }, [rec.complete, target, index]);
  const reset = useCallback(() => setIndex(0), []);
  const skip = useCallback(() => setIndex((i) => Math.min(i + 1, letters.length)), [letters.length]);
  return { index, target, rec, reset, skip, done: index >= letters.length };
}

type Run = ReturnType<typeof useLetterRun>;

function letterGauge(run: Run): GaugeView {
  const { target, rec } = run;
  if (!target) return { kind: "idle", label: "¡Listo!", detail: "Palabra completa" };
  return MOTION_LETTERS.has(target) ? motionGauge(rec.live, rec.feedback, rec.complete) : staticGauge(rec.feedback, rec.targetShare, rec.progress);
}

/** Una línea bajo la cámara: qué hacer ahora con la letra actual. */
function letterNote(run: Run): { tone?: "ok" | "warn"; text: string } {
  const { target, rec } = run;
  if (!target) return { tone: "ok", text: "¡Completaste la palabra!" };
  if (rec.complete) return { tone: "ok", text: `¡Bien! ${target}` };
  const fb = rec.feedback;
  if (MOTION_LETTERS.has(target)) {
    const live = rec.live;
    if (live?.phase === "result" && live.result && live.result.issue !== "ok") return { tone: "warn", text: live.result.reason };
    if (live?.phase === "moving") return { text: "Siguiendo tu movimiento…" };
    if (live?.phase === "ready") return { tone: "ok", text: "Posición lista: haz el movimiento." };
    if (fb && !fb.correct && fb.issue !== "no_hand") return { tone: "warn", text: fb.message };
    return { text: `Haz la ${target} con su movimiento.` };
  }
  if (!fb || fb.issue === "no_hand") return { text: `Haz la letra ${target} frente a la cámara.` };
  if (fb.correct) return { tone: "ok", text: "¡Eso es! Mantén la posición…" };
  return { tone: "warn", text: fb.message };
}

/**
 * Las letras de un texto: hechas, saltadas, la actual y las que faltan. Cada palabra va junta (no se
 * parte entre renglones); los espacios separan palabras pero no se deletrean.
 */
function LetterStrip({ text, index, skipped, big }: { text: string; index: number; skipped: ReadonlySet<number>; big?: boolean }) {
  const letters = lettersOf(text);
  let n = 0;
  return (
    <p className={`game-word${big ? " game-word--big" : ""}`} translate="no" aria-label={`${text}: letra ${Math.min(index + 1, letters.length)} de ${letters.length}`}>
      {spellable(text).split(" ").filter(Boolean).map((w, wi) => (
        <span key={wi} className="game-word__w">
          {[...w].map((c, i) => {
            const k = n++;
            const state = k < index ? (skipped.has(k) ? "skip" : "done") : k === index ? "now" : "todo";
            return <span key={i} className="game-word__letter" data-state={state} aria-hidden="true">{c}</span>;
          })}
        </span>
      ))}
    </p>
  );
}

function Note({ note }: { note: { tone?: "ok" | "warn"; text: string } }) {
  return (
    <div className="practice-note" data-tone={note.tone} aria-live="polite">
      <p className="practice-note__tip">
        {note.tone === "ok" ? <ToneIcon tone="ok" /> : note.tone === "warn" ? <IconWarning /> : null}
        <span>{note.text}</span>
      </p>
    </div>
  );
}

const LEVELS = ["fácil", "media", "difícil"] as const;

function SpellGame({ onBack }: { onBack(): void }) {
  const [level, setLevel] = useState<(typeof LEVELS)[number] | "todas">("todas");
  const pool = useMemo(() => SPELL_WORDS.filter((w) => level === "todas" || w.level === level).map((w) => w.word), [level]);
  const [word, setWord] = useState(() => pickOther(pool, null));
  const letters = useMemo(() => lettersOf(word), [word]);
  const run = useLetterRun(letters, true);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [hint, setHint] = useState(false);
  const started = useRef(performance.now());
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [score, setScore] = useState({ words: 0, letters: 0 });

  useEffect(() => {
    if (!run.done || elapsed !== null) return;
    setElapsed(performance.now() - started.current);
    // La estrella se gana haciendo letras: una palabra saltada completa no cuenta.
    if (skipped.size < letters.length) setScore((s) => ({ words: s.words + 1, letters: s.letters + letters.length - skipped.size }));
  }, [run.done, elapsed, letters.length, skipped.size]);
  useEffect(() => { setHint(false); }, [run.index]);

  const next = useCallback((list = pool) => {
    setWord((w) => pickOther(list, w));
    run.reset();
    setSkipped(new Set());
    setElapsed(null);
    started.current = performance.now();
  }, [pool, run.reset]);
  const skip = () => { setSkipped((s) => new Set(s).add(run.index)); run.skip(); };
  const changeLevel = (l: typeof level) => {
    setLevel(l);
    next(SPELL_WORDS.filter((w) => l === "todas" || w.level === l).map((w) => w.word));
  };

  return (
    <div className="screen">
      <GameHead title="Completa la palabra · con letras" lead="Deletrea la palabra letra por letra. Cada letra correcta pasa sola a la siguiente." onBack={onBack}
        right={<span className="game-score tabular" aria-label={`Palabras completas: ${score.words}`}>⭐ {score.words}</span>} />
      <div className="game-levels" role="group" aria-label="Dificultad">
        {(["todas", ...LEVELS] as const).map((l) => (
          <button key={l} type="button" className={`btn btn--small ${level === l ? "btn--primary" : "btn--secondary"}`} aria-pressed={level === l} onClick={() => changeLevel(l)}>
            {l === "todas" ? "Todas" : l[0].toUpperCase() + l.slice(1)}
          </button>
        ))}
      </div>
      <section className="sheet game-target" aria-label="Palabra a formar">
        <p className="game-target__label">Forma la palabra</p>
        <LetterStrip text={word} index={run.index} skipped={skipped} big />
        <p className="sheet__hint tabular">{run.done ? `${letters.length} de ${letters.length} letras` : `Letra ${run.index + 1} de ${letters.length}`}</p>
      </section>

      {run.done ? (
        <section className="sheet game-done" aria-live="polite">
          <p className="game-done__title">🎉 ¡Formaste <span translate="no">{word}</span>!</p>
          <p className="sheet__hint tabular">
            {elapsed !== null ? `${(elapsed / 1000).toFixed(1)} s` : ""}{skipped.size ? ` · ${skipped.size} letra${skipped.size > 1 ? "s" : ""} saltada${skipped.size > 1 ? "s" : ""}` : " · sin saltar letras"}
          </p>
          <button type="button" className="btn btn--primary" onClick={() => next()} autoFocus>Otra palabra →</button>
        </section>
      ) : (
        <div className="practice-stage">
          <div className="practice-camera">
            <LiveCamera corner={<ScoreGauge view={letterGauge(run)} />}>
              <p className="overlay-pill game-now" role="status"><span>Letra</span><strong translate="no">{run.target}</strong></p>
            </LiveCamera>
            <Note note={letterNote(run)} />
            <div className="sheet__actions">
              <button type="button" className="btn btn--secondary" onClick={() => setHint((h) => !h)} aria-pressed={hint}>{hint ? "Ocultar pista" : "💡 Pista"}</button>
              <button type="button" className="btn btn--secondary" onClick={skip}>Saltar letra →</button>
              <button type="button" className="btn btn--quiet" onClick={() => next()}>Otra palabra</button>
            </div>
          </div>
          <div className="practice-side">
            <section className="sheet practice-ref" aria-labelledby="juego-pista">
              <h3 id="juego-pista" className="practice-ref__title">Pista: <span translate="no">{run.target}</span></h3>
              {hint && run.target ? <LetterReference letter={run.target} /> : (
                <p className="sheet__hint">¿No recuerdas cómo se hace? Pulsa «Pista» para ver la foto de la letra.</p>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Señas (servidor, modo Práctica) ------------------------------ */

function SignGame({ onBack }: { onBack(): void }) {
  const { session, vocab } = useApp();
  const phrases = useMemo(() => availablePhrases(vocab), [vocab]);
  const [phrase, setPhrase] = useState<string[] | null>(null);
  useEffect(() => { if (!phrase && phrases.length) setPhrase(pickOther(phrases, null)); }, [phrases, phrase]);
  const [index, setIndex] = useState(0);
  const target = phrase && index < phrase.length ? phrase[index] : null;
  useSessionMode("practice", target, target !== null);
  useFrameSink(target ? (f) => session.send(f) : null);
  const { evaluation, live } = session.last;
  const [attempt, setAttempt] = useState<{ ok: boolean; recognized: Glosses } | null>(null);
  const [hint, setHint] = useState(false);
  const [score, setScore] = useState(0);
  const seen = useRef(evaluation);

  // Cada toma (baja las manos al terminar) llega como `evaluation`; se juzga solo si es de la seña actual.
  useEffect(() => {
    if (!evaluation || evaluation === seen.current) return;
    seen.current = evaluation;
    if (!target || evaluation.target !== target) return;
    setAttempt({ ok: wordCorrect(evaluation.recognized, target), recognized: evaluation.recognized });
  }, [evaluation, target]);
  useEffect(() => {
    if (!attempt?.ok) return;
    const id = window.setTimeout(() => { setIndex((i) => i + 1); setAttempt(null); setHint(false); }, 900);
    return () => window.clearTimeout(id);
  }, [attempt]);
  const done = phrase !== null && index >= phrase.length;
  useEffect(() => { if (done) setScore((s) => s + 1); }, [done]);

  const next = () => { setPhrase((p) => pickOther(phrases, p)); setIndex(0); setAttempt(null); setHint(false); };
  const skip = () => { setIndex((i) => i + 1); setAttempt(null); setHint(false); };

  const signing = live?.segment === "active";
  const top = attempt?.recognized[0]?.[0];
  const gauge: GaugeView = attempt?.ok ? { kind: "score", value: 100, tone: "ok", word: "¡Bien!", label: "✓", detail: "Seña correcta", caption: "Correcta" }
    : attempt ? { kind: "guide", label: "Otra vez", detail: top ? `Vi: ${glossLabel(top)}` : "No reconocí la seña" }
      : { kind: "idle", label: signing ? "Leyendo…" : "Haz la seña…", detail: signing ? "Baja las manos al terminar" : "Luego baja las manos" };
  const note = attempt?.ok ? { tone: "ok" as const, text: `¡Bien! ${glossLabel(target ?? "")}` }
    : attempt ? { tone: "warn" as const, text: top ? `Reconocí «${glossLabel(top)}». Intenta otra vez ${glossLabel(target ?? "")}; puedes ver la pista.` : "No reconocí ninguna seña. Hazla completa y baja las manos." }
      : { text: signing ? "Leyendo tu seña… baja las manos al terminar." : `Haz la seña ${glossLabel(target ?? "")} y baja las manos al terminar.` };

  return (
    <div className="screen">
      <GameHead title="Completa la palabra · con señas" lead="Haz las señas de la frase una tras otra. Baja las manos al terminar cada seña." onBack={onBack}
        right={<span className="game-score tabular" aria-label={`Frases completas: ${score}`}>⭐ {score}</span>} />
      <ServerNotice />
      {!phrase ? (
        <section className="sheet"><p className="sheet__hint" role="status">{vocab ? "El modelo activo no tiene las señas de estas frases." : "Cargando el catálogo de señas… (el servidor debe estar encendido)."}</p></section>
      ) : (
        <>
          <section className="sheet game-target" aria-label="Frase a formar">
            <p className="game-target__label">Forma la frase</p>
            <p className="game-phrase" translate="no">
              {phrase.map((g, i) => (
                <span key={i} className="game-phrase__word" data-state={i < index ? "done" : i === index ? "now" : "todo"}>{glossLabel(g)}</span>
              ))}
            </p>
            <p className="sheet__hint tabular">{done ? `${phrase.length} de ${phrase.length} señas` : `Seña ${index + 1} de ${phrase.length}`}</p>
          </section>
          {done ? (
            <section className="sheet game-done" aria-live="polite">
              <p className="game-done__title">🎉 ¡Formaste «<span translate="no">{phrase.map(glossLabel).join(" ")}</span>»!</p>
              <button type="button" className="btn btn--primary" onClick={next} autoFocus>Otra frase →</button>
            </section>
          ) : (
            <div className="practice-stage">
              <div className="practice-camera">
                <LiveCamera corner={<ScoreGauge view={gauge} />}>
                  {signing ? (
                    <p className="overlay-pill" role="status"><span className="rec-mark" aria-hidden="true" /><span>Leyendo tu seña</span></p>
                  ) : <p className="overlay-pill game-now" role="status"><span>Seña</span><strong translate="no">{glossLabel(target ?? "")}</strong></p>}
                </LiveCamera>
                <Note note={note} />
                <div className="sheet__actions">
                  <button type="button" className="btn btn--secondary" onClick={() => setHint((h) => !h)} aria-pressed={hint}>{hint ? "Ocultar pista" : "💡 Pista"}</button>
                  <button type="button" className="btn btn--secondary" onClick={skip}>Saltar seña →</button>
                  <button type="button" className="btn btn--quiet" onClick={next}>Otra frase</button>
                </div>
              </div>
              <div className="practice-side">
                <section className="sheet practice-ref" aria-labelledby="juego-pista-sena">
                  <h3 id="juego-pista-sena" className="practice-ref__title">Pista: <span translate="no">{glossLabel(target ?? "")}</span></h3>
                  {hint && target ? <ReferencePlayer gloss={target} /> : <p className="sheet__hint">Pulsa «Pista» para ver cómo se hace la seña.</p>}
                </section>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------ Carrera ------------------------------ */

const CARS = ["🚗", "🚙", "🚕", "🚓"];
const SKIP_PENALTY_MS = 3000;

function RaceGame({ onBack }: { onBack(): void }) {
  const [level, setLevel] = useState<RaceLevel>("normal");
  const [text, setText] = useState(() => pickOther(RACE_TEXTS, null));
  const letters = useMemo(() => lettersOf(text), [text]);
  const [phase, setPhase] = useState<"setup" | "countdown" | "racing" | "done">("setup");
  const [count, setCount] = useState(3);
  const startAt = useRef(0);
  const [now, setNow] = useState(0);
  const [youMs, setYouMs] = useState<number | null>(null);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const run = useLetterRun(letters, phase === "racing");

  useEffect(() => {
    if (phase !== "countdown") return;
    if (count === 0) { startAt.current = performance.now(); setNow(startAt.current); setPhase("racing"); return; }
    const id = window.setTimeout(() => setCount((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [phase, count]);
  useEffect(() => {
    if (phase !== "racing") return;
    const id = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(id);
  }, [phase]);
  useEffect(() => {
    if (phase === "racing" && run.done) { setYouMs(performance.now() - startAt.current); setPhase("done"); }
  }, [phase, run.done]);

  const elapsed = phase === "racing" ? Math.max(0, now - startAt.current) : 0;
  const rivals = RIVALS[level];
  const racers: Racer[] = [
    { name: "Tú", you: true, progress: letters.length ? run.index / letters.length : 0, finishMs: youMs },
    ...rivals.map((r) => {
      const finish = rivalFinishMs(r.lpm, letters.length);
      return phase === "done"
        ? { name: r.name, progress: youMs !== null && youMs < finish ? rivalProgress(r.lpm, youMs, letters.length) : 1, finishMs: finish }
        : { name: r.name, progress: rivalProgress(r.lpm, elapsed, letters.length), finishMs: elapsed >= finish ? finish : null };
    }),
  ];
  const order = standings(racers);
  const place = order.findIndex((r) => r.you) + 1;

  const start = () => { run.reset(); setSkipped(new Set()); setYouMs(null); setCount(3); setPhase("countdown"); };
  const again = () => { setText((t) => pickOther(RACE_TEXTS, t)); setPhase("setup"); };
  const skip = () => { setSkipped((s) => new Set(s).add(run.index)); startAt.current -= SKIP_PENALTY_MS; run.skip(); };

  return (
    <div className="screen">
      <GameHead title="Carrera de letras" lead="Deletrea el texto: cada letra correcta avanza tu carro. Gana quien llegue primero a la meta." onBack={onBack}
        right={phase === "racing" ? <span className="game-score tabular">⏱ {(elapsed / 1000).toFixed(1)} s</span> : null} />

      <section className="sheet race" aria-label="Pista de carreras">
        <div className="race-track">
          {racers.map((r, i) => (
            <div key={r.name} className="race-lane" data-you={r.you || undefined}>
              <span className="race-lane__name">{r.name}{r.you ? "" : <small> · {rivals[i - 1].lpm} l/min</small>}</span>
              <div className="race-lane__road">
                <span className="race-car" style={{ left: `calc(1.2rem + (100% - 3rem) * ${r.progress.toFixed(4)})` }} aria-hidden="true">{CARS[i]}</span>
                <span className="race-lane__goal" aria-hidden="true">🏁</span>
              </div>
              <span className="race-lane__pct tabular">{Math.round(r.progress * 100)} %</span>
            </div>
          ))}
        </div>
        <LetterStrip text={text} index={phase === "setup" || phase === "countdown" ? -1 : run.index} skipped={skipped} big />
      </section>

      {phase === "setup" ? (
        <section className="sheet game-done">
          <p className="game-target__label">Elige la dificultad de los rivales</p>
          <div className="game-levels" role="group" aria-label="Dificultad">
            {(["fácil", "normal", "difícil"] as RaceLevel[]).map((l) => (
              <button key={l} type="button" className={`btn btn--small ${level === l ? "btn--primary" : "btn--secondary"}`} aria-pressed={level === l} onClick={() => setLevel(l)}>
                {l[0].toUpperCase() + l.slice(1)}
              </button>
            ))}
          </div>
          <p className="sheet__hint">Consejo: pon la mano frente a la cámara antes de empezar. Saltar una letra cuesta {SKIP_PENALTY_MS / 1000} s.</p>
          <div className="sheet__actions">
            <button type="button" className="btn btn--primary" onClick={start} autoFocus>¡Arrancar! 🏁</button>
            <button type="button" className="btn btn--quiet" onClick={() => setText((t) => pickOther(RACE_TEXTS, t))}>Otro texto</button>
          </div>
        </section>
      ) : phase === "countdown" ? (
        <section className="sheet game-done" aria-live="assertive">
          <p className="race-count tabular">{count}</p>
        </section>
      ) : phase === "done" ? (
        <section className="sheet game-done" aria-live="polite">
          <p className="game-done__title">{place === 1 ? "🏆 ¡Ganaste!" : `Llegaste en ${place}.º lugar`}</p>
          <ol className="race-results">
            {order.map((r) => (
              <li key={r.name} data-you={r.you || undefined}>
                <span>{r.name}</span>
                <span className="tabular">{r.finishMs !== null ? `${(r.finishMs / 1000).toFixed(1)} s` : "—"}</span>
              </li>
            ))}
          </ol>
          <p className="sheet__hint tabular">
            {youMs !== null ? `${lettersPerMinute(letters.length - skipped.size, youMs)} letras por minuto` : ""}{skipped.size ? ` · ${skipped.size} saltada${skipped.size > 1 ? "s" : ""}` : ""}
          </p>
          <div className="sheet__actions">
            <button type="button" className="btn btn--primary" onClick={again} autoFocus>Otra carrera →</button>
          </div>
        </section>
      ) : (
        <div className="practice-stage">
          <div className="practice-camera">
            <LiveCamera corner={<ScoreGauge view={letterGauge(run)} />}>
              <p className="overlay-pill game-now" role="status"><span>Letra</span><strong translate="no">{run.target}</strong></p>
            </LiveCamera>
            <Note note={letterNote(run)} />
            <div className="sheet__actions">
              <button type="button" className="btn btn--secondary" onClick={skip}>Saltar letra (+{SKIP_PENALTY_MS / 1000} s)</button>
              <button type="button" className="btn btn--quiet" onClick={() => setPhase("setup")}>Rendirse</button>
            </div>
          </div>
          <div className="practice-side">
            <section className="sheet practice-ref" aria-labelledby="carrera-letra">
              <h3 id="carrera-letra" className="practice-ref__title">Ahora: <span translate="no">{run.target}</span></h3>
              {run.target ? <LetterReference letter={run.target} /> : null}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
