import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { Screen, Panel, SectionHeader, DemoModeBanner } from '../components/Basics';
import ConfirmModal from '../components/ConfirmModal';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { useAppState } from '../hooks/useAppState';
import { backend } from '../services/backendService';

const DEMO_NODES = [
  { id: 'n1', node: 'ESHIELD-NODE-01', location: 'Kitchen', load: 'Refrigerator', relayOn: true },
  { id: 'n2', node: 'ESHIELD-NODE-02', location: 'Bedroom', load: 'Ceiling Fan', relayOn: true },
];

export default function RemoteProtectionScreen() {
  const { demoMode, activeDeviceId } = useAppState();
  const [nodes, setNodes] = useState(DEMO_NODES);
  const [pending, setPending] = useState(null); // { node, action }

  function requestAction(node, action) {
    setPending({ node, action });
  }

  async function confirmAction() {
    const { node, action } = pending;
    setPending(null);

    if (demoMode) {
      setNodes((prev) =>
        prev.map((n) => (n.id === node.id ? { ...n, relayOn: action === 'RESTORE' } : n))
      );
      return;
    }

    try {
      await backend.sendRelayCommand({
        deviceId: node.node || activeDeviceId,
        loadId: node.id,
        action,
        requestedBy: 'app-user',
      });
      setNodes((prev) =>
        prev.map((n) => (n.id === node.id ? { ...n, relayOn: action === 'RESTORE' } : n))
      );
    } catch (err) {
      Alert.alert('Command failed', err.message);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <DemoModeBanner visible={demoMode} />

        <Panel style={{ marginBottom: 16, borderColor: colors.warning }}>
          <Text style={styles.warningText}>
            The physical relay and ESP32 must be correctly wired and configured for remote
            isolation to actually switch power. This screen sends a command — it does not
            guarantee physical isolation if hardware is not installed.
          </Text>
        </Panel>

        {nodes.map((node) => (
          <Panel key={node.id} style={{ marginBottom: 14 }}>
            <Text style={styles.nodeTitle}>
              {node.location} → {node.load}
            </Text>
            <Text style={styles.nodeMeta}>{node.node}</Text>
            <Text style={[styles.relayStatus, { color: node.relayOn ? colors.safe : colors.critical }]}>
              RELAY: {node.relayOn ? 'ON' : 'OFF'}
            </Text>

            <View style={styles.buttonRow}>
              <Pressable
                style={[styles.actionButton, styles.isolateButton, !node.relayOn && styles.disabledButton]}
                disabled={!node.relayOn}
                onPress={() => requestAction(node, 'ISOLATE')}
              >
                <Text style={styles.actionButtonText}>ISOLATE LOAD</Text>
              </Pressable>
              <Pressable
                style={[styles.actionButton, styles.restoreButton, node.relayOn && styles.disabledButton]}
                disabled={node.relayOn}
                onPress={() => requestAction(node, 'RESTORE')}
              >
                <Text style={styles.actionButtonText}>RESTORE LOAD</Text>
              </Pressable>
            </View>
          </Panel>
        ))}
      </ScrollView>

      <ConfirmModal
        visible={!!pending}
        title={pending?.action === 'ISOLATE' ? 'Isolate this load?' : 'Restore this load?'}
        message={
          pending
            ? `Are you sure you want to ${pending.action.toLowerCase()} ${pending.node.location} → ${pending.node.load}? ${
                pending.action === 'ISOLATE'
                  ? 'Electrical isolation will switch the connected relay OFF.'
                  : 'This will switch the connected relay back ON.'
              }`
            : ''
        }
        confirmLabel={pending?.action === 'ISOLATE' ? 'Isolate' : 'Restore'}
        danger={pending?.action === 'ISOLATE'}
        onConfirm={confirmAction}
        onCancel={() => setPending(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  warningText: { ...typography.caption, color: colors.warning, lineHeight: 18 },
  nodeTitle: { ...typography.h3, color: colors.text },
  nodeMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2, marginBottom: 8 },
  relayStatus: { ...typography.bodyStrong, marginBottom: 14 },
  buttonRow: { flexDirection: 'row', gap: 10 },
  actionButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  isolateButton: { backgroundColor: colors.critical },
  restoreButton: { backgroundColor: colors.safe },
  disabledButton: { opacity: 0.35 },
  actionButtonText: { color: colors.onAccent, ...typography.bodyStrong, fontSize: 12 },
});
