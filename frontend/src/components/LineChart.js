import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Polyline, Line, Text as SvgText } from 'react-native-svg';
import { colors } from '../theme/colors';

/**
 * Minimal dependency-free line chart. Good enough for waveform display and
 * simple trend lines. `data` is an array of numbers; `referenceLine` (0-1
 * fraction of height) optionally draws a horizontal reference (e.g. 0V axis).
 */
export default function LineChart({
  data = [],
  height = 160,
  color = colors.accent,
  showZeroLine = false,
  min,
  max,
}) {
  const [width, setWidth] = React.useState(0);

  if (!data.length || width === 0) {
    return <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} />;
  }

  const dataMin = min ?? Math.min(...data);
  const dataMax = max ?? Math.max(...data);
  const range = dataMax - dataMin || 1;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - dataMin) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const zeroY = height - ((0 - dataMin) / range) * height;

  return (
    <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Svg width={width} height={height}>
        {[0.25, 0.5, 0.75].map((f) => (
          <Line key={f} x1={0} y1={height * f} x2={width} y2={height * f} stroke={colors.bgSecondary} strokeWidth={1} />
        ))}
        {showZeroLine && zeroY >= 0 && zeroY <= height && (
          <Line x1={0} y1={zeroY} x2={width} y2={zeroY} stroke={colors.border} strokeWidth={1} strokeDasharray="4,4" />
        )}
        <Polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      </Svg>
    </View>
  );
}
