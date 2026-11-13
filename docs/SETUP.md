# SETUP.md — Running E-SHIELD from VS Code on macOS

## Prerequisites

- Node.js 18+ (`node -v` to check) — install from https://nodejs.org if needed
- npm (comes with Node.js)
- VS Code
- Expo Go app on your phone (App Store / Play Store) — for running the app
  on your own device
- (Optional, for live mode) A Firebase project — see `FIREBASE_SETUP.md`
- (Optional, for live mode) An MQTT broker if your ESP32 publishes over MQTT
  (e.g. [Mosquitto](https://mosquitto.org/), or a hosted broker like
  HiveMQ Cloud)

No global npm packages are required — everything below uses `npx`/local
`node_modules`.

## 1. Open the project

```bash
cd ~/Downloads
unzip E-SHIELD.zip
cd E-SHIELD
code .
```

## 2. Run in DEMO MODE first (fastest path, no configuration needed)

```bash
cd frontend
npm install
npm start
```

This opens the Expo developer tools in your terminal/browser. Scan the QR
code with the Expo Go app on your phone (same Wi-Fi network as your Mac), or
press `i` / `a` in the terminal for an iOS/Android simulator, or `w` for a
web preview.

The app works fully in this mode — every screen is populated with clearly
labeled DEMO MODE data — because no `frontend/.env` exists yet.

## 3. Run the backend (needed for LIVE MODE)

Open a **new terminal tab** in VS Code (`Cmd+Shift+5` or the `+` button):

```bash
cd backend
npm install
cp .env.example .env
```

Edit `backend/.env` in VS Code and fill in your Firebase Admin credentials
(see `FIREBASE_SETUP.md`). Then:

```bash
npm start
```

You should see:

```
E-SHIELD backend listening on port 4000
```

Check it's alive: open `http://localhost:4000/health` in a browser.

## 4. Point the frontend at your backend

```bash
cd frontend
cp .env.example .env
```

Edit `frontend/.env`:

- Fill in the `EXPO_PUBLIC_FIREBASE_*` values from your Firebase web app
  config (see `FIREBASE_SETUP.md`).
- Set `EXPO_PUBLIC_BACKEND_URL` to your Mac's **local network IP**, not
  `localhost` — your phone needs to reach it over Wi-Fi. Find your IP with:

  ```bash
  ipconfig getifaddr en0
  ```

  Example: `EXPO_PUBLIC_BACKEND_URL=http://192.168.1.50:4000`

Restart the Expo dev server (`Ctrl+C` then `npm start` again) so it picks up
the new `.env` values. Toggle **Demo Mode off** in the app's Settings screen.

## 5. Public web/PWA build

Set `EXPO_PUBLIC_BACKEND_URL` in `frontend/.env` to the public HTTPS backend
URL, then run:

```bash
cd frontend
npm run web:build
npx serve dist -l 8080
```

Deploy the contents of `frontend/dist` to an HTTPS static host. The manifest,
service worker, app icon, splash artwork, and mobile standalone metadata are
included in that directory. The Settings screen includes **Install E-SHIELD**;
on iPhone/iPad, use Safari's Share menu and **Add to Home Screen**.

## 6. Android APK

The Expo project remains on its existing SDK version. After signing in to an
Expo account, create an APK with:

```bash
cd frontend
npx eas-cli@latest login
npx eas-cli@latest build --platform android --profile preview
```

The `production` profile is configured for a store distribution build.

## 7. Run the simulator (test without ESP32 hardware)

Open another terminal tab:

```bash
cd simulator
npm install
cp .env.example .env
```

Edit `simulator/.env` so `DEVICE_INGEST_SECRET` matches the value in
`backend/.env`, and `BACKEND_URL` points at your backend (localhost is fine
here since the simulator runs on the same Mac as the backend).

```bash
npm start
```

Type a scenario name and press Enter at any time to trigger it:

```
NORMAL
WARNING
CRITICAL
DISCONNECT
MAINTENANCE
```

You should see live values update on the Home/Waveform screens in the app
within a couple of seconds.

## 8. Connect real ESP32 hardware

Point your ESP32 firmware at either:

- **HTTP:** `POST http://<your-mac-ip>:4000/api/telemetry/ingest` with header
  `X-Device-Secret: <DEVICE_INGEST_SECRET>` and a JSON body matching the
  schema in the main `README.md`.
- **MQTT:** publish JSON telemetry to `eshield/<deviceId>/telemetry` on the
  broker configured in `backend/.env` (`MQTT_BROKER_URL`).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| App stuck on DEMO MODE banner after toggling it off | `frontend/.env` missing/incorrect, or Expo dev server wasn't restarted after editing `.env` |
| "Backend unavailable" in Alerts/Loads screens | `EXPO_PUBLIC_BACKEND_URL` unreachable from your phone — check it's your Mac's LAN IP, not `localhost`, and both devices are on the same Wi-Fi |
| Backend logs "Firebase Admin is NOT configured" | `backend/.env` missing `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` |
| Push notifications never arrive | Physical device required (not simulator), notification permission must be granted, and FCM/APNs setup completed per `FIREBASE_SETUP.md` |
| `npm install` fails on `frontend` | Delete `frontend/node_modules` and `package-lock.json`, re-run `npm install` |
