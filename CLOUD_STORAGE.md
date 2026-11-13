# E-SHIELD Cloud Storage

LIVE data path:

ESP32 -> POST /api/telemetry/ingest -> Node.js backend -> Firebase Admin SDK -> Cloud Firestore (`telemetry`) -> E-SHIELD app/history

Real ESP32 documents have `source: ESP32`. Simulator documents, when DEMO/MIXED is explicitly enabled, have `source: SIMULATOR`.

Required backend/.env values:
- FIREBASE_PROJECT_ID
- FIREBASE_CLIENT_EMAIL
- FIREBASE_PRIVATE_KEY
- DEVICE_INGEST_SECRET (must match the ESP32)
- ESHIELD_MODE=LIVE

Do not put Firebase Admin service-account credentials in the ESP32 or frontend.
