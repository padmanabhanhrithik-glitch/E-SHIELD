import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { Screen, Panel, DemoModeBanner, EmptyState, StatusPill } from '../components/Basics';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { useAppState } from '../hooks/useAppState';
import { generateDemoAlerts } from '../services/demoSimulator';
import { backend } from '../services/backendService';

export default function NotificationsScreen() {
  const { demoMode } = useAppState();
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (demoMode) {
      setItems(generateDemoAlerts());
      return;
    }
    backend
      .alerts()
      .then((res) => setItems(res.alerts || []))
      .catch((err) => setError(err.message));
  }, [demoMode]);

  return (
    <Screen>
      <DemoModeBanner visible={demoMode} />
      {error && !demoMode ? (
        <EmptyState title="Backend unavailable" subtitle={error} />
      ) : items.length === 0 ? (
        <EmptyState title="No notifications" />
      ) : (
        <FlatList
          contentContainerStyle={{ padding: 16 }}
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <NotificationRow item={item} />}
        />
      )}
    </Screen>
  );
}

function NotificationRow({ item }) {
  return (
    <Panel style={[styles.row, !item.read && styles.unread]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <StatusPill label={item.severity} severity={item.severity} />
        {!item.read && <View style={styles.unreadDot} />}
      </View>
      <Text style={styles.title}>{item.what}</Text>
      <Text style={styles.meta}>
        {item.where} • {item.load}
      </Text>
      <Text style={styles.time}>{new Date(item.when).toLocaleString()}</Text>
    </Panel>
  );
}

const styles = StyleSheet.create({
  row: { marginBottom: 10 },
  unread: { borderColor: colors.accent },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accentSoft },
  title: { ...typography.bodyStrong, color: colors.text },
  meta: { ...typography.caption, color: colors.textSecondary, marginTop: 4 },
  time: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
});
