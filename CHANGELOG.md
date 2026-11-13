# CHANGELOG — Expo SDK 57 / Expo Go fix

## Expo SDK 51 → 57 (frontend/package.json)
expo ~57.0.24, react / react-dom 19.2.3, react-native 0.86.3, @expo/metro-runtime ~57.0.16,
expo-notifications ~57.0.20, expo-status-bar ~57.0.1, expo-constants ~57.0.19 (new, used for Expo Go detection),
expo-splash-screen ~57.0.9 (new, required for splash config in SDK 55+), react-native-gesture-handler ~2.32.0,
react-native-safe-area-context ~5.7.0, react-native-screens ~4.26.0, react-native-svg 15.15.4,
react-native-web ~0.21.0, @react-native-async-storage/async-storage 2.2.0,
@react-navigation/* 6 → 7 (React 19 support), firebase 10 → 12.
Versions taken from SDK 57's bundledNativeModules.json. package-lock.json regenerated. No `npm audit fix --force`.

## Entry point
Added frontend/index.js (registerRootComponent) and set "main": "index.js" (AppEntry.js is deprecated).

## Notifications (the crash)
- notificationService.js no longer imports expo-notifications at top level. Importing it in Expo Go (SDK 53+) is what
  called addPushTokenListener and threw "runtime not ready".
- New environment detection: web / expo-go / development-build / production.
- Expo Go: module is never loaded; registerForPushNotificationsAsync() returns
  { supported: false, reason: "Remote push notifications are unavailable in Expo Go" }.
- Dev/production builds: permission request, Android channel, and Expo push token (needs EAS projectId in app.json
  extra.eas.projectId) — all wrapped in try/catch so failures never propagate.
- Handler updated to SDK 57 flags (shouldShowBanner / shouldShowList).
- App.js: notification init is fire-and-forget with .catch — app always renders.
- SettingsScreen: in Expo Go shows "Remote push notifications require an E-SHIELD development build."

## app.json
Removed the top-level "splash" key (rejected in SDK 55+). Migrated to the ["expo-splash-screen", {backgroundColor: "#0B0F14"}]
plugin, keeping the dark appearance. Removed obsolete assetBundlePatterns.

## Untouched
Backend, Firebase (client + Admin + functions), MQTT, simulator, demo/real separation, all screens and dark theme.

## Run
    cd frontend
    npm install
    npx expo start -c

## Light theme (single theme, no dark mode)
- theme/colors.js: new light palette (#F7F9FC page, #EEF3F8 secondary, #FFFFFF cards, #4F46E5 primary, #6366F1 / #8B5CF6 accents,
  #172033 text, #5B6475 secondary text, #D9E1EA borders) plus light tint tokens for safe / warning / critical / info.
  Every screen reads from this file, so all screens, cards, forms, settings, login, alerts, notifications and empty states switch together.
- Cards: white, soft border, subtle shadow. Status pills use light tinted fills. Filled buttons use white text.
- Navigation: white tab bar / headers, indigo active tab with #EEF2FF background, light navigation theme, dark status bar text.
- Waveform: white chart panel, light grid, Voltage = indigo, Current = purple, Residual = orange.
- New ModeBadge on Home: REAL HARDWARE CONNECTED (green) / SENSOR DISCONNECTED (red) / DATA UNAVAILABLE (grey); DEMO MODE banner is indigo.
  Sensor-disconnected card is light red. No fake values are generated in real mode.
- Splash / app.json: light background (#F7F9FC), userInterfaceStyle "light". Modal overlay is a translucent slate instead of black.
- No dark colors (#0B0F14, #111820, #17212B, #000) remain in src/ or app.json.

## ML appliance identification + anomaly detection
See `ml/README.md`. New: `ml/` (training, evaluation, data collection, Flask inference service), `backend/services/ml/*`,
`backend/services/firestoreQueue.js`, `backend/routes/ml.js`, `backend/test/ml.test.js`, frontend `MlStatusPanel`, `DevicesScreen`.
Modified: `backend/services/telemetryService.js`, `backend/server.js`, `backend/.env.example`, `firebase/firestore.rules`, `.gitignore`,
`frontend/src/{services/backendService.js, screens/HomeScreen.js, screens/MoreScreen.js, navigation/RootNavigator.js}`.
No package/SDK versions changed; no new npm dependencies. No model or training data is shipped.
