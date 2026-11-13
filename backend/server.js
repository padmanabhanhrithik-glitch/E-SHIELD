require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { Server } = require('socket.io');

const logger = require('./utils/logger');
const { isConfigured } = require('./config/firebaseAdmin');
const { startMqttClient } = require('./mqtt/mqttClient');
const { getDeviceConnectionStatus } = require('./services/telemetryService');

const app = express();
const server = http.createServer(app);
const allowedOrigins = (process.env.CORS_ORIGINS || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOrigin = allowedOrigins.includes('*')
  ? '*'
  : (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin));
const io = new Server(server, { cors: { origin: corsOrigin } });

app.use(helmet());
app.use(cors({ origin: corsOrigin }));
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));
app.use(morgan('dev'));

// --- Socket.IO: clients join a room per deviceId to receive live updates ---
io.on('connection', (socket) => {
  logger.debug('Socket connected:', socket.id);

  socket.on('subscribe', (deviceId) => {
    if (deviceId) {
      socket.join(deviceId);
      logger.debug(socket.id, 'subscribed to device', deviceId);
    }
  });

  socket.on('disconnect', () => logger.debug('Socket disconnected:', socket.id));
});

// --- MQTT ingestion (ESP32 -> broker -> backend) ---
const mqttClient = process.env.MQTT_ENABLED === 'true' ? startMqttClient(io) : null;
if (!mqttClient) logger.info('[mqtt] MQTT disabled — using HTTP telemetry ingest.');

// --- Routes ---
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    firebaseConfigured: isConfigured,
    mqttConnected: !!(mqttClient && mqttClient.connected),
    mode: require('./services/ml/config').MODE,
    uptimeSeconds: process.uptime(),
  });
});

app.get('/api/devices/:deviceId/status', (req, res) => {
  const status = getDeviceConnectionStatus(
    req.params.deviceId,
    Number(process.env.DEVICE_OFFLINE_TIMEOUT_MS) || 15000
  );
  res.json({ ok: true, deviceId: req.params.deviceId, ...status });
});

app.use('/api/telemetry', require('./routes/telemetry')(io));
app.use('/api/relay', require('./routes/relay')(io, mqttClient));
app.use('/api/loads', require('./routes/loads'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/ml', require('./routes/ml'));

// --- Central error handler so one failing route never crashes the server ---
app.use((err, req, res, next) => {
  logger.error('Unhandled route error:', err);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason);
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  logger.info(`E-SHIELD backend listening on port ${PORT}`);
  if (!isConfigured) {
    logger.warn('Firebase Admin is NOT configured — see docs/FIREBASE_SETUP.md. App will still run in DEMO MODE from the frontend.');
  }
});
