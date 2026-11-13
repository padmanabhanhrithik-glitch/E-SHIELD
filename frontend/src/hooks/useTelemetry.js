import { useEffect, useRef, useState } from 'react';
import { useAppState } from './useAppState';
import { subscribeToDevice, backend } from '../services/backendService';
import { generateTelemetryTick } from '../services/demoSimulator';

const CONNECTION_TIMEOUT_MS = 15000;

/**
 * Returns { telemetry, connectionStatus, healthScore } for the active device.
 * - In DEMO MODE: ticks a local simulator every 2s. Data is tagged isSimulated.
 * - In LIVE MODE: subscribes to the backend Socket.IO room for real ESP32 data,
 *   and falls back to polling the REST endpoint if sockets are unavailable.
 * Never silently substitutes simulated data for a live screen — if the device
 * has not sent a packet within CONNECTION_TIMEOUT_MS, connectionStatus becomes
 * 'DISCONNECTED' and callers must show "SENSOR DISCONNECTED / DATA UNAVAILABLE".
 */
export function useTelemetry() {
  const { demoMode, activeDeviceId } = useAppState();
  const [telemetry, setTelemetry] = useState(null);
  const [healthScore, setHealthScore] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('CONNECTING');
  const lastPacketRef = useRef(0);

  useEffect(() => {
    setTelemetry(null);
    setHealthScore(null);
    setConnectionStatus('CONNECTING');

    if (demoMode) {
      const interval = setInterval(() => {
        const tick = generateTelemetryTick(activeDeviceId);
        if (tick) {
          setTelemetry(tick);
          setConnectionStatus('CONNECTED');
          lastPacketRef.current = Date.now();
        } else {
          setConnectionStatus('DISCONNECTED');
        }
      }, 2000);
      return () => clearInterval(interval);
    }

    // --- LIVE MODE ---
    const unsubscribe = subscribeToDevice(activeDeviceId, {
      onTelemetry: (packet) => {
        setTelemetry(packet);
        setConnectionStatus('CONNECTED');
        lastPacketRef.current = Date.now();
      },
      onHealthScore: (hs) => setHealthScore(hs),
    });

    // Fetch the last known packet immediately so the UI isn't blank on open
    backend
      .latestTelemetry(activeDeviceId)
      .then((res) => {
        if (res.latest) {
          setTelemetry(res.latest);
          lastPacketRef.current = res.latest.timestamp;
          setConnectionStatus(res.connection?.connected ? 'CONNECTED' : 'DISCONNECTED');
        } else {
          setConnectionStatus('DISCONNECTED');
        }
      })
      .catch(() => setConnectionStatus('BACKEND_UNAVAILABLE'));

    const watchdog = setInterval(() => {
      if (lastPacketRef.current && Date.now() - lastPacketRef.current > CONNECTION_TIMEOUT_MS) {
        setConnectionStatus('DISCONNECTED');
      }
    }, 3000);

    return () => {
      unsubscribe();
      clearInterval(watchdog);
    };
  }, [demoMode, activeDeviceId]);

  return { telemetry, healthScore, connectionStatus, isSimulated: !!telemetry?.isSimulated };
}
