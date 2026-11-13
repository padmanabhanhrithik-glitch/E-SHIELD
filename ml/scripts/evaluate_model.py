#!/usr/bin/env python3
"""
Independent evaluation of a trained model on the held-out TEST split
(dataset/test/test.csv, written by train_model.py from sessions the model never saw).

    python scripts/evaluate_model.py                      # current model
    python scripts/evaluate_model.py --version appliance_classifier_v2
    python scripts/evaluate_model.py --data other_labeled.csv   # your own held-out recording

Reports accuracy, precision, recall, F1 (per class + macro), the confusion matrix,
and the same numbers under the production gating rules (confidence + margin +
out-of-distribution), including how often the system answers UNKNOWN.
"""
import argparse
import json
import os
import sys

import numpy as np
import pandas as pd
from sklearn.metrics import (accuracy_score, classification_report, confusion_matrix,
                             precision_recall_fscore_support)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "inference"))
sys.path.insert(0, os.path.dirname(__file__))
from predictor import Predictor, resolve_version_dir  # noqa: E402
import features as F  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version")
    ap.add_argument("--models-dir", default=os.path.join(ROOT, "models"))
    ap.add_argument("--data", default=os.path.join(ROOT, "dataset", "test", "test.csv"))
    args = ap.parse_args()

    vdir = resolve_version_dir(args.version, args.models_dir)
    if not vdir:
        sys.exit("No trained model found. Run scripts/train_model.py first.")
    p = Predictor(vdir)
    if not os.path.exists(args.data):
        sys.exit(f"Test data {args.data} not found.")
    df = pd.read_csv(args.data)
    stride = p.meta["stride"]

    y_true, y_argmax, y_gated, statuses = [], [], [], []
    for (cls, sid), g in df.groupby(["applianceClass", "sessionId"]):
        rows = g.sort_values("timestamp").to_dict("records")
        for start in range(0, len(rows) - p.window_size + 1, stride):
            vec, _ = F.window_features(rows[start:start + p.window_size], p.channels)
            if vec is None:
                continue
            res = p.predict_vector(vec)
            proba = p.model.predict_proba(vec.reshape(1, -1))[0]
            y_true.append(cls)
            y_argmax.append(p.classes[int(np.argmax(proba))])
            y_gated.append(res["applianceClass"])
            statuses.append(res["status"])
    if not y_true:
        sys.exit("No evaluable windows in the test data.")

    y_true, y_argmax, y_gated = map(np.array, (y_true, y_argmax, y_gated))
    labels = p.classes
    pr, rc, f1, sup = precision_recall_fscore_support(y_true, y_argmax, labels=labels, zero_division=0)
    mp, mr, mf, _ = precision_recall_fscore_support(y_true, y_argmax, labels=labels, average="macro", zero_division=0)
    cm = confusion_matrix(y_true, y_argmax, labels=labels)

    accepted = y_gated != "UNKNOWN"
    report = {
        "model_version": p.version, "model_type": p.meta["model_type"], "test_windows": int(len(y_true)),
        "raw_classifier": {
            "accuracy": float(accuracy_score(y_true, y_argmax)),
            "macro_precision": float(mp), "macro_recall": float(mr), "macro_f1": float(mf),
            "per_class": {c: {"precision": float(pr[i]), "recall": float(rc[i]), "f1": float(f1[i]), "support": int(sup[i])}
                          for i, c in enumerate(labels)},
            "confusion_matrix": {"labels": labels, "matrix": cm.tolist()},
        },
        "with_unknown_rejection": {
            "coverage_answered": float(accepted.mean()),
            "unknown_rate": float(1 - accepted.mean()),
            "accuracy_on_answered": float((y_gated[accepted] == y_true[accepted]).mean()) if accepted.any() else None,
            "status_counts": {s: int((np.array(statuses) == s).sum()) for s in sorted(set(statuses))},
        },
        "thresholds": p.meta.get("recommended_thresholds"),
    }

    print(f"\nModel {p.version} ({p.meta['model_type']}) on {len(y_true)} test windows")
    print(f"Accuracy: {report['raw_classifier']['accuracy']:.4f}   macro P/R/F1: {mp:.4f} / {mr:.4f} / {mf:.4f}\n")
    print(classification_report(y_true, y_argmax, labels=labels, zero_division=0))
    print("Confusion matrix (rows = true, cols = predicted):")
    print(pd.DataFrame(cm, index=labels, columns=labels).to_string())
    w = report["with_unknown_rejection"]
    print(f"\nWith production gating: answered {w['coverage_answered']:.1%}, UNKNOWN {w['unknown_rate']:.1%}, "
          f"accuracy on answered windows: {w['accuracy_on_answered']}")
    if not p.meta["data"]["test"]["windows"] or len(y_true) < 100:
        print("\nNOTE: small test set - treat these numbers as indicative, not as guaranteed field accuracy.")

    with open(os.path.join(vdir, "evaluation.json"), "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nSaved {os.path.join(vdir, 'evaluation.json')}")


if __name__ == "__main__":
    main()
