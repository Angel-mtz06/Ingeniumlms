"""Entrena SignTransformer v1 y reporta métricas con personas no vistas."""
from __future__ import annotations

import argparse
import csv
import json

import numpy as np
import torch
from sklearn.metrics import f1_score

from lsm.anchor import FACEBOX_TO_HEAD
from lsm.augment import augment
from lsm.classifier.model import SignTransformer
from lsm.features import featurize
from lsm.normalize import NormSequence
from lsm.paths import MODELS, PROCESSED


class SignDataset(torch.utils.data.Dataset):
    def __init__(self, items, labels, mean, std, train: bool, seed: int = 0):
        self.items, self.labels, self.mean, self.std, self.train = items, labels, mean, std, train
        self.rng = np.random.default_rng(seed)

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        seq = self.items[i]
        if self.train:
            seq = augment(seq, self.rng)
        x = (featurize(seq) - self.mean) / self.std
        return torch.from_numpy(x.astype(np.float32)), self.labels[i]


def load_split(rows, split, label_idx):
    sel = [r for r in rows if r["split"] == split and r["gloss"] in label_idx]
    return [NormSequence.load(r["norm_path"]) for r in sel], [label_idx[r["gloss"]] for r in sel]


@torch.no_grad()
def predict(model, ds, batch=256):
    model.eval()
    dl = torch.utils.data.DataLoader(ds, batch_size=batch)
    return torch.cat([torch.softmax(model(x), 1) for x, _ in dl]).numpy()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=150)
    ap.add_argument("--out", default="classifier_v1")
    args = ap.parse_args()
    torch.manual_seed(0)
    rows = list(csv.DictReader(open(PROCESSED / "manifest.csv", encoding="utf-8")))
    labels = sorted({r["gloss"] for r in rows if r["split"] == "train"})
    li = {g: i for i, g in enumerate(labels)}
    tr_x, tr_y = load_split(rows, "train", li)
    va_x, va_y = load_split(rows, "val", li)
    te_x, te_y = load_split(rows, "test", li)
    feats = np.concatenate([featurize(s) for s in tr_x])
    mean, std = feats.mean(0), feats.std(0) + 1e-6
    train_ds = SignDataset(tr_x, tr_y, mean, std, train=True)
    val_ds = SignDataset(va_x, va_y, mean, std, train=False)
    test_ds = SignDataset(te_x, te_y, mean, std, train=False)
    model = SignTransformer(len(labels))
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=0.05)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=1e-3, total_steps=args.epochs * (len(train_ds) // 64 + 1))
    dl = torch.utils.data.DataLoader(train_ds, batch_size=64, shuffle=True)
    best, best_state = -1.0, None
    for ep in range(args.epochs):
        model.train()
        for x, y in dl:
            opt.zero_grad()
            loss = torch.nn.functional.cross_entropy(model(x), y, label_smoothing=0.1)
            loss.backward()
            opt.step()
            sched.step()
        if ep % 5 == 4 or ep == args.epochs - 1:
            acc = float((predict(model, val_ds).argmax(1) == np.array(va_y)).mean())
            print(f"época {ep + 1} loss {loss.item():.3f} val_acc {acc:.3f}", flush=True)
            if acc > best:
                best, best_state = acc, {k: v.clone() for k, v in model.state_dict().items()}
    model.load_state_dict(best_state)
    p = predict(model, test_ds)
    y = np.array(te_y)
    top3 = float(np.mean([yi in np.argsort(-pi)[:3] for pi, yi in zip(p, y)]))
    report = {"val_acc": best, "test_acc": float((p.argmax(1) == y).mean()), "test_top3": top3,
              "test_macro_f1": float(f1_score(y, p.argmax(1), average="macro")),
              "n_classes": len(labels), "n_train": len(tr_x), "n_val": len(va_x), "n_test": len(te_x),
              "facebox_to_head": FACEBOX_TO_HEAD}
    MODELS.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": model.state_dict(), "labels": labels, "feat_mean": mean, "feat_std": std,
                "config": {"d": 128, "layers": 3, "heads": 4, "ff": 256}}, MODELS / f"{args.out}.pt")
    json.dump(report, open(MODELS / f"{args.out}_report.json", "w"), indent=2)
    with open(MODELS / f"{args.out}_per_class.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["gloss", "n_test", "acc"])
        for c, g in enumerate(labels):
            m = y == c
            if m.any():
                w.writerow([g, int(m.sum()), round(float((p[m].argmax(1) == c).mean()), 3)])
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
