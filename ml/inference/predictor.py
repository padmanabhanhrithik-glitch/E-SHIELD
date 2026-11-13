"""
Loads a trained E-SHIELD appliance-classifier version and produces a gated
prediction. Used by inference/server.py (real time) and scripts/evaluate_model.py
so both apply exactly the same confidence / margin / out-of-distribution rules.

The predictor NEVER just returns argmax. A class name is only returned when
  1. the window is complete and all required channels are present,
  2. the window is not far outside what that class looked like in training,
  3. top-1 probability >= confidence threshold, and
  4. top-1 minus top-2 probability >= margin.
Otherwise applianceClass == "UNKNOWN".
"""
import json
import os
import sys

import joblib
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
from features import window_features  # noqa: E402

MODELS_DIR = os.environ.get("ML_MODELS_DIR") or os.path.join(os.path.dirname(__file__), "..", "models")
FALLBACK_CONFIDENCE = 0.85
FALLBACK_MARGIN = 0.20


def resolve_version_dir(version=None, models_dir=MODELS_DIR):
    if version is None:
        pointer = os.path.join(models_dir, "current.json")
        if not os.path.exists(pointer):
            return None
        with open(pointer) as f:
            version = json.load(f)["version"]
    d = os.path.join(models_dir, version)
    return d if os.path.isdir(d) else None


class Predictor:
    def __init__(self, version_dir):
        with open(os.path.join(version_dir, "metadata.json")) as f:
            self.meta = json.load(f)
        self.model = joblib.load(os.path.join(version_dir, "model.joblib"))
        self.version = self.meta["version"]
        self.classes = list(self.model.classes_)
        self.channels = self.meta["channels"]
        self.window_size = self.meta["window_size"]
        ood = self.meta["ood"]
        self.ood_mean = {c: np.array(v) for c, v in ood["class_mean"].items()}
        self.ood_std = {c: np.array(v) for c, v in ood["class_std"].items()}
        self.ood_threshold = ood["threshold"]
        th = self.meta.get("recommended_thresholds", {})
        self.default_confidence = th.get("confidence", FALLBACK_CONFIDENCE)
        self.default_margin = th.get("margin", FALLBACK_MARGIN)

    def ood_distance(self, vec, cls):
        z = (vec - self.ood_mean[cls]) / self.ood_std[cls]
        return float(np.sqrt(np.mean(z * z)))

    def predict_vector(self, vec, confidence=None, margin=None):
        confidence = self.default_confidence if confidence is None else confidence
        margin = self.default_margin if margin is None else margin
        proba = self.model.predict_proba(vec.reshape(1, -1))[0]
        order = np.argsort(proba)[::-1]
        top1, top2 = order[0], (order[1] if len(order) > 1 else None)
        p1 = float(proba[top1])
        p2 = float(proba[top2]) if top2 is not None else 0.0
        cls = self.classes[top1]
        ood = self.ood_distance(vec, cls)
        base = {
            "confidence": round(p1, 4),
            "margin": round(p1 - p2, 4),
            "oodDistance": round(ood, 3),
            "modelVersion": self.version,
            "thresholds": {"confidence": confidence, "margin": margin, "ood": self.ood_threshold},
        }
        if ood > self.ood_threshold:
            return {**base, "applianceClass": "UNKNOWN", "status": "OUT_OF_DISTRIBUTION",
                    "reason": "Measured behaviour is not similar to any trained appliance"}
        if p1 < confidence or (p1 - p2) < margin:
            return {**base, "applianceClass": "UNKNOWN", "status": "INSUFFICIENT_CONFIDENCE",
                    "reason": "Classifier could not separate this device from others with enough confidence"}
        return {**base, "applianceClass": cls, "status": "IDENTIFICATION_CONFIRMED", "reason": None}

    def predict(self, samples, confidence=None, margin=None):
        if len(samples) < self.window_size:
            return {"applianceClass": "UNKNOWN", "status": "COLLECTING_WINDOW", "confidence": None,
                    "modelVersion": self.version,
                    "reason": f"{len(samples)}/{self.window_size} samples collected"}
        vec, why = window_features(samples[-self.window_size:], self.channels)
        if vec is None:
            return {"applianceClass": "UNKNOWN", "status": "MISSING_INPUT", "confidence": None,
                    "modelVersion": self.version,
                    "reason": f"Model requires channels {self.channels}: {why}"}
        return self.predict_vector(vec, confidence, margin)
