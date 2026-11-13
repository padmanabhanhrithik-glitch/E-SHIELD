/**
 * ML + anomaly pipeline. Called by telemetryService.ingestTelemetry for every packet.
 *
 *   telemetry -> per-device window -> ML classification (Python service, gated)
 *                                  -> learning phase / learned profile (Welford)
 *                                  -> z-score anomaly detection
 *                                  -> deterministic safety limits + fault flags
 *                                  -> overallStatus
 *                                  -> Firestore (queued / retried) + result for Socket.IO
 *
 * Every device has its own state object — profiles are never shared or mixed.
 * process() never throws; on internal failure it returns an explicit error status.
 */
const cfg = require('./config');
const mlClient = require('./mlClient');
const detector = require('./anomalyDetector');
const collector = require('./dataCollector');
const queue = require('../firestoreQueue');
const { db, isConfigured } = require('../../config/firebaseAdmin');
const { THRESHOLDS } = require('../alertService');

const states = new Map();
const history = new Map(); // deviceId -> flattened rows (for CSV export without Firebase)
const MAX_WINDOW_GAP_MS = 30000;
const EVENT_MIN_INTERVAL_MS = 30000;
const DEVICE_DOC_MIN_INTERVAL_MS = 5000;

const offlineTimeout = () => Number(process.env.DEVICE_OFFLINE_TIMEOUT_MS) || 15000;

function normalize(t) {
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return {
    timestamp: t.timestamp,
    voltage: n(t.rmsVoltage ?? t.voltage),
    current: n(t.rmsCurrent ?? t.current),
    power: n(t.power),
    energy: n(t.energy),
    frequency: n(t.frequency),
    powerFactor: n(t.powerFactor),
    crestFactor: n(t.crestFactor),
    thd: n(t.thd),
  };
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

function freshState(deviceId, mode) {
  return {
    deviceId,
    mode,
    window: [],
    profile: detector.newProfile(deviceId, mode),
    lastClassifyAt: 0,
    classification: { applianceClass: 'UNKNOWN', status: 'COLLECTING_WINDOW', confidence: null, modelVersion: null, reason: null },
    anomalyStreak: 0,
    lastOverall: 'LEARNING',
    lastEventAt: 0,
    lastDeviceDocAt: 0,
    lastDeviceDocKey: '',
    lastSeen: 0,
    hydrated: false,
  };
}

async function getState(deviceId, mode) {
  let st = states.get(deviceId);
  if (st && st.mode !== mode) {
    // Same deviceId now sends a different data mode -> never mix DEMO and LIVE profiles.
    st = null;
  }
  if (!st) {
    st = freshState(deviceId, mode);
    states.set(deviceId, st);
    if (isConfigured) {
      try {
        const snap = await withTimeout(db.doc(`learnedProfiles/${deviceId}`).get(), 3000);
        if (snap.exists) {
          const d = snap.data();
          if (d.mode === mode && d.complete) {
            st.profile = detector.profileFromSummary(d);
            st.hydrated = true;
          }
        }
      } catch (err) {
        console.warn(`[ml] could not load learned profile for ${deviceId}: ${err.message}`);
      }
    }
  }
  return st;
}

async function classify(st, mode, now) {
  if (mode === 'DEMO') {
    return { applianceClass: 'UNKNOWN', status: 'DEMO_DATA_NOT_CLASSIFIED', confidence: null, modelVersion: null,
      reason: 'Simulated data is never classified as a real appliance' };
  }
  if (now - st.lastClassifyAt < cfg.ML_INFER_INTERVAL_MS && st.classification.status !== 'COLLECTING_WINDOW') {
    return st.classification;
  }
  st.lastClassifyAt = now;
  const r = await mlClient.classify(st.deviceId, st.window.slice(-60));
  return {
    applianceClass: r.applianceClass || 'UNKNOWN',
    status: r.status,
    confidence: typeof r.confidence === 'number' ? r.confidence : null,
    modelVersion: r.modelVersion || null,
    reason: r.reason || null,
  };
}

function deriveOverall({ fault, safety, anomalous, classification, learning }) {
  if (fault) return 'FAULT';
  if (safety.length) return 'SAFETY_LIMIT_VIOLATION';
  if (anomalous) return 'ANOMALY';
  if (['INSUFFICIENT_CONFIDENCE', 'OUT_OF_DISTRIBUTION'].includes(classification.status) && !learning) return 'UNKNOWN_DEVICE';
  if (learning) return 'LEARNING';
  return 'NORMAL';
}

async function processPacket(telemetry) {
  const mode = telemetry.isSimulated ? 'DEMO' : 'LIVE';
  const sample = normalize(telemetry);
  const now = Date.now();
  const st = await getState(telemetry.deviceId, mode);
  st.lastSeen = now;

  if (mode === 'LIVE') collector.record(telemetry);

  // window (contiguous packets only)
  const prev = st.window[st.window.length - 1];
  if (prev && sample.timestamp - prev.timestamp > MAX_WINDOW_GAP_MS) st.window = [];
  st.window.push(sample);
  if (st.window.length > cfg.WINDOW_BUFFER_SIZE) st.window.shift();

  // learning phase
  let learningJustCompleted = false;
  if (!st.profile.complete) learningJustCompleted = detector.learn(st.profile, sample);

  // classification
  st.classification = await classify(st, mode, now);
  if (learningJustCompleted) {
    st.profile.applianceClass = st.classification.status === 'IDENTIFICATION_CONFIRMED' ? st.classification.applianceClass : 'UNKNOWN';
    st.profile.identificationStatus = st.classification.status;
    queue.set(`learnedProfiles/${st.deviceId}`, detector.profileSummary(st.profile));
  }

  // anomaly + safety
  const learning = !st.profile.complete;
  let anomalyStatus = 'LEARNING';
  let anomalyScore = null;
  let anomalyDetail = null;
  let anomalous = false;
  if (!learning) {
    const sc = detector.score(st.profile, sample);
    st.anomalyStreak = sc.exceeds ? st.anomalyStreak + 1 : 0;
    anomalous = st.anomalyStreak >= cfg.ANOMALY_CONSECUTIVE;
    anomalyStatus = anomalous ? 'ANOMALY' : 'NORMAL';
    anomalyScore = Number(sc.anomalyScore.toFixed(3));
    anomalyDetail = { zScores: Object.fromEntries(Object.entries(sc.z).map(([k, v]) => [k, Number(v.toFixed(2))])), worstChannel: sc.worstChannel };
  }
  const safety = detector.evaluateSafetyLimits(sample);

  let faultType = null;
  if (typeof telemetry.faultType === 'string' && telemetry.faultType) faultType = telemetry.faultType;
  else if (typeof telemetry.anomalyScore === 'number' && telemetry.anomalyScore >= THRESHOLDS.anomalyScoreCritical) faultType = 'MICRO_ARC_SUSPECTED';
  else if (safety.length) faultType = safety[0];
  else if (anomalous) faultType = 'PROFILE_DEVIATION';

  const overall = deriveOverall({ fault: !!(telemetry.faultType || faultType === 'MICRO_ARC_SUSPECTED'), safety, anomalous, classification: st.classification, learning });

  const profileClassMismatch = !!(
    !learning && st.classification.status === 'IDENTIFICATION_CONFIRMED' && st.profile.applianceClass &&
    st.profile.applianceClass !== 'UNKNOWN' && st.classification.applianceClass !== st.profile.applianceClass
  );

  const ml = {
    deviceId: st.deviceId,
    mode,
    modelVersion: st.classification.modelVersion,
    applianceClass: st.classification.applianceClass,
    classificationStatus: st.classification.status,
    classificationConfidence: st.classification.confidence,
    classificationReason: st.classification.reason,
    learningStatus: learning ? 'LEARNING' : 'MONITORING',
    learningProgress: {
      elapsedSec: Math.min(cfg.LEARNING_SECONDS, Math.floor(st.profile.learningElapsedSec)),
      targetSec: cfg.LEARNING_SECONDS,
      samples: st.profile.samples,
    },
    anomalyStatus,
    anomalyScore,
    anomalyDetail,
    safetyViolations: safety,
    faultType,
    overallStatus: overall,
    profileClassMismatch,
    profileApplianceClass: st.profile.applianceClass,
    processedAt: now,
  };

  // event history (transitions into a non-normal state, rate limited)
  if (['ANOMALY', 'SAFETY_LIMIT_VIOLATION', 'FAULT'].includes(overall) &&
      (overall !== st.lastOverall || now - st.lastEventAt > EVENT_MIN_INTERVAL_MS) &&
      now - st.lastEventAt > 2000) {
    st.lastEventAt = now;
    ml.event = { type: overall, faultType };
    queue.add(`faultHistory/${st.deviceId}/events`, {
      timestamp: telemetry.timestamp, deviceId: st.deviceId, mode,
      applianceClass: ml.applianceClass, classificationStatus: ml.classificationStatus,
      voltage: sample.voltage ?? null, current: sample.current ?? null, power: sample.power ?? null,
      anomalyScore, faultType, status: overall, safetyViolations: safety,
      zScores: anomalyDetail?.zScores || null, modelVersion: ml.modelVersion,
    });
  }
  st.lastOverall = overall;

  persistDevice(st, ml, telemetry.timestamp);
  pushHistory(st.deviceId, telemetry, ml);
  return ml;
}

function persistDevice(st, ml, timestamp) {
  const key = [ml.applianceClass, ml.classificationStatus, ml.learningStatus, ml.overallStatus, ml.modelVersion, ml.mode].join('|');
  const now = Date.now();
  if (key === st.lastDeviceDocKey && now - st.lastDeviceDocAt < DEVICE_DOC_MIN_INTERVAL_MS) return;
  st.lastDeviceDocKey = key;
  st.lastDeviceDocAt = now;
  queue.set(`devices/${st.deviceId}`, {
    deviceId: st.deviceId,
    mode: ml.mode,
    applianceClass: ml.applianceClass,
    identificationStatus: ml.classificationStatus,
    classificationConfidence: ml.classificationConfidence,
    modelVersion: ml.modelVersion,
    learningStatus: ml.learningStatus,
    learningProgress: ml.learningProgress,
    anomalyStatus: ml.anomalyStatus,
    anomalyScore: ml.anomalyScore,
    overallStatus: ml.overallStatus,
    lastSeen: timestamp,
  }, { merge: true });
}

// ---------- export / history ----------
function flatten(t) {
  const ml = t.ml || {};
  return {
    timestamp: t.timestamp,
    deviceId: t.deviceId,
    mode: ml.mode || (t.isSimulated ? 'DEMO' : 'LIVE'),
    applianceClass: ml.applianceClass,
    voltage: t.rmsVoltage ?? t.voltage,
    current: t.rmsCurrent ?? t.current,
    power: t.power,
    energy: t.energy,
    frequency: t.frequency,
    powerFactor: t.powerFactor,
    classificationConfidence: ml.classificationConfidence,
    classificationStatus: ml.classificationStatus,
    anomalyScore: ml.anomalyScore,
    anomalyStatus: ml.anomalyStatus,
    overallStatus: ml.overallStatus,
    faultType: ml.faultType,
    modelVersion: ml.modelVersion,
  };
}
const EXPORT_COLUMNS = ['timestamp', 'deviceId', 'mode', 'applianceClass', 'voltage', 'current', 'power', 'energy', 'frequency',
  'powerFactor', 'classificationConfidence', 'classificationStatus', 'anomalyScore', 'anomalyStatus', 'overallStatus', 'faultType', 'modelVersion'];

function pushHistory(deviceId, telemetry, ml) {
  const arr = history.get(deviceId) || [];
  arr.push(flatten({ ...telemetry, ml }));
  if (arr.length > cfg.HISTORY_BUFFER_SIZE) arr.shift();
  history.set(deviceId, arr);
}

async function exportRows({ deviceId, since = 0, limit = 20000 } = {}) {
  if (isConfigured) {
    try {
      let q = db.collection('telemetry');
      if (deviceId) q = q.where('deviceId', '==', deviceId);
      if (since) q = q.where('timestamp', '>=', since);
      q = q.orderBy('timestamp', 'asc').limit(limit);
      const snap = await withTimeout(q.get(), 15000);
      return { source: 'firestore', rows: snap.docs.map((d) => flatten(d.data())) };
    } catch (err) {
      console.warn('[ml] Firestore export failed, falling back to in-memory buffer:', err.message);
    }
  }
  const ids = deviceId ? [deviceId] : [...history.keys()];
  const rows = ids.flatMap((id) => history.get(id) || []).filter((r) => r.timestamp >= since);
  return { source: 'memory (last packets since backend start)', rows: rows.slice(-limit) };
}

function toCsv(rows) {
  const esc = (v) => (v === undefined || v === null ? '' : String(v).includes(',') ? `"${v}"` : String(v));
  return [EXPORT_COLUMNS.join(','), ...rows.map((r) => EXPORT_COLUMNS.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}

// ---------- device views ----------
function stateView(st) {
  const connected = Date.now() - st.lastSeen <= offlineTimeout();
  return {
    deviceId: st.deviceId,
    mode: st.mode,
    connected,
    lastSeen: st.lastSeen,
    applianceClass: st.classification.applianceClass,
    classificationStatus: st.classification.status,
    classificationConfidence: st.classification.confidence,
    modelVersion: st.classification.modelVersion,
    learningStatus: st.profile.complete ? 'MONITORING' : 'LEARNING',
    learningProgress: { elapsedSec: Math.min(cfg.LEARNING_SECONDS, Math.floor(st.profile.learningElapsedSec)), targetSec: cfg.LEARNING_SECONDS, samples: st.profile.samples },
    overallStatus: st.lastOverall,
    profile: st.profile.complete ? detector.profileSummary(st.profile) : null,
  };
}

async function listDevices() {
  const out = new Map([...states.values()].map((st) => [st.deviceId, stateView(st)]));
  if (isConfigured) {
    try {
      const snap = await withTimeout(db.collection('devices').get(), 4000);
      snap.docs.forEach((d) => {
        if (!out.has(d.id) && d.data().mode) {
          const x = d.data();
          out.set(d.id, { deviceId: d.id, mode: x.mode, connected: false, lastSeen: x.lastSeen || null, applianceClass: x.applianceClass,
            classificationStatus: x.identificationStatus, classificationConfidence: x.classificationConfidence, modelVersion: x.modelVersion,
            learningStatus: x.learningStatus, learningProgress: x.learningProgress, overallStatus: x.overallStatus, fromStorage: true });
        }
      });
    } catch (err) { /* memory view is enough */ }
  }
  return [...out.values()];
}

function getDevice(deviceId) {
  const st = states.get(deviceId);
  return st ? stateView(st) : null;
}

/** Discard the learned profile so the 30–60 s learning phase runs again for this device. */
function relearn(deviceId) {
  const st = states.get(deviceId);
  if (!st) return false;
  st.profile = detector.newProfile(deviceId, st.mode);
  st.anomalyStreak = 0;
  st.lastOverall = 'LEARNING';
  queue.set(`learnedProfiles/${deviceId}`, { ...detector.profileSummary(st.profile), complete: false });
  return true;
}

async function safeProcess(telemetry) {
  try {
    return await processPacket(telemetry);
  } catch (err) {
    console.error('[ml] pipeline error:', err);
    return { deviceId: telemetry.deviceId, overallStatus: 'ML_PIPELINE_ERROR', classificationStatus: 'ML_MODEL_UNAVAILABLE', applianceClass: 'UNKNOWN', error: err.message, processedAt: Date.now() };
  }
}

module.exports = { process: safeProcess, listDevices, getDevice, relearn, exportRows, toCsv, EXPORT_COLUMNS, _states: states, _reset: () => { states.clear(); history.clear(); } };
