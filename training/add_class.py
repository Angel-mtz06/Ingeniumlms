"""Agrega UNA clase nueva a un clasificador ya entrenado, sin reentrenar las demás.

Uso: python add_class.py --gloss MAMA --base classifier_v2 --out classifier_v3
Copia el modelo base, amplía la capa de salida con una fila y entrena SOLO esa fila (y su sesgo) con las tomas
propias de la glosa (datasets/own). El resto (rasgos, Transformer y las filas de las demás señas) queda idéntico.
Como no hay datos de las otras señas, los negativos son el ejemplo guardado de cada seña en references_<base>.json,
con aumentación. Evalúa dejando fuera una persona a la vez (tomas de la pantalla Grabar/extract_own_videos.py).
Nada del modelo base se reescribe: para volver atrás basta con dejar ACTIVE_MODEL en el modelo base."""
from __future__ import annotations

import argparse
import csv
import json
import shutil
from pathlib import Path

import numpy as np
import torch

from lsm.anchor import AnchorError
from lsm.augment import augment
from lsm.classifier.model import SignTransformer
from lsm.evaluator.references import load_references
from lsm.features import featurize
from lsm.normalize import NormSequence, normalize
from lsm.paths import DATASETS, MODELS
from lsm.schema import RawSequence
from lsm.vocab import canonical

MIN_HAND_RATIO = 0.3
K_AUG = 25  # variantes aumentadas por muestra


def embed(model: SignTransformer, seqs: list[NormSequence], mean, std) -> torch.Tensor:
    x = np.stack([(featurize(s) - mean) / std for s in seqs]).astype(np.float32)
    with torch.no_grad():
        xt = torch.from_numpy(x)
        return model.norm(model.enc(model.inp(xt) + model.pos).mean(dim=1))


def augmented(seqs, rng, k):
    return [augment(s, rng) for s in seqs for _ in range(k)]


def fit_row(old_head, pos, neg, neg_idx, steps=400, l2=1e-3):
    """Entrena w (128) y b para la clase nueva con las filas viejas fijas. pos/neg: incrustaciones (N, 128)."""
    w = torch.nn.Parameter(pos.mean(0) - neg.mean(0))
    b = torch.nn.Parameter(torch.zeros(()))
    opt = torch.optim.Adam([w, b], lr=0.05)
    emb = torch.cat([pos, neg])
    tgt = torch.cat([torch.full((len(pos),), old_head.out_features, dtype=torch.long), neg_idx])
    wt = torch.cat([torch.full((len(pos),), 0.5 / len(pos)), torch.full((len(neg),), 0.5 / len(neg))])
    with torch.no_grad():
        old_logits = old_head(emb)
    for _ in range(steps):
        opt.zero_grad()
        logits = torch.cat([old_logits, (emb @ w + b)[:, None]], 1)
        loss = (torch.nn.functional.cross_entropy(logits, tgt, reduction="none", label_smoothing=0.05) * wt).sum()
        (loss + l2 * (w ** 2).sum()).backward()
        opt.step()
    return w.detach(), b.detach()


def probs(old_head, w, b, emb):
    with torch.no_grad():
        logits = torch.cat([old_head(emb), (emb @ w + b)[:, None]], 1)
        return torch.softmax(logits, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gloss", required=True)
    ap.add_argument("--base", default="classifier_v2")
    ap.add_argument("--out", default="classifier_v3")
    ap.add_argument("--min-hands", type=float, default=MIN_HAND_RATIO)
    args = ap.parse_args()
    gloss = canonical(args.gloss)

    ck = torch.load(MODELS / f"{args.base}.pt", map_location="cpu", weights_only=False)
    labels = list(ck["labels"])
    if gloss in labels:
        raise SystemExit(f"{gloss} ya es una clase de {args.base}.")
    mean, std = np.asarray(ck["feat_mean"]), np.asarray(ck["feat_std"])
    model = SignTransformer(len(labels), **ck["config"])
    model.load_state_dict(ck["state_dict"])
    model.eval()
    old_head = model.head

    # positivos: tomas propias por persona (normalizadas como en el entrenamiento, sin quitar la mano en reposo)
    by_signer: dict[str, list[NormSequence]] = {}
    for r in csv.DictReader(open(DATASETS / "own" / "index_own.csv", encoding="utf-8")):
        if r["source_label"] != gloss or float(r["hand_ratio"]) < args.min_hands:
            continue
        try:
            by_signer.setdefault(r["signer"], []).append(normalize(RawSequence.load(r["path"])))
        except AnchorError:
            continue
    n_pos = sum(len(v) for v in by_signer.values())
    if len(by_signer) < 2 or n_pos < 10:
        raise SystemExit(f"Faltan tomas de {gloss}: {n_pos} de {len(by_signer)} personas (mínimo 10 de 2).")

    # negativos: el ejemplo de cada seña conocida
    refs = load_references(MODELS / f"references_{args.base}.json")
    neg_seqs, neg_lab = [], []
    for g, ref in sorted(refs.items()):
        if g in labels:
            neg_seqs.append(NormSequence(hands=ref.example_hands.astype(np.float32), present=ref.example_present.astype(bool),
                                         sample_id=f"ex_{g}", signer="ex"))
            neg_lab.append(labels.index(g))
    neg_lab_t = torch.tensor(neg_lab)
    print(f"{gloss}: {n_pos} tomas de {len(by_signer)} personas {({k: len(v) for k, v in by_signer.items()})}; "
          f"{len(neg_seqs)} negativos (un ejemplo por seña)")

    rng = np.random.default_rng(0)
    neg_plain = embed(model, neg_seqs, mean, std)
    neg_aug = embed(model, augmented(neg_seqs, rng, K_AUG), mean, std)
    neg_aug_lab = neg_lab_t.repeat_interleave(K_AUG)
    base_pred = old_head(neg_plain).argmax(1)
    print(f"negativos que el modelo base ya acierta (top1) sin aumentar: {(base_pred == neg_lab_t).float().mean():.2f}")

    # evaluación dejando fuera una persona a la vez
    report = {"folds": {}}
    new_i = len(labels)
    for held in sorted(by_signer):
        train_seqs = [s for k, v in by_signer.items() if k != held for s in v]
        pos = embed(model, augmented(train_seqs, rng, K_AUG), mean, std)
        w, b = fit_row(old_head, pos, neg_aug, neg_aug_lab)
        test_pos = embed(model, by_signer[held], mean, std)
        p_pos = probs(old_head, w, b, test_pos)
        p_neg = probs(old_head, w, b, neg_plain)
        fold = {"n_test": len(by_signer[held]),
                "recall_top1": float((p_pos.argmax(1) == new_i).float().mean()),
                "recall_top3": float((p_pos.topk(3, 1).indices == new_i).any(1).float().mean()),
                "prob_media_pos": float(p_pos[:, new_i].mean()),
                "neg_robados_top1": int((p_neg.argmax(1) == new_i).sum()),
                "neg_prob_max": float(p_neg[:, new_i].max()),
                "neg_aciertos_top1": float((p_neg.argmax(1) == neg_lab_t).float().mean())}
        report["folds"][held] = fold
        print(held, {k: (round(v, 3) if isinstance(v, float) else v) for k, v in fold.items()})
    folds = list(report["folds"].values())
    report["resumen"] = {k: round(float(np.mean([f[k] for f in folds])), 3)
                         for k in ("recall_top1", "recall_top3", "prob_media_pos", "neg_aciertos_top1")}
    report["resumen"]["neg_robados_top1_max"] = max(f["neg_robados_top1"] for f in folds)
    print("RESUMEN", report["resumen"])

    # modelo final: todas las personas
    all_seqs = [s for v in by_signer.values() for s in v]
    pos = embed(model, augmented(all_seqs, rng, K_AUG), mean, std)
    w, b = fit_row(old_head, pos, neg_aug, neg_aug_lab)
    sd = {k: v.clone() for k, v in ck["state_dict"].items()}
    sd["head.weight"] = torch.cat([sd["head.weight"], w[None]])
    sd["head.bias"] = torch.cat([sd["head.bias"], b[None]])
    out = MODELS / f"{args.out}.pt"
    torch.save({"state_dict": sd, "labels": labels + [gloss], "feat_mean": ck["feat_mean"], "feat_std": ck["feat_std"],
                "config": ck["config"]}, out)
    base_report = MODELS / f"{args.base}_report.json"
    info = {"base": args.base, "added": gloss, "n_train_new": n_pos, "n_classes": len(labels) + 1,
            "nota": "solo se entrenó la fila nueva; las demás clases son idénticas a la base", **report}
    json.dump(info, open(MODELS / f"{args.out}_report.json", "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    refs_src = MODELS / f"references_{args.base}.json"
    if refs_src.exists():
        shutil.copy2(refs_src, MODELS / f"references_{args.out}.json")
    print("Guardado:", out.name, "y references_" + args.out + ".json. NO se activó (ACTIVE_MODEL no cambió).")


if __name__ == "__main__":
    main()
