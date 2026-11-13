// E-SHIELD color system.
// Purple is reserved for branding/navigation/analytics — NOT general UI decoration.
// Green/Amber/Red/Blue always carry the same electrical-safety meaning everywhere.

export const colors = {
  bgPrimary: '#F7F9FC', // page background
  bgSecondary: '#EEF3F8', // secondary surface / inputs
  panel: '#FFFFFF', // cards

  accent: '#4F46E5', // primary (indigo) — actions, active nav
  accentSoft: '#6366F1',
  accentLight: '#8B5CF6',
  accentBg: '#EEF2FF', // selected / secondary button background

  safe: '#16A34A', // SAFE / healthy
  safeBg: '#DCFCE7',
  warning: '#F59E0B', // WARNING
  warningBg: '#FEF3C7',
  critical: '#DC2626', // CRITICAL
  criticalBg: '#FEE2E2',
  info: '#2563EB', // INFORMATION / telemetry
  infoBg: '#DBEAFE',

  text: '#172033',
  textSecondary: '#5B6475',
  border: '#D9E1EA',
  onAccent: '#FFFFFF', // text on filled buttons
  overlay: 'rgba(23,32,51,0.45)',
  shadow: '#172033',
};

export function tintForSeverity(severity) {
  switch (severity) {
    case 'CRITICAL':
      return colors.criticalBg;
    case 'WARNING':
      return colors.warningBg;
    case 'INFO':
      return colors.infoBg;
    case 'SAFE':
    case 'GOOD':
      return colors.safeBg;
    default:
      return colors.bgSecondary;
  }
}

export function colorForSeverity(severity) {
  switch (severity) {
    case 'CRITICAL':
      return colors.critical;
    case 'WARNING':
      return colors.warning;
    case 'INFO':
      return colors.info;
    case 'SAFE':
    case 'GOOD':
      return colors.safe;
    default:
      return colors.textSecondary;
  }
}

export function colorForHealthLabel(label) {
  switch (label) {
    case 'SAFE':
      return colors.safe;
    case 'GOOD':
      return colors.safe;
    case 'WARNING':
      return colors.warning;
    case 'HIGH RISK':
      return colors.critical;
    case 'CRITICAL':
      return colors.critical;
    default:
      return colors.textSecondary;
  }
}
