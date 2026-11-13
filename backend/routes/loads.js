const express = require('express');
const { db, isConfigured } = require('../config/firebaseAdmin');

const router = express.Router();

function requireFirebase(req, res, next) {
  if (!isConfigured) {
    return res.status(503).json({ ok: false, error: 'Firebase not configured' });
  }
  next();
}

// List all loads for a home
router.get('/', requireFirebase, async (req, res) => {
  try {
    const snap = await db.collection('loads').get();
    res.json({ ok: true, loads: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Create a load (e.g. user manually adds one, or renames an "Unknown Load")
router.post('/', requireFirebase, async (req, res) => {
  const { name, locationId, deviceId, category } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: 'name is required' });

  try {
    const ref = await db.collection('loads').add({
      name,
      locationId: locationId || null,
      deviceId: deviceId || null,
      category: category || 'UNKNOWN',
      baselineStartupCurrent: null,
      createdAt: Date.now(),
    });
    res.json({ ok: true, id: ref.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Rename / update a load (e.g. turning "Unknown Load" into "Ceiling Fan")
router.patch('/:loadId', requireFirebase, async (req, res) => {
  try {
    await db.collection('loads').doc(req.params.loadId).set(req.body, { merge: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Locations tree (home/floor/room/node/load)
router.get('/locations/tree', requireFirebase, async (req, res) => {
  try {
    const [locSnap, loadSnap] = await Promise.all([
      db.collection('locations').get(),
      db.collection('loads').get(),
    ]);
    const locations = locSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const loads = loadSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ ok: true, locations, loads });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
