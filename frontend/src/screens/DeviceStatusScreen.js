import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Screen, Panel, SectionHeader, DemoModeBanner } from '../components/Basics';
import ConnectionBadge from '../components/ConnectionBadge';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { useAppState } from '../hooks/useAppState';
import { useTelemetry } from '../hooks/useTelemetry';
import { backend } from '../services/backendService';

export default function DeviceStatusScreen() {
  const { demoMode, activeDeviceId, isFirebaseConfigured } = useAppState();
  const { telemetry, connectionStatus, isSimulated } = useTelemetry();
  const [backendHealth, setBackendHealth] = useState(null);

  useEffect(() => {
    if (demoMode) return;
    backend
      .health()
      .then(setBackendHealth)
      .catch(() => setBackendHealth({ ok: false }));
  }, [demoMode]);

  const connected = connectionStatus === 'CONNECTED';
  const lastPacketAgo = telemetry?.timestamp ? Math.round((Date.now() - telemetry.timestamp) / 1000) : null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <DemoModeBanner visible={demoMode || isSimulated} />

        <SectionHeader title="Connectivity" />
        <Panel>
          <ConnectionBadge label="ESP32" connected={connected} />
          <ConnectionBadge label="Wi-Fi" connected={connected} />
          <ConnectionBadge label="Firebase" connected={isFirebaseConfigured} />
          <ConnectionBadge label="MQTT" connected={!!backendHealth?.mqttConnected} />
          <ConnectionBadge label="Backend" connected={demoMode ? true : !!backendHealth?.ok} />
        </Panel>

        <SectionHeader title="Device Info" />
        <Panel>
          <InfoRow label="Node ID" value={activeDeviceId} />
          <InfoRow label="Last packet" value={lastPacketAgo != null ? `${lastPacketAgo}s ago` : 'N/A'} />
          <InfoRow label="Firmware version" value={telemetry?.firmwareVersion || '1.0.0 (assumed)'} />
          <InfoRow label="Signal strength" value={telemetry?.rssi ? `${telemetry.rssi} dBm` : 'N/A'} last />
        </Panel>

        {connectionStatus === 'DISCONNECTED' && (
          <Panel style={{ marginTop: 16, borderColor: colors.critical }}>
            <Text style={styles.disconnectedTitle}>SENSOR DISCONNECTED</Text>
            <Text style={styles.disconnectedSubtitle}>DATA UNAVAILABLE</Text>
          </Panel>
        )}
      </ScrollView>
    </Screen>
  );
}

function InfoRow({ label, value, last }) {
  return (
    <View style={[styles.infoRow, !last && styles.infoBorder]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  infoBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  infoLabel: { ...typography.body, color: colors.textSecondary },
  infoValue: { ...typography.bodyStrong, color: colors.text },
  disconnectedTitle: { color: colors.critical, ...typography.h3, textAlign: 'center' },
  disconnectedSubtitle: { color: colors.textSecondary, ...typography.caption, textAlign: 'center', marginTop: 4 },
});
