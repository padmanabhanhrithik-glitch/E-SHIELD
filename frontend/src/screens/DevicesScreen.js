import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Linking, RefreshControl } from 'react-native';
import { Screen, Panel, SectionHeader, EmptyState, DemoModeBanner } from '../components/Basics';
import { identificationLabel, overallStyle } from '../components/MlStatusPanel';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { useAppState } from '../hooks/useAppState';
import { backend } from '../services/backendService';

export default function DevicesScreen() {
  const { demoMode, activeDeviceId, setActiveDeviceId } = useAppState();
  const [devices, setDevices] = useState([]);
  const [model, setModel] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (demoMode) return;
    setRefreshing(true);
    try {
      const [d, s] = await Promise.all([backend.mlDevices(), backend.mlStatus()]);
      setDevices(d.devices || []);
      setModel(s.model || null);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
    setRefreshing(false);
  }, [demoMode]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}>
        <DemoModeBanner visible={demoMode} />
        {demoMode ? (
          <EmptyState title="DEMO MODE" subtitle="Device intelligence is computed by the backend from LIVE ESP32 data. Turn off demo mode in Settings." />
        ) : (
          <>
            <SectionHeader title="ML Model" />
            <Panel>
              {model?.available ? (
                <>
                  <Text style={styles.strong}>{model.version} · {model.modelType}</Text>
                  <Text style={styles.sub}>Classes: {(model.classes || []).join(', ')}</Text>
                </>
              ) : (
                <>
                  <Text style={[styles.strong, { color: colors.critical }]}>ML MODEL UNAVAILABLE</Text>
                  <Text style={styles.sub}>{model?.error || error || 'Backend not reachable'}</Text>
                </>
              )}
            </Panel>

            <SectionHeader title="Devices" />
            {devices.length === 0 ? (
              <EmptyState title="No devices yet" subtitle={error ? `DATA UNAVAILABLE — ${error}` : 'A device appears here after it sends its first packet.'} />
            ) : (
              devices.map((d) => {
                const o = overallStyle(d.overallStatus);
                const confirmed = d.classificationStatus === 'IDENTIFICATION_CONFIRMED';
                return (
                  <Pressable key={d.deviceId} onPress={() => setActiveDeviceId(d.deviceId)}>
                    <Panel style={[{ marginBottom: 10 }, d.deviceId === activeDeviceId && { borderColor: colors.accent }]}>
                      <View style={styles.head}>
                        <Text style={styles.strong}>{d.deviceId}</Text>
                        <Text style={[styles.conn, { color: d.connected ? colors.safe : colors.critical }]}>
                          ● {d.connected ? 'CONNECTED' : 'SENSOR DISCONNECTED'}
                        </Text>
                      </View>
                      {!d.connected ? (
                        <Text style={styles.sub}>DATA UNAVAILABLE</Text>
                      ) : (
                        <>
                          <Text style={styles.big}>{confirmed ? d.applianceClass : 'UNKNOWN DEVICE'}</Text>
                          <Text style={styles.sub}>
                            {identificationLabel(d.classificationStatus)}
                            {confirmed && typeof d.classificationConfidence === 'number' ? ` · ${(d.classificationConfidence * 100).toFixed(1)}%` : ''}
                          </Text>
                          {d.learningStatus === 'LEARNING' && (
                            <Text style={styles.sub}>LEARNING DEVICE {d.learningProgress?.elapsedSec} / {d.learningProgress?.targetSec} s</Text>
                          )}
                          <Text style={[styles.status, { color: o.fg }]}>{o.label}</Text>
                          <Text style={styles.foot}>{d.mode === 'DEMO' ? 'DEMO DATA' : 'LIVE ESP32 DATA'}</Text>
                        </>
                      )}
                    </Panel>
                  </Pressable>
                );
              })
            )}

            <Pressable style={styles.button} onPress={() => Linking.openURL(backend.exportCsvUrl(activeDeviceId))}>
              <Text style={styles.buttonText}>Export CSV — {activeDeviceId}</Text>
            </Pressable>
            <Pressable style={[styles.button, styles.buttonAlt]} onPress={() => Linking.openURL(backend.exportCsvUrl())}>
              <Text style={[styles.buttonText, { color: colors.accent }]}>Export CSV — all devices</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  strong: { ...typography.bodyStrong, color: colors.text },
  big: { ...typography.h3, color: colors.text, marginTop: 6 },
  sub: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  conn: { ...typography.caption, fontWeight: '700' },
  status: { ...typography.bodyStrong, marginTop: 6 },
  foot: { ...typography.caption, color: colors.textSecondary, marginTop: 6 },
  button: { backgroundColor: colors.accent, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 12 },
  buttonAlt: { backgroundColor: colors.accentBg },
  buttonText: { ...typography.bodyStrong, color: colors.onAccent },
});
