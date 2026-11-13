import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { Screen, Panel, StatusPill } from '../components/Basics';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';

export default function AlertDetailScreen() {
  const { params } = useRoute();
  const alert = params?.alert || {};

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View style={{ marginBottom: 12 }}>
          <StatusPill label={`${alert.severity} ALERT`} severity={alert.severity} />
        </View>

        <Panel>
          <Field label="WHAT" value={alert.what} />
          <Field label="WHERE" value={alert.where} />
          <Field label="LOAD" value={alert.load} />
          <Field label="DETECTED" value={alert.when ? new Date(alert.when).toLocaleString() : '--'} />
          <Field
            label="HEALTH AT EVENT"
            value={alert.healthScoreAtEvent != null ? `${alert.healthScoreAtEvent} / 100` : 'N/A'}
          />
          <Field label="WHY" value={alert.why} last />
        </Panel>

        <Panel style={{ marginTop: 16, borderColor: colors.accent }}>
          <Text style={styles.actionLabel}>SUGGESTED ACTION</Text>
          <Text style={styles.actionText}>{alert.action}</Text>
        </Panel>
      </ScrollView>
    </Screen>
  );
}

function Field({ label, value, last }) {
  return (
    <View style={[styles.fieldRow, !last && styles.fieldBorder]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value ?? '--'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fieldRow: { paddingVertical: 10 },
  fieldBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  fieldLabel: { ...typography.metricLabel, color: colors.textSecondary, marginBottom: 4 },
  fieldValue: { ...typography.body, color: colors.text, lineHeight: 20 },
  actionLabel: { ...typography.metricLabel, color: colors.accentSoft, marginBottom: 6 },
  actionText: { ...typography.body, color: colors.text, lineHeight: 20 },
});
