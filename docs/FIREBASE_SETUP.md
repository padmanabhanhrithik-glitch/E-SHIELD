# FIREBASE_SETUP.md

## 1. Create a Firebase project

1. Go to https://console.firebase.google.com and click **Add project**.
2. Name it (e.g. `faultsentinel`), disable Google Analytics if you don't need
   it, and create the project.

## 2. Enable Authentication

1. In the console: **Build → Authentication → Get started**.
2. Enable the **Email/Password** sign-in method (the app's Login screen uses
   this). Add other providers later if you want.

## 3. Configure Firestore

1. **Build → Firestore Database → Create database**.
2. Choose **Production mode** (the included security rules lock it down
   properly — see step 7).
3. Pick a region close to you.

Collections are created automatically the first time the backend writes to
them (`telemetry`, `alerts`, `loads`, `locations`, `relayCommands`, etc.) —
you don't need to create them manually.

## 4. Configure Cloud Messaging (push notifications)

1. **Build → Cloud Messaging**. No extra setup is required for Android.
2. For iOS push notifications, you'll need an Apple Developer account: upload
   your APNs authentication key under **Project Settings → Cloud Messaging →
   Apple app configuration**. (You can skip this for Android-only/Expo Go
   testing — Android push works without it.)

## 5. Create app credentials

### Web/client app (used by the Expo frontend)

1. **Project Settings (gear icon) → General → Your apps → Add app → Web**.
2. Register the app (nickname: `eshield-frontend`).
3. Copy the `firebaseConfig` object values into `frontend/.env`:

   ```
   EXPO_PUBLIC_FIREBASE_API_KEY=...
   EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=...
   EXPO_PUBLIC_FIREBASE_PROJECT_ID=...
   EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=...
   EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
   EXPO_PUBLIC_FIREBASE_APP_ID=...
   ```

   These are public client identifiers — safe to ship in the app binary.

### Service account (used by the backend — KEEP SECRET)

1. **Project Settings → Service Accounts → Generate new private key**.
2. This downloads a JSON file. **Never commit this file or put it in the
   frontend.** Open it and copy three fields into `backend/.env`:

   ```
   FIREBASE_PROJECT_ID=<project_id from the JSON>
   FIREBASE_CLIENT_EMAIL=<client_email from the JSON>
   FIREBASE_PRIVATE_KEY="<private_key from the JSON, keep the \n escapes>"
   ```

   The private key in the JSON contains literal `\n` sequences — paste it
   exactly as-is, wrapped in double quotes, into the `.env` file.

3. Delete the downloaded JSON file once you've copied the values (or store
   it somewhere outside the repo, e.g. a password manager) — `.gitignore`
   already excludes `serviceAccountKey.json` and `*.json` service account
   patterns, but it's safest not to leave it on disk at all.

## 6. Configure environment variables

Summary of where each value goes:

| File | Contains |
|---|---|
| `backend/.env` | Service-account credentials (secret), MQTT broker config, device ingest secret |
| `frontend/.env` | Public web app config, backend URL |

Both have `.env.example` templates — copy and fill them in, never commit the
real `.env` files (already covered by `.gitignore`).

## 7. Deploy Firestore rules and indexes

Install the Firebase CLI once, globally or via `npx`:

```bash
npm install -g firebase-tools   # or prefix every command below with npx
firebase login
cd E-SHIELD
firebase use faultsentinel
firebase deploy --only firestore:rules,firestore:indexes
```

This applies `firebase/firestore.rules` and `firebase/firestore.indexes.json`.

## 8. Deploy Cloud Functions (optional but recommended)

```bash
cd firebase/functions
npm install
cd ../..
firebase deploy --only functions
```

This deploys `onAlertCreated` (FCM safety-net push) and `dailyHealthReport`
(scheduled daily summary notification).

## 9. Start the backend

```bash
cd backend
npm install
npm start
```

## 10. Start the frontend

```bash
cd frontend
npm install
npm start
```

Toggle **Demo Mode off** in the app's Settings screen once both are running
and `frontend/.env` / `backend/.env` are filled in.

## Security notes

- The service-account private key (`backend/.env`) must never reach the
  frontend, a public repo, or client-side logs.
- `firebase/firestore.rules` denies direct client writes to `telemetry`,
  `alerts`, `events`, `healthScores`, and `maintenance` — only the backend
  (via the Admin SDK, which bypasses rules) can write these. Clients can only
  mark an alert/notification as read.
- Every Firestore read requires `request.auth != null` — no anonymous public
  read access.


## Automatic ESP32 telemetry storage

In LIVE mode, every accepted real ESP32 packet sent to `POST /api/telemetry/ingest` is written by the backend Firebase Admin SDK to the Firestore `telemetry` collection. Each stored document includes `source: "ESP32"` and a server-side `receivedAt` timestamp. Temporary Firestore failures are queued and retried by the backend. Firebase Admin credentials must be configured in `backend/.env`; credentials are never placed in the ESP32 firmware or frontend.
