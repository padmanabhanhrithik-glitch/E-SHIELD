// Central configuration for the ML / anomaly layer. All values are overridable via backend/.env.
const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

module.exports = {
  // MODE: LIVE = only real ESP32 packets, DEMO = only simulator packets, MIXED = both (each labeled).
  MODE: ['LIVE', 'DEMO', 'MIXED'].includes((process.env.ESHIELD_MODE || '').toUpperCase())
    ? process.env.ESHIELD_MODE.toUpperCase()
    : 'LIVE',

  ML_INFERENCE_URL: process.env.ML_INFERENCE_URL || 'http://127.0.0.1:5001',
  ML_TIMEOUT_MS: num(process.env.ML_TIMEOUT_MS, 1500),
  ML_INFER_INTERVAL_MS: num(process.env.ML_INFER_INTERVAL_MS, 1000),
  ML_RETRY_AFTER_MS: num(process.env.ML_RETRY_AFTER_MS, 10000),
  // Optional override; when unset the threshold calibrated during training (model metadata) is used.
  CLASSIFICATION_CONFIDENCE_THRESHOLD: process.env.CLASSIFICATION_CONFIDENCE_THRESHOLD
    ? num(process.env.CLASSIFICATION_CONFIDENCE_THRESHOLD, undefined)
    : undefined,
  CLASSIFICATION_MARGIN: process.env.CLASSIFICATION_MARGIN ? num(process.env.CLASSIFICATION_MARGIN, undefined) : undefined,

  // Learning phase (device-specific normal profile) — 30..120 s.
  LEARNING_SECONDS: clamp(num(process.env.LEARNING_SECONDS, 60), 30, 120),
  LEARNING_MIN_SAMPLES: num(process.env.LEARNING_MIN_SAMPLES, 10),
  LEARNING_MAX_GAP_SEC: 5, // gaps longer than this do not count as learning time

  // Statistical anomaly detector (z-score against the learned profile)
  ANOMALY_Z_THRESHOLD: num(process.env.ANOMALY_Z_THRESHOLD, 3.5),
  ANOMALY_CONSECUTIVE: num(process.env.ANOMALY_CONSECUTIVE, 2),
  ANOMALY_Z_FULL_SCALE: 6, // z at which anomalyScore reaches 1.0

  // Deterministic electrical safety limits (NOT machine learning)
  SAFETY_MAX_POWER_W: num(process.env.SAFETY_MAX_POWER_W, 3000),

  WINDOW_BUFFER_SIZE: 200,
  HISTORY_BUFFER_SIZE: 2000,
  DATASET_DIR: process.env.ML_DATASET_DIR || require('path').resolve(__dirname, '../../../ml/dataset/raw'),
};
