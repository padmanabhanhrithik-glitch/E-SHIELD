import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Screen, Panel, SectionHeader, DemoModeBanner, EmptyState, StatusPill } from '../components/Basics';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { useAppState } from '../hooks/useAppState';
import { backend } from '../services/backendService';

// DEMO MODE dataset — mirrors the exact example from the product spec so the
// screen is meaningful without hardware. Clearly separate from live data.
const DEMO_MAINTENANCE = [
  {
    id: 'demo-fan',
    name: 'Ceiling Fan',
    location: 'Bedroom',
    health: 76,
    previousHealth: 84,
    trend: 'Declining',
    startupCurrent: 1.82,
    baseline: 1.51,
    changePct: 20.5,
    risk: 'MEDIUM',
    cause: 'Motor/capacitor degradation',
    recommendation: 'Inspect the fan capacitor and motor condition.',
  },
  {
    id: 'demo-fridge',
    name: 'Refrigerator',
    location: 'Kitchen',
    health: 68,
    previousHealth: 74,
    trend: 'Declining',
    startupCurrent: 2.4,
    baseline: 2.05,
    changePct: 17.1,
    risk: 'MEDIUM',
    cause: 'Possible compressor start-capacitor wear',
    recommendation: 'Monitor startup current; schedule inspection if trend continues.',
  },
  {
    id: 'demo-lamp',
    name: 'LED Lamp',
    location: 'Hall',
    health: 97,
    previousHealth: 97,
    trend: 'Stable',
    startupCurrent: 0.09,
    baseline: 0.09,
    changePct: 0,
    risk: 'LOW',
    cause: 'None detected',
    recommendation: 'No action needed.',
  },
];

function riskSeverity(risk) {
  if (risk === 'HIGH') return 'CRITICAL';
  if (risk === 'MEDIUM') return 'WARNING';
  return 'SAFE';
}

export default function PredictiveMaintenanceScreen() {
  const { demoMode } = useAppState();
  const [records, setRecords] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (demoMode) {
      setRecords(DEMO_MAINTENANCE);
      return;
    }
    // Live mode: derive from /api/loads, which stores baselineStartupCurrent.
    // A full deployment would maintain a dedicated `maintenance` collection
    // updated by the backend; loads is used here as the available source.
    backend
      .loads()
      .then((res) => {
        const mapped = (res.loads || [])
          .filter((l) => l.baselineStartupCurrent)
          .map((l) => ({
            id: l.id,
            name: l.name,
            location: l.locationName || 'Unassigned',
            health: l.health ?? null,
            previousHealth: null,
            trend: 'Unknown',
            startupCurrent: l.lastStartupCurrent ?? null,
            baseline: l.baselineStartupCurrent,
            changePct: l.lastStartupCurrent
              ? ((l.lastStartupCurrent - l.baselineStartupCurrent) / l.baselineStartupCurrent) * 100
              : null,
            risk: 'LOW',
            cause: 'Insufficient trend history yet',
            recommendation: 'Continue monitoring — baseline learning in progress.',
          }));
        setRecords(mapped);
      })
      .catch((err) => setError(err.message));
  }, [demoMode]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <DemoModeBanner visible={demoMode} />

        {error && !demoMode ? (
          <EmptyState title="Backend unavailable" subtitle={error} />
        ) : records.length === 0 ? (
          <EmptyState
            title="Not enough data yet"
            subtitle="Predictive maintenance needs several startup cycles before a baseline can be learned."
          />
        ) : (
          records.map((r) => <MaintenanceCard key={r.id} record={r} />)
        )}
      </ScrollView>
    </Screen>
  );
}

function MaintenanceCard({ record }) {
  return (
    <Panel style={{ marginBottom: 14 }}>
      <View style={styles.headerRow}>
        <Text style={styles.name}>{record.name.toUpperCase()}</Text>
        <StatusPill label={`${record.risk} RISK`} severity={riskSeverity(record.risk)} />
      </View>
      <Text style={styles.location}>{record.location}</Text>

      <View style={styles.metricsRow}>
        <Metric label="Health" value={record.health != null ? `${record.health} / 100` : '--'} />
        <Metric label="Trend" value={record.trend} />
      </View>
      <View style={styles.metricsRow}>
        <Metric label="Startup Current" value={record.startupCurrent != null ? `${record.startupCurrent.toFixed(2)} A` : '--'} />
        <Metric label="Baseline" value={record.baseline != null ? `${record.baseline.toFixed(2)} A` : '--'} />
      </View>
      <View style={styles.metricsRow}>
        <Metric
          label="Change"
          value={record.changePct != null ? `${record.changePct > 0 ? '+' : ''}${record.changePct.toFixed(1)}%` : '--'}
          color={record.changePct > 15 ? colors.warning : colors.text}
        />
      </View>

      <SectionHeader title="Possible Cause" />
      <Text style={styles.body}>{record.cause}</Text>

      <SectionHeader title="Recommendation" />
      <Text style={styles.body}>{record.recommendation}</Text>

      <Text style={styles.disclaimerNote}>
        Wording reflects an early-warning trend, not a guaranteed failure date.
      </Text>
    </Panel>
  );
}

function Metric({ label, value, color }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, color && { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { ...typography.h3, color: colors.text },
  location: { ...typography.caption, color: colors.textSecondary, marginTop: 2, marginBottom: 12 },
  metricsRow: { flexDirection: 'row', marginBottom: 10 },
  metricLabel: { ...typography.metricLabel, color: colors.textSecondary, marginBottom: 4 },
  metricValue: { ...typography.bodyStrong, color: colors.text },
  body: { ...typography.body, color: colors.textSecondary, lineHeight: 20 },
  disclaimerNote: { ...typography.caption, color: colors.textSecondary, marginTop: 12, fontStyle: 'italic' },
});
