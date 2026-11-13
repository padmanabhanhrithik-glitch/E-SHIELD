# E-SHIELD ML — appliance identification + anomaly detection

```
ESP32 (ACS712 + ZMPT101B) ──Wi-Fi/MQTT──► Node backend ──► Python inference service (this folder)
                                             │   ▲                 appliance classifier (scikit-learn)
                                             │   └── result: class / status / confidence / model version
                                             ├── learned-profile anomaly detector (Welford + z-score, in Node)
                                             ├── deterministic safety limits (NOT ML)
                                             └──► Firebase ──► E-SHIELD app (Socket.IO for live, Firestore for history)
```

Two independent functions:

| | Appliance **classification** | Electrical **anomaly detection** |
|---|---|---|
| Learns from | REAL labeled recordings you collect (global, trained offline) | the first 30–60 s of each device (per device, online) |
| Where | `ml/` Python (train + inference service) | `backend/services/ml/anomalyDetector.js` |
| Output | class **or UNKNOWN**, status, confidence | NORMAL / ANOMALY + score |
| Safety limits | — | separate, deterministic: over/under-voltage, overcurrent, overload |

Final `overallStatus`: `NORMAL`, `LEARNING`, `ANOMALY`, `SAFETY_LIMIT_VIOLATION`, `FAULT`, `UNKNOWN_DEVICE`.

> **No model ships with this project and no dataset is pre-filled.** A classifier can only be as good as the real
> recordings you train it on. Until you train one, the app shows `ML MODEL UNAVAILABLE` (never a made-up appliance).
> Learning-phase anomaly detection and safety limits work without any trained model.

## 0. Setup
```bash
cd ml
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## 1. Collect REAL labeled data
Connect the ESP32 (section 8), start the backend in **LIVE** (`ESHIELD_MODE=LIVE`), plug **one** appliance into the node, then:
```bash
python scripts/collect_data.py record --device DEVICE_001 --label CHARGER_90W --minutes 5
```
(or `start` … `stop`). The backend writes `dataset/raw/CHARGER_90W__DEVICE_001__<session>.csv` from the genuine packets;
simulator/DEMO packets are refused. Schema: `dataset/README.md`. Set `DEVICE_INGEST_SECRET` in your shell if the backend uses one.

Recommended per class (chargers 45 W / 68 W / 90 W, LED lamp, fan, laptop charger, …):
- **≥ 5 separate sessions** (unplug/re-plug, different times of day, different outlets/loads). Training splits **by session**, so the test set is recordings the model never saw. Minimum is 3 sessions.
- 5–10 minutes each; for chargers include idle, partial and full load (phone/laptop charging at different levels); for the fan every speed; include the switch-on transient.
- Keep the label naming stable: `CHARGER_45W`, `CHARGER_68W`, `CHARGER_90W`, `LED_LAMP`, `FAN`, `LAPTOP_CHARGER`, …
- Similar-looking appliances (e.g. two chargers with similar draw) may not be separable with only V/I/P/PF/f. That is expected — the system will answer `UNKNOWN` rather than guess. More varied data and (if your firmware provides them) `powerFactor`, `crestFactor`, `thd` help.

## 2. Train
```bash
python scripts/train_model.py
```
Validates and cleans the CSVs, splits by session (train/validation/test), extracts window features (20 packets, stride 5;
mean/std/min/max/range/CV/rate-of-change/slope/start-vs-end transient for voltage, current, power, power factor, frequency,
apparent power and estimated PF — **only channels genuinely present** in your data), trains Random Forest, Gradient Boosting and
SVM, keeps the best on validation macro-F1, calibrates the confidence threshold on validation (floor 0.70, margin ≥ 0.20),
fits out-of-distribution statistics, and saves `models/appliance_classifier_vN/` (+ `models/current.json`).
If a class has < 3 sessions the script stops and tells you which; `--allow-block-split` forces a chronological split inside sessions
(optimistic accuracy — for a first smoke test only).

## 3. Evaluate (independent test set)
```bash
python scripts/evaluate_model.py            # current model, dataset/test/test.csv
python scripts/evaluate_model.py --version appliance_classifier_v1
```
Prints accuracy, precision, recall, F1 (per class + macro), confusion matrix, and the same numbers **with the production
rejection rules** (how often the system answers UNKNOWN). Saved to `models/<version>/evaluation.json`.
Only quote accuracy that this report shows; small test sets are only indicative.

## 4. Run inference (live)
```bash
python inference/server.py         # http://127.0.0.1:5001 ; backend calls POST /predict
```
After retraining: restart it or `curl -X POST localhost:5001/reload`.

A class name is returned **only if** all hold: full 20-packet window with all required channels · window not far outside that
class's training data (out-of-distribution check) · top-1 probability ≥ threshold · top-1 − top-2 ≥ margin.
Otherwise `applianceClass = "UNKNOWN"` with status `INSUFFICIENT_CONFIDENCE` / `OUT_OF_DISTRIBUTION` / `COLLECTING_WINDOW` / `MISSING_INPUT`.
So 51 % vs 49 % is displayed as **UNKNOWN DEVICE**. Threshold: `CLASSIFICATION_CONFIDENCE_THRESHOLD` in `backend/.env` (empty = use the calibrated value in the model metadata).
Model unavailable ⇒ `ML_MODEL_UNAVAILABLE`.

## 5. The 30–60 s learning phase
When a device sends its first packets: `LEARNING DEVICE 37 / 60 seconds` → `MONITORING`. During this time the device's own
normal profile (mean/variance of voltage, current, power via Welford, ranges, duration, model version, recognised class) is built.
It does **not** train the appliance classifier. After learning, each packet is scored `z = (x − mean)/max(std, floor)`;
`ANOMALY` needs |z| ≥ `ANOMALY_Z_THRESHOLD` (3.5) for `ANOMALY_CONSECUTIVE` (2) packets in a row. Profiles are per `deviceId`, persisted to
Firestore `learnedProfiles/<deviceId>`, and reloaded after a backend restart. Relearn: `POST /api/ml/devices/<id>/relearn` (header `X-Device-Secret`).
Change of appliance on a node → relearn (the app warns when the identified class differs from the profile's).

## 6. Firebase layout (adapted to the existing flat collections)
| Path | Content |
|---|---|
| `telemetry/<auto>` | existing packet + `ml{applianceClass, classificationStatus, classificationConfidence, anomalyStatus, anomalyScore, overallStatus, faultType, modelVersion, mode}` |
| `devices/<deviceId>` | latest applianceClass, identificationStatus, confidence, modelVersion, learningStatus/progress, overallStatus, lastSeen, mode |
| `learnedProfiles/<deviceId>` | means, variances, ranges, learning duration, class at learning time, updatedAt |
| `faultHistory/<deviceId>/events/<auto>` | timestamp, class, V/I/P, anomalyScore, faultType, status, z-scores, modelVersion |
| `alerts` | existing rule alerts + `LEARNED_PROFILE_ANOMALY` |
The model itself runs only in the inference service. Firebase Admin credentials stay in `backend/.env`. If Firestore is slow/down, writes are queued and retried (in memory) while live Socket.IO data keeps flowing.

## 7. CSV export
`GET /api/ml/export.csv?deviceId=DEVICE_001&since=<ms>` (also buttons in the app: More → Devices & ML Identification). Columns:
`timestamp,deviceId,mode,applianceClass,voltage,current,power,energy,frequency,powerFactor,classificationConfidence,classificationStatus,anomalyScore,anomalyStatus,overallStatus,faultType,modelVersion` (blank where the hardware doesn't provide a value).
Source is Firestore `telemetry` when configured, otherwise the backend's in-memory buffer.

## 8. Connect the ESP32
POST JSON to `http://<backend>:4000/api/telemetry/ingest` (header `X-Device-Secret`) or publish to MQTT `eshield/<deviceId>/telemetry`:
```json
{"deviceId":"DEVICE_001","timestamp":1790000000000,"voltage":229.8,"current":0.412,"power":61.9,"energy":0.0123,"frequency":50.01,"powerFactor":0.66}
```
`deviceId`, `voltage`, `current` are required; send `power`, `frequency`, `powerFactor` (and `crestFactor`, `thd`) **only if your firmware really computes them**. Never set `isSimulated` on real hardware. Every ESP32 needs its own unique `deviceId`.
Send at a steady rate (≈ every 1–2 s); the classifier window is 20 consecutive packets.

## 9. LIVE vs DEMO
`ESHIELD_MODE=LIVE` (real only) · `DEMO` (simulator only) · `MIXED` (default; each packet labeled by `isSimulated`). Simulated packets are shown as **DEMO DATA**, are never classified as a real appliance, never written to the training set, and never share a profile with LIVE data. The in-app demo (no backend) shows a DEMO MODE notice instead of ML results.

## 10. Run everything
```bash
# terminal 1  (ML)       cd ml && source .venv/bin/activate && python inference/server.py
# terminal 2  (backend)  cd backend && npm install && cp .env.example .env && npm start
# terminal 3  (app)      cd frontend && npm install && npx expo start -c
```
`cd backend && npm test` runs the backend ML/anomaly tests.

## 11. Adding appliances / retraining
Record ≥ 3 (better 5+) sessions of the new appliance with a new label → `python scripts/train_model.py` (creates `appliance_classifier_v2`, old versions kept) →
`python scripts/evaluate_model.py` → restart/reload the inference service. New records store the new `modelVersion`. Roll back: edit `models/current.json`.

## File map
| File | Purpose |
|---|---|
| `scripts/features.py` | shared window feature extraction (train = eval = live) |
| `scripts/collect_data.py` | CLI to label + record real ESP32 data via the backend |
| `scripts/train_model.py` | validate/clean → session split → train/select → calibrate → save versioned model |
| `scripts/evaluate_model.py` | accuracy / P / R / F1 / confusion matrix on the held-out test split |
| `inference/predictor.py` | gated prediction (confidence, margin, out-of-distribution) |
| `inference/server.py` | Flask service used by the backend |
| `dataset/`, `models/` | data (real only) and versioned models |
