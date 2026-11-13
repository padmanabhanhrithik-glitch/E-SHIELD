// Mirrors backend/services/healthScoreService.js so DEMO MODE (which has no
// backend to call) can still show a real, telemetry-derived score instead of
// a hard-coded number. Keep this in sync if the backend scoring changes.

const NOMINAL_VOLTAGE = 230;

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function labelForScore(score) {
  if (score === null || score === undefined) return 'UNAVAILABLE';
  if (score >= 90) return 'SAFE';
  if (score >= 75) return 'GOOD';
  if (score >= 50) return 'WARNING';
  if (score >= 25) return 'HIGH RISK';
  return 'CRITICAL';
}

/**
 * Simplified single-sample version of the backend's multi-sample scorer —
 * enough to drive the demo UI in a way that responds honestly to the
 * simulator's current scenario, without duplicating a rolling window.
 */
export function calculateHealthScoreFromSample(telemetry) {
  if (!telemetry) return { score: null, label: 'UNAVAILABLE', factors: {}, reason: 'No data yet.' };

  const voltage = telemetry.rmsVoltage ?? telemetry.voltage;
  const current = telemetry.rmsCurrent ?? telemetry.current;

  const voltageDeviationPct = Math.abs(voltage - NOMINAL_VOLTAGE) / NOMINAL_VOLTAGE;
  const voltageStability = clamp(Math.round(100 - voltageDeviationPct * 300));

  const currentBehaviour = clamp(
    Math.round(100 - (typeof telemetry.anomalyScore === 'number' ? telemetry.anomalyScore * 40 : 0))
  );

  const waveformQuality =
    typeof telemetry.anomalyScore === 'number'
      ? clamp(Math.round(100 - telemetry.anomalyScore * 100))
      : null;

  const startupBehaviour =
    typeof telemetry.startupPeak === 'number'
      ? clamp(Math.round(100 - Math.max(0, telemetry.startupPeak / 1.51 - 1) * 220))
      : null;

  const factors = { voltageStability, currentBehaviour, waveformQuality, startupBehaviour, faultHistory: 100 };
  const weights = { voltageStability: 25, currentBehaviour: 20, waveformQuality: 20, startupBehaviour: 15, faultHistory: 20 };

  let weightedSum = 0;
  let weightUsed = 0;
  Object.entries(factors).forEach(([key, value]) => {
    if (typeof value === 'number') {
      weightedSum += value * weights[key];
      weightUsed += weights[key];
    }
  });

  const score = weightUsed ? clamp(Math.round(weightedSum / weightUsed)) : null;
  const label = labelForScore(score);

  const entries = Object.entries(factors).filter(([, v]) => typeof v === 'number');
  const lowest = entries.length ? entries.reduce((min, curr) => (curr[1] < min[1] ? curr : min)) : null;
  const labels = {
    voltageStability: 'voltage stability',
    currentBehaviour: 'current behaviour',
    waveformQuality: 'waveform quality',
    startupBehaviour: 'startup behaviour',
    faultHistory: 'fault history',
  };
  const reason =
    score >= 90 ? 'Stable voltage and current behaviour.' : lowest ? `Score impacted mainly by ${labels[lowest[0]]} (${lowest[1]}/100).` : 'Not enough data yet.';

  return { score, label, factors, reason };
}
