/**
 * E-SHIELD Cloud Functions.
 *
 * These are OPTIONAL — the Node backend (backend/services/telemetryService.js)
 * already sends push notifications directly when it generates an alert.
 * These functions provide a Firestore-triggered safety net (in case an alert
 * is ever written by a path other than the backend) and the scheduled
 * daily/weekly report notifications described in the spec.
 *
 * Deploy with: firebase deploy --only functions
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();

// --- Safety-net push notification when a new alert document appears ---
exports.onAlertCreated = onDocumentCreated('alerts/{alertId}', async (event) => {
  const alert = event.data?.data();
  if (!alert || alert.severity === 'INFO') return;
  if (alert.notifiedByBackend) return; // backend already handled it

  const title = alert.severity === 'CRITICAL' ? 'E-SHIELD CRITICAL ALERT' : 'E-SHIELD WARNING';
  const body = [alert.what, `Location: ${alert.where}`, `Load: ${alert.load}`]
    .filter(Boolean)
    .join('\n');

  try {
    await messaging.send({
      topic: `device_${alert.deviceId}`,
      notification: { title, body },
      data: {
        severity: alert.severity || '',
        type: alert.type || '',
      },
    });
  } catch (err) {
    console.error('onAlertCreated: failed to send FCM', err);
  }
});

// --- Daily electrical report, 8am every day (adjust timezone as needed) ---
exports.dailyHealthReport = onSchedule(
  { schedule: '0 8 * * *', timeZone: 'Asia/Kolkata' },
  async () => {
    const since = Date.now() - 24 * 60 * 60 * 1000;

    const [alertsSnap, loadsSnap] = await Promise.all([
      db.collection('alerts').where('when', '>=', since).get(),
      db.collection('loads').get(),
    ]);

    const alerts = alertsSnap.docs.map((d) => d.data());
    const warnings = alerts.filter((a) => a.severity === 'WARNING').length;
    const critical = alerts.filter((a) => a.severity === 'CRITICAL').length;

    // Average of latest per-device health scores, if present
    const scoresSnap = await db
      .collection('healthScores')
      .orderBy('timestamp', 'desc')
      .limit(loadsSnap.size || 10)
      .get();
    const scores = scoresSnap.docs.map((d) => d.data().score).filter((s) => typeof s === 'number');
    const avgHealth = scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : null;

    const body = [
      avgHealth !== null ? `System Health: ${avgHealth}%` : 'System Health: N/A',
      `Loads Monitored: ${loadsSnap.size}`,
      `Warnings: ${warnings}`,
      `Critical Events: ${critical}`,
    ].join('\n');

    try {
      await messaging.send({
        topic: 'daily_reports',
        notification: { title: 'E-SHIELD Daily Electrical Report', body },
      });
    } catch (err) {
      console.error('dailyHealthReport: failed to send FCM', err);
    }
  }
);
