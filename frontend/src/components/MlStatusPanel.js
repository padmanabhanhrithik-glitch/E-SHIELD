import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Panel } from './Basics';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';

// Human-readable text for every classification status the backend can send.
// Note: there is deliberately NO "likely X" wording anywhere — a class name is
// only shown when the backend reports IDENTIFICATION_CONFIRMED.
const IDENT_LABEL = {
  IDENTIFICATION_CONFIRMED: 'CONFIRMED',
  INSUFFICIENT_CONFIDENCE: 'INSUFFICIENT CONFIDENCE',
  OUT_OF_DISTRIBUTION: 'NOT A TRAINED APPLIANCE',
  COLLECTING_WINDOW: 'COLLECTING DATA',
  MISSING_INPUT: 'REQUIRED SENSOR VALUES MISSING',
  ML_MODEL_UNAVAILABLE: 'ML MODEL UNAVAILABLE',
  DEMO_DATA_NOT_CLASSIFIED: 'NOT RUN ON DEMO DATA',
};

const OVERALL = {
  NORMAL: { label: 'NORMAL', fg: colors.safe, bg: colors.safeBg },
  LEARNING: { label: 'LEARNING', fg: colors.info, bg: colors.infoBg },
  ANOMALY: { label: 'ANOMALY', fg: colors.warning, bg: colors.warningBg },
  SAFETY_LIMIT_VIOLATION: { label: 'SAFETY LIMIT VIOLATION', fg: colors.critical, bg: colors.criticalBg },
  FAULT: { label: 'FAULT', fg: colors.critical, bg: colors.criticalBg },
  UNKNOWN_DEVICE: { label: 'UNKNOWN DEVICE', fg: colors.textSecondary, bg: colors.bgSecondary },
  ML_PIPELINE_ERROR: { label: 'ML ERROR', fg: colors.critical, bg: colors.criticalBg },
};

export function identificationLabel(status) {
  return IDENT_LABEL[status] || String(status || '—').replace(/_/g, ' ');
}

export function overallStyle(status) {
  return OVERALL[status] || OVERALL.UNKNOWN_DEVICE;
}

function Row({ label, value, valueColor }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueColor && { color: valueColor }]}>{value}</Text>
    </View>
  );
}

/**
 * ML / anomaly status for ONE device.
 * props: ml (telemetry.ml from backend), deviceId, connectionStatus, demoMode (in-app simulator)
 */
export default function MlStatusPanel({ ml, deviceId, connectionStatus, demoMode }) {
  if (demoMode) {
    return (
      <Panel style={styles.panel}>
        <Text style={styles.deviceId}>{deviceId}</Text>
        <Text style={styles.note}>
          DEMO MODE — appliance identification and learned-profile anomaly detection run on the backend using
          LIVE ESP32 data. They are never run on simulated values.
        </Text>
      </Panel>
    );
  }
  if (connectionStatus === 'DISCONNECTED') {
    return (
      <Panel style={[styles.panel, { backgroundColor: colors.criticalBg, borderColor: colors.critical }]}>
        <Text style={styles.deviceId}>{deviceId}</Text>
        <Text style={[styles.big, { color: colors.critical }]}>SENSOR DISCONNECTED</Text>
        <Text style={styles.note}>DATA UNAVAILABLE</Text>
      </Panel>
    );
  }
  if (connectionStatus === 'BACKEND_UNAVAILABLE') {
    return (
      <Panel style={styles.panel}>
        <Text style={styles.deviceId}>{deviceId}</Text>
        <Text style={styles.note}>DATA UNAVAILABLE — backend not reachable</Text>
      </Panel>
    );
  }
  if (!ml) {
    return (
      <Panel style={styles.panel}>
        <Text style={styles.deviceId}>{deviceId}</Text>
        <Text style={styles.note}>Waiting for the first analysed packet…</Text>
      </Panel>
    );
  }

  const o = overallStyle(ml.overallStatus);
  const confirmed = ml.classificationStatus === 'IDENTIFICATION_CONFIRMED';
  const learning = ml.learningStatus === 'LEARNING';
  const lp = ml.learningProgress || { elapsedSec: 0, targetSec: 60 };
  const pct = Math.min(1, lp.targetSec ? lp.elapsedSec / lp.targetSec : 0);

  return (
    <Panel style={styles.panel}>
      <View style={styles.headRow}>
        <Text style={styles.deviceId}>{deviceId}</Text>
        <View style={[styles.pill, { backgroundColor: o.bg, borderColor: o.fg }]}>
          <Text style={[styles.pillText, { color: o.fg }]}>{o.label}</Text>
        </View>
      </View>

      <Text style={styles.small}>APPLIANCE</Text>
      <Text style={[styles.big, !confirmed && { color: colors.textSecondary }]}>
        {confirmed ? ml.applianceClass : 'UNKNOWN DEVICE'}
      </Text>

      <Row label="Identification" value={identificationLabel(ml.classificationStatus)} valueColor={confirmed ? colors.safe : colors.textSecondary} />
      <Row
        label="Confidence"
        value={confirmed && typeof ml.classificationConfidence === 'number' ? `${(ml.classificationConfidence * 100).toFixed(1)}%` : '—'}
      />
      {!confirmed && ml.classificationStatus !== 'DEMO_DATA_NOT_CLASSIFIED' && ml.classificationStatus !== 'ML_MODEL_UNAVAILABLE' && (
        <Text style={styles.note}>CONTINUE LEARNING — the system will not name an appliance it cannot identify reliably.</Text>
      )}
      {ml.classificationStatus === 'ML_MODEL_UNAVAILABLE' && (
        <Text style={styles.note}>{ml.classificationReason || 'Start the ML inference service and train a model.'}</Text>
      )}

      <View style={styles.divider} />
      <Row label="Learning" value={learning ? 'LEARNING DEVICE' : 'MONITORING'} valueColor={learning ? colors.info : colors.safe} />
      {learning && (
        <View>
          <View style={styles.track}><View style={[styles.fill, { width: `${pct * 100}%` }]} /></View>
          <Text style={styles.note}>{lp.elapsedSec} / {lp.targetSec} seconds</Text>
        </View>
      )}
      <Row label="Anomaly status" value={learning ? '—' : ml.anomalyStatus} valueColor={ml.anomalyStatus === 'ANOMALY' ? colors.warning : undefined} />
      <Row label="Anomaly score" value={typeof ml.anomalyScore === 'number' ? ml.anomalyScore.toFixed(2) : '—'} />
      {ml.safetyViolations?.length > 0 && <Row label="Safety limits" value={ml.safetyViolations.join(', ')} valueColor={colors.critical} />}
      {ml.faultType && <Row label="Fault" value={ml.faultType.replace(/_/g, ' ')} valueColor={colors.critical} />}
      {ml.profileClassMismatch && (
        <Text style={[styles.note, { color: colors.warning }]}>The identified appliance differs from the one this profile was learned on. Consider relearning.</Text>
      )}
      <Text style={styles.foot}>{ml.mode === 'DEMO' ? 'DEMO DATA' : 'LIVE ESP32 DATA'} · {ml.modelVersion || 'no model'}</Text>
    </Panel>
  );
}

const styles = StyleSheet.create({
  panel: { marginHorizontal: 16 },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  deviceId: { ...typography.bodyStrong, color: colors.text },
  pill: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { ...typography.caption, fontWeight: '700' },
  small: { ...typography.caption, color: colors.textSecondary },
  big: { ...typography.h3, color: colors.text, marginBottom: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  rowLabel: { ...typography.body, color: colors.textSecondary },
  rowValue: { ...typography.bodyStrong, color: colors.text, flexShrink: 1, textAlign: 'right' },
  note: { ...typography.caption, color: colors.textSecondary, marginTop: 4 },
  foot: { ...typography.caption, color: colors.textSecondary, marginTop: 10 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 8 },
  track: { height: 8, backgroundColor: colors.bgSecondary, borderRadius: 4, overflow: 'hidden', marginTop: 4 },
  fill: { height: 8, backgroundColor: colors.accent },
});
