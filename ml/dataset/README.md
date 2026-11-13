# Dataset schema

Real, labeled ESP32 measurements only. **Nothing in this folder is pre-filled with invented data.**

## `raw/` — one CSV per recording session
File name: `<APPLIANCE_CLASS>__<DEVICE_ID>__<SESSION_ID>.csv` (written by the backend while a
collection session is active — see `../README.md`).

| column | required | meaning |
|---|---|---|
| timestamp | yes | ms since epoch, from the ESP32 (or backend receive time if the ESP32 sent none) |
| sessionId | yes | one start→stop recording; used to split train/validation/test |
| deviceId | yes | physical node, e.g. DEVICE_001 |
| applianceClass | yes | label you chose, `A-Z 0-9 _` only (e.g. `CHARGER_90W`, `LED_LAMP`, `FAN`) |
| voltage | yes | RMS volts (ZMPT101B) |
| current | yes | RMS amps (ACS712) |
| power | if reported | active power W |
| energy | if reported | cumulative kWh (stored, **not** used as a feature) |
| frequency | if reported | Hz |
| powerFactor | if reported | 0–1 |
| crestFactor, thd | if reported | only if your firmware really computes them |
| sampleNumber | yes | packet counter inside the session |

Columns your firmware doesn't send stay empty. `train_model.py` only uses a channel if it is
≥ 95 % populated in the whole dataset, and the model then *requires* that channel at inference.

## `processed/`, `train/`, `validation/`, `test/`
Written by `scripts/train_model.py`: the session-level split (`*/train.csv` etc.) and the window
feature tables (`processed/features_*.csv`). Regenerated on every training run.
