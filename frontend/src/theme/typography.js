// Typography scale. Uses the platform system font by default; swap fontFamily
// to 'Inter' after loading the font with expo-font / @expo-google-fonts/inter
// if you want the exact recommended typeface.

export const typography = {
  fontFamily: undefined, // undefined = system default (San Francisco / Roboto)
  h1: { fontSize: 28, fontWeight: '700', letterSpacing: 0.2 },
  h2: { fontSize: 20, fontWeight: '700', letterSpacing: 0.2 },
  h3: { fontSize: 16, fontWeight: '600' },
  body: { fontSize: 14, fontWeight: '400' },
  bodyStrong: { fontSize: 14, fontWeight: '600' },
  caption: { fontSize: 12, fontWeight: '500', letterSpacing: 0.4 },
  metricValue: { fontSize: 26, fontWeight: '700' },
  metricLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.8 },
};
