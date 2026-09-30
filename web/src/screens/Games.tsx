import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScoreGauge } from "../components/ScoreGauge";
import { IconFlag, IconLetterW, IconPuzzle, IconSimon } from "../components/icons";
import {
  availablePhrases, lettersOf, lettersPerMinute, pickOther, RACE_LEVEL_ORDER, RACE_LEVELS, readRecords, rivalFinishMs,
  rivalProgress, saveRecord, SPELL_WORDS, standings, wordCorrect, type RaceLevel, type Racer,
} from "../lib/games";
import { firstTip, type GaugeView } from "../lib/gauge";
import type { Glosses } from "../lib/protocol";
import { glossLabel } from "../lib/ui";
import { GameHead, GameStage, LetterAssist, LetterStrip, letterGauge, letterNote, Note, SignAssist, useAssist, useAssistUsed, useLetterRun } from "./gameParts";
import { LiveCamera } from "./LiveCamera";
import { SimonLetters, SimonSigns } from "./SimonGame";
import { WordleLetters, WordleSigns } from "./WordleGame";
import { ServerNotice, useApp, useFrameSink, useSessionMode } from "./shared";

type Game = "menu" | "letras" | "senas" | "carrera" | "wordle-letras" | "wordle-senas" | "simon-letras" | "simon-senas";

/**
 * Juegos: "Completa la palabra" (con letras del alfabeto o con señas de palabras), "Carrera" (deletrear
 * un texto para que avance tu leopardo), "Wordle LSM" y "Simón dice" (ambos con letras o con señas). Las letras usan el mismo reconocedor que Alfabeto con la letra
 * objetivo (el modo más preciso); las palabras, el servidor en modo Práctica (una seña por toma).
 */
export default function Games() {
  const [game, setGame] = useState<Game>("menu");
  const back = useCallback(() => { setGame("menu"); window.scrollTo({ top: 0 }); }, []);
  if (game === "letras") return <SpellGame onBack={back} />;
  if (game === "senas") return <SignGame onBack={back} />;
  if (game === "carrera") return <RaceGame onBack={back} />;
  if (game === "wordle-letras") return <WordleLetters onBack={back} />;
  if (game === "wordle-senas") return <WordleSigns onBack={back} />;
  if (game === "simon-letras") return <SimonLetters onBack={back} />;
  if (game === "simon-senas") return <SimonSigns onBack={back} />;
  const open = (g: Game) => { setGame(g); window.scrollTo({ top: 0 }); };
  return (
    <div className="screen">
      <header className="screen__head">
        <h2 className="screen__title">Juegos</h2>
        <p className="screen__lead">Practica el alfabeto y las señas jugando.</p>
      </header>
      <div className="game-menu">
        <section className="sheet game-card" aria-labelledby="juego-completa">
          <span className="entry__icon game-card__icon" aria-hidden="true"><IconPuzzle size={40} strokeWidth={1.75} /></span>
          <h3 id="juego-completa" className="sheet__title">Completa la palabra</h3>
          <p className="sheet__hint">Forma la palabra o la frase que te pide la app.</p>
          <div className="game-card__actions">
            <button type="button" className="btn btn--primary" onClick={() => open("letras")}>Con letras</button>
            <button type="button" className="btn btn--secondary" onClick={() => open("senas")}>Con señas</button>
          </div>
        </section>
        <section className="sheet game-card" aria-labelledby="juego-carrera">
          <span className="entry__icon game-card__icon" aria-hidden="true"><IconFlag size={40} strokeWidth={1.75} /></span>
          <h3 id="juego-carrera" className="sheet__title">Carrera de letras</h3>
          <p className="sheet__hint">Deletrea rápido y gánale a tres rivales.</p>
          <div className="game-card__actions">
            <button type="button" className="btn btn--primary" onClick={() => open("carrera")}>Jugar</button>
          </div>
        </section>
        <section className="sheet game-card" aria-labelledby="juego-wordle">
          <span className="entry__icon game-card__icon" aria-hidden="true"><IconLetterW size={40} strokeWidth={1.75} /></span>
          <h3 id="juego-wordle" className="sheet__title">Wordle LSM</h3>
          <p className="sheet__hint">Adivina la palabra secreta en 6 intentos.</p>
          <div className="game-card__actions">
            <button type="button" className="btn btn--primary" onClick={() => open("wordle-letras")}>Con letras</button>
            <button type="button" className="btn btn--secondary" onClick={() => open("wordle-senas")}>Con señas</button>
          </div>
        </section>
        <section className="sheet game-card" aria-labelledby="juego-simon">
          <span className="entry__icon game-card__icon" aria-hidden="true"><IconSimon size={40} strokeWidth={1.75} /></span>
          <h3 id="juego-simon" className="sheet__title">Simón dice</h3>
          <p className="sheet__hint">Repite la secuencia de memoria. Tienes 3 vidas.</p>
          <div className="game-card__actions">
            <button type="button" className="btn btn--primary" onClick={() => open("simon-letras")}>Con letras</button>
            <button type="button" className="btn btn--secondary" onClick={() => open("simon-senas")}>Con señas</button>
          </div>
        </section>
      </div>
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
  const assist = useAssist();
  const started = useRef(performance.now());
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [score, setScore] = useState({ words: 0, letters: 0 });

  useEffect(() => {
    if (!run.done || elapsed !== null) return;
    setElapsed(performance.now() - started.current);
    // La estrella se gana haciendo letras: una palabra saltada completa no cuenta.
    if (skipped.size < letters.length) setScore((s) => ({ words: s.words + 1, letters: s.letters + letters.length - skipped.size }));
  }, [run.done, elapsed, letters.length, skipped.size]);

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
    <div className="screen game-screen">
      <GameHead title="Completa la palabra · con letras" lead="Deletrea la palabra; cada letra correcta pasa sola a la siguiente." onBack={onBack} assist={assist}
        right={<span className="game-score tabular" aria-label={`Palabras completas: ${score.words}`}>⭐ {score.words}</span>} />
      <GameStage wide={assist.on}
        camera={run.done ? (
          <section className="sheet game-done" aria-live="polite">
            <p className="game-done__title">🎉 ¡Formaste <span translate="no">{word}</span>!</p>
            <p className="sheet__hint tabular">
              {elapsed !== null ? `${(elapsed / 1000).toFixed(1)} s` : ""}
              {skipped.size ? ` · ${skipped.size} letra${skipped.size > 1 ? "s" : ""} saltada${skipped.size > 1 ? "s" : ""}` : " · sin saltar letras"}
              {assist.on ? " · con asistencia" : ""}
            </p>
            <button type="button" className="btn btn--primary" onClick={() => next()} autoFocus>Otra palabra →</button>
          </section>
        ) : (
          <>
            <LiveCamera corner={<ScoreGauge view={letterGauge(run)} />}>
              <p className="overlay-pill game-now" role="status"><span>Letra</span><strong translate="no">{run.target}</strong></p>
            </LiveCamera>
            <Note note={letterNote(run)} />
            <div className="sheet__actions">
              <button type="button" className="btn btn--secondary" onClick={skip}>Saltar letra →</button>
              <button type="button" className="btn btn--quiet" onClick={() => next()}>Otra palabra</button>
            </div>
          </>
        )}
        side={<>
          <section className="sheet game-target" aria-label="Palabra a formar">
            <div className="game-levels" role="group" aria-label="Dificultad">
              {(["todas", ...LEVELS] as const).map((l) => (
                <button key={l} type="button" className={`btn btn--small ${level === l ? "btn--primary" : "btn--secondary"}`} aria-pressed={level === l} onClick={() => changeLevel(l)}>
                  {l === "todas" ? "Todas" : l[0].toUpperCase() + l.slice(1)}
                </button>
              ))}
            </div>
            <p className="game-target__label">Forma la palabra</p>
            <LetterStrip text={word} index={run.index} skipped={skipped} big />
            <p className="sheet__hint tabular">{run.done ? `${letters.length} de ${letters.length} letras` : `Letra ${run.index + 1} de ${letters.length}`}</p>
          </section>
          {run.target && assist.on ? <LetterAssist letter={run.target} rec={run.rec} />
            : !run.done ? (
              <p className="sheet__hint game-help">Activa la asistencia para ver la foto o el video de la letra y tus dedos en vivo.</p>
            ) : null}
        </>}
      />
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
  const [attempt, setAttempt] = useState<{ ok: boolean; recognized: Glosses; tip: string | null } | null>(null);
  const assist = useAssist();
  const [score, setScore] = useState(0);
  const seen = useRef(evaluation);

  // Cada toma (baja las manos al terminar) llega como `evaluation`; se juzga solo si es de la seña actual.
  useEffect(() => {
    if (!evaluation || evaluation === seen.current) return;
    seen.current = evaluation;
    if (!target || evaluation.target !== target) return;
    setAttempt({ ok: wordCorrect(evaluation.recognized, target), recognized: evaluation.recognized, tip: firstTip(evaluation) });
  }, [evaluation, target]);
  useEffect(() => {
    if (!attempt?.ok) return;
    const id = window.setTimeout(() => { setIndex((i) => i + 1); setAttempt(null); }, 900);
    return () => window.clearTimeout(id);
  }, [attempt]);
  const done = phrase !== null && index >= phrase.length;
  useEffect(() => { if (done) setScore((s) => s + 1); }, [done]);

  const next = () => { setPhrase((p) => pickOther(phrases, p)); setIndex(0); setAttempt(null); };
  const skip = () => { setIndex((i) => i + 1); setAttempt(null); };

  const signing = live?.segment === "active";
  const top = attempt?.recognized[0]?.[0];
  const gauge: GaugeView = attempt?.ok ? { kind: "score", value: 100, tone: "ok", word: "¡Bien!", label: "✓", detail: "Seña correcta", caption: "Correcta" }
    : attempt ? { kind: "guide", label: "Otra vez", detail: top ? `Vi: ${glossLabel(top)}` : "No reconocí la seña" }
      : { kind: "idle", label: signing ? "Leyendo…" : "Haz la seña…", detail: signing ? "Baja las manos al terminar" : "Luego baja las manos" };
  const note = attempt?.ok ? { tone: "ok" as const, text: `¡Bien! ${glossLabel(target ?? "")}` }
    : attempt ? { tone: "warn" as const, text: top ? `Reconocí «${glossLabel(top)}». Intenta otra vez ${glossLabel(target ?? "")}.` : "No reconocí ninguna seña. Hazla completa y baja las manos." }
      : { text: signing ? "Leyendo tu seña… baja las manos al terminar." : `Haz la seña ${glossLabel(target ?? "")} y baja las manos al terminar.` };

  return (
    <div className="screen game-screen">
      <GameHead title="Completa la palabra · con señas" lead="Haz las señas de la frase una tras otra, bajando las manos después de cada una." onBack={onBack} assist={assist}
        right={<span className="game-score tabular" aria-label={`Frases completas: ${score}`}>⭐ {score}</span>} />
      <ServerNotice />
      {!phrase ? (
        <section className="sheet"><p className="sheet__hint" role="status">{vocab ? "El modelo activo no tiene las señas de estas frases." : "Cargando el catálogo de señas… (el servidor debe estar encendido)."}</p></section>
      ) : (
        <GameStage wide={assist.on}
          camera={done ? (
            <section className="sheet game-done" aria-live="polite">
              <p className="game-done__title">🎉 ¡Formaste «<span translate="no">{phrase.map(glossLabel).join(" ")}</span>»!</p>
              {assist.on ? <p className="sheet__hint">Con asistencia</p> : null}
              <button type="button" className="btn btn--primary" onClick={next} autoFocus>Otra frase →</button>
            </section>
          ) : (
            <>
              <LiveCamera corner={<ScoreGauge view={gauge} />}>
                {signing ? (
                  <p className="overlay-pill" role="status"><span className="rec-mark" aria-hidden="true" /><span>Leyendo tu seña</span></p>
                ) : <p className="overlay-pill game-now" role="status"><span>Seña</span><strong translate="no">{glossLabel(target ?? "")}</strong></p>}
              </LiveCamera>
              <Note note={note} />
              <div className="sheet__actions">
                <button type="button" className="btn btn--secondary" onClick={skip}>Saltar seña →</button>
                <button type="button" className="btn btn--quiet" onClick={next}>Otra frase</button>
              </div>
            </>
          )}
          side={<>
            <section className="sheet game-target" aria-label="Frase a formar">
              <p className="game-target__label">Forma la frase</p>
              <p className="game-phrase" translate="no">
                {phrase.map((g, i) => (
                  <span key={i} className="game-phrase__word" data-state={i < index ? "done" : i === index ? "now" : "todo"}>{glossLabel(g)}</span>
                ))}
              </p>
              <p className="sheet__hint tabular">{done ? `${phrase.length} de ${phrase.length} señas` : `Seña ${index + 1} de ${phrase.length}`}</p>
            </section>
            {target && assist.on ? <SignAssist gloss={target} live={live} tip={attempt && !attempt.ok ? attempt.tip : null} />
              : !done ? (
                <p className="sheet__hint game-help">Activa la asistencia para ver el ejemplo de la seña, tus dedos en vivo y los consejos.</p>
              ) : null}
          </>}
        />
      )}
    </div>
  );
}

/* ------------------------------ Carrera ------------------------------ */

/** Corredores: el leopardo es el jugador; los rivales usan el resto en orden de carril. */
const RUNNERS = ["leopardo", "perro", "aguila", "tiburon"];
const LEVEL_ICON: Record<RaceLevel, string> = { "fácil": "🐢", normal: "🐴", "difícil": "🐆", experto: "🚀" };
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function RaceGame({ onBack }: { onBack(): void }) {
  const [level, setLevel] = useState<RaceLevel>("normal");
  const cfg = RACE_LEVELS[level];
  const [text, setText] = useState(() => pickOther(RACE_LEVELS.normal.texts, null));
  const letters = useMemo(() => lettersOf(text), [text]);
  const [phase, setPhase] = useState<"setup" | "countdown" | "racing" | "done">("setup");
  const [count, setCount] = useState(3);
  const startAt = useRef(0);
  const [now, setNow] = useState(0);
  const [youMs, setYouMs] = useState<number | null>(null);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [records, setRecords] = useState(() => readRecords());
  const [newRecord, setNewRecord] = useState(false);
  const assist = useAssist();
  const assistUsed = useAssistUsed(assist.on, phase === "countdown" || phase === "racing");
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
    if (phase !== "racing" || !run.done) return;
    const ms = performance.now() - startAt.current;
    setYouMs(ms);
    // Récord: sin asistencia y deletreando al menos la mitad sin saltar.
    const record = !assistUsed.used && skipped.size * 2 <= letters.length && saveRecord(level, ms);
    setNewRecord(record);
    if (record) setRecords(readRecords());
    setPhase("done");
  }, [phase, run.done, level, skipped.size, letters.length, assistUsed.used]);

  const elapsed = phase === "racing" ? Math.max(0, now - startAt.current) : 0;
  const racers: Racer[] = [
    { name: "Tú", you: true, progress: letters.length ? run.index / letters.length : 0, finishMs: youMs },
    ...cfg.rivals.map((r) => {
      const finish = rivalFinishMs(r.lpm, letters.length);
      return phase === "done"
        ? { name: r.name, progress: youMs !== null && youMs < finish ? rivalProgress(r.lpm, youMs, letters.length) : 1, finishMs: finish }
        : { name: r.name, progress: rivalProgress(r.lpm, elapsed, letters.length), finishMs: elapsed >= finish ? finish : null };
    }),
  ];
  const order = standings(racers);
  const place = order.findIndex((r) => r.you) + 1;

  const chooseLevel = (l: RaceLevel) => { setLevel(l); setText((t) => pickOther(RACE_LEVELS[l].texts, t)); };
  const start = () => { run.reset(); setSkipped(new Set()); setYouMs(null); setNewRecord(false); assistUsed.reset(); setCount(3); setPhase("countdown"); };
  const again = () => { setText((t) => pickOther(cfg.texts, t)); setPhase("setup"); };
  const skip = () => { setSkipped((s) => new Set(s).add(run.index)); startAt.current -= cfg.skipPenalty * 1000; run.skip(); };
  const best = records[level];

  const track = (
    <section className="sheet race" aria-label="Pista de carreras">
      <div className="race-track">
        {racers.map((r, i) => (
          <div key={r.name} className="race-lane" data-you={r.you || undefined}>
            <span className="race-lane__name">{r.name}{r.you ? "" : <small> · {cfg.rivals[i - 1].lpm} l/min</small>}</span>
            <div className="race-lane__road">
              <img className="race-car" src={`/race/${RUNNERS[i]}.png`} alt="" draggable={false}
                data-running={(phase === "racing" && r.progress < 1) || undefined}
                style={{ left: `calc(1.7rem + (100% - 4rem) * ${r.progress.toFixed(4)})` }} />
              <span className="race-lane__goal" aria-hidden="true">🏁</span>
            </div>
            <span className="race-lane__pct tabular">{Math.round(r.progress * 100)} %</span>
          </div>
        ))}
      </div>
      <LetterStrip text={text} index={phase === "setup" || phase === "countdown" ? -1 : run.index} skipped={skipped} big />
    </section>
  );

  const main = phase === "setup" ? (
    <section className="sheet race-levels" aria-labelledby="carrera-nivel">
      <h3 id="carrera-nivel" className="sheet__title">Elige la dificultad</h3>
      <div className="race-levels__grid" role="radiogroup" aria-label="Dificultad de la carrera">
        {RACE_LEVEL_ORDER.map((l) => {
          const c = RACE_LEVELS[l], rec = records[l];
          return (
            <button key={l} type="button" role="radio" aria-checked={level === l} className="race-level" onClick={() => chooseLevel(l)}>
              <span className="race-level__icon" aria-hidden="true">{LEVEL_ICON[l]}</span>
              <span className="race-level__name">{c.label}</span>
              <span className="race-level__text">{c.summary}</span>
              <span className="race-level__meta tabular">Rivales {c.rivals[0].lpm}–{c.rivals[c.rivals.length - 1].lpm} letras/min · saltar +{c.skipPenalty} s</span>
              <span className="race-level__meta tabular">{rec !== undefined ? `🏆 Récord: ${seconds(rec)}` : "Sin récord todavía"}</span>
            </button>
          );
        })}
      </div>
      <p className="sheet__hint">
        {assist.on ? "Con asistencia verás la foto, el video y tus dedos en cada letra (no se guarda récord)." : "Activa la asistencia si quieres ver fotos y ejemplos durante la carrera."}
      </p>
      <div className="sheet__actions">
        <button type="button" className="btn btn--primary" onClick={start} autoFocus>¡Arrancar! 🏁</button>
        <button type="button" className="btn btn--quiet" onClick={() => setText((t) => pickOther(cfg.texts, t))}>Otro texto</button>
      </div>
    </section>
  ) : phase === "countdown" ? (
    <section className="sheet game-done" aria-live="assertive"><p className="race-count tabular">{count}</p></section>
  ) : phase === "done" ? (
    <section className="sheet game-done" aria-live="polite">
      <p className="game-done__title">{place === 1 ? "🏆 ¡Ganaste!" : `Llegaste en ${place}.º lugar`}</p>
      {newRecord ? <p className="race-record" role="status">⭐ ¡Nuevo récord en {cfg.label}!</p> : null}
      <ol className="race-results">
        {order.map((r) => (
          <li key={r.name} data-you={r.you || undefined}><span>{r.name}</span><span className="tabular">{r.finishMs !== null ? seconds(r.finishMs) : "—"}</span></li>
        ))}
      </ol>
      <p className="sheet__hint tabular">
        {youMs !== null ? `${lettersPerMinute(letters.length - skipped.size, youMs)} letras por minuto` : ""}
        {skipped.size ? ` · ${skipped.size} saltada${skipped.size > 1 ? "s" : ""}` : ""}
        {assistUsed.used ? " · con asistencia (sin récord)" : best !== undefined && !newRecord ? ` · récord: ${seconds(best)}` : ""}
      </p>
      <div className="sheet__actions">
        <button type="button" className="btn btn--primary" onClick={again} autoFocus>Otra carrera →</button>
        {level !== "experto" && place === 1 ? (
          <button type="button" className="btn btn--secondary" onClick={() => { chooseLevel(RACE_LEVEL_ORDER[RACE_LEVEL_ORDER.indexOf(level) + 1]); setPhase("setup"); }}>Subir de nivel ↑</button>
        ) : null}
      </div>
    </section>
  ) : (
    <>
      <LiveCamera corner={<ScoreGauge view={letterGauge(run)} />}>
        <p className="overlay-pill game-now" role="status"><span>Letra</span><strong translate="no">{run.target}</strong></p>
      </LiveCamera>
      <Note note={letterNote(run)} />
      <div className="sheet__actions">
        <button type="button" className="btn btn--secondary" onClick={skip}>Saltar letra (+{cfg.skipPenalty} s)</button>
        <button type="button" className="btn btn--quiet" onClick={() => setPhase("setup")}>Rendirse</button>
      </div>
    </>
  );

  return (
    <div className="screen game-screen">
      <GameHead title="Carrera de letras" lead="Deletrea el texto: cada letra correcta avanza tu leopardo." onBack={onBack} assist={assist}
        right={phase === "racing" ? <span className="game-score tabular">⏱ {seconds(elapsed)}</span> : <span className="game-score">{LEVEL_ICON[level]} {cfg.label}</span>} />
      <GameStage wide={assist.on} camera={main} side={<>
        {track}
        {phase === "racing" && run.target && assist.on ? <LetterAssist letter={run.target} rec={run.rec} />
          : null}
      </>} />
    </div>
  );
}
