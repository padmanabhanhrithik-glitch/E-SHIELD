# E-SHIELD

**Embedded Signal-based Hazard Isolation & Early Line Detection**

E-SHIELD is the mobile/dashboard companion app for an ESP32-based electrical
safety system. The ESP32 continuously samples AC voltage and current,
performs on-device waveform analysis to catch micro-arcs and wiring faults,
and trips a relay locally in under 15ms when a hazard is confirmed. This repo
is the **software side**: a Node.js backend, a Firebase data/notification
layer, and an Expo React Native app that give you live monitoring, waveform
visualization, alerts, predictive maintenance, and remote protection.

> Hardware/firmware (ESP32 + ACS712 + ZMPT101B + relay) is a separate
> project. This repo assumes that hardware exists and speaks the telemetry
> schema described below — or that you're using the included simulator.

## Project layout

```
E-SHIELD/
├── backend/       Node.js/Express server: MQTT + HTTP telemetry ingest,
│                  alert rule engine, health-score calculation, Firebase
│                  Admin writes, Socket.IO real-time broadcast, relay commands
├── frontend/      Expo React Native app (iOS/Android/Web) — 16 screens
├── firebase/      Firestore security rules, indexes, and Cloud Functions
├── simulator/     Standalone CLI that posts fake telemetry so you can test
│                  the whole app with zero hardware
└── docs/          SETUP.md, FIREBASE_SETUP.md, ARCHITECTURE.md
```

## Quick start (DEMO MODE — no Firebase, no ESP32 required)

The app works out of the box in **DEMO MODE**: it generates realistic,
clearly-labeled simulated telemetry client-side, so you can see every screen
immediately.

```bash
cd frontend
npm install

# Web development server
npm run web

# Production web/PWA export (writes frontend/dist)
npm run web:build

# Mobile (scan the QR code with Expo Go)
npx expo start
```

DEMO MODE is on by default whenever Firebase isn't configured — you'll see a
"DEMO MODE" banner on every screen using simulated data. Toggle it in
**Settings** once you're ready to go live. The same codebase, screens, and
telemetry interface power both the web dashboard and the mobile app — no
separate web build to maintain.

### Installable web app (PWA)

Serve `frontend/dist` over HTTPS in production. The export includes a web app
manifest, PNG app icon, splash artwork, service worker, offline shell caching,
and an **Install E-SHIELD** button in Settings. On iPhone/iPad, use the
browser Share menu and choose **Add to Home Screen**. Android and desktop
Chromium browsers expose the install prompt from a secure origin.

For a local desktop PWA check after building:

```bash
cd frontend
npx serve dist -l 8080
```

For phone testing, deploy `dist` to an HTTPS preview host or use an HTTPS
tunnel. A plain LAN HTTP URL is not sufficient for service workers on mobile.

### Android APK (Expo Application Services)

The checked-in `frontend/eas.json` keeps the current Expo SDK and defines an
APK-producing preview profile:

```bash
cd frontend
npx eas-cli@latest login
npx eas-cli@latest build --platform android --profile preview
```

EAS returns a download URL for the installable APK.

## Full setup (real backend + Firebase + simulator/ESP32)

See **[docs/SETUP.md](docs/SETUP.md)** for exact terminal commands and
**[docs/FIREBASE_SETUP.md](docs/FIREBASE_SETUP.md)** for the Firebase project
walkthrough. Short version:

```bash
# 1. Backend
cd backend
npm install
cp .env.example .env      # fill in your Firebase Admin credentials
npm start                 # listens on http://localhost:4000

# 2. Frontend (new terminal)
cd frontend
npm install
cp .env.example .env      # fill in your Firebase client config + backend URL
npm start

# 3. Simulator (new terminal, optional — lets you test without hardware)
cd simulator
npm install
cp .env.example .env      # must match backend DEVICE_INGEST_SECRET
npm start
```

Then in the simulator terminal, type a scenario and press Enter to trigger
events on demand:

```
NORMAL
WARNING
CRITICAL
DISCONNECT
MAINTENANCE
```

## Real-time data flow

```
ESP32 → Wi-Fi → MQTT/HTTP → Backend → Firebase → Frontend → Dashboard
```

**Safety-critical protection never depends on this chain.** The ESP32 trips
its relay locally, in under 15ms, using only on-device signal analysis. The
chain above is for monitoring, alerts, history, analytics, remote convenience
commands, and reports — never the primary safety mechanism. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Telemetry schema

The backend accepts (only `deviceId` + voltage + current are required —
everything else degrades gracefully if the ESP32 doesn't provide it):

```json
{
  "deviceId": "ESHIELD-NODE-01",
  "locationId": "bedroom",
  "loadId": "ceiling-fan",
  "timestamp": 1737000000000,
  "voltage": 229.8,
  "current": 0.42,
  "power": 94.6,
  "energy": 1.24,
  "frequency": 50.02,
  "powerFactor": 0.92,
  "rmsVoltage": 229.8,
  "rmsCurrent": 0.42,
  "crestFactor": 1.41,
  "thd": 3.2,
  "startupPeak": 1.51,
  "startupDecayTime": 180,
  "anomalyScore": 0.05,
  "waveformSamples": [ /* up to ~128 normalized samples per cycle */ ],
  "status": "ONLINE"
}
```

Post it to `POST /api/telemetry/ingest` with header `X-Device-Secret: <DEVICE_INGEST_SECRET>`,
or publish it as JSON to the MQTT topic `eshield/<deviceId>/telemetry`.

## Alert & health-score logic

Both live in `backend/services/` as plain, explainable code (thresholds,
z-score-style deviation, trend comparison against a learned baseline) — not
a black box. See `alertService.js` and `healthScoreService.js`. The frontend
mirrors a simplified version of the health-score math in
`frontend/src/utils/healthScoreCalc.js` so DEMO MODE can show a real,
telemetry-derived score without needing the backend running.

## Demo mode vs. live mode

- **DEMO MODE** (toggle in Settings): all telemetry is generated by
  `frontend/src/services/demoSimulator.js`, tagged `isSimulated: true`, and
  every screen shows a visible "DEMO MODE" banner. No screen ever silently
  substitutes simulated numbers for real ones.
- **LIVE MODE**: the app subscribes to the backend over Socket.IO and reads
  Firestore directly for alerts/loads. If the ESP32 stops sending data, the
  UI shows **SENSOR DISCONNECTED / DATA UNAVAILABLE** rather than freezing
  or fabricating values.

## Safety disclaimer

E-SHIELD provides monitoring and early-warning analysis. Physical electrical
protection must be implemented using properly rated hardware and installed
according to applicable electrical safety standards. The software does not
by itself guarantee fire prevention.

## Tech choices

- **Frontend: Expo React Native.** Runs on your phone via Expo Go for
  demonstration, and is fully debuggable from VS Code on macOS with
  `npm start` + the Expo dev tools — no native Xcode/Android Studio project
  needed for day-to-day development.
- **Backend: Node.js + Express + Socket.IO + MQTT.js + firebase-admin.**
  Simple, well-documented, and matches the ESP32/MQTT ecosystem this project
  is built around.
- **Charts/waveform: react-native-svg-based custom line chart**, chosen over
  a heavier charting library so the whole frontend installs reliably inside
  Expo Go without extra native linking steps.
