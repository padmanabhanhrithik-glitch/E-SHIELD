import React from 'react';
import { Modal, View, Text, StyleSheet, Pressable } from 'react-native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';

export default function ConfirmModal({ visible, title, message, confirmLabel = 'Confirm', danger, onConfirm, onCancel }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.buttonRow}>
            <Pressable style={[styles.button, styles.cancelButton]} onPress={onCancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.button, danger ? styles.dangerButton : styles.confirmButton]}
              onPress={onConfirm}
            >
              <Text style={styles.confirmText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'colors.overlay', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: colors.panel, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 20 },
  title: { ...typography.h3, color: colors.text, marginBottom: 8 },
  message: { ...typography.body, color: colors.textSecondary, lineHeight: 20, marginBottom: 20 },
  buttonRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  button: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, marginLeft: 10 },
  cancelButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  cancelText: { color: colors.textSecondary, ...typography.bodyStrong },
  confirmButton: { backgroundColor: colors.accent },
  dangerButton: { backgroundColor: colors.critical },
  confirmText: { color: colors.onAccent, ...typography.bodyStrong },
});
