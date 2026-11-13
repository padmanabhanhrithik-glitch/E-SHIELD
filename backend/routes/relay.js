const express = require('express');
const { db, isConfigured } = require('../config/firebaseAdmin');

module.exports = function relayRoutes(io, mqttClient) {
  const router = express.Router();

  // Body: { deviceId, loadId, action: 'ISOLATE' | 'RESTORE', requestedBy }
  router.post('/command', async (req, res) => {
    const { deviceId, loadId, action, requestedBy } = req.body || {};

    if (!deviceId || !['ISOLATE', 'RESTORE'].includes(action)) {
      return res.status(400).json({
        ok: false,
        error: "deviceId and action ('ISOLATE' | 'RESTORE') are required",
      });
    }

    const command = {
      deviceId,
      loadId: loadId || null,
      action,
      requestedBy: requestedBy || 'unknown-user',
      status: 'SENT',
      createdAt: Date.now(),
    };

    // Publish to the device over MQTT so it can act immediately.
    // NOTE: This is the *remote convenience* path only. The ESP32 must
    // still perform its own local, sub-15ms protection independent of
    // Wi-Fi/MQTT/Firebase — see docs/ARCHITECTURE.md.
    if (mqttClient && mqttClient.connected) {
      const topic = `eshield/${deviceId}/relay/cmd`;
      mqttClient.publish(topic, JSON.stringify({ action, loadId }));
    } else {
      command.status = 'QUEUED_NO_BROKER';
    }

    if (isConfigured) {
      try {
        const ref = await db.collection('relayCommands').add(command);
        command.id = ref.id;
      } catch (err) {
        console.error('[relayRoutes] Failed to log relay command:', err.message);
      }
    }

    if (io) io.to(deviceId).emit('relayCommand', command);

    res.json({ ok: true, command });
  });

  return router;
};
