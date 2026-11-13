# E-SHIELD — NEW FAULTSENTINEL PROJECT SETUP

This build is prepared for Firebase project **faultsentinel**.

## 1. Firebase
- Create/register a Web app in Firebase Project Settings.
- Enable Email/Password Authentication.
- Create Firestore Database.
- Deploy the included Firestore rules and indexes with `firebase deploy --only firestore:rules,firestore:indexes`.

## 2. Backend
- Copy `backend/.env.example` to `backend/.env`.
- Fill the three Firebase Admin values from the new project's Service Account.
- Set a random `DEVICE_INGEST_SECRET`.
- Keep `MQTT_ENABLED=false` unless an MQTT broker is intentionally being used.

## 3. Frontend
- Copy `frontend/.env.example` to `frontend/.env`.
- Fill the six public Firebase Web App values.
- Replace `YOUR_MAC_LAN_IP` with the Mac's LAN address (for example, from `ipconfig getifaddr en0`).

## 4. ESP32
- Copy `esp32/src/secrets.h.example` to `esp32/src/secrets.h`.
- Enter the 2.4 GHz Wi-Fi SSID/password, the Mac LAN backend URL on port 4000, and the same device ingest secret as the backend.
- Build/upload with PlatformIO.
- The firmware prints Wi-Fi status and nearby networks when it cannot connect.

## 5. Live data path
ESP32 -> Wi-Fi -> HTTP `/api/telemetry/ingest` -> Node backend -> Firestore + Socket.IO -> E-SHIELD app.

Demo mode is not used by the live ESP32 path. In `ESHIELD_MODE=LIVE`, simulator packets are rejected by the backend.

## Security
The ZIP intentionally contains no Firebase service-account private key, no Wi-Fi password, and no backend `.env`.
