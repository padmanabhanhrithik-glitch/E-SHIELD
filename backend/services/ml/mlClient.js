/**
 * HTTP client for the Python inference service (ml/inference/server.py).
 * Never throws: on any failure it returns { status: 'ML_MODEL_UNAVAILABLE' } so
 * the pipeline can report it — an appliance name is never fabricated.
 * A simple circuit breaker avoids hammering a dead service on every packet.
 */
const cfg = require('./config');

let downUntil = 0;
let lastError = null;
let modelInfo = null;

async function callJson(path, options = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), cfg.ML_TIMEOUT_MS);
  try {
    const res = await fetch(cfg.ML_INFERENCE_URL + path, {
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      ...options,
    });
    const body = await res.json().catch(() => ({}));
    return { httpOk: res.ok, httpStatus: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

const unavailable = (reason) => ({
  applianceClass: 'UNKNOWN',
  status: 'ML_MODEL_UNAVAILABLE',
  confidence: null,
  modelVersion: null,
  reason,
});

async function classify(deviceId, samples) {
  if (Date.now() < downUntil) return unavailable(lastError || 'ML inference service unreachable');
  try {
    const { httpOk, httpStatus, body } = await callJson('/predict', {
      method: 'POST',
      body: JSON.stringify({
        deviceId,
        samples,
        confidenceThreshold: cfg.CLASSIFICATION_CONFIDENCE_THRESHOLD,
        margin: cfg.CLASSIFICATION_MARGIN,
      }),
    });
    if (!httpOk) {
      lastError = body.error || `inference service returned ${httpStatus}`;
      if (httpStatus === 503) downUntil = Date.now() + cfg.ML_RETRY_AFTER_MS;
      return unavailable(lastError);
    }
    lastError = null;
    return body;
  } catch (err) {
    lastError = `ML inference service unreachable (${err.name === 'AbortError' ? 'timeout' : err.message})`;
    downUntil = Date.now() + cfg.ML_RETRY_AFTER_MS;
    return unavailable(lastError);
  }
}

async function getModelStatus() {
  try {
    const { httpOk, body } = await callJson('/model');
    if (httpOk) {
      modelInfo = body;
      return { available: true, ...body };
    }
    return { available: false, error: body.error || 'model not loaded' };
  } catch (err) {
    return { available: false, error: `ML inference service unreachable (${err.message})` };
  }
}

module.exports = { classify, getModelStatus, _resetForTests: () => { downUntil = 0; lastError = null; } };
