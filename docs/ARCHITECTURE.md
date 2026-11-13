# ARCHITECTURE.md

## High-level data flow

```
ACS712 (current) ─┐
ZMPT101B (voltage)─┼─► ESP32 ─► Local signal analysis ─► Relay / protection (<15ms, local only)
                    │              │
                    │              └─► Wi-Fi / MQTT ─► Backend (Node.js) ─► Firebase ─► E-SHIELD App
                    │
              (Core 0: sampling + safety)      (Core 1: display + comms)
```

### Why the relay trip never depends on the cloud

The single most important architectural decision in E-SHIELD: **the ESP32's
Core 0 performs signal analysis and relay control entirely on-device.** If
Wi-Fi, MQTT, the backend, or Firebase are all unreachable, the ESP32 still
detects hazardous patterns and trips the relay in under 15ms. The app,
backend, and Firebase exist purely for:

- Live monitoring dashboards
- Push/local alerts and their history
- Electrical Health Score computation and trends
- Predictive maintenance analysis
- Remote convenience commands (isolate/restore) — a *convenience* layer on
  top of, not a replacement for, local protection
- Reports and analytics

This mirrors real electrical-safety engineering practice: the protective
device itself must fail safe independent of any network layer.

## Component responsibilities

| Layer | Responsibility |
|---|---|
| ESP32 firmware (external to this repo) | Sample voltage/current, compute waveform residuals, detect hazards, trip relay locally, publish telemetry |
| `backend/` | Ingest telemetry (HTTP + MQTT), validate it, run the alert rule engine, compute health scores, write to Firestore, broadcast over Socket.IO, send FCM pushes, relay remote commands to the device |
| `firebase/` | Durable storage (Firestore), auth, push notification delivery, security rules, scheduled reports |
| `frontend/` | Visual monitoring, waveform display, alert explanations, predictive maintenance UI, remote protection UI, settings, demo/live mode switch |
| `simulator/` | Stand-in for ESP32 hardware during development/demo — posts the same schema the backend expects |

## Data model (Firestore)

```
users/{userId}
  settings/{settingId}
  fcmTokens/{tokenId}

homes/{homeId}
locations/{locationId}      # floor / room / node in a tree, via parentId
loads/{loadId}               # appliances; includes baselineStartupCurrent
devices/{deviceId}           # ESP32 node metadata (firmware, last seen)

telemetry/{telemetryId}      # backend-write-only
alerts/{alertId}             # backend-write-only, client can mark read
events/{eventId}             # backend-write-only (event history)
healthScores/{scoreId}       # backend-write-only
maintenance/{maintenanceId}  # backend-write-only
notifications/{notificationId}
relayCommands/{commandId}    # client can create, backend/ESP32 executes
```

`locations` supports an arbitrary tree (Home → Floor → Room → Node → Load) by
giving each document a `parentId` pointing at its parent location.

## Alert generation

`backend/services/alertService.js` runs a transparent rule engine per
telemetry packet:

- Voltage surge/sag: ±10% deviation from 230V nominal
- Frequency deviation: >1Hz from 50Hz
- Overcurrent: configurable threshold (default 15A)
- Waveform anomaly / possible micro-arcing: `anomalyScore` thresholds
  (0.4 = WARNING, 0.75 = CRITICAL)
- Startup current drift vs. learned baseline: 15% = INFO, 35% = WARNING

Every alert answers WHAT / WHERE / WHEN / WHICH LOAD / HOW SEVERE / WHY /
WHAT TO DO, per the fields produced by `buildAlert()`.

## Health score

`backend/services/healthScoreService.js` computes a weighted 0–100 score from
five factors derived from actual telemetry — voltage stability, current
behaviour, waveform quality, startup behaviour, and fault history — never a
hard-coded number. See the file for exact weights and formulas.

## Future ML integration path

The current system uses explainable statistics: EMA/baseline learning,
z-score-style deviation, and trend comparison. To move toward ML-based
anomaly detection later, the natural integration point is
`alertService.evaluateTelemetry()` — replace or augment its threshold checks
with a model inference call, while keeping the same alert shape (what/where/
when/why/action) so the rest of the app doesn't need to change.
