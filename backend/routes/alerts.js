const express = require('express');
const { db, isConfigured } = require('../config/firebaseAdmin');

const router = express.Router();

function requireFirebase(req, res, next) {
  if (!isConfigured) {
    return res.status(503).json({ ok: false, error: 'Firebase not configured' });
  }
  next();
}

// List alerts, optional filters: severity, locationId, loadId, sinceHours
router.get('/', requireFirebase, async (req, res) => {
  try {
    let query = db.collection('alerts').orderBy('when', 'desc').limit(200);
    const snap = await query.get();
    let alerts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const { severity, locationId, loadId, sinceHours } = req.query;
    if (severity) alerts = alerts.filter((a) => a.severity === severity);
    if (locationId) alerts = alerts.filter((a) => a.locationId === locationId);
    if (loadId) alerts = alerts.filter((a) => a.loadId === loadId);
    if (sinceHours) {
      const since = Date.now() - Number(sinceHours) * 60 * 60 * 1000;
      alerts = alerts.filter((a) => a.when >= since);
    }

    res.json({ ok: true, alerts, unreadCount: alerts.filter((a) => !a.read).length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.patch('/:alertId/read', requireFirebase, async (req, res) => {
  try {
    await db.collection('alerts').doc(req.params.alertId).set({ read: true }, { merge: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
