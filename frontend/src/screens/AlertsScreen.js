import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Screen, DemoModeBanner, EmptyState, Panel, StatusPill } from '../components/Basics';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { useAppState } from '../hooks/useAppState';
import { generateDemoAlerts } from '../services/demoSimulator';
import { backend, listenToAlerts } from '../services/backendService';

const FILTERS = ['ALL', 'CRITICAL', 'WARNING', 'INFO'];

export default function AlertsScreen() {
  const navigation = useNavigation();
  const { demoMode } = useAppState();
  const [alerts, setAlerts] = useState([]);
  const [filter, setFilter] = useState('ALL');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (demoMode) {
      setAlerts(generateDemoAlerts());
      setError(null);
      return;
    }

    const unsub = listenToAlerts((docs) => {
      if (docs.length) setAlerts(docs);
    });

    backend
      .alerts()
      .then((res) => setAlerts(res.alerts || []))
      .catch((err) => setError(err.message));

    return unsub;
  }, [demoMode]);

  const filtered = filter === 'ALL' ? alerts : alerts.filter((a) => a.severity === filter);

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Alerts</Text>
      </View>
      <DemoModeBanner visible={demoMode} />

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <Pressable key={f} style={[styles.filterChip, filter === f && styles.filterChipActive]} onPress={() => setFilter(f)}>
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>{f}</Text>
          </Pressable>
        ))}
      </View>

      {error && !demoMode ? (
        <EmptyState title="Backend unavailable" subtitle={error} />
      ) : filtered.length === 0 ? (
        <EmptyState title="No alerts" subtitle="You're all caught up." />
      ) : (
        <FlatList
          contentContainerStyle={{ padding: 16 }}
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable onPress={() => navigation.navigate('AlertDetail', { alert: item })}>
              <AlertRow alert={item} />
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

function AlertRow({ alert }) {
  return (
    <Panel style={[styles.row, !alert.read && styles.unreadRow]}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
          <StatusPill label={alert.severity} severity={alert.severity} />
        </View>
        <Text style={styles.what}>{alert.what}</Text>
        <Text style={styles.meta}>
          {alert.where} • {alert.load}
        </Text>
        <Text style={styles.time}>{new Date(alert.when).toLocaleString()}</Text>
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 12 },
  title: { ...typography.h2, color: colors.text },
  filterRow: { flexDirection: 'row', paddingHorizontal: 16, marginTop: 12, gap: 8 },
  filterChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  filterChipActive: { borderColor: colors.accent, backgroundColor: 'colors.accentBg' },
  filterText: { ...typography.caption, color: colors.textSecondary },
  filterTextActive: { color: colors.accent, fontWeight: '700' },
  row: { marginBottom: 10 },
  unreadRow: { borderColor: colors.accent },
  what: { ...typography.bodyStrong, color: colors.text },
  meta: { ...typography.caption, color: colors.textSecondary, marginTop: 4 },
  time: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
});
