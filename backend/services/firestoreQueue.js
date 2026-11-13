/**
 * Resilient Firestore writes. Real-time processing must never stop just because
 * Firebase is slow or down: writes are tried with a timeout; on failure they go
 * into a bounded in-memory queue and are retried every few seconds.
 * Documents get a client-generated ID up front so a retried write is idempotent
 * (no duplicate telemetry rows).
 *
 * (In-memory only: if the backend process itself restarts while Firebase is
 * down, queued writes are lost. Live packets keep flowing to the app regardless.)
 */
const { db, isConfigured } = require('../config/firebaseAdmin');

const MAX_QUEUE = 5000;
const WRITE_TIMEOUT_MS = 4000;
const queue = [];
let flushing = false;
let dropped = 0;

const withTimeout = (p) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Firestore write timeout')), WRITE_TIMEOUT_MS))]);

async function execute(op) {
  await withTimeout(db.doc(op.path).set(op.data, op.merge ? { merge: true } : undefined));
}

function enqueue(op) {
  if (queue.length >= MAX_QUEUE) {
    queue.shift();
    dropped += 1;
  }
  queue.push(op);
}

/** collectionPath: e.g. 'telemetry' or 'faultHistory/DEVICE_001/events'. Returns true if written now. */
async function add(collectionPath, data) {
  if (!isConfigured) return false;
  const id = db.collection(collectionPath).doc().id;
  return set(`${collectionPath}/${id}`, data);
}

async function set(path, data, { merge = false } = {}) {
  if (!isConfigured) return false;
  const op = { path, data, merge };
  try {
    await execute(op);
    return true;
  } catch (err) {
    console.warn(`[firestoreQueue] write to ${path} failed, queued for retry: ${err.message}`);
    enqueue(op);
    return false;
  }
}

async function flush() {
  if (flushing || !queue.length || !isConfigured) return;
  flushing = true;
  try {
    while (queue.length) {
      try {
        await execute(queue[0]);
        queue.shift();
      } catch (err) {
        break; // still down; try again next tick
      }
    }
  } finally {
    flushing = false;
  }
}

const timer = setInterval(flush, 5000);
timer.unref();

module.exports = { add, set, flush, stats: () => ({ queued: queue.length, dropped }) };
