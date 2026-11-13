import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors, colorForHealthLabel } from '../theme/colors';
import { typography } from '../theme/typography';

export default function HealthGauge({ score, label, size = 140, strokeWidth = 12 }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = score === null || score === undefined ? 0 : score / 100;
  const dashOffset = circumference * (1 - pct);
  const color = colorForHealthLabel(label);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.border}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={styles.centerLabel}>
        <Text style={[styles.scoreText, { color }]}>{score ?? '--'}</Text>
        <Text style={styles.maxText}>/ 100</Text>
        <Text style={[styles.labelText, { color }]}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centerLabel: { position: 'absolute', alignItems: 'center' },
  scoreText: { fontSize: 34, fontWeight: '700' },
  maxText: { color: colors.textSecondary, fontSize: 12, marginTop: -2 },
  labelText: { ...typography.caption, marginTop: 4, fontWeight: '700' },
});
