/**
 * Electrical Health Score calculation.
 *
 * Produces a 0-100 score plus a breakdown of contributing factors, derived
 * from actual telemetry/anomaly data — never hard-coded.
 *
 * Factors (weights sum to 100):
 *  - Voltage Stability   25
 *  - Current Behaviour   20
 *  - Waveform Quality    20   (residual/anomalyScore + crestFactor/THD if present)
 *  - Startup Behaviour   15   (startupPeak / startupDecayTime deviation from baseline)
 *  - Fault History       20   (recent alert frequency & severity)
 */

const NOMINAL_VOLTAGE = 230; // volts, adjust per region in settings if needed
const NOMINAL_FREQUENCY = 50; // Hz

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function scoreVoltageStability(telemetrySamples) {
  if (!telemetrySamples.length) return null;
  const voltages = telemetrySamples
    .map((t) => t.rmsVoltage ?? t.voltage)
    .filter((v) => typeof v === 'number');
  if (!voltages.length) return null;

  const mean = voltages.reduce((a, b) => a + b, 0) / voltages.length;
  const variance =
    voltages.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / voltages.length;
  const stdDev = Math.sqrt(variance);

  const deviationFromNominalPct = Math.abs(mean - NOMINAL_VOLTAGE) / NOMINAL_VOLTAGE;
  const noisePct = stdDev / mean;

  const score = 100 - deviationFromNominalPct * 300 - noisePct * 400;
  return clamp(Math.round(score));
}

function scoreCurrentBehaviour(telemetrySamples) {
  if (!telemetrySamples.length) return null;
  const currents = telemetrySamples
    .map((t) => t.rmsCurrent ?? t.current)
    .filter((v) => typeof v === 'number');
  if (!currents.length) return null;

  const mean = currents.reduce((a, b) => a + b, 0) / currents.length;
  if (mean === 0) return 100;

  const variance =
    currents.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / currents.length;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = stdDev / mean;

  // Healthy loads have fairly consistent draw between startup transients.
  const score = 100 - coefficientOfVariation * 150;
  return clamp(Math.round(score));
}

function scoreWaveformQuality(telemetrySamples) {
  const relevant = telemetrySamples.filter(
    (t) => typeof t.anomalyScore === 'number' || typeof t.thd === 'number' || typeof t.crestFactor === 'number'
  );
  if (!relevant.length) return null;

  let total = 0;
  let count = 0;

  relevant.forEach((t) => {
    if (typeof t.anomalyScore === 'number') {
      // anomalyScore expected 0 (clean) - 1 (severe anomaly)
      total += clamp(100 - t.anomalyScore * 100);
      count += 1;
    }
    if (typeof t.thd === 'number') {
      // THD in %, above ~8% starts to indicate distortion for resistive/inductive loads
      total += clamp(100 - t.thd * 5);
      count += 1;
    }
    if (typeof t.crestFactor === 'number') {
      // Ideal sinusoidal crest factor ~1.414; large deviation suggests clipping/distortion
      const deviation = Math.abs(t.crestFactor - 1.414);
      total += clamp(100 - deviation * 60);
      count += 1;
    }
  });

  return count ? clamp(Math.round(total / count)) : null;
}

function scoreStartupBehaviour(loadProfile) {
  if (!loadProfile || !loadProfile.baselineStartupCurrent || !loadProfile.lastStartupCurrent) {
    return null;
  }
  const changePct =
    ((loadProfile.lastStartupCurrent - loadProfile.baselineStartupCurrent) /
      loadProfile.baselineStartupCurrent) *
    100;

  // Small positive/negative drift is normal; large positive drift indicates
  // ageing capacitors/motor wear.
  const score = 100 - Math.max(0, changePct) * 2.2 - Math.abs(Math.min(0, changePct)) * 0.5;
  return clamp(Math.round(score));
}

function scoreFaultHistory(recentAlerts) {
  if (!recentAlerts) return 100;
  const weights = { INFO: 1, WARNING: 4, CRITICAL: 12 };
  const penalty = recentAlerts.reduce((sum, a) => sum + (weights[a.severity] || 1), 0);
  return clamp(Math.round(100 - penalty));
}

/**
 * @param {Object} params
 * @param {Array} params.telemetrySamples - recent telemetry documents for a device/load
 * @param {Object} [params.loadProfile] - { baselineStartupCurrent, lastStartupCurrent }
 * @param {Array} [params.recentAlerts] - alerts in the scoring window, each with `severity`
 * @returns {{score:number, label:string, factors:Object, reason:string}}
 */
function calculateHealthScore({ telemetrySamples = [], loadProfile = null, recentAlerts = [] }) {
  const factors = {
    voltageStability: scoreVoltageStability(telemetrySamples),
    currentBehaviour: scoreCurrentBehaviour(telemetrySamples),
    waveformQuality: scoreWaveformQuality(telemetrySamples),
    startupBehaviour: scoreStartupBehaviour(loadProfile),
    faultHistory: scoreFaultHistory(recentAlerts),
  };

  const weights = {
    voltageStability: 25,
    currentBehaviour: 20,
    waveformQuality: 20,
    startupBehaviour: 15,
    faultHistory: 20,
  };

  let weightedSum = 0;
  let weightUsed = 0;

  Object.entries(factors).forEach(([key, value]) => {
    if (typeof value === 'number') {
      weightedSum += value * weights[key];
      weightUsed += weights[key];
    }
  });

  if (weightUsed === 0) {
    return {
      score: null,
      label: 'UNAVAILABLE',
      factors,
      reason: 'Insufficient telemetry to calculate a health score yet.',
    };
  }

  const score = clamp(Math.round(weightedSum / weightUsed));
  const label = labelForScore(score);
  const reason = reasonForFactors(factors, score);

  return { score, label, factors, reason };
}

function labelForScore(score) {
  if (score >= 90) return 'SAFE';
  if (score >= 75) return 'GOOD';
  if (score >= 50) return 'WARNING';
  if (score >= 25) return 'HIGH RISK';
  return 'CRITICAL';
}

function reasonForFactors(factors, score) {
  const entries = Object.entries(factors).filter(([, v]) => typeof v === 'number');
  if (!entries.length) return 'Not enough data yet.';

  const lowest = entries.reduce((min, curr) => (curr[1] < min[1] ? curr : min));
  const labels = {
    voltageStability: 'voltage stability',
    currentBehaviour: 'current behaviour',
    waveformQuality: 'waveform quality',
    startupBehaviour: 'startup behaviour',
    faultHistory: 'recent fault history',
  };

  if (score >= 90) return 'Stable voltage and current behaviour.';
  return `Score impacted mainly by ${labels[lowest[0]]} (${lowest[1]}/100).`;
}

module.exports = {
  calculateHealthScore,
  labelForScore,
  NOMINAL_VOLTAGE,
  NOMINAL_FREQUENCY,
};
