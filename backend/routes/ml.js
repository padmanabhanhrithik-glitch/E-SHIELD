const express = require('express');
const mlClient = require('../services/ml/mlClient');
const pipeline = require('../services/ml/pipeline');
const collector = require('../services/ml/dataCollector');
const cfg = require('../services/ml/config');
const queue = require('../services/firestoreQueue');

const router = express.Router();

// Mutating endpoints reuse the same shared secret as telemetry ingest.
function requireSecret(req, res, next) {
  if (process.env.DEVICE_INGEST_SECRET && req.header('X-Device-Secret') !== process.env.DEVICE_INGEST_SECRET) {
    return res.status(401).json({ ok: false, error: 'Invalid device secret' });
  }
  next();
}

router.get('/status', async (req, res) => {
  const model = await mlClient.getModelStatus();
  res.json({ ok: true, mode: cfg.MODE, model, firestoreQueue: queue.stats(),
    learningSeconds: cfg.LEARNING_SECONDS, anomalyZThreshold: cfg.ANOMALY_Z_THRESHOLD });
});

router.get('/devices', async (req, res) => {
  res.json({ ok: true, devices: await pipeline.listDevices() });
});

router.get('/devices/:deviceId', (req, res) => {
  const d = pipeline.getDevice(req.params.deviceId);
  if (!d) return res.status(404).json({ ok: false, error: 'Device has not sent data since backend start' });
  res.json({ ok: true, device: d });
});

router.post('/devices/:deviceId/relearn', requireSecret, (req, res) => {
  const ok = pipeline.relearn(req.params.deviceId);
  res.status(ok ? 200 : 404).json({ ok, error: ok ? undefined : 'Unknown device' });
});

// ---- labeled data collection for training ----
router.get('/collection', (req, res) => res.json({ ok: true, sessions: collector.list() }));

router.post('/collection/start', requireSecret, (req, res) => {
  const r = collector.start(req.body?.deviceId, req.body?.applianceClass);
  res.status(r.ok ? 200 : 400).json(r);
});

router.post('/collection/stop', requireSecret, (req, res) => {
  const r = collector.stop(req.body?.deviceId);
  res.status(r.ok ? 200 : 404).json(r);
});

// ---- CSV export of historical telemetry + ML results ----
router.get('/export.csv', async (req, res) => {
  const since = req.query.since ? Number(req.query.since) : 0;
  const { source, rows } = await pipeline.exportRows({ deviceId: req.query.deviceId, since });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="eshield_${req.query.deviceId || 'all'}_export.csv"`);
  res.setHeader('X-Export-Source', source);
  res.send(pipeline.toCsv(rows));
});

module.exports = router;
