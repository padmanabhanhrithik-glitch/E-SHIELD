// Thin client for the E-SHIELD Node/Express backend (REST + Socket.IO) and,
// where useful, direct Firestore reads. Keeping this in one file makes it
// easy to see exactly which network calls the app makes.

import { io } from 'socket.io-client';
import { Platform } from 'react-native';
import { collection, onSnapshot, orderBy, query, where, limit } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase/firebaseConfig';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

let socket = null;

export function getSocket() {
  if (!BACKEND_URL && Platform.OS !== 'web') {
    throw new Error('EXPO_PUBLIC_BACKEND_URL is required for live device mode.');
  }
  if (!socket) {
    socket = io(BACKEND_URL, { transports: ['websocket'], reconnection: true });
  }
  return socket;
}

export function subscribeToDevice(deviceId, handlers = {}) {
  const s = getSocket();
  s.emit('subscribe', deviceId);
  if (handlers.onTelemetry) s.on('telemetry', handlers.onTelemetry);
  if (handlers.onHealthScore) s.on('healthScore', handlers.onHealthScore);
  if (handlers.onAlert) s.on('alert', handlers.onAlert);
  if (handlers.onDeviceStatus) s.on('deviceStatus', handlers.onDeviceStatus);

  return () => {
    if (handlers.onTelemetry) s.off('telemetry', handlers.onTelemetry);
    if (handlers.onHealthScore) s.off('healthScore', handlers.onHealthScore);
    if (handlers.onAlert) s.off('alert', handlers.onAlert);
    if (handlers.onDeviceStatus) s.off('deviceStatus', handlers.onDeviceStatus);
  };
}

async function apiFetch(path, options = {}) {
  if (!BACKEND_URL && Platform.OS !== 'web') {
    throw new Error('EXPO_PUBLIC_BACKEND_URL is required for live device mode.');
  }
  const res = await fetch(`${BACKEND_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const backend = {
  health: () => apiFetch('/health'),
  deviceStatus: (deviceId) => apiFetch(`/api/devices/${deviceId}/status`),
  latestTelemetry: (deviceId) => apiFetch(`/api/telemetry/${deviceId}/latest`),
  telemetryHistory: (deviceId, rangeHours = 24) =>
    apiFetch(`/api/telemetry/history?deviceId=${deviceId}&rangeHours=${rangeHours}`),
  loads: () => apiFetch('/api/loads'),
  renameLoad: (loadId, patch) =>
    apiFetch(`/api/loads/${loadId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  locationsTree: () => apiFetch('/api/loads/locations/tree'),
  alerts: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/alerts${qs ? `?${qs}` : ''}`);
  },
  markAlertRead: (alertId) => apiFetch(`/api/alerts/${alertId}/read`, { method: 'PATCH' }),
  mlStatus: () => apiFetch('/api/ml/status'),
  mlDevices: () => apiFetch('/api/ml/devices'),
  exportCsvUrl: (deviceId) => `${BACKEND_URL}/api/ml/export.csv${deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : ''}`,
  sendRelayCommand: (payload) =>
    apiFetch('/api/relay/command', { method: 'POST', body: JSON.stringify(payload) }),
};

// Direct Firestore listener helper, used where a simple real-time list is
// more convenient than round-tripping through the backend (e.g. alert feed).
export function listenToAlerts(callback, { limitCount = 50 } = {}) {
  if (!isFirebaseConfigured || !db) return () => {};
  const q = query(collection(db, 'alerts'), orderBy('when', 'desc'), limit(limitCount));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export function listenToLoads(callback) {
  if (!isFirebaseConfigured || !db) return () => {};
  const q = query(collection(db, 'loads'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
