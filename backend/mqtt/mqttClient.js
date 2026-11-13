const mqtt = require('mqtt');
const { ingestTelemetry } = require('../services/telemetryService');
const { markDeviceSeen } = require('../services/telemetryService');

/**
 * Connects to the MQTT broker and subscribes to ESP32 telemetry/status topics.
 * Returns the mqtt client (or null if no broker URL is configured) so routes
 * like relay.js can also publish commands back to devices.
 */
function startMqttClient(io) {
  const brokerUrl = process.env.MQTT_BROKER_URL;
  if (!brokerUrl) {
    console.warn('[mqtt] MQTT_BROKER_URL not set — MQTT ingestion disabled (HTTP ingest still works).');
    return null;
  }

  const client = mqtt.connect(brokerUrl, {
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    reconnectPeriod: 3000,
  });

  const telemetryTopic = process.env.MQTT_TOPIC_TELEMETRY || 'eshield/+/telemetry';
  const statusTopic = process.env.MQTT_TOPIC_STATUS || 'eshield/+/status';

  client.on('connect', () => {
    console.log('[mqtt] Connected to broker:', brokerUrl);
    client.subscribe([telemetryTopic, statusTopic], (err) => {
      if (err) console.error('[mqtt] Subscribe failed:', err.message);
      else console.log('[mqtt] Subscribed to', telemetryTopic, 'and', statusTopic);
    });
  });

  client.on('message', async (topic, messageBuffer) => {
    try {
      const payload = JSON.parse(messageBuffer.toString());

      if (topic.endsWith('/status')) {
        // e.g. {"deviceId":"NODE01","state":"online","firmware":"1.2.0"}
        if (payload.deviceId) markDeviceSeen(payload.deviceId);
        if (io) io.to(payload.deviceId).emit('deviceStatus', payload);
        return;
      }

      if (topic.endsWith('/telemetry')) {
        await ingestTelemetry(payload, io);
      }
    } catch (err) {
      console.error('[mqtt] Failed to process message on', topic, ':', err.message);
    }
  });

  client.on('error', (err) => {
    console.error('[mqtt] Connection error:', err.message);
  });

  return client;
}

module.exports = { startMqttClient };
