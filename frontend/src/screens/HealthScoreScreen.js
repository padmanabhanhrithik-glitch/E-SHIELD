import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Screen, Panel, SectionHeader, DemoModeBanner } from '../components/Basics';
import HealthGauge from '../components/HealthGauge';
import { colors, colorForHealthLabel } from '../theme/colors';
import { typography } from '../theme/typography';
import { useAppState } from '../hooks/useAppState';
import { useTelemetry } from '../hooks/useTelemetry';
import { calculateHealthScoreFromSample } from '../utils/healthScoreCalc';

const FACTOR_LABELS = {
  voltageStability: 'Voltage Stability',
  currentBehaviour: 'Current Behaviour',
  waveformQuality: 'Waveform Quality',
  startupBehaviour: 'Startup Behaviour',
  faultHistory: 'Fault History',
};

export default function HealthScoreScreen() {
  const { demoMode } = useAppState();
  const { telemetry, healthScore, isSimulated } = useTelemetry();

  const health = healthScore ?? (telemetry ? calculateHealthScoreFromSample(telemetry) : null);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <DemoModeBanner visible={demoMode || isSimulated} />

        <Panel style={styles.gaugeCard}>
          <HealthGauge score={health?.score ?? null} label={health?.label ?? 'UNAVAILABLE'} size={160} />
          <Text style={styles.reason}>{health?.reason ?? 'Waiting for telemetry…'}</Text>
        </Panel>

        <SectionHeader title="Interpretation" />
        <Panel>
          <InterpretationRow range="90–100" label="SAFE" color={colors.safe} />
          <InterpretationRow range="75–89" label="GOOD" color={colors.safe} />
          <InterpretationRow range="50–74" label="WARNING" color={colors.warning} />
          <InterpretationRow range="25–49" label="HIGH RISK" color={colors.critical} />
          <InterpretationRow range="0–24" label="CRITICAL" color={colors.critical} last />
        </Panel>

        <SectionHeader title="Contributing Factors" />
        <Panel>
          {health?.factors &&
            Object.entries(health.factors).map(([key, value], i, arr) => (
              <FactorRow
                key={key}
                label={FACTOR_LABELS[key] || key}
                value={value}
                last={i === arr.length - 1}
              />
            ))}
          {!health?.factors && <Text style={styles.reason}>No factor breakdown available yet.</Text>}
        </Panel>
      </ScrollView>
    </Screen>
  );
}

function InterpretationRow({ range, label, color, last }) {
  return (
    <View style={[styles.interpRow, !last && styles.rowBorder]}>
      <Text style={styles.interpRange}>{range}</Text>
      <Text style={[styles.interpLabel, { color }]}>{label}</Text>
    </View>
  );
}

function FactorRow({ label, value, last }) {
  const displayValue = typeof value === 'number' ? value : 'N/A';
  const color = typeof value === 'number' ? colorForHealthLabel(labelFor(value)) : colors.textSecondary;
  return (
    <View style={[styles.factorRow, !last && styles.rowBorder]}>
      <Text style={styles.factorLabel}>{label}</Text>
      <View style={styles.factorBarTrack}>
        <View
          style={[
            styles.factorBarFill,
            { width: `${typeof value === 'number' ? value : 0}%`, backgroundColor: color },
          ]}
        />
      </View>
      <Text style={[styles.factorValue, { color }]}>{displayValue}</Text>
    </View>
  );
}

function labelFor(score) {
  if (score >= 90) return 'SAFE';
  if (score >= 75) return 'GOOD';
  if (score >= 50) return 'WARNING';
  if (score >= 25) return 'HIGH RISK';
  return 'CRITICAL';
}

const styles = StyleSheet.create({
  gaugeCard: { alignItems: 'center', paddingVertical: 20 },
  reason: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: 14, paddingHorizontal: 10 },
  interpRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  interpRange: { ...typography.body, color: colors.textSecondary },
  interpLabel: { ...typography.bodyStrong },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  factorRow: { paddingVertical: 12 },
  factorLabel: { ...typography.body, color: colors.text, marginBottom: 6 },
  factorBarTrack: { height: 6, borderRadius: 3, backgroundColor: colors.bgSecondary, overflow: 'hidden' },
  factorBarFill: { height: 6, borderRadius: 3 },
  factorValue: { ...typography.caption, marginTop: 4, alignSelf: 'flex-end' },
});
