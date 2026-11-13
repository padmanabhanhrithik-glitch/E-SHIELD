/**
 * E-SHIELD Simulator (standalone CLI)
 *
 * Posts telemetry to the backend's HTTP ingest endpoint every TICK_MS,
 * exactly as a real ESP32 would over Wi-Fi. Every payload is tagged
 * `isSimulated: true` so it is never confused with genuine hardware data.
 *
 * Usage:
 *   cd simulator
 *   npm install
 *   cp .env.example .env   (edit BACKEND_URL / DEVICE_INGEST_SECRET to match backend/.env)
 *   npm start
 *
 * While running, type a scenario name + Enter to switch behaviour:
 *   NORMAL | WARNING | CRITICAL | DISCONNECT | MAINTENANCE
 */

require('dotenv').config();
const fetch = require('node-fetch');
const readline = require('readline');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';
const DEVICE_INGEST_SECRET = process.env.DEVICE_INGEST_SECRET || '';
const DEVICE_ID = process.env.DEVICE_ID || 'ESHIELD-NODE-01';
const LOAD_ID = process.env.LOAD_ID || 'demo-ceiling-fan';
const LOCATION_ID = process.env.LOCATION_ID || 'demo-bedroom';
const TICK_MS = Number(process.env.TICK_MS) || 2000;

const SCENARIOS = ['NORMAL', 'WARNING', 'CRITICAL', 'DISCONNECT', 'MAINTENANCE'];
let scenario = 'NORMAL';
let tick = 0;
let disconnectUntilTick = -1;

const BASELINE_STARTUP_CURRENT = 1.51;

function gaussianNoise(scale = 1) {
  const u = Math.random() || 1e-6;
  const v = Math.random() || 1e-6;
  return scale * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function buildTelemetry() {
  let voltage = 230 + gaussianNoise(0.6);
  let current = 0.42 + gaussianNoise(0.02);
  let frequency = 50 + gaussianNoise(0.03);
  let anomalyScore = Math.max(0, 0.05 + gaussianNoise(0.03));
  let startupPeak = BASELINE_STARTUP_CURRENT + gaussianNoise(0.03);

  switch (scenario) {
    case 'WARNING':
      voltage += 18;
      anomalyScore = 0.45 + gaussianNoise(0.05);
      startupPeak = BASELINE_STARTUP_CURRENT * 1.18;
      break;
    case 'CRITICAL':
      current = 16 + gaussianNoise(0.3);
      anomalyScore = 0.82 + gaussianNoise(0.03);
      startupPeak = BASELINE_STARTUP_CURRENT * 1.4;
      break;
    case 'MAINTENANCE':
      startupPeak = BASELINE_STARTUP_CURRENT * 1.21;
      anomalyScore = 0.15 + gaussianNoise(0.03);
      break;
    default:
      break;
  }

  const power = voltage * Math.max(0, current) * 0.92;

  const waveformSamples = Array.from({ length: 128 }, (_, i) => {
    const angle = (i / 128) * 2 * Math.PI;
    const fundamental = Math.sin(angle) * (voltage / 230);
    const noise =
      scenario === 'CRITICAL' || scenario === 'WARNING'
        ? gaussianNoise(0.08) + Math.sin(angle * 7) * 0.05
        : gaussianNoise(0.01);
    return Number((fundamental + noise).toFixed(4));
  });

  return {
    isSimulated: true,
    deviceId: DEVICE_ID,
    loadId: LOAD_ID,
    locationId: LOCATION_ID,
    locationName: 'Bedroom',
    loadName: 'Ceiling Fan',
    timestamp: Date.now(),
    voltage: Number(voltage.toFixed(2)),
    rmsVoltage: Number(voltage.toFixed(2)),
    current: Number(Math.max(0, current).toFixed(3)),
    rmsCurrent: Number(Math.max(0, current).toFixed(3)),
    power: Number(power.toFixed(1)),
    energy: Number((1.24 + tick * 0.0004).toFixed(3)),
    frequency: Number(frequency.toFixed(2)),
    powerFactor: 0.92,
    crestFactor: Number((1.414 + gaussianNoise(0.02)).toFixed(3)),
    thd: Number(Math.max(0, 3 + gaussianNoise(0.5)).toFixed(2)),
    anomalyScore: Number(Math.min(1, Math.max(0, anomalyScore)).toFixed(3)),
    startupPeak: Number(startupPeak.toFixed(3)),
    startupDecayTime: 180 + Math.round(gaussianNoise(10)),
    waveformSamples,
    status: 'ONLINE',
  };
}

async function postTelemetry(payload) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/telemetry/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Secret': DEVICE_INGEST_SECRET,
      },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[simulator] Backend rejected telemetry (${res.status}):`, body.error || body.errors);
    } else {
      const alertNote = body.alerts?.length ? ` | ${body.alerts.length} alert(s) generated` : '';
      console.log(
        `[${scenario}] V=${payload.voltage}V I=${payload.current}A P=${payload.power}W anomaly=${payload.anomalyScore} health=${body.health?.score ?? 'N/A'}${alertNote}`
      );
    }
  } catch (err) {
    console.error('[simulator] Could not reach backend:', err.message);
    console.error('[simulator] Is the backend running? (cd backend && npm start)');
  }
}

function tickOnce() {
  tick += 1;

  if (scenario === 'DISCONNECT' && disconnectUntilTick < 0) {
    disconnectUntilTick = tick + 8;
  }
  if (scenario === 'DISCONNECT' && tick < disconnectUntilTick) {
    console.log('[DISCONNECT] (withholding packet — simulating ESP32 offline)');
    return;
  }
  if (scenario === 'DISCONNECT' && tick >= disconnectUntilTick) {
    scenario = 'NORMAL';
    disconnectUntilTick = -1;
    console.log('[simulator] Device reconnected — resuming NORMAL scenario.');
  }

  postTelemetry(buildTelemetry());
}

console.log('=================================================');
console.log(' E-SHIELD SIMULATOR — DEMO MODE (no real hardware)');
console.log('=================================================');
console.log(`Posting to ${BACKEND_URL}/api/telemetry/ingest every ${TICK_MS}ms`);
console.log(`Type a scenario name + Enter to switch: ${SCENARIOS.join(', ')}`);
console.log('Press Ctrl+C to stop.\n');

setInterval(tickOnce, TICK_MS);

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const input = line.trim().toUpperCase();
  if (SCENARIOS.includes(input)) {
    scenario = input;
    console.log(`\n[simulator] Scenario switched to ${input}\n`);
  } else {
    console.log(`Unknown scenario "${input}". Options: ${SCENARIOS.join(', ')}`);
  }
});
