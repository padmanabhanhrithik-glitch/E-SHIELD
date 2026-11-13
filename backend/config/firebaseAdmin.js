/**
 * Firebase Admin SDK initialization.
 *
 * IMPORTANT: This file must only ever run on the backend/server.
 * Never copy service-account credentials into the frontend app.
 *
 * Reads credentials from environment variables (see .env.example).
 * If credentials are missing, the server still boots (so you can develop
 * the UI in DEMO MODE) but every Firestore-backed route will return a
 * clear 503 "Firebase not configured" error instead of crashing.
 */

const admin = require('firebase-admin');

let firebaseApp = null;
let firestoreDb = null;
let messaging = null;
let isConfigured = false;

function initFirebaseAdmin() {
  const {
    FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY,
    FIREBASE_DATABASE_URL,
  } = process.env;

  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    console.warn(
      '[firebaseAdmin] Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY. ' +
        'Backend will run, but Firebase-backed routes are disabled until backend/.env is configured. ' +
        'See docs/FIREBASE_SETUP.md.'
    );
    return;
  }

  try {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        // .env stores literal "\n" — convert back to real newlines
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
      databaseURL: FIREBASE_DATABASE_URL,
    });

    firestoreDb = admin.firestore();
    firestoreDb.settings({ ignoreUndefinedProperties: true });
    messaging = admin.messaging();
    isConfigured = true;

    console.log('[firebaseAdmin] Firebase Admin initialized for project:', FIREBASE_PROJECT_ID);
  } catch (err) {
    console.error('[firebaseAdmin] Failed to initialize Firebase Admin:', err.message);
  }
}

initFirebaseAdmin();

module.exports = {
  admin,
  get db() {
    return firestoreDb;
  },
  get messaging() {
    return messaging;
  },
  get isConfigured() {
    return isConfigured;
  },
};
