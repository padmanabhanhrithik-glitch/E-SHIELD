import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, colorForSeverity, tintForSeverity } from '../theme/colors';
import { typography } from '../theme/typography';

export function Screen({ children, style }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function Panel({ children, style }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

export function SectionHeader({ title, right }) {
  return (
    <View style={styles.sectionHeaderRow}>
      <Text style={styles.sectionHeaderText}>{title}</Text>
      {right}
    </View>
  );
}

export function StatusPill({ label, severity }) {
  const color = colorForSeverity(severity);
  return (
    <View style={[styles.pill, { borderColor: color, backgroundColor: tintForSeverity(severity) }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

export function MetricCard({ label, value, unit, accent }) {
  return (
    <Panel style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, accent && { color: colors.accent }]}>
        {value}
        {unit ? <Text style={styles.metricUnit}> {unit}</Text> : null}
      </Text>
    </Panel>
  );
}

export function DemoModeBanner({ visible }) {
  if (!visible) return null;
  return (
    <View style={styles.demoBanner}>
      <Text style={styles.demoBannerText}>DEMO MODE — simulated data, not live hardware</Text>
    </View>
  );
}

// Operating-mode badge: 'real' | 'demo' | 'disconnected' | 'unavailable'
const MODE_STYLES = {
  real: { label: 'REAL HARDWARE CONNECTED', fg: colors.safe, bg: colors.safeBg },
  demo: { label: 'DEMO MODE', fg: colors.accent, bg: colors.accentBg },
  disconnected: { label: 'SENSOR DISCONNECTED', fg: colors.critical, bg: colors.criticalBg },
  unavailable: { label: 'DATA UNAVAILABLE', fg: colors.textSecondary, bg: colors.bgSecondary },
};
export function ModeBadge({ mode }) {
  const m = MODE_STYLES[mode];
  if (!m) return null;
  return (
    <View style={[styles.modeBadge, { backgroundColor: m.bg, borderColor: m.fg }]}>
      <View style={[styles.dot, { backgroundColor: m.fg }]} />
      <Text style={[styles.pillText, { color: m.fg, fontWeight: '700' }]}>{m.label}</Text>
    </View>
  );
}

export function Disclaimer() {
  return (
    <Text style={styles.disclaimer}>
      E-SHIELD provides monitoring and early-warning analysis. Physical electrical protection must
      be implemented using properly rated hardware and installed according to applicable electrical
      safety standards.
    </Text>
  );
}

export function EmptyState({ title, subtitle }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgPrimary },
  panel: {
    backgroundColor: colors.panel,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    shadowColor: colors.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    marginTop: 18,
    paddingHorizontal: 16,
  },
  sectionHeaderText: { ...typography.caption, color: colors.textSecondary, textTransform: 'uppercase' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  pillText: { ...typography.caption },
  modeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginHorizontal: 16,
    marginTop: 10,
  },
  metricCard: { flexBasis: '48%', marginBottom: 10 },
  metricLabel: { ...typography.metricLabel, color: colors.textSecondary, marginBottom: 6 },
  metricValue: { ...typography.metricValue, color: colors.text },
  metricUnit: { ...typography.body, color: colors.textSecondary },
  demoBanner: {
    backgroundColor: colors.accentBg,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginHorizontal: 16,
    marginTop: 10,
  },
  demoBannerText: { color: colors.accent, fontWeight: '700', ...typography.caption, textAlign: 'center' },
  disclaimer: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  emptyState: { padding: 24, alignItems: 'center' },
  emptyTitle: { color: colors.text, ...typography.h3, marginBottom: 4 },
  emptySubtitle: { color: colors.textSecondary, ...typography.body, textAlign: 'center' },
});
