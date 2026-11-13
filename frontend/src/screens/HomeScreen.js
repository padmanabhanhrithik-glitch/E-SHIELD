import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Screen, Panel, SectionHeader, MetricCard, DemoModeBanner, ModeBadge } from '../components/Basics';
import MlStatusPanel from '../components/MlStatusPanel';
import ConnectionBadge from '../components/ConnectionBadge';
import HealthGauge from '../components/HealthGauge';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { useAppState } from '../hooks/useAppState';
import { useTelemetry } from '../hooks/useTelemetry';
import { calculateHealthScoreFromSample } from '../utils/healthScoreCalc';

export default function HomeScreen() {
  const navigation = useNavigation();
  const { demoMode, isFirebaseConfigured, activeDeviceId } = useAppState();
  const { telemetry, healthScore, connectionStatus, isSimulated } = useTelemetry();

  const computedHealth =
    healthScore ?? (telemetry ? calculateHealthScoreFromSample(telemetry) : { score: null, label: 'UNAVAILABLE', reason: 'Waiting for data…' });

  const connected = connectionStatus === 'CONNECTED';

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={styles.header}>
          <Text style={styles.brand}>E-SHIELD</Text>
          <Text style={styles.subtitle}>Electrical Safety & Early Hazard Detection</Text>
        </View>

        <DemoModeBanner visible={demoMode || isSimulated} />
        {!(demoMode || isSimulated) && (
          <ModeBadge mode={connected ? 'real' : connectionStatus === 'DISCONNECTED' ? 'disconnected' : 'unavailable'} />
        )}

        <View style={styles.connectionRow}>
          <ConnectionBadge label="ESP32" connected={connected} />
          <ConnectionBadge label="FIREBASE" connected={isFirebaseConfigured} />
          <ConnectionBadge label="NETWORK" connected={connectionStatus !== 'BACKEND_UNAVAILABLE'} />
        </View>

        <SectionHeader title="System Health" />
        <Pressable onPress={() => navigation.navigate('HealthScore')}>
          <Panel style={styles.healthCard}>
            <HealthGauge score={computedHealth.score} label={computedHealth.label} />
            <View style={{ flex: 1, marginLeft: 16 }}>
              <Text style={styles.healthCardTitle}>Electrical Health Score</Text>
              <Text style={styles.healthCardReason}>{computedHealth.reason}</Text>
              <Text style={styles.viewMore}>View full breakdown →</Text>
            </View>
          </Panel>
        </Pressable>

        <SectionHeader title="Live Electrical Parameters" />
        {connectionStatus === 'DISCONNECTED' ? (
          <Panel style={{ marginHorizontal: 16, backgroundColor: colors.criticalBg, borderColor: colors.critical }}>
            <Text style={styles.disconnectedTitle}>SENSOR DISCONNECTED</Text>
            <Text style={styles.disconnectedSubtitle}>DATA UNAVAILABLE</Text>
          </Panel>
        ) : (
          <View style={styles.metricsGrid}>
            <MetricCard label="VOLTAGE" value={telemetry?.voltage?.toFixed(1) ?? '--'} unit="V" />
            <MetricCard label="CURRENT" value={telemetry?.current?.toFixed(2) ?? '--'} unit="A" />
            <MetricCard label="POWER" value={telemetry?.power?.toFixed(1) ?? '--'} unit="W" accent />
            <MetricCard label="ENERGY" value={telemetry?.energy?.toFixed(2) ?? '--'} unit="kWh" />
            <MetricCard label="FREQUENCY" value={telemetry?.frequency?.toFixed(2) ?? '--'} unit="Hz" />
            <MetricCard label="POWER FACTOR" value={telemetry?.powerFactor?.toFixed(2) ?? '--'} />
          </View>
        )}

        <SectionHeader title="Device Intelligence" />
        <MlStatusPanel ml={telemetry?.ml} deviceId={activeDeviceId} connectionStatus={connectionStatus} demoMode={demoMode || isSimulated} />

        <SectionHeader title="Quick Access" />
        <View style={styles.quickAccessGrid}>
          <QuickAccessTile
            title="Predictive Maintenance"
            onPress={() => navigation.navigate('PredictiveMaintenance')}
          />
          <QuickAccessTile title="Event History" onPress={() => navigation.navigate('EventHistory')} />
          <QuickAccessTile title="Remote Protection" onPress={() => navigation.navigate('RemoteProtection')} />
          <QuickAccessTile title="Device Status" onPress={() => navigation.navigate('DeviceStatus')} />
        </View>
      </ScrollView>
    </Screen>
  );
}

function QuickAccessTile({ title, onPress }) {
  return (
    <Pressable style={styles.tile} onPress={onPress}>
      <Text style={styles.tileText}>{title}</Text>
      <Text style={styles.tileArrow}>→</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 12 },
  brand: { ...typography.h1, color: colors.text, letterSpacing: 1 },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: 2 },
  connectionRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, marginTop: 14 },
  healthCard: { marginHorizontal: 16, flexDirection: 'row', alignItems: 'center' },
  healthCardTitle: { ...typography.h3, color: colors.text, marginBottom: 4 },
  healthCardReason: { ...typography.body, color: colors.textSecondary },
  viewMore: { ...typography.caption, color: colors.accent, marginTop: 10 },
  disconnectedTitle: { color: colors.critical, ...typography.h3, textAlign: 'center' },
  disconnectedSubtitle: { color: colors.textSecondary, ...typography.caption, textAlign: 'center', marginTop: 4 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 16 },
  quickAccessGrid: { paddingHorizontal: 16 },
  tile: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  tileText: { ...typography.bodyStrong, color: colors.text },
  tileArrow: { color: colors.accent, fontSize: 16 },
});
