import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';

export default function ConnectionBadge({ label, connected }) {
  const color = connected ? colors.safe : colors.critical;
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.state, { color }]}>{connected ? 'CONNECTED' : 'DISCONNECTED'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginRight: 16, marginBottom: 6 },
  dot: { width: 7, height: 7, borderRadius: 3.5, marginRight: 6 },
  label: { color: colors.textSecondary, ...typography.caption, marginRight: 4 },
  state: { ...typography.caption, fontWeight: '700' },
});
