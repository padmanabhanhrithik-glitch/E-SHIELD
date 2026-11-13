import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Line } from 'react-native-svg';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';

function ShieldLogo({ size = 84 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path
        d="M50 6 L88 20 V48 C88 72 71 90 50 96 C29 90 12 72 12 48 V20 Z"
        fill="none"
        stroke={colors.accentSoft}
        strokeWidth={4}
      />
      <Path
        d="M22 52 H40 L46 38 L56 66 L62 52 H80"
        fill="none"
        stroke={colors.accent}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export default function SplashScreen({ onFinished }) {
  useEffect(() => {
    const t = setTimeout(onFinished, 1100);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={styles.container}>
      <ShieldLogo />
      <Text style={styles.title}>E-SHIELD</Text>
      <Text style={styles.subtitle}>Electrical Safety & Early Hazard Detection</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.h1, color: colors.text, marginTop: 18, letterSpacing: 2 },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 6 },
});
