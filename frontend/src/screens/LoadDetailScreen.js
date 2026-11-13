import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, Alert } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { Screen, Panel, SectionHeader } from '../components/Basics';
import { colors, colorForSeverity } from '../theme/colors';
import { typography } from '../theme/typography';
import { useAppState } from '../hooks/useAppState';
import { backend } from '../services/backendService';

export default function LoadDetailScreen() {
  const { params } = useRoute();
  const { demoMode } = useAppState();
  const load = params?.load || {};
  const isUnknown = load.isUnknown || load.category === 'UNKNOWN';

  const [name, setName] = useState(load.name || '');
  const [saving, setSaving] = useState(false);

  async function handleRename() {
    if (!name.trim()) return;
    if (demoMode) {
      Alert.alert('Demo Mode', 'Renaming is simulated only in demo mode and is not persisted.');
      return;
    }
    setSaving(true);
    try {
      await backend.renameLoad(load.id, { name: name.trim(), category: 'IDENTIFIED' });
      Alert.alert('Saved', 'Load renamed successfully.');
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
    }
  }

  const severity = load.status || (load.health >= 90 ? 'SAFE' : load.health >= 50 ? 'WARNING' : 'CRITICAL');

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Panel>
          <Text style={styles.name}>{load.name}</Text>
          <Text style={styles.location}>{load.locationName || 'Unassigned location'}</Text>
          <View style={styles.metricsRow}>
            <Metric label="CURRENT" value={load.current != null ? `${load.current.toFixed(2)} A` : '--'} />
            <Metric label="POWER" value={load.power != null ? `${load.power.toFixed(1)} W` : '--'} />
            <Metric label="HEALTH" value={`${load.health ?? '--'}`} color={colorForSeverity(severity)} />
          </View>
          <Text style={styles.lastSeen}>
            Last seen: {load.lastSeen ? new Date(load.lastSeen).toLocaleTimeString() : 'Unknown'}
          </Text>
        </Panel>

        {isUnknown && (
          <>
            <SectionHeader title="New Electrical Signature Detected" />
            <Panel>
              <Text style={styles.body}>
                This load doesn't match any known appliance profile yet. You can give it a name so
                future alerts reference it correctly.
              </Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Water Heater"
                placeholderTextColor={colors.textSecondary}
              />
              <Pressable style={styles.button} onPress={handleRename} disabled={saving}>
                <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save Name'}</Text>
              </Pressable>
            </Panel>
          </>
        )}

        <SectionHeader title="Anomaly Level" />
        <Panel>
          <Text style={styles.body}>{load.anomalyLevel || 'NONE'}</Text>
        </Panel>
      </ScrollView>
    </Screen>
  );
}

function Metric({ label, value, color }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={[styles.metricValue, color && { color }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  name: { ...typography.h2, color: colors.text },
  location: { ...typography.body, color: colors.textSecondary, marginTop: 2 },
  metricsRow: { flexDirection: 'row', marginTop: 16 },
  metricValue: { ...typography.h3, color: colors.text },
  metricLabel: { ...typography.metricLabel, color: colors.textSecondary, marginTop: 4 },
  lastSeen: { ...typography.caption, color: colors.textSecondary, marginTop: 14 },
  body: { ...typography.body, color: colors.textSecondary, lineHeight: 20, marginBottom: 12 },
  input: {
    backgroundColor: colors.bgSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    marginBottom: 12,
  },
  button: { backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: colors.onAccent, ...typography.bodyStrong },
});
