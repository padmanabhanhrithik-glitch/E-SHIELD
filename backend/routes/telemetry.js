const express = require('express');
const { db, isConfigured } = require('../config/firebaseAdmin');
const { ingestTelemetry, getDeviceConnectionStatus } = require('../services/telemetryService');

module.exports = function telemetryRoutes(io) {
  const router = express.Router();

  // ESP32 (or simulator) posts a telemetry packet here.
  // Header X-Device-Secret must match DEVICE_INGEST_SECRET.
  router.post('/ingest', async (req, res) => {
    const secret = req.header('X-Device-Secret');
    if (process.env.DEVICE_INGEST_SECRET && secret !== process.env.DEVICE_INGEST_SECRET) {
      return res.status(401).json({ ok: false, error: 'Invalid device secret' });
    }

    const result = await ingestTelemetry(req.body, io);
    if (!result.ok) {
      return res.status(400).json({ ok: false, errors: result.errors });
    }
    res.json(result);
  });

  // Latest telemetry + connection status for a device
  router.get('/:deviceId/latest', async (req, res) => {
    const { deviceId } = req.params;
    const connection = getDeviceConnectionStatus(
      deviceId,
      Number(process.env.DEVICE_OFFLINE_TIMEOUT_MS) || 15000
    );

    if (!isConfigured) {
      return res.status(503).json({ ok: false, error: 'Firebase not configured', connection });
    }

    try {
      const snap = await db
        .collection('telemetry')
        .where('deviceId', '==', deviceId)
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();

      const latest = snap.empty ? null : snap.docs[0].data();
      res.json({ ok: true, latest, connection });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Historical range for charts: ?deviceId=...&rangeHours=24
  router.get('/history', async (req, res) => {
    if (!isConfigured) {
      return res.status(503).json({ ok: false, error: 'Firebase not configured' });
    }
    const { deviceId, rangeHours = 24 } = req.query;
    if (!deviceId) return res.status(400).json({ ok: false, error: 'deviceId is required' });

    const since = Date.now() - Number(rangeHours) * 60 * 60 * 1000;

    try {
      const snap = await db
        .collection('telemetry')
        .where('deviceId', '==', deviceId)
        .where('timestamp', '>=', since)
        .orderBy('timestamp', 'asc')
        .limit(2000)
        .get();

      res.json({ ok: true, samples: snap.docs.map((d) => d.data()) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
};
