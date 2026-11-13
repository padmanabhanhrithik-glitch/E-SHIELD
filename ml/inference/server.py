"""
E-SHIELD ML inference service (Flask). The Node backend calls this for every
appliance-identification window. Bound to localhost by default.

    cd ml
    python inference/server.py            # port 5001

If no trained model exists, /predict returns 503 MODEL_NOT_LOADED and the
backend reports ML MODEL UNAVAILABLE (it never invents an appliance name).
"""
import os
import sys

from flask import Flask, jsonify, request

sys.path.insert(0, os.path.dirname(__file__))
from predictor import Predictor, resolve_version_dir  # noqa: E402

app = Flask(__name__)
_predictor = None
_load_error = None


def load_model(version=None):
    global _predictor, _load_error
    try:
        d = resolve_version_dir(version)
        if d is None:
            _predictor, _load_error = None, "No trained model found (run scripts/train_model.py)"
        else:
            _predictor, _load_error = Predictor(d), None
    except Exception as e:  # noqa: BLE001
        _predictor, _load_error = None, f"Model failed to load: {e}"
    return _predictor is not None


@app.get("/health")
def health():
    return jsonify(ok=True, modelLoaded=_predictor is not None,
                   modelVersion=_predictor.version if _predictor else None, error=_load_error)


@app.get("/model")
def model():
    if not _predictor:
        return jsonify(ok=False, error=_load_error), 503
    m = _predictor.meta
    return jsonify(ok=True, version=m["version"], modelType=m["model_type"], classes=m["classes"],
                   channels=m["channels"], windowSize=m["window_size"],
                   recommendedThresholds=m.get("recommended_thresholds"), metrics=m.get("validation_metrics"),
                   createdAt=m["created_at"])


@app.post("/reload")
def reload_model():
    ok = load_model((request.get_json(silent=True) or {}).get("version"))
    return jsonify(ok=ok, modelVersion=_predictor.version if _predictor else None, error=_load_error), (200 if ok else 503)


@app.post("/predict")
def predict():
    if not _predictor:
        return jsonify(ok=False, status="MODEL_NOT_LOADED", error=_load_error), 503
    body = request.get_json(silent=True) or {}
    samples = body.get("samples")
    if not isinstance(samples, list):
        return jsonify(ok=False, error="samples must be a list"), 400
    result = _predictor.predict(samples, body.get("confidenceThreshold"), body.get("margin"))
    return jsonify(ok=True, **result)


if __name__ == "__main__":
    load_model()
    print(f"[ml-inference] model loaded: {_predictor.version if _predictor else 'NONE - ' + str(_load_error)}")
    app.run(host=os.environ.get("ML_HOST", "127.0.0.1"), port=int(os.environ.get("ML_PORT", 5001)))
