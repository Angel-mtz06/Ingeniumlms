import { useEffect, useMemo, useRef, useState } from "react";
import { ReferencePlayer } from "../components/ReferencePlayer";
import { ScoreGauge } from "../components/ScoreGauge";
import { useAlphabetRecognition } from "../hooks/useAlphabetRecognition";
import { LETTERS } from "../lib/alphabet";
import { freeGauge, spellStatus } from "../lib/alphabetView";
import {
  availableSigns, knownMarks, lettersOf, pickDistinct, pickOther, readBest, recognizedInBank, saveBest, scoreGuess,
  WORDLE_TRIES, WORDLE_WORDS, type Mark,
} from "../lib/games";
import type { GaugeView } from "../lib/gauge";
import { glossLabel } from "../lib/ui";
import { appendLetter } from "../lib/spelling";
import { GameHead, Note } from "./gameParts";
import { LiveCamera } from "./LiveCamera";
import { ServerNotice, useApp, useFrameSink, useSessionMode } from "./shared";

type Row<T> = { guess: T[]; marks: Mark[] };
const MARK_WORD: Record<Mark, string> = { ok: "en su lugar", near: "está en otro lugar", no: "no está" };
/** Con el intento completo, se envía solo tras este tiempo sin cambios (se puede borrar antes). */
const AUTO_SUBMIT_MS = 1500;

/** Tablero de Wordle: intentos calificados, el intento en curso y las filas que faltan. */
function Board<T extends string>({ rows, current, size, label }: { rows: Row<T>[]; current: T[]; size: number; label(t: T): string }) {
  const lines = Array.from({ length: WORDLE_TRIES }, (_, i) => i);
  return (
    <div className="wordle-board" data-cols={size} style={{ ["--cols" as string]: size }} role="table" aria-label="Intentos">
      {lines.map((i) => {
        const row = rows[i];
        const cells = row ? row.guess : i === rows.length ? current : [];
        return (
          <div key={i} className="wordle-row" role="row" data-current={!row && i === rows.length ? "" : undefined}>
            {Array.from({ length: size }, (_, j) => {
              const t = cells[j];
              const mark = row?.marks[j];
              return (
                <span key={j} role="cell" className="wordle-cell" data-mark={mark} data-filled={t !== undefined ? "" : undefined}
                  aria-label={t !== undefined ? `${label(t)}${mark ? `: ${MARK_WORD[mark]}` : ""}` : "vacío"} translate="no">
                  {t !== undefined ? label(t) : ""}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function Legend() {
  return (
    <p className="wordle-legend">
      <span className="wordle-cell wordle-cell--mini" data-mark="ok" aria-hidden="true" /> en su lugar
      <span className="wordle-cell wordle-cell--mini" data-mark="near" aria-hidden="true" /> en otro lugar
      <span className="wordle-cell wordle-cell--mini" data-mark="no" aria-hidden="true" /> no está
    </p>
  );
}

/** Envía `current` cuando tiene `size` elementos y pasan AUTO_SUBMIT_MS sin cambios. */
function useAutoSubmit<T>(current: T[], size: number, submit: () => void, enabled: boolean) {
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (!enabled || current.length !== size) return;
    const id = window.setTimeout(() => submitRef.current(), AUTO_SUBMIT_MS);
    return () => window.clearTimeout(id);
  }, [current, size, enabled]);
}

function EndCard({ win, tries, answer, best, isRecord, onAgain }: { win: boolean; tries: number; answer: string; best: number | null; isRecord: boolean; onAgain(): void }) {
  return (
    <section className="sheet game-done" aria-live="polite">
      <p className="game-done__title">{win ? `🎉 ¡Lo adivinaste en ${tries} intento${tries > 1 ? "s" : ""}!` : "😅 ¡Casi! Esta vez no"}</p>
      <p className="sheet__hint">Era: <strong translate="no">{answer}</strong></p>
      {isRecord ? <p className="race-record">⭐ ¡Nuevo récord!</p> : best !== null ? <p className="sheet__hint tabular">Tu récord: {best} intento{best > 1 ? "s" : ""}</p> : null}
      <button type="button" className="btn btn--primary" onClick={onAgain} autoFocus>Jugar otra vez →</button>
    </section>
  );
}

/* ------------------------------ Wordle con letras ------------------------------ */

export function WordleLetters({ onBack }: { onBack(): void }) {
  const { camera, vision } = useApp();
  const [secret, setSecret] = useState(() => pickOther(WORDLE_WORDS, null));
  const answer = useMemo(() => lettersOf(secret), [secret]);
  const [rows, setRows] = useState<Row<string>[]>([]);
  const [current, setCurrent] = useState<string[]>([]);
  const [isRecord, setIsRecord] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const win = rows.some((r) => r.marks.length > 0 && r.marks.every((m) => m === "ok"));
  const over = win || gaveUp || rows.length >= WORDLE_TRIES;
  // Sin letra objetivo: el reconocedor de Libre (estáticas y con movimiento). Cada letra nueva se escribe.
  const rec = useAlphabetRecognition(null, "free", !over && camera.ready && !vision.loading && !vision.error);
  useFrameSink(!over ? (f) => rec.onFrame(f) : null);
  const stable = rec.stable?.[0] ?? null;
  useEffect(() => {
    if (!stable || over) return;
    setCurrent((c) => { const next = appendLetter(c, stable); return next.length > 5 ? c : next; });
  }, [stable, over]);

  const submit = () => {
    if (current.length !== 5) return;
    const marks = scoreGuess(current, answer);
    const next = [...rows, { guess: current, marks }];
    setRows(next);
    setCurrent([]);
    if (marks.every((m) => m === "ok")) setIsRecord(saveBest("wordle-letras", next.length, false));
  };
  useAutoSubmit(current, 5, submit, !over);
  const again = () => { setSecret((s) => pickOther(WORDLE_WORDS, s)); setRows([]); setCurrent([]); setIsRecord(false); setGaveUp(false); rec.restart(); };
  const keys = knownMarks(rows);
  const status = spellStatus(rec);

  return (
    <div className="screen">
      <GameHead title="Wordle LSM · con letras" lead="Adivina la palabra de 5 letras. Deletréala frente a la cámara: cada letra que sostienes se escribe." onBack={onBack}
        right={<span className="game-score tabular">Intento {Math.min(rows.length + 1, WORDLE_TRIES)} de {WORDLE_TRIES}</span>} />
      <div className="wordle-layout">
        <section className="sheet wordle-main" aria-label="Tablero">
          <Board rows={rows} current={current} size={5} label={(l) => l} />
          <Legend />
          <div className="wordle-keys" aria-label="Letras usadas">
            {LETTERS.map((l) => <span key={l} className="wordle-key" data-mark={keys.get(l)} translate="no">{l}</span>)}
          </div>
        </section>
        {over ? (
          <EndCard win={win} tries={rows.length} answer={secret} best={readBest("wordle-letras")} isRecord={isRecord} onAgain={again} />
        ) : (
          <div className="practice-camera">
            <LiveCamera corner={<ScoreGauge view={freeGauge(rec.stable, rec.feedback)} />}>
              <p className="overlay-pill game-now" role="status"><span>Letras</span><strong translate="no">{current.join("") || "…"}</strong></p>
            </LiveCamera>
            <Note note={current.length === 5 ? { tone: "ok", text: "Intento completo: se envía en un momento (o bórralo)." } : status} />
            <p className="sheet__hint">Para repetir una letra (PERRO), baja la mano un instante entre las dos.</p>
            <div className="sheet__actions">
              <button type="button" className="btn btn--secondary" onClick={() => setCurrent((c) => c.slice(0, -1))} disabled={!current.length}>⌫ Borrar letra</button>
              <button type="button" className="btn btn--primary" onClick={submit} disabled={current.length !== 5}>Enviar</button>
              <button type="button" className="btn btn--quiet" onClick={() => setGaveUp(true)}>Rendirse</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ Wordle con señas ------------------------------ */

const SIGN_SLOTS = 3, BANK_SIZE = 6;

/**
 * Wordle de señas (tipo Mastermind): una secuencia secreta de 3 señas distintas, tomadas de un banco
 * de 6 que se muestra. Se hace una seña a la vez (bajando las manos); solo cuentan las del banco.
 */
export function WordleSigns({ onBack }: { onBack(): void }) {
  const { session, vocab } = useApp();
  const signs = useMemo(() => availableSigns(vocab), [vocab]);
  const [game, setGame] = useState<{ bank: string[]; secret: string[] } | null>(null);
  useEffect(() => {
    if (game || signs.length < BANK_SIZE) return;
    const bank = pickDistinct(signs, BANK_SIZE);
    setGame({ bank, secret: pickDistinct(bank, SIGN_SLOTS) });
  }, [signs, game]);
  const [rows, setRows] = useState<Row<string>[]>([]);
  const [current, setCurrent] = useState<string[]>([]);
  const [last, setLast] = useState<{ hit: string | null; top: string | null } | null>(null);
  const [help, setHelp] = useState<string | null>(null);
  const [isRecord, setIsRecord] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const win = rows.some((r) => r.marks.length > 0 && r.marks.every((m) => m === "ok"));
  const over = win || gaveUp || rows.length >= WORDLE_TRIES;
  const bank = game?.bank ?? [];
  // El servidor en modo Práctica (una seña por toma); la seña objetivo no importa: se usa su top 3.
  useSessionMode("practice", bank[0] ?? null, bank.length > 0 && !over);
  useFrameSink(bank.length && !over ? (f) => session.send(f) : null);
  const { evaluation, live } = session.last;
  const seen = useRef(evaluation);
  useEffect(() => {
    if (!evaluation || evaluation === seen.current || !game || over) return;
    seen.current = evaluation;
    const hit = recognizedInBank(evaluation.recognized, game.bank);
    setLast({ hit, top: evaluation.recognized[0]?.[0] ?? null });
    if (hit) setCurrent((c) => (c.length < SIGN_SLOTS ? [...c, hit] : c));
  }, [evaluation, game, over]);

  const submit = () => {
    if (!game || current.length !== SIGN_SLOTS) return;
    const marks = scoreGuess(current, game.secret);
    const next = [...rows, { guess: current, marks }];
    setRows(next);
    setCurrent([]);
    setLast(null);
    if (marks.every((m) => m === "ok")) setIsRecord(saveBest("wordle-senas", next.length, false));
  };
  useAutoSubmit(current, SIGN_SLOTS, submit, !over);
  const again = () => { setGame(null); setRows([]); setCurrent([]); setLast(null); setIsRecord(false); setHelp(null); setGaveUp(false); };
  const marks = knownMarks(rows);
  const signing = live?.segment === "active";
  const gauge: GaugeView = signing ? { kind: "idle", label: "Leyendo…", detail: "Baja las manos al terminar" }
    : last?.hit ? { kind: "score", value: 100, tone: "ok", word: glossLabel(last.hit), label: "✓", detail: `Seña: ${glossLabel(last.hit)}`, caption: "Anotada" }
      : last ? { kind: "guide", label: "No es del banco", detail: last.top ? `Vi: ${glossLabel(last.top)}` : "No reconocí la seña" }
        : { kind: "idle", label: `Seña ${current.length + 1} de ${SIGN_SLOTS}`, detail: "Haz una seña del banco" };

  return (
    <div className="screen">
      <GameHead title="Wordle LSM · con señas" lead="Adivina la secuencia secreta de 3 señas. Usa solo señas del banco, una a la vez, bajando las manos al terminar cada una." onBack={onBack}
        right={<span className="game-score tabular">Intento {Math.min(rows.length + 1, WORDLE_TRIES)} de {WORDLE_TRIES}</span>} />
      <ServerNotice />
      {!game ? (
        <section className="sheet"><p className="sheet__hint" role="status">{vocab ? "El modelo activo no tiene suficientes señas para este juego." : "Cargando el catálogo de señas… (el servidor debe estar encendido)."}</p></section>
      ) : (
        <div className="wordle-layout">
          <section className="sheet wordle-main" aria-label="Tablero">
            <Board rows={rows} current={current} size={SIGN_SLOTS} label={glossLabel} />
            <Legend />
            <p className="game-target__label">Banco de señas (toca una para ver cómo se hace)</p>
            <div className="wordle-bank">
              {game.bank.map((g) => (
                <button key={g} type="button" className="wordle-key wordle-key--sign" data-mark={marks.get(g)} aria-pressed={help === g}
                  onClick={() => setHelp((h) => (h === g ? null : g))} translate="no">{glossLabel(g)}</button>
              ))}
            </div>
            {help ? <div className="wordle-help"><ReferencePlayer gloss={help} /></div> : null}
          </section>
          {over ? (
            <EndCard win={win} tries={rows.length} answer={game.secret.map(glossLabel).join(" · ")} best={readBest("wordle-senas")} isRecord={isRecord} onAgain={again} />
          ) : (
            <div className="practice-camera">
              <LiveCamera corner={<ScoreGauge view={gauge} />}>
                {signing ? <p className="overlay-pill" role="status"><span className="rec-mark" aria-hidden="true" /><span>Leyendo tu seña</span></p> : null}
              </LiveCamera>
              <Note note={current.length === SIGN_SLOTS ? { tone: "ok", text: "Intento completo: se envía en un momento (o bórralo)." }
                : last && !last.hit ? { tone: "warn", text: `Reconocí «${last.top ? glossLabel(last.top) : "nada"}», que no está en el banco. Repite la seña.` }
                  : { text: `Haz la seña ${current.length + 1} de ${SIGN_SLOTS} y baja las manos.` }} />
              <div className="sheet__actions">
                <button type="button" className="btn btn--secondary" onClick={() => setCurrent((c) => c.slice(0, -1))} disabled={!current.length}>⌫ Borrar seña</button>
                <button type="button" className="btn btn--primary" onClick={submit} disabled={current.length !== SIGN_SLOTS}>Enviar</button>
                <button type="button" className="btn btn--quiet" onClick={() => setGaveUp(true)}>Rendirse</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
