const { db, messaging, isConfigured } = require('../config/firebaseAdmin');
const { evaluateTelemetry } = require('./alertService');
const { calculateHealthScore } = require('./healthScoreService');
const mlPipeline = require('./ml/pipeline');
const mlConfig = require('./ml/config');
const firestoreQueue = require('./firestoreQueue');

// In-memory "last seen" map so we can flag devices as disconnected even if
// Firestore writes are slow/unavailable. This is monitoring-only — it never
// gates the ESP32's own local relay protection.
const lastSeenByDevice = new Map();

function markDeviceSeen(deviceId) {
  lastSeenByDevice.set(deviceId, Date.now());
}

function getDeviceConnectionStatus(deviceId, timeoutMs = 15000) {
  const lastSeen = lastSeenByDevice.get(deviceId);
  if (!lastSeen) return { connected: false, lastSeen: null };
  return { connected: Date.now() - lastSeen <= timeoutMs, lastSeen };
}

/**
 * Validates a raw telemetry payload. Required fields are minimal on purpose —
 * the ESP32 may not send every optional field.
 */
function validateTelemetry(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be a JSON object'] };
  }
  if (!payload.deviceId) errors.push('deviceId is required');
  if (typeof payload.voltage !== 'number' && typeof payload.rmsVoltage !== 'number') {
    errors.push('voltage or rmsVoltage is required');
  }
  if (typeof payload.current !== 'number' && typeof payload.rmsCurrent !== 'number') {
    errors.push('current or rmsCurrent is required');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Full ingest pipeline for one telemetry packet, used by both the HTTP route
 * and the MQTT subscriber so behaviour stays identical regardless of transport.
 */
async function ingestTelemetry(rawPayload, io) {
  const { valid, errors } = validateTelemetry(rawPayload);
  if (!valid) {
    return { ok: false, errors };
  }

  // ESHIELD_MODE: LIVE accepts only real ESP32 packets, DEMO only simulator packets, MIXED both.
  if (mlConfig.MODE === 'LIVE' && rawPayload.isSimulated) {
    return { ok: false, errors: ['Backend is in LIVE mode: simulated (DEMO) telemetry is rejected'] };
  }
  if (mlConfig.MODE === 'DEMO' && !rawPayload.isSimulated) {
    return { ok: false, errors: ['Backend is in DEMO mode: only simulated telemetry is accepted'] };
  }

  const receivedAt = Date.now();
  const telemetry = {
    ...rawPayload,
    timestamp: rawPayload.timestamp || receivedAt,
    receivedAt,
    source: rawPayload.isSimulated ? 'SIMULATOR' : 'ESP32',
  };

  markDeviceSeen(telemetry.deviceId);

  // --- ML: appliance identification + learned-profile anomaly detection + safety limits ---
  // Runs BEFORE any Firestore access so real-time processing never waits on Firebase.
  const ml = await mlPipeline.process(telemetry);
  telemetry.ml = ml;
  if (io) io.to(telemetry.deviceId).emit('telemetry', telemetry);

  let locationName = telemetry.locationName || null;
  let loadName = telemetry.loadName || null;
  let baselineStartupCurrent = null;
  let recentAlerts = [];
  let recentTelemetry = [telemetry];

  if (isConfigured) {
    try {
      // Write telemetry
      // Queued + retried if Firestore is slow/unavailable (never blocks the live stream for long)
      // Every accepted telemetry packet is persisted in Firestore's `telemetry`
      // collection. Real ESP32 packets are marked source=ESP32 so cloud history
      // can be filtered from simulator data. The queue retries temporary failures.
      const stored = await firestoreQueue.add('telemetry', telemetry);
      if (!stored) {
        console.warn('[telemetryService] Telemetry queued for Firestore retry:', telemetry.deviceId, telemetry.timestamp);
      }

      // Look up load profile for context (name + learned baseline)
      if (telemetry.loadId) {
        const loadDoc = await db.collection('loads').doc(telemetry.loadId).get();
        if (loadDoc.exists) {
          const loadData = loadDoc.data();
          loadName = loadData.name || loadName;
          baselineStartupCurrent = loadData.baselineStartupCurrent || null;
        }
      }
      if (telemetry.locationId) {
        const locDoc = await db.collection('locations').doc(telemetry.locationId).get();
        if (locDoc.exists) locationName = locDoc.data().name || locationName;
      }

      // Pull recent telemetry + alerts for health score computation
      const recentSnap = await db
        .collection('telemetry')
        .where('deviceId', '==', telemetry.deviceId)
        .orderBy('timestamp', 'desc')
        .limit(30)
        .get();
      recentTelemetry = recentSnap.docs.map((d) => d.data());

      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      const alertsSnap = await db
        .collection('alerts')
        .where('deviceId', '==', telemetry.deviceId)
        .where('when', '>=', oneHourAgo)
        .get();
      recentAlerts = alertsSnap.docs.map((d) => d.data());
    } catch (err) {
      console.error('[telemetryService] Firestore write/read failed:', err.message);
    }
  }

  // --- Health score ---
  const health = calculateHealthScore({
    telemetrySamples: recentTelemetry,
    loadProfile: baselineStartupCurrent
      ? { baselineStartupCurrent, lastStartupCurrent: telemetry.startupPeak }
      : null,
    recentAlerts,
  });

  // --- Alert generation ---
  const newAlerts = evaluateTelemetry(telemetry, {
    locationName,
    loadName,
    baselineStartupCurrent,
  });

  // Learned-profile anomaly -> alert (safety-limit alerts already come from the rule engine above)
  if (ml.event && ml.event.type === 'ANOMALY') {
    newAlerts.push({
      severity: 'WARNING',
      type: 'LEARNED_PROFILE_ANOMALY',
      what: 'Behaviour deviates from this device\'s learned normal profile',
      where: locationName || 'Unknown location',
      load: loadName || (ml.applianceClass !== 'UNKNOWN' ? ml.applianceClass : 'Unidentified device'),
      when: telemetry.timestamp,
      why: `Statistical deviation on ${ml.anomalyDetail?.worstChannel || 'a channel'} (score ${ml.anomalyScore}) versus the ${mlConfig.LEARNING_SECONDS}s learned profile.`,
      action: 'Check whether the connected appliance changed or is behaving differently; inspect if it persists.',
      deviceId: telemetry.deviceId,
      locationId: telemetry.locationId || null,
      loadId: telemetry.loadId || null,
      healthScoreAtEvent: null,
      source: 'ml-anomaly-detector',
    });
  }

  if (isConfigured && newAlerts.length) {
    const batch = db.batch();
    newAlerts.forEach((alert) => {
      const ref = db.collection('alerts').doc();
      // notifiedByBackend=true tells the Cloud Functions safety-net
      // (onAlertCreated) not to double-send a push — this backend already
      // sends it directly below.
      batch.set(ref, { ...alert, read: false, createdAt: Date.now(), notifiedByBackend: true });
    });
    try {
      await batch.commit();
    } catch (err) {
      console.error('[telemetryService] Failed writing alerts:', err.message);
    }

    // Push notifications for WARNING/CRITICAL only (avoid notification spam)
    if (messaging) {
      for (const alert of newAlerts) {
        if (alert.severity === 'INFO') continue;
        await sendPushForAlert(alert).catch((err) =>
          console.error('[telemetryService] FCM send failed:', err.message)
        );
      }
    }
  }

  // --- Broadcast real-time update over Socket.IO ---
  if (io) {
    io.to(telemetry.deviceId).emit('healthScore', health);
    newAlerts.forEach((alert) => io.to(telemetry.deviceId).emit('alert', alert));
  }

  return { ok: true, telemetry, health, alerts: newAlerts, ml };
}

async function sendPushForAlert(alert) {
  if (!isConfigured || !messaging) return;

  // Topic per device keeps this simple; for per-user targeting, store FCM
  // tokens under users/{uid}/fcmTokens and send multicast instead.
  const topic = `device_${alert.deviceId}`;

  const title =
    alert.severity === 'CRITICAL' ? 'E-SHIELD CRITICAL ALERT' : 'E-SHIELD WARNING';

  const body = [`${alert.what}`, `Location: ${alert.where}`, `Load: ${alert.load}`]
    .filter(Boolean)
    .join('\n');

  await messaging.send({
    topic,
    notification: { title, body },
    data: {
      severity: alert.severity,
      type: alert.type,
      locationId: alert.locationId || '',
      loadId: alert.loadId || '',
    },
  });
}

module.exports = {
  ingestTelemetry,
  validateTelemetry,
  getDeviceConnectionStatus,
  markDeviceSeen,
};
