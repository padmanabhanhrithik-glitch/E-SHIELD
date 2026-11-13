/**
 * DEMO MODE simulator.
 *
 * Generates plausible telemetry so the full UI can be exercised without
 * hardware. Every value produced here is tagged `isSimulated: true` and the
 * UI must always render the "DEMO MODE" badge whenever it is displaying
 * simulated data — see components/DemoModeBanner.js. This module is never
 * imported by any "live" data path.
 */

const SCENARIOS = ['NORMAL', 'WARNING', 'CRITICAL', 'DISCONNECT', 'MAINTENANCE'];

let currentScenario = 'NORMAL';
let tickCount = 0;
let disconnectedUntilTick = -1;

const BASELINE_STARTUP_CURRENT = 1.51; // A, matches example in spec

export function setScenario(scenario) {
  if (SCENARIOS.includes(scenario)) {
    currentScenario = scenario;
    if (scenario === 'DISCONNECT') {
      disconnectedUntilTick = tickCount + 8; // simulate ~8 ticks of silence
    }
  }
}

export function getScenario() {
  return currentScenario;
}

export function getAvailableScenarios() {
  return SCENARIOS;
}

function gaussianNoise(scale = 1) {
  // Box-Muller
  const u = Math.random() || 1e-6;
  const v = Math.random() || 1e-6;
  return scale * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Produces one simulated telemetry packet for the given device/load, shaped
 * exactly like a real ESP32 payload (see backend/services/telemetryService.js
 * validateTelemetry for the required fields).
 */
export function generateTelemetryTick(deviceId = 'ESHIELD-NODE-01', loadId = 'demo-ceiling-fan') {
  tickCount += 1;

  if (currentScenario === 'DISCONNECT' && tickCount < disconnectedUntilTick) {
    return null; // simulates no packet arriving — UI should show SENSOR DISCONNECTED
  }
  if (currentScenario === 'DISCONNECT' && tickCount >= disconnectedUntilTick) {
    currentScenario = 'NORMAL';
  }

  let voltage = 230 + gaussianNoise(0.6);
  let current = 0.42 + gaussianNoise(0.02);
  let frequency = 50 + gaussianNoise(0.03);
  let anomalyScore = Math.max(0, 0.05 + gaussianNoise(0.03));
  let startupPeak = BASELINE_STARTUP_CURRENT + gaussianNoise(0.03);
  let crestFactor = 1.414 + gaussianNoise(0.02);
  let thd = 3 + gaussianNoise(0.5);

  switch (currentScenario) {
    case 'WARNING':
      voltage += 18; // surge-ish
      anomalyScore = 0.45 + gaussianNoise(0.05);
      startupPeak = BASELINE_STARTUP_CURRENT * 1.18;
      break;
    case 'CRITICAL':
      current = 16 + gaussianNoise(0.3); // overcurrent
      anomalyScore = 0.82 + gaussianNoise(0.03);
      startupPeak = BASELINE_STARTUP_CURRENT * 1.4;
      break;
    case 'MAINTENANCE':
      startupPeak = BASELINE_STARTUP_CURRENT * 1.21; // ageing capacitor trend
      anomalyScore = 0.15 + gaussianNoise(0.03);
      break;
    default:
      break;
  }

  const power = voltage * current * 0.92;

  // Simple synthetic waveform samples (128 points) for the waveform screen.
  const waveformSamples = Array.from({ length: 128 }, (_, i) => {
    const angle = (i / 128) * 2 * Math.PI;
    const fundamental = Math.sin(angle) * (voltage / 230);
    const noise =
      currentScenario === 'CRITICAL' || currentScenario === 'WARNING'
        ? gaussianNoise(0.08) + Math.sin(angle * 7) * 0.05
        : gaussianNoise(0.01);
    return Number((fundamental + noise).toFixed(4));
  });

  return {
    isSimulated: true,
    deviceId,
    loadId,
    locationId: 'demo-bedroom',
    locationName: 'Bedroom',
    loadName: 'Ceiling Fan',
    timestamp: Date.now(),
    voltage: Number(voltage.toFixed(2)),
    rmsVoltage: Number(voltage.toFixed(2)),
    current: Number(Math.max(0, current).toFixed(3)),
    rmsCurrent: Number(Math.max(0, current).toFixed(3)),
    power: Number(power.toFixed(1)),
    energy: Number((1.24 + tickCount * 0.0004).toFixed(3)),
    frequency: Number(frequency.toFixed(2)),
    powerFactor: 0.92,
    crestFactor: Number(crestFactor.toFixed(3)),
    thd: Number(Math.max(0, thd).toFixed(2)),
    anomalyScore: Number(Math.min(1, Math.max(0, anomalyScore)).toFixed(3)),
    startupPeak: Number(startupPeak.toFixed(3)),
    startupDecayTime: 180 + Math.round(gaussianNoise(10)),
    waveformSamples,
    status: 'ONLINE',
  };
}

export function generateDemoLoads() {
  return [
    { id: 'demo-ceiling-fan', name: 'Ceiling Fan', locationName: 'Bedroom', health: 76, status: 'WARNING', current: 0.42, power: 96.6, lastSeen: Date.now(), anomalyLevel: 'LOW' },
    { id: 'demo-led-lamp', name: 'LED Lamp', locationName: 'Hall', health: 97, status: 'SAFE', current: 0.08, power: 9.2, lastSeen: Date.now(), anomalyLevel: 'NONE' },
    { id: 'demo-laptop-charger', name: 'Laptop Charger', locationName: 'Study', health: 92, status: 'SAFE', current: 0.31, power: 65.0, lastSeen: Date.now(), anomalyLevel: 'NONE' },
    { id: 'demo-fridge', name: 'Refrigerator', locationName: 'Kitchen', health: 68, status: 'WARNING', current: 1.1, power: 148.5, lastSeen: Date.now(), anomalyLevel: 'MEDIUM' },
    { id: 'demo-unknown-1', name: 'Unknown Load', locationName: 'Kitchen', health: 84, status: 'INFO', current: 0.55, power: 88.1, lastSeen: Date.now(), anomalyLevel: 'LOW', isUnknown: true },
  ];
}

export function generateDemoAlerts() {
  const now = Date.now();
  return [
    {
      id: 'demo-alert-1',
      severity: 'CRITICAL',
      what: 'Abnormal current waveform',
      where: 'Bedroom',
      load: 'Ceiling Fan',
      when: now - 5 * 60 * 1000,
      why: 'Residual waveform anomaly score is 82%, above the critical threshold.',
      action: 'Inspect wiring, plug and appliance connection.',
      healthScoreAtEvent: 41,
      read: false,
    },
    {
      id: 'demo-alert-2',
      severity: 'WARNING',
      what: 'Increasing startup current',
      where: 'Kitchen',
      load: 'Refrigerator',
      when: now - 45 * 60 * 1000,
      why: 'Startup current is 21% above its learned baseline.',
      action: 'Possible component degradation — monitor the trend.',
      healthScoreAtEvent: 68,
      read: true,
    },
    {
      id: 'demo-alert-3',
      severity: 'INFO',
      what: 'Unknown electrical load detected',
      where: 'Kitchen',
      load: 'Unknown Load',
      when: now - 3 * 60 * 60 * 1000,
      why: 'A new electrical signature was seen that does not match any known load profile.',
      action: 'Rename the load once identified.',
      healthScoreAtEvent: 84,
      read: true,
    },
  ];
}
