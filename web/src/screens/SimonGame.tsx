import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LetterReference } from "../components/LetterReference";
import { ScoreGauge } from "../components/ScoreGauge";
import { availableSigns, pickDistinct, readBest, saveBest, SIMON_LETTERS, simonNext, wordCorrect } from "../lib/games";
import type { GaugeView } from "../lib/gauge";
import { glossLabel } from "../lib/ui";
import { GameHead, Note, useLetterRun } from "./gameParts";
import { LiveCamera } from "./LiveCamera";
import { ServerNotice, useApp, useFrameSink, useSessionMode } from "./shared";

type Phase = "ready" | "show" | "play" | "good" | "fail" | "over";
const LIVES = 3;

/**
 * Motor de Simón dice: muestra la secuencia (un elemento cada `showMs`), luego la persona la repite
 * de memoria. Cada elemento tiene `timeoutMs` para hacerse; al completar la ronda se agrega uno más.
 * Un error o que se acabe el tiempo quita una vida y se vuelve a mostrar la misma secuencia.
 */
function useSimon<T>(pool: T[], showMs: number, timeoutMs: number, bestKey: string) {
  const [seq, setSeq] = useState<T[]>([]);
  const [phase, setPhase] = useState<Phase>("ready");
  const [shown, setShown] = useState(0);
  const [lives, setLives] = useState(LIVES);
  const [pos, setPos] = useState(0);
  const [deadline, setDeadline] = useState(0);
  const [isRecord, setIsRecord] = useState(false);
  const [reason, setReason] = useState("");
  const poolRef = useRef(pool);
  poolRef.current = pool;

  const start = useCallback(() => {
    setSeq(simonNext([], poolRef.current)); setLives(LIVES); setShown(0); setPos(0); setIsRecord(false); setPhase("show");
  }, []);
  // Mostrar la secuencia, un elemento a la vez.
  useEffect(() => {
    if (phase !== "show") return;
    const id = window.setTimeout(() => {
      if (shown + 1 >= seq.length) { setPos(0); setDeadline(performance.now() + timeoutMs); setPhase("play"); }
      else setShown((s) => s + 1);
    }, showMs);
    return () => window.clearTimeout(id);
  }, [phase, shown, seq.length, showMs, timeoutMs]);
  const fail = (why: string) => {
    if (phase !== "play") return;
    const left = lives - 1;
    setReason(why);
    setLives(left);
    if (left <= 0) {
      const rounds = seq.length - 1;
      setIsRecord(rounds > 0 && saveBest(bestKey, rounds, true));
      setPhase("over");
    } else setPhase("fail");
  };
  const failRef = useRef(fail);
  failRef.current = fail;
  // Tiempo límite de cada elemento.
  useEffect(() => {
    if (phase !== "play") return;
    const id = window.setTimeout(() => failRef.current("Se acabó el tiempo"), Math.max(0, deadline - performance.now()));
    return () => window.clearTimeout(id);
  }, [phase, deadline]);
  /** El elemento `pos` se hizo bien. */
  const hit = () => {
    if (phase !== "play") return;
    if (pos + 1 >= seq.length) { setPhase("good"); return; }
    setPos((p) => p + 1);
    setDeadline(performance.now() + timeoutMs);
  };
  // Tras acertar la ronda (o fallar con vidas), una pausa corta y se vuelve a mostrar.
  useEffect(() => {
    if (phase !== "good" && phase !== "fail") return;
    const id = window.setTimeout(() => {
      if (phase === "good") setSeq((s) => simonNext(s, poolRef.current));
      setShown(0); setPos(0); setPhase("show");
    }, 1400);
    return () => window.clearTimeout(id);
  }, [phase]);

  return { seq, phase, shown, lives, pos, deadline, isRecord, reason, start, hit, fail, round: seq.length, best: readBest(bestKey) };
}

type Simon<T> = ReturnType<typeof useSimon<T>>;

function Lives({ n }: { n: number }) {
  return <span className="game-score" aria-label={`${n} vidas`}>{"❤️".repeat(n)}{"🤍".repeat(Math.max(0, LIVES - n))}</span>;
}

/** Puntos de la secuencia: los ya hechos muestran su elemento; los que faltan, ocultos. */
function Dots<T>({ simon, label }: { simon: Simon<T>; label(t: T): string }) {
  return (
    <p className="simon-dots" aria-label={`Elemento ${simon.pos + 1} de ${simon.seq.length}`}>
      {simon.seq.map((t, i) => (
        <span key={i} className="simon-dot" data-state={i < simon.pos || simon.phase === "good" ? "done" : i === simon.pos ? "now" : "todo"} translate="no">
          {i < simon.pos || simon.phase === "good" ? label(t) : "?"}
        </span>
      ))}
    </p>
  );
}

function TimeBar({ deadline, total }: { deadline: number; total: number }) {
  const [now, setNow] = useState(performance.now());
  useEffect(() => { const id = window.setInterval(() => setNow(performance.now()), 200); return () => window.clearInterval(id); }, []);
  const left = Math.max(0, deadline - now);
  return (
    <div className="alfa-hold-bar simon-time" role="progressbar" aria-label="Tiempo para este elemento" aria-valuenow={Math.round(left / 1000)} aria-valuemin={0} aria-valuemax={Math.round(total / 1000)}>
      <div className="alfa-hold-bar__fill" style={{ width: `${(left / total) * 100}%` }} />
    </div>
  );
}

function SimonFrame<T>({ simon, title, lead, onBack, label, showCard, playArea, what, notice }: {
  simon: Simon<T>; title: string; lead: string; onBack(): void; label(t: T): string;
  showCard(t: T): React.ReactNode; playArea: React.ReactNode; what: string; notice?: React.ReactNode;
}) {
  const { phase } = simon;
  return (
    <div className="screen">
      <GameHead title={title} lead={lead} onBack={onBack}
        right={<>{phase !== "ready" ? <span className="game-score tabular">Ronda {simon.round}</span> : null}<Lives n={simon.lives} /></>} />
      {notice}
      {phase === "ready" ? (
        <section className="sheet game-done">
          <p className="game-done__title">🧠 Simón dice</p>
          <p className="sheet__hint">Mira la secuencia de {what} y repítela de memoria, en el mismo orden. Cada ronda agrega una más. Tienes {LIVES} vidas.</p>
          {simon.best !== null ? <p className="sheet__hint tabular">Tu récord: ronda {simon.best}</p> : null}
          <button type="button" className="btn btn--primary" onClick={simon.start} autoFocus>¡Empezar!</button>
        </section>
      ) : phase === "show" ? (
        <section className="sheet simon-show" aria-live="assertive">
          <p className="game-target__label">Memoriza · {simon.shown + 1} de {simon.seq.length}</p>
          <div key={simon.shown} className="simon-show__card">{showCard(simon.seq[simon.shown])}</div>
        </section>
      ) : phase === "over" ? (
        <section className="sheet game-done" aria-live="polite">
          <p className="game-done__title">Fin del juego</p>
          <p className="sheet__hint">{simon.reason}. Llegaste a la ronda {simon.round} ({simon.round - 1} completa{simon.round - 1 === 1 ? "" : "s"}).</p>
          <p className="sheet__hint" translate="no">La secuencia era: {simon.seq.map(label).join(" · ")}</p>
          {simon.isRecord ? <p className="race-record">⭐ ¡Nuevo récord!</p> : simon.best !== null ? <p className="sheet__hint tabular">Tu récord: ronda {simon.best}</p> : null}
          <button type="button" className="btn btn--primary" onClick={simon.start} autoFocus>Jugar otra vez →</button>
        </section>
      ) : (
        <>
          <section className="sheet game-target" aria-live="polite">
            <p className="game-target__label">{phase === "good" ? "¡Ronda completa!" : phase === "fail" ? `${simon.reason}: te la muestro otra vez` : "Repite la secuencia"}</p>
            <Dots simon={simon} label={label} />
          </section>
          {playArea}
        </>
      )}
    </div>
  );
}

/* ------------------------------ Simón dice con letras ------------------------------ */

const LETTER_SHOW_MS = 1300, LETTER_TIMEOUT_MS = 9000;

export function SimonLetters({ onBack }: { onBack(): void }) {
  const simon = useSimon(SIMON_LETTERS, LETTER_SHOW_MS, LETTER_TIMEOUT_MS, "simon-letras");
  const playing = simon.phase === "play";
  // La secuencia con la letra actual como objetivo (reconocedor del alfabeto); en pantalla no se muestra.
  const run = useLetterRun(simon.seq, playing);
  const resetRun = useRef(run.reset);
  resetRun.current = run.reset;
  // Fuera de "play" el recorrido vuelve al principio: al empezar a repetir siempre arranca en 0.
  useEffect(() => { if (!playing) resetRun.current(); }, [playing]);
  const hitRef = useRef(simon.hit);
  hitRef.current = simon.hit;
  // useLetterRun avanza uno al completar una letra: ese avance (y solo ese) es un acierto.
  useEffect(() => { if (playing && run.index === simon.pos + 1) hitRef.current(); }, [run.index, playing, simon.pos]);
  const handSeen = !!run.rec.feedback && run.rec.feedback.issue !== "no_hand";
  const gauge: GaugeView = { kind: "idle", label: `Letra ${simon.pos + 1} de ${simon.seq.length}`, detail: handSeen ? "Te veo" : "Pon la mano en el cuadro" };
  return (
    <SimonFrame simon={simon} title="Simón dice · con letras" lead="Memoriza la secuencia de letras y hazla en el mismo orden." onBack={onBack}
      label={(l) => l} what="letras"
      showCard={(l) => (<><p className="simon-show__big" translate="no">{l}</p><LetterReference letter={l} /></>)}
      playArea={
        <div className="practice-camera">
          <LiveCamera corner={<ScoreGauge view={gauge} />} />
          {playing ? <TimeBar deadline={simon.deadline} total={LETTER_TIMEOUT_MS} /> : null}
          <Note note={simon.phase === "good" ? { tone: "ok", text: "¡Bien! Viene una letra más." } : simon.phase === "fail" ? { tone: "warn", text: `${simon.reason}. Mira otra vez la secuencia.` }
            : { text: `Haz la letra ${simon.pos + 1} de la secuencia y mantenla hasta que se marque.` }} />
          <div className="sheet__actions">
            <button type="button" className="btn btn--quiet" onClick={() => simon.fail("Te rendiste")} disabled={!playing}>Ver otra vez (−1 vida)</button>
          </div>
        </div>
      } />
  );
}

/* ------------------------------ Simón dice con señas ------------------------------ */

const SIGN_SHOW_MS = 1800, SIGN_TIMEOUT_MS = 20000, SIGN_POOL = 8;

export function SimonSigns({ onBack }: { onBack(): void }) {
  const { session, vocab } = useApp();
  const signs = useMemo(() => availableSigns(vocab), [vocab]);
  // Unas pocas señas por partida (se muestran al inicio): más memoria, menos adivinar entre 121.
  const [pool, setPool] = useState<string[]>([]);
  useEffect(() => { if (!pool.length && signs.length >= 4) setPool(pickDistinct(signs, SIGN_POOL)); }, [signs, pool.length]);
  const simon = useSimon(pool, SIGN_SHOW_MS, SIGN_TIMEOUT_MS, "simon-senas");
  const playing = simon.phase === "play";
  const target = playing ? simon.seq[simon.pos] ?? null : null;
  useSessionMode("practice", target, target !== null);
  useFrameSink(target ? (f) => session.send(f) : null);
  const { evaluation, live } = session.last;
  const seen = useRef(evaluation);
  const [last, setLast] = useState<string | null>(null);
  const simonRef = useRef(simon);
  simonRef.current = simon;
  useEffect(() => {
    if (!evaluation || evaluation === seen.current) return;
    seen.current = evaluation;
    if (!target || evaluation.target !== target) return;
    const top = evaluation.recognized[0]?.[0] ?? null;
    setLast(top);
    if (wordCorrect(evaluation.recognized, target)) simonRef.current.hit();
    else simonRef.current.fail(top ? `Hiciste «${glossLabel(top)}»` : "No reconocí la seña");
  }, [evaluation, target]);
  useEffect(() => { setLast(null); }, [simon.pos, simon.phase]);
  const signing = live?.segment === "active";
  const gauge: GaugeView = signing ? { kind: "idle", label: "Leyendo…", detail: "Baja las manos al terminar" }
    : { kind: "idle", label: `Seña ${simon.pos + 1} de ${simon.seq.length}`, detail: last ? `Vi: ${glossLabel(last)}` : "Haz la seña y baja las manos" };
  const newPool = () => setPool(pickDistinct(signs, SIGN_POOL));

  return (
    <SimonFrame simon={simon} title="Simón dice · con señas" lead="Memoriza la secuencia de señas y hazla en el mismo orden, bajando las manos después de cada una." onBack={onBack}
      label={glossLabel} what="señas"
      notice={<>
        <ServerNotice />
        {simon.phase === "ready" && pool.length ? (
          <section className="sheet" aria-label="Señas de esta partida">
            <p className="game-target__label">Señas de esta partida</p>
            <p className="game-phrase" translate="no">{pool.map((g) => <span key={g} className="game-phrase__word">{glossLabel(g)}</span>)}</p>
            <button type="button" className="btn btn--quiet btn--small" onClick={newPool}>Otras señas</button>
          </section>
        ) : !pool.length ? <section className="sheet"><p className="sheet__hint" role="status">{vocab ? "El modelo activo no tiene suficientes señas." : "Cargando el catálogo de señas… (el servidor debe estar encendido)."}</p></section> : null}
      </>}
      showCard={(g) => <p className="simon-show__big simon-show__big--word" translate="no">{glossLabel(g)}</p>}
      playArea={
        <div className="practice-camera">
          <LiveCamera corner={<ScoreGauge view={gauge} />}>
            {signing ? <p className="overlay-pill" role="status"><span className="rec-mark" aria-hidden="true" /><span>Leyendo tu seña</span></p> : null}
          </LiveCamera>
          {playing ? <TimeBar deadline={simon.deadline} total={SIGN_TIMEOUT_MS} /> : null}
          <Note note={simon.phase === "good" ? { tone: "ok", text: "¡Bien! Viene una seña más." } : simon.phase === "fail" ? { tone: "warn", text: `${simon.reason}. Mira otra vez la secuencia.` }
            : { text: `Haz la seña ${simon.pos + 1} de la secuencia y baja las manos.` }} />
          <div className="sheet__actions">
            <button type="button" className="btn btn--quiet" onClick={() => simon.fail("Te rendiste")} disabled={!playing}>Ver otra vez (−1 vida)</button>
          </div>
        </div>
      } />
  );
}
