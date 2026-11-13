#!/usr/bin/env python3
"""
Train the E-SHIELD appliance classifier from REAL labeled measurements.

    cd ml
    python scripts/train_model.py                       # uses dataset/raw/*.csv
    python scripts/train_model.py --raw-dir path/to/csvs

Pipeline
  1. read + validate every CSV in dataset/raw (schema in dataset/README.md)
  2. drop invalid rows (missing/out-of-range/duplicate), never DEMO/simulated rows
  3. choose the channels that are genuinely present in the data
  4. split BY RECORDING SESSION (windows from one session never appear in two
     splits -> no leakage) into train / validation / test
  5. window + extract features (scripts/features.py)
  6. train RandomForest, GradientBoosting and SVM; keep the best on validation macro-F1
  7. calibrate the confidence threshold on the validation split
  8. fit per-class out-of-distribution statistics
  9. save models/appliance_classifier_vN/{model.joblib,metadata.json} + models/current.json
 10. write the split CSVs into dataset/train|validation|test and features into dataset/processed

The test split is only used by evaluate_model.py.
"""
import argparse
import glob
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

sys.path.insert(0, os.path.dirname(__file__))
import features as F  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CLASS_RE = re.compile(r"^[A-Z0-9_]+$")
REQUIRED = ["timestamp", "sessionId", "deviceId", "applianceClass", "voltage", "current"]
# physical sanity ranges (invalid rows are dropped, not clipped)
RANGES = {"voltage": (50, 300), "current": (0, 40), "power": (0, 10000),
          "powerFactor": (0, 1.05), "frequency": (40, 70)}


def log(*a):
    print("[train]", *a)


def load_raw(raw_dir):
    files = sorted(glob.glob(os.path.join(raw_dir, "*.csv")))
    if not files:
        sys.exit(f"No CSV files in {raw_dir}. Collect real labeled data first (see ml/README.md).")
    frames = []
    for f in files:
        df = pd.read_csv(f)
        missing = [c for c in REQUIRED if c not in df.columns]
        if missing:
            sys.exit(f"{f}: missing required columns {missing}")
        df["__file"] = os.path.basename(f)
        frames.append(df)
    df = pd.concat(frames, ignore_index=True)
    log(f"read {len(df)} rows from {len(files)} file(s)")
    return df


def clean(df):
    n0 = len(df)
    for col in ["mode", "isSimulated"]:
        if col in df.columns:
            bad = df[col].astype(str).str.upper().isin(["DEMO", "TRUE", "1"])
            if bad.any():
                log(f"dropping {int(bad.sum())} rows flagged {col}=DEMO/simulated (never used for training)")
                df = df[~bad]
    df = df[df["applianceClass"].astype(str).str.match(CLASS_RE) & (df["applianceClass"] != "UNKNOWN")]
    for c in ["timestamp", "voltage", "current"] + [c for c in F.CANDIDATE_CHANNELS if c in df.columns]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=["timestamp", "voltage", "current"])
    for c, (lo, hi) in RANGES.items():
        if c in df.columns:
            df = df[df[c].isna() | ((df[c] >= lo) & (df[c] <= hi))]
    df = df.drop_duplicates(subset=["sessionId", "timestamp"]).sort_values(["sessionId", "timestamp"])
    log(f"kept {len(df)}/{n0} rows after validation")
    return df.reset_index(drop=True)


def pick_channels(df):
    channels = []
    for c in F.CANDIDATE_CHANNELS:
        if c in df.columns and df[c].notna().mean() >= 0.95:
            channels.append(c)
    if "voltage" not in channels or "current" not in channels:
        sys.exit("voltage and current must be present in the dataset")
    dropped = [c for c in F.CANDIDATE_CHANNELS if c in df.columns and c not in channels]
    if dropped:
        log(f"channels present but <95% populated, NOT used: {dropped}")
    log(f"feature channels: {channels}")
    return channels


def split_sessions(df, seed, allow_block_split, window):
    """Returns dict split -> DataFrame. Session-level split per class."""
    rng = np.random.RandomState(seed)
    parts = {"train": [], "validation": [], "test": []}
    for cls, g in df.groupby("applianceClass"):
        sessions = sorted(g["sessionId"].unique())
        if len(sessions) >= 3:
            rng.shuffle(sessions)
            n = len(sessions)
            n_test = max(1, round(n * 0.2))
            n_val = max(1, round(n * 0.2))
            assign = {"test": sessions[:n_test], "validation": sessions[n_test:n_test + n_val],
                      "train": sessions[n_test + n_val:]}
            for k, ss in assign.items():
                parts[k].append(g[g["sessionId"].isin(ss)])
        else:
            if not allow_block_split:
                sys.exit(
                    f"Class {cls} has only {len(sessions)} recording session(s). Need >= 3 separate sessions "
                    f"(e.g. re-plug the appliance / different day) so validation and test data come from "
                    f"recordings the model never trained on. Collect more sessions, or pass "
                    f"--allow-block-split for a chronological split WITHIN sessions (optimistic accuracy)."
                )
            log(f"WARNING: class {cls} has {len(sessions)} session(s); using chronological block split. "
                f"Reported accuracy will be optimistic.")
            for s in sessions:
                gs = g[g["sessionId"] == s]
                n = len(gs)
                a, b = int(n * 0.6), int(n * 0.8)
                # leave a gap of one window between blocks so windows never overlap
                parts["train"].append(gs.iloc[:a - window].assign(sessionId=f"{s}#train"))
                parts["validation"].append(gs.iloc[a:b - window].assign(sessionId=f"{s}#val"))
                parts["test"].append(gs.iloc[b:].assign(sessionId=f"{s}#test"))
    return {k: pd.concat(v) if v else pd.DataFrame() for k, v in parts.items()}


def build_xy(df, channels, window, stride):
    X, y, sess = [], [], []
    for (cls, sid), g in df.groupby(["applianceClass", "sessionId"]):
        rows = g.sort_values("timestamp").to_dict("records")
        for v in F.rows_to_windows(rows, channels, window, stride):
            X.append(v); y.append(cls); sess.append(sid)
    return np.array(X), np.array(y), np.array(sess)


def candidates(seed):
    return {
        "RandomForest": RandomForestClassifier(n_estimators=300, min_samples_leaf=2, class_weight="balanced_subsample",
                                               random_state=seed, n_jobs=-1),
        "GradientBoosting": GradientBoostingClassifier(random_state=seed),
        "SVM_RBF": make_pipeline(StandardScaler(), SVC(kernel="rbf", C=3.0, probability=True,
                                                       class_weight="balanced", random_state=seed)),
    }


def calibrate_thresholds(proba, y_true, classes):
    """Smallest confidence threshold (>= 0.70) whose ACCEPTED predictions are >= 95% correct on validation."""
    pred = np.array(classes)[proba.argmax(1)]
    p1 = proba.max(1)
    srt = np.sort(proba, axis=1)
    margin = srt[:, -1] - (srt[:, -2] if proba.shape[1] > 1 else 0)
    best = None
    for th in np.arange(0.70, 0.991, 0.01):  # floor 0.70: never accept near-coin-flip predictions
        acc_mask = (p1 >= th) & (margin >= 0.20)
        if acc_mask.sum() < max(5, 0.3 * len(y_true)):
            continue
        acc = (pred[acc_mask] == y_true[acc_mask]).mean()
        if acc >= 0.95:
            best = (float(round(th, 2)), float(acc), float(acc_mask.mean()))
            break
    if best is None:
        log("WARNING: no confidence threshold reaches 95% accepted-accuracy on validation; "
            "using conservative 0.90. Collect more/cleaner data.")
        return {"confidence": 0.90, "margin": 0.20, "calibrated": False}
    return {"confidence": best[0], "margin": 0.20, "calibrated": True,
            "validation_accepted_accuracy": round(best[1], 4), "validation_coverage": round(best[2], 4)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw-dir", default=os.path.join(ROOT, "dataset", "raw"))
    ap.add_argument("--models-dir", default=os.path.join(ROOT, "models"))
    ap.add_argument("--dataset-dir", default=os.path.join(ROOT, "dataset"))
    ap.add_argument("--window", type=int, default=F.DEFAULT_WINDOW_SIZE)
    ap.add_argument("--stride", type=int, default=F.DEFAULT_STRIDE)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--allow-block-split", action="store_true")
    ap.add_argument("--min-windows-per-class", type=int, default=15)
    args = ap.parse_args()

    df = clean(load_raw(args.raw_dir))
    classes_present = sorted(df["applianceClass"].unique())
    if len(classes_present) < 2:
        sys.exit(f"Need at least 2 appliance classes, found {classes_present}")
    channels = pick_channels(df)

    splits = split_sessions(df, args.seed, args.allow_block_split, args.window)
    data = {}
    for k, sdf in splits.items():
        data[k] = build_xy(sdf, channels, args.window, args.stride)
        log(f"{k}: {len(sdf)} rows -> {len(data[k][0])} windows, sessions={sdf['sessionId'].nunique()}")
    Xtr, ytr, _ = data["train"]; Xva, yva, _ = data["validation"]
    for cls in classes_present:
        for k in ("train", "validation", "test"):
            if (data[k][1] == cls).sum() < (args.min_windows_per_class if k == "train" else 3):
                sys.exit(f"Class {cls} has too few {k} windows. Record longer sessions.")

    results, fitted = {}, {}
    for name, clf in candidates(args.seed).items():
        clf.fit(Xtr, ytr)
        pv = clf.predict(Xva)
        results[name] = {"accuracy": float(accuracy_score(yva, pv)),
                         "macro_f1": float(f1_score(yva, pv, average="macro", zero_division=0))}
        fitted[name] = clf
        log(f"{name}: val acc={results[name]['accuracy']:.3f} macroF1={results[name]['macro_f1']:.3f}")
    best = max(results, key=lambda n: (results[n]["macro_f1"], n == "RandomForest"))
    model = fitted[best]
    log(f"selected model: {best}")

    classes = list(model.classes_)
    thresholds = calibrate_thresholds(model.predict_proba(Xva), yva, classes)

    # out-of-distribution statistics from TRAIN windows
    gstd = Xtr.std(axis=0)
    ood_mean, ood_std = {}, {}
    for c in classes:
        Xc = Xtr[ytr == c]
        ood_mean[c] = Xc.mean(axis=0).tolist()
        ood_std[c] = np.maximum(Xc.std(axis=0), np.maximum(0.05 * gstd, 1e-6)).tolist()
    d = []
    for x, c in zip(Xva, yva):
        z = (x - np.array(ood_mean[c])) / np.array(ood_std[c])
        d.append(float(np.sqrt(np.mean(z * z))))
    ood_thr = float(max(4.0, 1.5 * np.percentile(d, 95)))

    # versioning
    os.makedirs(args.models_dir, exist_ok=True)
    existing = [int(m.group(1)) for n in os.listdir(args.models_dir)
                if (m := re.match(r"appliance_classifier_v(\d+)$", n))]
    version = f"appliance_classifier_v{max(existing, default=0) + 1}"
    vdir = os.path.join(args.models_dir, version)
    os.makedirs(vdir)
    joblib.dump(model, os.path.join(vdir, "model.joblib"))

    digest = hashlib.sha256(pd.util.hash_pandas_object(df[["sessionId", "timestamp", "voltage", "current"]],
                                                       index=False).values.tobytes()).hexdigest()[:16]
    meta = {
        "version": version, "model_type": best,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "trained_on": "REAL_LABELED_DATA", "dataset_hash": digest,
        "classes": classes, "channels": channels, "window_size": args.window, "stride": args.stride,
        "feature_names": F.feature_names(channels),
        "candidates_validation": results,
        "validation_metrics": results[best],
        "recommended_thresholds": thresholds,
        "ood": {"threshold": ood_thr, "class_mean": ood_mean, "class_std": ood_std},
        "data": {k: {"windows": int(len(v[0])), "per_class": {c: int((v[1] == c).sum()) for c in classes}}
                 for k, v in data.items()},
        "sessions_per_class": {c: int(df[df.applianceClass == c].sessionId.nunique()) for c in classes},
        "seed": args.seed,
    }
    with open(os.path.join(vdir, "metadata.json"), "w") as f:
        json.dump(meta, f, indent=2)
    with open(os.path.join(args.models_dir, "current.json"), "w") as f:
        json.dump({"version": version}, f)

    # persist splits + features
    for k, sdf in splits.items():
        os.makedirs(os.path.join(args.dataset_dir, k), exist_ok=True)
        sdf.drop(columns=["__file"], errors="ignore").to_csv(os.path.join(args.dataset_dir, k, f"{k}.csv"), index=False)
    proc = os.path.join(args.dataset_dir, "processed")
    os.makedirs(proc, exist_ok=True)
    for k, (X, y, s) in data.items():
        out = pd.DataFrame(X, columns=meta["feature_names"]); out.insert(0, "applianceClass", y); out.insert(1, "sessionId", s)
        out.to_csv(os.path.join(proc, f"features_{k}.csv"), index=False)

    log(f"saved {version} -> {vdir}")
    log("NEXT: python scripts/evaluate_model.py   (independent test-set report)")
    if thresholds.get("calibrated") is False:
        log("NOTE: confidence threshold could not be validated; the system will report UNKNOWN more often.")


if __name__ == "__main__":
    main()
