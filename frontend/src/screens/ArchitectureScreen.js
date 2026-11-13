import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import Svg, { Rect, Line, Text as SvgText } from 'react-native-svg';
import { Screen, Panel, SectionHeader } from '../components/Basics';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';

const STAGES = [
  'ACS712 / ZMPT101B Sensors',
  'ESP32 (dual-core)',
  'Local Signal Analysis',
  'Relay / Protection (<15ms)',
  'Wi-Fi / MQTT',
  'Backend (Node.js)',
  'Firebase',
  'E-SHIELD App',
];

export default function ArchitectureScreen() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <SectionHeader title="Signal Path" />
        <Panel>
          <FlowDiagram />
        </Panel>

        <SectionHeader title="ESP32 Dual-Core Split" />
        <Panel style={{ flexDirection: 'row' }}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={styles.coreTitle}>CORE 0</Text>
            <Text style={styles.coreDesc}>Signal processing & safety-critical protection. Trips the relay locally in under 15ms, independent of network connectivity.</Text>
          </View>
          <View style={{ flex: 1, paddingLeft: 8, borderLeftWidth: 1, borderLeftColor: colors.border }}>
            <Text style={styles.coreTitle}>CORE 1</Text>
            <Text style={styles.coreDesc}>Display, Wi-Fi/MQTT communication, and sending telemetry/alerts to the cloud.</Text>
          </View>
        </Panel>

        <SectionHeader title="Design Principle" />
        <Panel>
          <Text style={styles.principle}>
            Firebase, the backend, and the mobile app are for monitoring, alerts, history, analytics
            and remote convenience commands only. The physical emergency trip is performed by the
            ESP32 itself and does not depend on cloud connectivity.
          </Text>
        </Panel>
      </ScrollView>
    </Screen>
  );
}

function FlowDiagram() {
  const width = 320;
  const rowHeight = 42;
  const height = STAGES.length * rowHeight;

  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
      {STAGES.map((stage, i) => {
        const y = i * rowHeight;
        return (
          <React.Fragment key={stage}>
            <Rect
              x={20}
              y={y + 4}
              width={width - 40}
              height={rowHeight - 14}
              rx={6}
              fill={colors.bgSecondary}
              stroke={i === 3 ? colors.critical : colors.border}
              strokeWidth={1}
            />
            <SvgText
              x={width / 2}
              y={y + rowHeight / 2 + 2}
              fill={colors.text}
              fontSize="11"
              textAnchor="middle"
            >
              {stage}
            </SvgText>
            {i < STAGES.length - 1 && (
              <Line
                x1={width / 2}
                y1={y + rowHeight - 10}
                x2={width / 2}
                y2={y + rowHeight + 4}
                stroke={colors.accentSoft}
                strokeWidth={1.5}
              />
            )}
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

const styles = StyleSheet.create({
  coreTitle: { ...typography.metricLabel, color: colors.accentSoft, marginBottom: 6 },
  coreDesc: { ...typography.caption, color: colors.textSecondary, lineHeight: 17 },
  principle: { ...typography.body, color: colors.textSecondary, lineHeight: 20 },
});
