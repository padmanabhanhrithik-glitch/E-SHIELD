import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, TextInput, Pressable, Alert } from 'react-native';
import { signOut } from 'firebase/auth';
import { Screen, Panel, SectionHeader, Disclaimer } from '../components/Basics';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { useAppState } from '../hooks/useAppState';
import { auth } from '../firebase/firebaseConfig';
import { registerForPushNotificationsAsync, EXPO_GO_MESSAGE } from '../services/notificationService';
import PwaInstallButton from '../components/PwaInstallButton';

const NOTIF_DEFAULTS = {
  daily: true,
  weekly: true,
  critical: true,
  maintenance: true,
  connection: true,
};

export default function SettingsScreen() {
  const { demoMode, setDemoMode, activeDeviceId, setActiveDeviceId, isFirebaseConfigured, user } = useAppState();
  const [deviceIdInput, setDeviceIdInput] = useState(activeDeviceId);
  const [notifPrefs, setNotifPrefs] = useState(NOTIF_DEFAULTS);
  const [notifGranted, setNotifGranted] = useState(null);

  function toggleNotifPref(key) {
    setNotifPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleEnableNotifications() {
    const result = await registerForPushNotificationsAsync();
    if (!result.supported && result.environment === 'expo-go') {
      Alert.alert('Not available in Expo Go', EXPO_GO_MESSAGE);
      return;
    }
    if (!result.supported) {
      Alert.alert('Notifications unavailable', result.reason || 'Notifications are not available on this platform.');
      return;
    }
    setNotifGranted(result.granted);
    if (!result.granted) {
      Alert.alert(
        'Notification permission denied',
        'Enable notifications in your device settings to receive E-SHIELD alerts when the app is closed.'
      );
    }
  }

  async function handleSignOut() {
    if (!isFirebaseConfigured) return;
    try {
      await signOut(auth);
    } catch (err) {
      Alert.alert('Sign out failed', err.message);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <SectionHeader title="Demo Mode" />
        <Panel style={styles.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Use simulated data</Text>
            <Text style={styles.rowSubtitle}>
              When ON, all screens show clearly-labeled DEMO MODE telemetry instead of live hardware
              data. Turn this OFF once your ESP32 and backend are running.
            </Text>
          </View>
          <Switch value={demoMode} onValueChange={setDemoMode} trackColor={{ true: colors.accent }} />
        </Panel>

        <SectionHeader title="Connected Device" />
        <Panel>
          <Text style={styles.rowSubtitle}>Node ID this app subscribes to for live telemetry.</Text>
          <TextInput
            style={styles.input}
            value={deviceIdInput}
            onChangeText={setDeviceIdInput}
            autoCapitalize="characters"
            placeholderTextColor={colors.textSecondary}
          />
          <Pressable style={styles.saveButton} onPress={() => setActiveDeviceId(deviceIdInput.trim())}>
            <Text style={styles.saveButtonText}>Save Device ID</Text>
          </Pressable>
        </Panel>

        <SectionHeader title="Notifications" />
        <Panel>
          <NotifToggle
            label="Critical alerts"
            value={notifPrefs.critical}
            onToggle={() => toggleNotifPref('critical')}
          />
          <NotifToggle
            label="Maintenance alerts"
            value={notifPrefs.maintenance}
            onToggle={() => toggleNotifPref('maintenance')}
          />
          <NotifToggle
            label="Connection alerts"
            value={notifPrefs.connection}
            onToggle={() => toggleNotifPref('connection')}
          />
          <NotifToggle label="Daily report" value={notifPrefs.daily} onToggle={() => toggleNotifPref('daily')} />
          <NotifToggle
            label="Weekly report"
            value={notifPrefs.weekly}
            onToggle={() => toggleNotifPref('weekly')}
            last
          />
          <Pressable style={styles.saveButton} onPress={handleEnableNotifications}>
            <Text style={styles.saveButtonText}>
              {notifGranted === false ? 'Permission denied — tap to retry' : 'Enable Push Notifications'}
            </Text>
          </Pressable>
        </Panel>

        <SectionHeader title="Account" />
        <Panel>
          <Text style={styles.rowSubtitle}>
            {isFirebaseConfigured ? user?.email || 'Signed in' : 'Firebase Auth not configured — running unauthenticated in demo mode.'}
          </Text>
          {isFirebaseConfigured && user && (
            <Pressable style={[styles.saveButton, { backgroundColor: colors.critical }]} onPress={handleSignOut}>
              <Text style={styles.saveButtonText}>Sign Out</Text>
            </Pressable>
          )}
        </Panel>

        <SectionHeader title="About E-SHIELD" />
        <Panel>
          <Text style={styles.rowTitle}>Embedded Signal-based Hazard Isolation & Early Line Detection</Text>
          <Text style={styles.rowSubtitle}>Version 1.0.0</Text>
          <PwaInstallButton />
        </Panel>

        <Disclaimer />
      </ScrollView>
    </Screen>
  );
}

function NotifToggle({ label, value, onToggle, last }) {
  return (
    <View style={[styles.rowBetween, !last && styles.rowBorder]}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={value} onValueChange={onToggle} trackColor={{ true: colors.accent }} />
    </View>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowTitle: { ...typography.bodyStrong, color: colors.text, marginBottom: 4 },
  rowSubtitle: { ...typography.caption, color: colors.textSecondary, lineHeight: 16, marginBottom: 10 },
  toggleLabel: { ...typography.body, color: colors.text },
  input: {
    backgroundColor: colors.bgSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    marginBottom: 10,
  },
  saveButton: { backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  saveButtonText: { color: colors.onAccent, ...typography.bodyStrong, fontSize: 13 },
});
