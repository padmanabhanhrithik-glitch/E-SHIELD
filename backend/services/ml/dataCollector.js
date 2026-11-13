/**
 * Labeled data collection for training the appliance classifier.
 *
 * While a session is active for a device, every REAL (non-simulated) telemetry
 * packet from that device is appended to
 *   ml/dataset/raw/<CLASS>__<DEVICE>__<SESSION>.csv
 * Simulator / DEMO packets are refused — they must never become training data.
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const COLUMNS = [
  'timestamp', 'sessionId', 'deviceId', 'applianceClass', 'voltage', 'current', 'power', 'energy',
  'frequency', 'powerFactor', 'crestFactor', 'thd', 'sampleNumber',
];
const CLASS_RE = /^[A-Z0-9_]+$/;
const sessions = new Map(); // deviceId -> session

function start(deviceId, applianceClass) {
  if (!deviceId || typeof deviceId !== 'string') return { ok: false, error: 'deviceId is required' };
  if (!CLASS_RE.test(applianceClass || '') || applianceClass === 'UNKNOWN') {
    return { ok: false, error: 'applianceClass must match A-Z, 0-9, _ (e.g. CHARGER_90W) and not be UNKNOWN' };
  }
  if (!/^[A-Za-z0-9_-]+$/.test(deviceId)) return { ok: false, error: 'deviceId may only contain letters, digits, _ and -' };
  if (sessions.has(deviceId)) return { ok: false, error: `A session is already active for ${deviceId}; stop it first.` };

  fs.mkdirSync(cfg.DATASET_DIR, { recursive: true });
  const sessionId = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const file = path.join(cfg.DATASET_DIR, `${applianceClass}__${deviceId}__${sessionId}.csv`);
  fs.writeFileSync(file, COLUMNS.join(',') + '\n');
  const s = { deviceId, applianceClass, sessionId, file, rows: 0, startedAt: Date.now() };
  sessions.set(deviceId, s);
  return { ok: true, session: publicView(s) };
}

function stop(deviceId) {
  const s = sessions.get(deviceId);
  if (!s) return { ok: false, error: `No active session for ${deviceId}` };
  sessions.delete(deviceId);
  return { ok: true, session: { ...publicView(s), stoppedAt: Date.now() } };
}

const publicView = (s) => ({
  deviceId: s.deviceId, applianceClass: s.applianceClass, sessionId: s.sessionId,
  rows: s.rows, startedAt: s.startedAt, file: path.basename(s.file),
});

function list() {
  return [...sessions.values()].map(publicView);
}

const cell = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/** Called by the pipeline for each packet. Returns true if recorded. */
function record(telemetry) {
  const s = sessions.get(telemetry.deviceId);
  if (!s || telemetry.isSimulated) return false;
  const row = {
    timestamp: telemetry.timestamp,
    sessionId: s.sessionId,
    deviceId: s.deviceId,
    applianceClass: s.applianceClass,
    voltage: telemetry.rmsVoltage ?? telemetry.voltage,
    current: telemetry.rmsCurrent ?? telemetry.current,
    power: telemetry.power,
    energy: telemetry.energy,
    frequency: telemetry.frequency,
    powerFactor: telemetry.powerFactor,
    crestFactor: telemetry.crestFactor,
    thd: telemetry.thd,
    sampleNumber: s.rows,
  };
  const line = COLUMNS.map((c) => (['sessionId', 'deviceId', 'applianceClass'].includes(c) ? row[c] : cell(row[c]))).join(',');
  fs.appendFileSync(s.file, line + '\n');
  s.rows += 1;
  return true;
}

module.exports = { start, stop, list, record, COLUMNS };
