/**
 * Rule-based alert generation.
 *
 * Evaluates a single telemetry packet (plus recent history/baseline) and
 * returns zero or more alert objects. This is intentionally a transparent,
 * explainable rule engine (thresholds / z-score / trend) rather than a
 * black-box "AI" — see README for rationale and future ML integration notes.
 */

const { NOMINAL_VOLTAGE, NOMINAL_FREQUENCY } = require('./healthScoreService');

const THRESHOLDS = {
  voltageSurgePct: 0.10, // +10% over nominal
  voltageSagPct: 0.10, // -10% under nominal
  overcurrentAmps: 15, // adjust per installation / breaker rating
  anomalyScoreWarning: 0.4,
  anomalyScoreCritical: 0.75,
  startupCurrentWarningPct: 15, // % increase vs baseline
  startupCurrentCriticalPct: 35,
  frequencyDeviationHz: 1.0,
};

function buildAlert({ severity, type, message, why, action, telemetry, locationName, loadName }) {
  return {
    severity, // INFO | WARNING | CRITICAL
    type, // machine-readable alert type
    what: message,
    where: locationName || 'Unknown location',
    load: loadName || 'Unknown load',
    when: telemetry.timestamp || Date.now(),
    why,
    action,
    deviceId: telemetry.deviceId || null,
    locationId: telemetry.locationId || null,
    loadId: telemetry.loadId || null,
    healthScoreAtEvent: typeof telemetry.healthScore === 'number' ? telemetry.healthScore : null,
    source: 'rule-engine',
  };
}

/**
 * @param {Object} telemetry - single telemetry packet, see fields in README
 * @param {Object} context - { locationName, loadName, baselineStartupCurrent }
 * @returns {Array<Object>} generated alerts (may be empty)
 */
function evaluateTelemetry(telemetry, context = {}) {
  const alerts = [];
  const { locationName, loadName, baselineStartupCurrent } = context;

  const voltage = telemetry.rmsVoltage ?? telemetry.voltage;
  const current = telemetry.rmsCurrent ?? telemetry.current;

  // --- Voltage surge / sag ---
  if (typeof voltage === 'number') {
    const deviation = (voltage - NOMINAL_VOLTAGE) / NOMINAL_VOLTAGE;
    if (deviation >= THRESHOLDS.voltageSurgePct) {
      alerts.push(
        buildAlert({
          severity: 'WARNING',
          type: 'VOLTAGE_SURGE',
          message: 'Voltage surge detected',
          why: `Measured voltage ${voltage.toFixed(1)}V is ${(deviation * 100).toFixed(
            1
          )}% above the ${NOMINAL_VOLTAGE}V nominal.`,
          action: 'Check for unstable mains supply or a nearby high-load device switching on/off.',
          telemetry,
          locationName,
          loadName,
        })
      );
    } else if (deviation <= -THRESHOLDS.voltageSagPct) {
      alerts.push(
        buildAlert({
          severity: 'WARNING',
          type: 'VOLTAGE_SAG',
          message: 'Voltage sag detected',
          why: `Measured voltage ${voltage.toFixed(1)}V is ${Math.abs(deviation * 100).toFixed(
            1
          )}% below the ${NOMINAL_VOLTAGE}V nominal.`,
          action: 'Check for overloaded circuits or loose supply connections.',
          telemetry,
          locationName,
          loadName,
        })
      );
    }
  }

  // --- Frequency deviation ---
  if (typeof telemetry.frequency === 'number') {
    const freqDeviation = Math.abs(telemetry.frequency - NOMINAL_FREQUENCY);
    if (freqDeviation >= THRESHOLDS.frequencyDeviationHz) {
      alerts.push(
        buildAlert({
          severity: 'INFO',
          type: 'FREQUENCY_DEVIATION',
          message: 'Mains frequency deviation detected',
          why: `Measured frequency ${telemetry.frequency.toFixed(2)}Hz deviates from the ${NOMINAL_FREQUENCY}Hz reference.`,
          action: 'Usually informational; monitor if it persists.',
          telemetry,
          locationName,
          loadName,
        })
      );
    }
  }

  // --- Overcurrent ---
  if (typeof current === 'number' && current >= THRESHOLDS.overcurrentAmps) {
    alerts.push(
      buildAlert({
        severity: 'CRITICAL',
        type: 'OVERCURRENT',
        message: 'Overcurrent detected',
        why: `Measured current ${current.toFixed(2)}A exceeds the configured limit of ${THRESHOLDS.overcurrentAmps}A.`,
        action: 'Isolate the load immediately and inspect wiring/appliance before restoring.',
        telemetry,
        locationName,
        loadName,
      })
    );
  }

  // --- Waveform anomaly / possible micro-arcing ---
  if (typeof telemetry.anomalyScore === 'number') {
    if (telemetry.anomalyScore >= THRESHOLDS.anomalyScoreCritical) {
      alerts.push(
        buildAlert({
          severity: 'CRITICAL',
          type: 'MICRO_ARC_SUSPECTED',
          message: 'Possible micro-arcing signature',
          why: `Residual waveform anomaly score is ${(telemetry.anomalyScore * 100).toFixed(
            0
          )}%, above the critical threshold.`,
          action: 'Inspect wiring, plug and appliance connection as soon as possible.',
          telemetry,
          locationName,
          loadName,
        })
      );
    } else if (telemetry.anomalyScore >= THRESHOLDS.anomalyScoreWarning) {
      alerts.push(
        buildAlert({
          severity: 'WARNING',
          type: 'ABNORMAL_WAVEFORM',
          message: 'Abnormal current waveform',
          why: `Residual waveform anomaly score is ${(telemetry.anomalyScore * 100).toFixed(0)}%.`,
          action: 'Monitor the load; inspect if the trend continues.',
          telemetry,
          locationName,
          loadName,
        })
      );
    }
  }

  // --- Startup current drift (predictive maintenance signal) ---
  if (typeof telemetry.startupPeak === 'number' && baselineStartupCurrent) {
    const changePct =
      ((telemetry.startupPeak - baselineStartupCurrent) / baselineStartupCurrent) * 100;
    if (changePct >= THRESHOLDS.startupCurrentCriticalPct) {
      alerts.push(
        buildAlert({
          severity: 'WARNING',
          type: 'STARTUP_CURRENT_DRIFT',
          message: 'Repeated startup abnormality',
          why: `Startup current is ${changePct.toFixed(1)}% above its learned baseline of ${baselineStartupCurrent.toFixed(
            2
          )}A.`,
          action: 'Possible component degradation. Inspect the appliance capacitor/motor condition.',
          telemetry,
          locationName,
          loadName,
        })
      );
    } else if (changePct >= THRESHOLDS.startupCurrentWarningPct) {
      alerts.push(
        buildAlert({
          severity: 'INFO',
          type: 'STARTUP_CURRENT_DRIFT',
          message: 'Increasing startup current',
          why: `Startup current is ${changePct.toFixed(1)}% above its learned baseline.`,
          action: 'Early warning only — continue monitoring the trend.',
          telemetry,
          locationName,
          loadName,
        })
      );
    }
  }

  return alerts;
}

module.exports = { evaluateTelemetry, THRESHOLDS };
