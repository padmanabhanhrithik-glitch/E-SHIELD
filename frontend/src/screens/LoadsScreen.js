import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Screen, DemoModeBanner, EmptyState, Panel } from '../components/Basics';
import { colors, colorForSeverity } from '../theme/colors';
import { typography } from '../theme/typography';
import { useAppState } from '../hooks/useAppState';
import { generateDemoLoads } from '../services/demoSimulator';
import { backend, listenToLoads } from '../services/backendService';

export default function LoadsScreen() {
  const navigation = useNavigation();
  const { demoMode } = useAppState();
  const [loads, setLoads] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (demoMode) {
      setLoads(generateDemoLoads());
      setError(null);
      return;
    }

    // Prefer a live Firestore listener; fall back to a one-off REST call.
    const unsub = listenToLoads((docs) => {
      if (docs.length) setLoads(docs);
    });

    backend
      .loads()
      .then((res) => setLoads(res.loads || []))
      .catch((err) => setError(err.message));

    return unsub;
  }, [demoMode]);

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Loads & Appliances</Text>
      </View>
      <DemoModeBanner visible={demoMode} />

      {error && !demoMode ? (
        <EmptyState title="Backend unavailable" subtitle={error} />
      ) : loads.length === 0 ? (
        <EmptyState title="No loads detected yet" subtitle="Loads appear here as E-SHIELD identifies electrical signatures." />
      ) : (
        <FlatList
          contentContainerStyle={{ padding: 16 }}
          data={loads}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable onPress={() => navigation.navigate('LoadDetail', { load: item })}>
              <LoadRow load={item} />
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

function LoadRow({ load }) {
  const isUnknown = load.isUnknown || load.category === 'UNKNOWN';
  const severity = load.status || (load.health >= 90 ? 'SAFE' : load.health >= 50 ? 'WARNING' : 'CRITICAL');

  return (
    <Panel style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.loadName}>{load.name}</Text>
        <Text style={styles.loadMeta}>
          {load.locationName || 'Unassigned location'} • {load.current != null ? `${load.current.toFixed(2)}A` : '--'} •{' '}
          {load.power != null ? `${load.power.toFixed(1)}W` : '--'}
        </Text>
        {isUnknown && <Text style={styles.newSignature}>New electrical signature detected</Text>}
      </View>
      <View style={styles.rightCol}>
        <Text style={[styles.healthValue, { color: colorForSeverity(severity) }]}>{load.health ?? '--'}</Text>
        <Text style={styles.healthLabel}>HEALTH</Text>
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 12 },
  title: { ...typography.h2, color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  loadName: { ...typography.bodyStrong, color: colors.text },
  loadMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 4 },
  newSignature: { ...typography.caption, color: colors.info, marginTop: 4 },
  rightCol: { alignItems: 'center', marginLeft: 12 },
  healthValue: { ...typography.h2 },
  healthLabel: { ...typography.metricLabel, color: colors.textSecondary },
});
