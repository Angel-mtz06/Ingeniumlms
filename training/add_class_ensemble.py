"""Agrega UNA clase nueva a cada miembro de un ensamble (p. ej. MAMA a classifier_v2e) sin reentrenar las demás.

Uso:
  python add_class_ensemble.py --gloss MAMA --base classifier_v2e --out classifier_v3e
  python add_class_ensemble.py --gloss MAMA --base classifier_v2e --out prueba --pos-norms <carpeta de .npz>

Como add_class.py (de Omar): se entrena solo la fila nueva de la capa de salida (y su sesgo); lo demás queda idéntico.
Cambia de dónde salen los negativos: TODAS las muestras de entrenamiento del manifiesto (las 121 señas y NINGUNA),
no un ejemplo por seña; así la clase nueva "roba" menos señas. Positivos: las tomas propias (datasets/own,
index_own.csv, normalizadas como en el entrenamiento) o, con --pos-norms, NormSequence ya normalizadas
(<persona>_<lo que sea>.npz).

Evaluación (se imprime y va al reporte):
- clase nueva, dejando fuera una persona a la vez: top-1 y top-3 del ENSAMBLE (promedio de miembros);
- señas y NINGUNA de val y test del manifiesto (personas no vistas): top-1, top-3, cuántas se volvieron la clase
  nueva y NINGUNA que se cuela (regla de la sesión: P(NINGUNA) ≥ NONE_MIN), antes y después.
Nada se activa: escribe models/<out>.pt, models/<out>_report.json, models/references_<out>.json (copia de las
del modelo base) y datasets/processed_<out>/vocab.csv (el de la base + la clase nueva). Se niega a sobrescribir."""
from __future__ import annotations

import argparse
import csv
import json
import shutil
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from add_class import K_AUG, augmented, embed, fit_row  # noqa: E402

from lsm.anchor import AnchorError  # noqa: E402
from lsm.classifier.model import SignTransformer  # noqa: E402
from lsm.normalize import NormSequence, mirror, normalize  # noqa: E402
from lsm.paths import DATASETS, MODELS, active_references_path, active_vocab_path  # noqa: E402
from lsm.schema import RawSequence  # noqa: E402
from lsm.session import NONE_MIN  # noqa: E402
from lsm.themes import THEME_OF  # noqa: E402
from lsm.vocab import canonical  # noqa: E402
from lsm.windows import NONE_GLOSS  # noqa: E402

MIN_HAND_RATIO = 0.3
NEG_AUG = 2  # variantes aumentadas por muestra de entrenamiento (además de la original)


def load_members(base: str) -> list[dict]:
    ck = torch.load(MODELS / f"{base}.pt", map_location="cpu", weights_only=False)
    return list(ck["ensemble"]) if "ensemble" in ck else [ck]


def model_of(ck: dict) -> SignTransformer:
    m = SignTransformer(len(ck["labels"]), **ck["config"])
    m.load_state_dict(ck["state_dict"])
    return m.eval()


def positives(gloss: str, pos_norms: Path | None, min_hands: float, espejo: bool = False) -> dict[str, list[NormSequence]]:
    by: dict[str, list[NormSequence]] = {}
    if pos_norms is not None:
        for p in sorted(pos_norms.glob("*.npz")):
            by.setdefault(p.stem.split("_")[0], []).append(NormSequence.load(p))
        return by
    for r in csv.DictReader(open(DATASETS / "own" / "index_own.csv", encoding="utf-8")):
        if canonical(r["source_label"]) != gloss or float(r["hand_ratio"]) < min_hands:
            continue
        try:
            n = normalize(RawSequence.load(r["path"]))
            by.setdefault(r["signer"], []).append(mirror(n) if espejo else n)
        except AnchorError:
            continue
    return by


def full_probs(head, w, b, emb) -> np.ndarray:
    with torch.no_grad():
        logits = head(emb) if w is None else torch.cat([head(emb), (emb @ w + b)[:, None]], 1)
        return torch.softmax(logits, 1).numpy()


def metrics(P: np.ndarray, y: np.ndarray, none: int, new: int | None) -> dict:
    """Señas conocidas (y != NINGUNA) y tramos NINGUNA; `new` = índice de la clase nueva (None = modelo base)."""
    sign = y != none
    q = P.copy()
    q[:, none] = -1
    order = np.argsort(-q, 1)
    disc = P[:, none] >= NONE_MIN
    return {"top1": float(((order[:, 0] == y) & ~disc)[sign].mean()),
            "top3": float((order[:, :3] == y[:, None]).any(1)[sign].mean()),
            "robadas": int(((order[:, 0] == new) & ~disc)[sign].sum()) if new is not None else 0,
            "ninguna_se_cuela": float((~disc)[~sign].mean()), "n": int(sign.sum()), "n_ninguna": int((~sign).sum())}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gloss", required=True)
    ap.add_argument("--base", default="classifier_v2e")
    ap.add_argument("--out", required=True)
    ap.add_argument("--manifest", type=Path, default=DATASETS / "processed_classifier_v2" / "manifest.csv")
    ap.add_argument("--pos-norms", type=Path, default=None)
    ap.add_argument("--espejo", action="store_true",
                    help="las tomas propias (datasets/own) están en espejo (cámara frontal del celular): se reflejan antes de usarlas")
    ap.add_argument("--min-hands", type=float, default=MIN_HAND_RATIO)
    ap.add_argument("--dry-run", action="store_true", help="solo evalúa; no escribe nada")
    args = ap.parse_args()
    gloss = canonical(args.gloss)
    out = MODELS / f"{args.out}.pt"
    if out.exists() and not args.dry_run:
        raise SystemExit(f"{out} ya existe: no se sobrescribe")
    torch.set_num_threads(6)

    members = load_members(args.base)
    labels = list(members[0]["labels"])
    if gloss in labels:
        raise SystemExit(f"{gloss} ya es una clase de {args.base}.")
    none, new = labels.index(NONE_GLOSS), len(labels)
    by_signer = positives(gloss, args.pos_norms, args.min_hands, args.espejo)
    n_pos = sum(len(v) for v in by_signer.values())
    if len(by_signer) < 2 or n_pos < 6:
        raise SystemExit(f"Faltan tomas de {gloss}: {n_pos} de {len(by_signer)} personas (mínimo 6 de 2).")
    print(f"{gloss}: {n_pos} tomas de {len(by_signer)} personas {({k: len(v) for k, v in by_signer.items()})}")

    rows = list(csv.DictReader(open(args.manifest, encoding="utf-8")))
    li = {g: i for i, g in enumerate(labels)}
    train = [r for r in rows if r["split"] == "train" and r["gloss"] in li]
    train_seqs = [NormSequence.load(r["norm_path"]) for r in train]
    train_y = torch.tensor([li[r["gloss"]] for r in train])
    held = {s: [r for r in rows if r["split"] == s and r["gloss"] in li] for s in ("val", "test")}
    held_seqs = {s: [NormSequence.load(r["norm_path"]) for r in v] for s, v in held.items()}
    held_y = {s: np.array([li[r["gloss"]] for r in v]) for s, v in held.items()}
    print(f"negativos: {len(train)} muestras de entrenamiento (+{NEG_AUG} aumentadas c/u); val {len(held['val'])}, "
          f"test {len(held['test'])}")

    rng = np.random.default_rng(0)
    neg_aug_seqs = augmented(train_seqs, rng, NEG_AUG)
    signers = sorted(by_signer)
    fold_p = {h: [] for h in signers}  # probabilidades de cada miembro sobre la persona dejada fuera
    base_p = {s: [] for s in held}
    new_p = {s: [] for s in held}
    rows_new = []
    for mi, ck in enumerate(members):
        model = model_of(ck)
        mean, std = np.asarray(ck["feat_mean"]), np.asarray(ck["feat_std"])
        neg = torch.cat([embed(model, train_seqs, mean, std), embed(model, neg_aug_seqs, mean, std)])
        neg_y = torch.cat([train_y, train_y.repeat_interleave(NEG_AUG)])
        for h in signers:
            tr = [s for k, v in by_signer.items() if k != h for s in v]
            pos = embed(model, augmented(tr, rng, K_AUG), mean, std)
            w, b = fit_row(model.head, pos, neg, neg_y)
            fold_p[h].append(full_probs(model.head, w, b, embed(model, by_signer[h], mean, std)))
        all_pos = [s for v in by_signer.values() for s in v]
        w, b = fit_row(model.head, embed(model, augmented(all_pos, rng, K_AUG), mean, std), neg, neg_y)
        rows_new.append((w, b))
        for s in held:
            e = embed(model, held_seqs[s], mean, std)
            base_p[s].append(full_probs(model.head, None, None, e))
            new_p[s].append(full_probs(model.head, w, b, e))
        print(f"miembro {mi + 1}/{len(members)} listo", flush=True)

    report = {"base": args.base, "added": gloss, "n_pos": n_pos, "personas": {k: len(v) for k, v in by_signer.items()},
              "negativos": f"{len(train)} de entrenamiento + {NEG_AUG} aumentadas c/u", "none_min": NONE_MIN}
    folds = {}
    for h in signers:
        P = np.mean(fold_p[h], 0)
        folds[h] = {"n": len(P), "top1": float((P.argmax(1) == new).mean()),
                    "top3": float((np.argsort(-P, 1)[:, :3] == new).any(1).mean()), "p_media": float(P[:, new].mean())}
    report["clase_nueva_por_persona"] = folds
    report["clase_nueva"] = {k: round(float(np.mean([f[k] for f in folds.values()])), 3) for k in ("top1", "top3", "p_media")}
    for s in held:
        report[s] = {"antes": metrics(np.mean(base_p[s], 0), held_y[s], none, None),
                     "despues": metrics(np.mean(new_p[s], 0), held_y[s], none, new)}
    print(json.dumps(report, indent=1, ensure_ascii=False))
    if args.dry_run:
        return

    new_members = []
    for ck, (w, b) in zip(members, rows_new):
        sd = {k: v.clone() for k, v in ck["state_dict"].items()}
        sd["head.weight"] = torch.cat([sd["head.weight"], w[None]])
        sd["head.bias"] = torch.cat([sd["head.bias"], b[None]])
        new_members.append({**ck, "state_dict": sd, "labels": labels + [gloss]})
    torch.save({"ensemble": new_members, "labels": labels + [gloss], "added": gloss, "base": args.base}, out)
    json.dump(report, open(MODELS / f"{args.out}_report.json", "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    shutil.copy2(active_references_path(args.base), MODELS / f"references_{args.out}.json")
    vocab_dir = DATASETS / f"processed_{args.out}"
    vocab_dir.mkdir(exist_ok=True)
    vrows = list(csv.DictReader(open(active_vocab_path(args.base), encoding="utf-8")))
    if not any(r["gloss"] == gloss for r in vrows):
        vrows.append({"gloss": gloss, "category": THEME_OF.get(gloss) or "Otros", "sources": "own"})
    with open(vocab_dir / "vocab.csv", "w", encoding="utf-8", newline="") as f:
        wtr = csv.DictWriter(f, fieldnames=list(vrows[0].keys()))
        wtr.writeheader()
        wtr.writerows(vrows)
    print(f"Guardado: {out.name}, su reporte, references_{args.out}.json y processed_{args.out}/vocab.csv. "
          "NO se activó (ACTIVE_MODEL no cambió).")


if __name__ == "__main__":
    main()
