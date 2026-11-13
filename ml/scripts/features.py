"""
Shared feature extraction for E-SHIELD appliance classification.

The SAME code is used for training (train_model.py), evaluation
(evaluate_model.py) and real-time inference (inference/predictor.py), so the
model can never see different features in production than it saw in training.

Only quantities that the ESP32 genuinely reports (or that can be derived from
them) are used. A channel is used ONLY if it is present in the collected
dataset; the list of channels actually used is stored in the model metadata and
enforced at inference time.
"""
import math
import numpy as np

# Raw channels the ESP32 payload may contain. Which of them are actually used
# is decided per-dataset at training time (must be >= 95 % populated).
CANDIDATE_CHANNELS = ["voltage", "current", "power", "powerFactor", "frequency", "crestFactor", "thd"]
# Never used as features: cumulative counters / identifiers.
NON_FEATURE_COLUMNS = ["energy", "timestamp", "sampleNumber", "sessionId", "deviceId", "applianceClass"]

DEFAULT_WINDOW_SIZE = 20   # consecutive telemetry packets per classification window
DEFAULT_STRIDE = 5

STATS = ["mean", "std", "min", "max", "range", "cv", "mean_abs_diff", "max_abs_diff", "slope", "head_tail_delta"]


def _num(v):
    try:
        f = float(v)
        return f if math.isfinite(f) else float("nan")
    except (TypeError, ValueError):
        return float("nan")


def sample_value(sample, channel):
    """Read a channel from a telemetry dict (accepts rmsVoltage/rmsCurrent aliases)."""
    if channel == "voltage":
        v = sample.get("rmsVoltage", sample.get("voltage"))
    elif channel == "current":
        v = sample.get("rmsCurrent", sample.get("current"))
    else:
        v = sample.get(channel)
    return _num(v)


def channel_arrays(samples, channels):
    """-> dict channelName -> np.array over the window, plus derived channels."""
    arrays = {c: np.array([sample_value(s, c) for s in samples], dtype=float) for c in channels}
    # Derived from V and I (always valid when both exist): apparent power.
    if "voltage" in arrays and "current" in arrays:
        arrays["apparentPower"] = arrays["voltage"] * arrays["current"]
    # Derived power factor estimate only if active power is genuinely reported.
    if "power" in arrays and "apparentPower" in arrays:
        with np.errstate(divide="ignore", invalid="ignore"):
            pf = np.where(arrays["apparentPower"] > 1e-6, arrays["power"] / arrays["apparentPower"], np.nan)
        arrays["pfEstimated"] = np.clip(pf, 0.0, 1.5)
    return arrays


def _stats(x):
    n = len(x)
    mean = float(np.mean(x))
    std = float(np.std(x))
    d = np.diff(x) if n > 1 else np.array([0.0])
    k = max(1, min(3, n // 4))
    return {
        "mean": mean,
        "std": std,
        "min": float(np.min(x)),
        "max": float(np.max(x)),
        "range": float(np.max(x) - np.min(x)),
        "cv": std / (abs(mean) + 1e-6),
        "mean_abs_diff": float(np.mean(np.abs(d))),
        "max_abs_diff": float(np.max(np.abs(d))),
        "slope": float(np.polyfit(np.arange(n), x, 1)[0]) if n > 1 else 0.0,
        # start-vs-end level change: captures start-up / transient behaviour inside the window
        "head_tail_delta": float((np.mean(x[:k]) - np.mean(x[-k:])) / (abs(mean) + 1e-6)),
    }


def _derived_names(channels):
    out = []
    if "voltage" in channels and "current" in channels:
        out.append("apparentPower")
        if "power" in channels:
            out.append("pfEstimated")
    return out


def feature_names(channels):
    names = []
    for ch in list(channels) + _derived_names(channels):
        for st in STATS:
            names.append(f"{ch}__{st}")
    return names


def window_features(samples, channels):
    """
    samples: list of telemetry dicts (one window, oldest first).
    Returns (vector, None) or (None, reason) if any required channel is missing/non-finite.
    """
    if not samples:
        return None, "empty window"
    arrays = channel_arrays(samples, channels)
    vec = []
    for ch in list(channels) + _derived_names(channels):
        x = arrays.get(ch)
        if x is None:
            return None, f"channel {ch} unavailable"
        if not np.all(np.isfinite(x)):
            return None, f"channel {ch} has missing/non-finite values"
        s = _stats(x)
        vec.extend(s[k] for k in STATS)
    return np.array(vec, dtype=float), None


def rows_to_windows(rows, channels, window_size=DEFAULT_WINDOW_SIZE, stride=DEFAULT_STRIDE):
    """rows: list of dicts of ONE session sorted by time. Returns list of feature vectors."""
    out = []
    for start in range(0, len(rows) - window_size + 1, stride):
        vec, _ = window_features(rows[start : start + window_size], channels)
        if vec is not None:
            out.append(vec)
    return out
