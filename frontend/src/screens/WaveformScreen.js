import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Screen, Panel, SectionHeader, DemoModeBanner, EmptyState } from '../components/Basics';
import LineChart from '../components/LineChart';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { useAppState } from '../hooks/useAppState';
import { useTelemetry } from '../hooks/useTelemetry';

const CHANNELS = ['Voltage', 'Current', 'Residual'];

export default function WaveformScreen() {
  const { demoMode } = useAppState();
  const { telemetry, connectionStatus, isSimulated } = useTelemetry();
  const [channel, setChannel] = useState('Voltage');

  const samples = telemetry?.waveformSamples;
  const disconnected = connectionStatus === 'DISCONNECTED' || !samples;

  const rms = telemetry?.rmsVoltage ?? telemetry?.voltage;
  const rmsCurrent = telemetry?.rmsCurrent ?? telemetry?.current;

  let chartData = [];
  let chartColor = colors.info;
  if (samples) {
    if (channel === 'Voltage') {
      chartData = samples.map((s) => s * (rms || 230));
      chartColor = colors.accent;
    } else if (channel === 'Current') {
      chartData = samples.map((s) => s * (rmsCurrent || 1) * 1.41);
      chartColor = colors.accentLight;
    } else {
      // Residual = deviation from pure sine shape, exaggerated for visibility
      chartData = samples.map((s, i) => {
        const angle = (i / samples.length) * 2 * Math.PI;
        return (s - Math.sin(angle)) * 100;
      });
      chartColor = colors.warning;
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={styles.header}>
          <Text style={styles.title}>Electrical Waveform</Text>
        </View>
        <DemoModeBanner visible={demoMode || isSimulated} />

        <View style={styles.channelRow}>
          {CHANNELS.map((c) => (
            <Pressable
              key={c}
              style={[styles.channelButton, channel === c && styles.channelButtonActive]}
              onPress={() => setChannel(c)}
            >
              <Text style={[styles.channelText, channel === c && styles.channelTextActive]}>
                {c.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>

        <Panel style={{ marginHorizontal: 16, marginTop: 12 }}>
          {disconnected ? (
            <EmptyState title="SENSOR DISCONNECTED" subtitle="DATA UNAVAILABLE — no live waveform to display." />
          ) : (
            <LineChart data={chartData} height={180} color={chartColor} showZeroLine />
          )}
        </Panel>

        {!disconnected && (
          <>
            <SectionHeader title="Waveform Info" />
            <View style={styles.infoGrid}>
              <InfoTile label="50 Hz REFERENCE" value={`${telemetry?.frequency?.toFixed(2) ?? '--'} Hz`} />
              <InfoTile label="SAMPLING" value="5 kHz" />
              <InfoTile label="PEAK" value={`${(rms ? rms * 1.414 : 0).toFixed(1)} V`} />
              <InfoTile label="RMS" value={`${rms?.toFixed(1) ?? '--'} V`} />
              <InfoTile label="THD" value={telemetry?.thd != null ? `${telemetry.thd.toFixed(1)}%` : 'N/A'} />
              <InfoTile
                label="CREST FACTOR"
                value={telemetry?.crestFactor != null ? telemetry.crestFactor.toFixed(2) : 'N/A'}
              />
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function InfoTile({ label, value }) {
  return (
    <Panel style={styles.infoTile}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </Panel>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 12 },
  title: { ...typography.h2, color: colors.text },
  channelRow: { flexDirection: 'row', paddingHorizontal: 16, marginTop: 14, gap: 8 },
  channelButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  channelButtonActive: { borderColor: colors.accent, backgroundColor: 'colors.accentBg' },
  channelText: { ...typography.caption, color: colors.textSecondary },
  channelTextActive: { color: colors.accentSoft },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 16 },
  infoTile: { flexBasis: '48%', marginBottom: 10 },
  infoLabel: { ...typography.metricLabel, color: colors.textSecondary, marginBottom: 6 },
  infoValue: { ...typography.h3, color: colors.text },
});
