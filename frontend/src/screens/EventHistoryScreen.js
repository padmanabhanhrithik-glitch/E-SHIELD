import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { Screen, Panel, DemoModeBanner, EmptyState, StatusPill } from '../components/Basics';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { useAppState } from '../hooks/useAppState';
import { backend } from '../services/backendService';

const RANGES = [
  { label: 'Today', hours: 24 },
  { label: '7 days', hours: 24 * 7 },
  { label: '30 days', hours: 24 * 30 },
];

const DEMO_EVENTS = [
  { id: '1', timestamp: Date.now() - 5 * 60 * 1000, location: 'Kitchen', load: 'Refrigerator', severity: 'WARNING', type: 'Startup current anomaly', health: 68 },
  { id: '2', timestamp: Date.now() - 9 * 60 * 1000, location: 'Bedroom', load: 'Ceiling Fan', severity: 'INFO', type: 'Normal startup', health: 91 },
  { id: '3', timestamp: Date.now() - 90 * 60 * 1000, location: 'Hall', load: 'LED Lamp', severity: 'SAFE', type: 'Normal operation', health: 97 },
  { id: '4', timestamp: Date.now() - 5 * 60 * 60 * 1000, location: 'Bedroom', load: 'Ceiling Fan', severity: 'CRITICAL', type: 'Abnormal current waveform', health: 41 },
];

export default function EventHistoryScreen() {
  const { demoMode } = useAppState();
  const [range, setRange] = useState(RANGES[0]);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (demoMode) {
      setEvents(DEMO_EVENTS);
      return;
    }
    backend
      .alerts({ sinceHours: range.hours })
      .then((res) =>
        setEvents(
          (res.alerts || []).map((a) => ({
            id: a.id,
            timestamp: a.when,
            location: a.where,
            load: a.load,
            severity: a.severity,
            type: a.what,
            health: a.healthScoreAtEvent,
          }))
        )
      )
      .catch((err) => setError(err.message));
  }, [demoMode, range]);

  return (
    <Screen>
      <View style={styles.rangeRow}>
        {RANGES.map((r) => (
          <Pressable
            key={r.label}
            style={[styles.rangeChip, range.label === r.label && styles.rangeChipActive]}
            onPress={() => setRange(r)}
          >
            <Text style={[styles.rangeText, range.label === r.label && styles.rangeTextActive]}>{r.label}</Text>
          </Pressable>
        ))}
      </View>
      <DemoModeBanner visible={demoMode} />

      {error && !demoMode ? (
        <EmptyState title="Backend unavailable" subtitle={error} />
      ) : events.length === 0 ? (
        <EmptyState title="No events in this range" />
      ) : (
        <FlatList
          contentContainerStyle={{ padding: 16 }}
          data={events}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <EventRow event={item} />}
        />
      )}
    </Screen>
  );
}

function EventRow({ event }) {
  return (
    <Panel style={styles.row}>
      <Text style={styles.time}>{new Date(event.timestamp).toLocaleTimeString()}</Text>
      <View style={styles.rowMain}>
        <View style={{ flex: 1 }}>
          <Text style={styles.location}>
            {event.location} • {event.load}
          </Text>
          <Text style={styles.type}>{event.type}</Text>
        </View>
        <StatusPill label={event.severity} severity={event.severity} />
      </View>
      {event.health != null && <Text style={styles.health}>Health: {event.health}</Text>}
    </Panel>
  );
}

const styles = StyleSheet.create({
  rangeRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  rangeChip: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  rangeChipActive: { borderColor: colors.accent, backgroundColor: 'colors.accentBg' },
  rangeText: { ...typography.caption, color: colors.textSecondary },
  rangeTextActive: { color: colors.accentSoft },
  row: { marginBottom: 10 },
  time: { ...typography.caption, color: colors.textSecondary, marginBottom: 6 },
  rowMain: { flexDirection: 'row', alignItems: 'center' },
  location: { ...typography.bodyStrong, color: colors.text },
  type: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  health: { ...typography.caption, color: colors.textSecondary, marginTop: 8 },
});
