const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cfg = require('../services/ml/config');
const det = require('../services/ml/anomalyDetector');
const mlClient = require('../services/ml/mlClient');
const pipeline = require('../services/ml/pipeline');
const collector = require('../services/ml/dataCollector');

const T0 = 1_700_000_000_000;
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2; // deterministic noise in [-1,1]

const pkt = (deviceId, i, over = {}) => ({
  deviceId, timestamp: T0 + i * 2000, isSimulated: false,
  voltage: 230 + rnd(), current: 0.4 + rnd() * 0.005, power: 90 + rnd() * 0.8, energy: 1 + i * 0.001, frequency: 50, powerFactor: 0.66, ...over,
});

test('Welford matches batch mean/variance', () => {
  const xs = [90, 91.2, 89.5, 90.4, 90.9, 89.9];
  const w = new det.Welford();
  xs.forEach((x) => w.push(x));
  const mean = xs.reduce((a, b) => a + b) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  assert.ok(Math.abs(w.mean - mean) < 1e-9);
  assert.ok(Math.abs(w.variance - variance) < 1e-9);
});

test('safety limits are deterministic and independent of learning', () => {
  assert.deepStrictEqual(det.evaluateSafetyLimits({ voltage: 260, current: 1, power: 100 }), ['OVERVOLTAGE']);
  assert.deepStrictEqual(det.evaluateSafetyLimits({ voltage: 190, current: 20, power: 4000 }), ['UNDERVOLTAGE', 'OVERCURRENT', 'OVERLOAD']);
  assert.deepStrictEqual(det.evaluateSafetyLimits({ voltage: 230, current: 1, power: 100 }), []);
});

test('learning ~60 s, then 90 W -> 150 W is an ANOMALY, normal stays NORMAL; devices are independent', async () => {
  pipeline._reset();
  mlClient.classify = async () => ({ applianceClass: 'CHARGER_90W', status: 'IDENTIFICATION_CONFIRMED', confidence: 0.94, modelVersion: 'appliance_classifier_v1' });
  cfg.ML_INFER_INTERVAL_MS = 0;

  let last;
  for (let i = 0; i < 20; i++) last = await pipeline.process(pkt('DEVICE_001', i));
  assert.strictEqual(last.learningStatus, 'LEARNING');
  assert.ok(last.learningProgress.elapsedSec > 0 && last.learningProgress.elapsedSec < 60);
  assert.strictEqual(last.anomalyStatus, 'LEARNING');
  for (let i = 20; i < 35; i++) last = await pipeline.process(pkt('DEVICE_001', i));
  assert.strictEqual(last.learningStatus, 'MONITORING');
  assert.strictEqual(last.overallStatus, 'NORMAL');
  assert.strictEqual(last.applianceClass, 'CHARGER_90W');
  assert.strictEqual(pipeline.getDevice('DEVICE_001').profile.applianceClass, 'CHARGER_90W');

  // a single spike is not enough (needs consecutive samples)
  let r = await pipeline.process(pkt('DEVICE_001', 35, { power: 150, current: 0.66 }));
  assert.strictEqual(r.anomalyStatus, 'NORMAL');
  r = await pipeline.process(pkt('DEVICE_001', 36, { power: 150, current: 0.66 }));
  assert.strictEqual(r.anomalyStatus, 'ANOMALY');
  assert.strictEqual(r.overallStatus, 'ANOMALY');
  assert.ok(r.anomalyScore > 0.5);
  assert.ok(r.event && r.event.type === 'ANOMALY');

  // second device has its own, still-learning profile
  const other = await pipeline.process(pkt('DEVICE_002', 0, { power: 150 }));
  assert.strictEqual(other.learningStatus, 'LEARNING');
  assert.notStrictEqual(pipeline.getDevice('DEVICE_001').profile.powerMean, pipeline.getDevice('DEVICE_002').profile);

  // safety violation beats anomaly
  r = await pipeline.process(pkt('DEVICE_001', 37, { voltage: 262, power: 150, current: 0.66 }));
  assert.strictEqual(r.overallStatus, 'SAFETY_LIMIT_VIOLATION');
  assert.deepStrictEqual(r.safetyViolations, ['OVERVOLTAGE']);
});

test('classifier below confidence -> UNKNOWN device, never a guessed name', async () => {
  pipeline._reset();
  mlClient.classify = async () => ({ applianceClass: 'UNKNOWN', status: 'INSUFFICIENT_CONFIDENCE', confidence: 0.51, modelVersion: 'appliance_classifier_v1' });
  let r;
  for (let i = 0; i < 40; i++) r = await pipeline.process(pkt('DEVICE_003', i));
  assert.strictEqual(r.applianceClass, 'UNKNOWN');
  assert.strictEqual(r.classificationStatus, 'INSUFFICIENT_CONFIDENCE');
  assert.strictEqual(r.overallStatus, 'UNKNOWN_DEVICE');
});

test('ML service down -> ML_MODEL_UNAVAILABLE, no fabricated appliance, pipeline keeps running', async () => {
  pipeline._reset();
  mlClient.classify = async () => ({ applianceClass: 'UNKNOWN', status: 'ML_MODEL_UNAVAILABLE', confidence: null, reason: 'down' });
  const r = await pipeline.process(pkt('DEVICE_004', 0));
  assert.strictEqual(r.classificationStatus, 'ML_MODEL_UNAVAILABLE');
  assert.strictEqual(r.applianceClass, 'UNKNOWN');
  assert.strictEqual(r.learningStatus, 'LEARNING'); // anomaly/learning still work
});

test('DEMO (simulated) data is never classified and never mixed into a LIVE profile', async () => {
  pipeline._reset();
  let called = 0;
  mlClient.classify = async () => { called++; return { applianceClass: 'FAN', status: 'IDENTIFICATION_CONFIRMED', confidence: 0.99 }; };
  let r = await pipeline.process(pkt('DEVICE_005', 0, { isSimulated: true }));
  assert.strictEqual(r.classificationStatus, 'DEMO_DATA_NOT_CLASSIFIED');
  assert.strictEqual(r.mode, 'DEMO');
  assert.strictEqual(called, 0);
  r = await pipeline.process(pkt('DEVICE_005', 1)); // same id now sends real data -> fresh profile
  assert.strictEqual(r.mode, 'LIVE');
  assert.strictEqual(pipeline.getDevice('DEVICE_005').learningProgress.samples, 1);
});

test('data collector records REAL packets only and writes the documented CSV schema', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eshield-ds-'));
  cfg.DATASET_DIR = dir;
  assert.ok(!collector.start('DEVICE_001', 'unknown!').ok);
  assert.ok(!collector.start('DEVICE_001', 'UNKNOWN').ok);
  const s = collector.start('DEVICE_001', 'CHARGER_90W');
  assert.ok(s.ok);
  assert.ok(!collector.start('DEVICE_001', 'FAN').ok); // already active
  assert.strictEqual(collector.record({ deviceId: 'DEVICE_001', isSimulated: true, timestamp: 1, voltage: 230, current: 1 }), false);
  assert.strictEqual(collector.record({ deviceId: 'DEVICE_009', isSimulated: false, timestamp: 1, voltage: 230, current: 1 }), false);
  assert.strictEqual(collector.record({ deviceId: 'DEVICE_001', isSimulated: false, timestamp: 5, voltage: 231.2, current: 0.4, power: 90 }), true);
  const stopped = collector.stop('DEVICE_001');
  assert.strictEqual(stopped.session.rows, 1);
  const lines = fs.readFileSync(path.join(dir, stopped.session.file), 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 2);
  assert.match(lines[0], /^timestamp,sessionId,deviceId,applianceClass,voltage,current,power,energy,frequency,powerFactor/);
  assert.match(lines[1], /^5,\d+,DEVICE_001,CHARGER_90W,231.2,0.4,90,,,/);
});

test('CSV export contains only real fields and blanks for missing ones', async () => {
  pipeline._reset();
  mlClient.classify = async () => ({ applianceClass: 'UNKNOWN', status: 'COLLECTING_WINDOW', confidence: null });
  await pipeline.process(pkt('DEVICE_006', 0));
  const { rows } = await pipeline.exportRows({ deviceId: 'DEVICE_006' });
  const csv = pipeline.toCsv(rows);
  assert.match(csv.split('\n')[0], /timestamp,deviceId,mode,applianceClass,voltage,current,power,energy,frequency,powerFactor,classificationConfidence,classificationStatus,anomalyScore,anomalyStatus,overallStatus,faultType,modelVersion/);
  assert.match(csv.split('\n')[1], /DEVICE_006,LIVE/);
});
