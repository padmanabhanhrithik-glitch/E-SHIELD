import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Screen, Disclaimer } from '../components/Basics';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';

const ITEMS = [
  { label: 'Electrical Health Score', screen: 'HealthScore' },
  { label: 'Predictive Maintenance', screen: 'PredictiveMaintenance' },
  { label: 'Event History', screen: 'EventHistory' },
  { label: 'Remote Protection', screen: 'RemoteProtection' },
  { label: 'Devices & ML Identification', screen: 'Devices' },
  { label: 'Device & Connection Status', screen: 'DeviceStatus' },
  { label: 'System Architecture', screen: 'Architecture' },
  { label: 'Notifications', screen: 'Notifications' },
  { label: 'Settings', screen: 'Settings' },
];

export default function MoreScreen() {
  const navigation = useNavigation();
  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>More</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {ITEMS.map((item) => (
          <Pressable key={item.screen} style={styles.row} onPress={() => navigation.navigate(item.screen)}>
            <Text style={styles.rowText}>{item.label}</Text>
            <Text style={styles.arrow}>→</Text>
          </Pressable>
        ))}
        <Disclaimer />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 12 },
  title: { ...typography.h2, color: colors.text },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 16,
    marginBottom: 10,
  },
  rowText: { ...typography.bodyStrong, color: colors.text },
  arrow: { color: colors.accentSoft, fontSize: 16 },
});
