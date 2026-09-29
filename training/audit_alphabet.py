"""Audit existing static letter features and export existing pose samples.

No new images, labels or temporal samples are fabricated. The split is by row
within each class; signer/session metadata is absent, so this is NOT a signer-
independent benchmark. Run from the repository root with its Python environment.
"""
from pathlib import Path
import json
import hashlib
import numpy as np
from sklearn.neighbors import NearestNeighbors
from lsm.features import finger_flexion

ROOT = Path(__file__).resolve().parents[1]
DYNAMIC = set("JÑQXZ")


def mirrored(x):
    out = x.copy()
    out[:, :63:3] *= -1
    # Normal is an axial vector: reflection in x negates normal y,z.
    out[:, 69:71] *= -1
    return out


def distances(x, prototypes, std, reflect=True):
    def calc(a):
        return np.stack([np.mean(((a[:, None]-c)/std)**2, axis=2).min(1) for c in prototypes], axis=1)
    d = calc(x)
    return np.minimum(d, calc(mirrored(x))) if reflect else d


def joint_features(h):
    values = []
    for base in (1, 5, 9, 13, 17):
        for j in (base+1, base+2):
            u, v = h[:, j]-h[:, j-1], h[:, j+1]-h[:, j]
            values.append(np.arctan2(np.linalg.norm(np.cross(u,v),axis=1), (u*v).sum(1))/np.pi)
    values.extend(np.linalg.norm(h[:,tip],axis=1) for tip in (4,8,12,16,20))
    return np.stack(values,axis=1)


def metrics(d, truth, letters, radius):
    best = d.argmin(1)
    weights = np.exp(-(d-d.min(1)[:, None])/.03)
    conf = 1/weights.sum(1)
    pred = np.array(letters)[best]
    accepted = (conf >= .65) & (d.min(1) <= np.array(radius)[best])
    return {l: {
        "n": int((truth == l).sum()),
        "top1": round(float(np.mean(pred[truth == l] == l)), 4),
        "accepted_correct": round(float(np.mean((pred[truth == l] == l) & accepted[truth == l])), 4),
        "accepted_wrong": round(float(np.mean((pred[truth == l] != l) & accepted[truth == l])), 4),
        "confusions": {p: int(np.sum(pred[truth == l] == p)) for p in letters if p != l and np.any(pred[truth == l] == p)},
    } for l in letters}


def main():
    source = ROOT / "models/letters.npz"
    z = np.load(source)
    x, y = z["X"], z["y"]
    old = json.loads((ROOT / "web/src/data/alphabet_classifier.json").read_text())
    letters = old["letters"]
    h = x[:, :63].reshape(-1, 21, 3)
    normal = np.cross(h[:, 5], h[:, 17])
    normal /= np.linalg.norm(normal, axis=1)[:, None]
    errors = {
        "flexion": float(np.max(abs(np.array([finger_flexion(a)/180 for a in h])-x[:, 63:68]))),
        "normal": float(np.max(abs(normal-x[:, 68:]))),
        "scale": float(np.max(abs(np.linalg.norm(h[:, 9], axis=1)-1))),
        "mapping_centroids": float(max(np.max(abs(x[y == l].mean(0)-old["centroids"][i])) for i, l in enumerate(letters))),
    }
    assert max(errors.values()) < 1e-4, errors
    # Keep three contiguous blocks apart; do not randomly mix adjacent samples.
    tr, va, te = [], [], []
    for l in letters:
        ix = np.flatnonzero(y == l)
        tr.extend(ix[:180]); va.extend(ix[180:240]); te.extend(ix[240:])
    tr, va, te = map(np.array, (tr, va, te))
    source_x = x
    shape = joint_features(h)
    x = np.concatenate([x, shape], axis=1)
    base_std = np.maximum(x[tr].std(0), .05)
    # Choose the smallest joint weight within 0.5 percentage points of the best
    # validation accuracy. No reference photograph enters this fit or selection.
    candidates = []
    static_mask = ~np.isin(y[va], list(DYNAMIC))
    aliases = {"J":"I", "Ñ":"N", "Z":"D"}
    for weight in (1., 2., 4.):
        candidate_std = base_std.copy(); candidate_std[71:] /= weight
        candidate_nn = NearestNeighbors(n_neighbors=5).fit(x[tr]/candidate_std)
        d, ix = candidate_nn.kneighbors(x[va]/candidate_std)
        md, mi = candidate_nn.kneighbors(mirrored(x[va])/candidate_std)
        use=md[:,0]<d[:,0]; d[use],ix[use]=md[use],mi[use]
        votes=np.stack([np.sum((y[tr][ix]==l)/(d+1e-6),axis=1) for l in letters],axis=1)
        for moving,base in aliases.items():
            votes[:,letters.index(base)]+=votes[:,letters.index(moving)]
            votes[:,letters.index(moving)]=0
        pred=np.array(letters)[votes.argmax(1)]
        candidates.append((weight,float(np.mean(pred[static_mask]==y[va][static_mask]))))
    best=max(score for _,score in candidates)
    weight=min(w for w,score in candidates if score>=best-.005)
    std=base_std.copy(); std[71:]/=weight
    # Reuse the k=5 instance classifier indicated in letters.npz, not a single mean.
    k = int(z["k"])
    nn = NearestNeighbors(n_neighbors=k).fit(x[tr]/std)
    def predict(a):
        d, ix = nn.kneighbors(a/std)
        md, mi = nn.kneighbors(mirrored(a)/std)
        use = md[:, 0] < d[:, 0]
        d[use], ix[use] = md[use], mi[use]
        votes = np.stack([np.sum((y[tr][ix] == l)/(d+1e-6), axis=1) for l in letters], axis=1)
        return d[:, 0]**2/x.shape[1], votes/votes.sum(1)[:, None]
    near, votes = predict(x[va])
    radius = [float(max(.015, min(.3, np.quantile(near[y[va] == l], .95)))) for l in letters]
    before = distances(source_x[te], [[c] for c in old["centroids"]], np.array(old["std"]), False)
    near, votes = predict(x[te])
    # Equivalent distances let the same report function retain the .65 confidence test.
    equivalent = -np.log(np.maximum(votes, 1e-12))*.03
    after_metrics = metrics(equivalent, y[te], letters, [100]*len(letters))
    pred = np.array(letters)[votes.argmax(1)]
    accepted = (votes.max(1) >= .65) & (near <= np.array(radius)[votes.argmax(1)])
    for l in letters:
        mask = y[te] == l
        after_metrics[l]["accepted_correct"] = round(float(np.mean((pred[mask] == l) & accepted[mask])),4)
        after_metrics[l]["accepted_wrong"] = round(float(np.mean((pred[mask] != l) & accepted[mask])),4)
    aliases = {"J":"I", "Ñ":"N", "Z":"D"}
    pooled = votes.copy()
    for source_label, base in aliases.items():
        pooled[:, letters.index(base)] += pooled[:, letters.index(source_label)]
        pooled[:, letters.index(source_label)] = 0
    static_pred = np.array(letters)[pooled.argmax(1)]
    static_accepted = (pooled.max(1) >= .65) & (near <= np.array(radius)[pooled.argmax(1)]) & ~np.isin(static_pred,list(DYNAMIC))
    static_metrics = {l:{"top1":round(float(np.mean(static_pred[y[te]==l]==l)),4),
        "accepted_correct":round(float(np.mean((static_pred[y[te]==l]==l)&static_accepted[y[te]==l])),4),
        "accepted_wrong":round(float(np.mean((static_pred[y[te]==l]!=l)&static_accepted[y[te]==l])),4)} for l in letters if l not in DYNAMIC}
    report = {
        "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "source_shapes": {key: list(z[key].shape) for key in z.files},
        "feature_audit_max_errors": errors,
        "split": "per class rows 0:180 train, 180:240 validation, 240:300 test; no signer metadata; baseline had access to all source rows",
        "threshold": .65, "k": k, "static_pose_aliases": aliases,
        "extra_features": "10 PIP/DIP joint angles and 5 wrist-to-tip lengths, computed from existing hand_local landmarks",
        "joint_weight_validation": candidates, "selected_joint_weight": weight,
        "test_before": metrics(before, y[te], letters, [0.9]*len(letters)),
        "test_after": after_metrics, "test_static_after": static_metrics,
        "test_top1_before": float(np.mean(np.array(letters)[before.argmin(1)] == y[te])),
        "test_top1_after": float(np.mean(pred == y[te])),
        "limitations": "Static rows only, no temporal trajectories or provenance/signer metadata. Scores are not calibrated probabilities. Dynamic labels are pose evidence only.",
    }
    dest = ROOT / "web/src/data/alphabet_samples.json"
    dest.write_text(json.dumps({"letters": letters, "std": std.astype(float).round(7).tolist(),
        "samples": x[tr].astype(float).round(5).tolist(), "labels": [letters.index(l) for l in y[tr]], "radius": radius,
        "threshold": .65, "k": k, "source_sha256": report["source_sha256"]}, separators=(",", ":")), encoding="utf-8")
    (ROOT / "docs/alphabet-model-audit.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"errors": errors, "k": k, "before": report["test_top1_before"], "after": report["test_top1_after"],
        "focus": {l: [report["test_before"][l], report["test_static_after"][l]] for l in "BCMN"}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
