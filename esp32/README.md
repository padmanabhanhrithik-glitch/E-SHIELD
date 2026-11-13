# E-SHIELD ESP32 Firmware

Real-hardware replacement for the telemetry simulator. This firmware reads
actual voltage/current from ZMPT101B + ACS712, computes RMS/power/waveform
metrics on-device, and sends telemetry to your **existing** backend in the
**existing** schema — no backend or app changes required.

The simulator (`simulator/simulate.js`) is untouched and still works for
software-only testing; this firmware is a second, independent telemetry
source tagged `isSimulated: false`.

## 1. What was inspected in your project, and what was changed

Inspected: `backend/server.js`, `backend/routes/telemetry.js`,
`backend/services/telemetryService.js`, `backend/mqtt/mqttClient.js`,
`backend/routes/relay.js`, `backend/services/alertService.js`,
`backend/services/healthScoreService.js`, `simulator/simulate.js`,
`frontend/src/hooks/useTelemetry.js`, `frontend/src/services/backendService.js`,
`frontend/src/screens/WaveformScreen.js`, all `.env.example` files, and
`docs/ARCHITECTURE.md`.

Findings relevant to this integration:

| Item | Existing value |
|---|---|
| HTTP ingest endpoint | `POST /api/telemetry/ingest` |
| Auth header | `X-Device-Secret: <DEVICE_INGEST_SECRET>` |
| Min required fields | `deviceId`, (`voltage` or `rmsVoltage`), (`current` or `rmsCurrent`) |
| MQTT telemetry topic | `eshield/<deviceId>/telemetry` |
| MQTT status topic | `eshield/<deviceId>/status` |
| MQTT relay command topic | `eshield/<deviceId>/relay/cmd`, body `{action, loadId}` |
| Socket.IO events broadcast | `telemetry`, `healthScore`, `alert`, `deviceStatus` |
| Default deviceId/loadId/locationId | `ESHIELD-NODE-01` / `demo-ceiling-fan` / `demo-bedroom` (from `simulator/.env.example`) |
| `waveformSamples` convention | Normalized values (~[-1, 1]); frontend reconstructs instantaneous voltage as `sample * rmsVoltage` (see `WaveformScreen.js`) |
| Simulated/live separation | `isSimulated` boolean; frontend never mixes the two (`useTelemetry.js`) |

**Files changed:** none, outside this new `esp32/` folder. No backend route,
service, schema, or frontend file was modified — the firmware was written to
match what already exists.

**Files added:**
- `esp32/platformio.ini`
- `esp32/src/main.cpp`
- `esp32/README.md` (this file)

## 2. Wiring table (low-voltage / logic side only)

| Signal | ESP32 pin |
|---|---|
| ACS712 analog out | GPIO 34 (ADC1_CH6) |
| ZMPT101B analog out | GPIO 35 (ADC1_CH7) |
| OLED SDA | GPIO 21 |
| OLED SCL | GPIO 22 |
| OLED I2C address | 0x3C |
| Green LED | GPIO 26 (+ series resistor, e.g. 220Ω) |
| Red LED | GPIO 27 (+ series resistor) |
| Buzzer | GPIO 25 |
| Relay module IN (optional) | GPIO 33 — only wire this if you actually have a relay module connected. Set `RELAY_CONNECTED = true` in firmware only then. |

**Mains-side wiring (ZMPT101B/ACS712 primary, the actual AC connection) is
not covered here** — that requires proper isolation, an enclosure, and
someone competent working with live mains. This firmware only concerns the
3.3V logic side.

The ESP32 ADC is a 3.3V device. Confirm your specific ZMPT101B and ACS712
module variants output within 0–3.3V (most module boards with onboard op-amp
bias circuits do, but verify with a multimeter before connecting to the
ESP32 — an out-of-range voltage can damage the ADC pin).

## 3. Libraries used

- `bblanchon/ArduinoJson` ^6.21.5
- `knolleary/PubSubClient` ^2.8
- `adafruit/Adafruit SSD1306` ^2.5.9
- `adafruit/Adafruit GFX Library` ^1.11.9
- `adafruit/Adafruit BusIO` ^1.15.0

All declared in `platformio.ini` — PlatformIO installs them automatically on
first build.

## 4. Wi-Fi configuration

Edit the top of `src/main.cpp`:

```cpp
static const char* WIFI_SSID     = "YOUR_WIFI_SSID";
static const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
```

The firmware connects on boot and auto-reconnects if Wi-Fi drops (checked
every loop, retried every 5s) — local sampling and relay protection on Core 0
never wait on this.

## 5. MQTT / HTTP configuration

Two transports are implemented; pick one with a single macro:

```cpp
#define USE_MQTT 0   // 0 = HTTP (simplest to bring up first), 1 = MQTT
```

**HTTP mode** (`USE_MQTT 0`):
```cpp
static const char* BACKEND_URL          = "http://192.168.1.50:4000";
static const char* DEVICE_INGEST_SECRET = "change-me-to-a-long-random-string";
```
`DEVICE_INGEST_SECRET` must exactly match `DEVICE_INGEST_SECRET` in
`backend/.env`. `BACKEND_URL` should point at the machine running your
backend, reachable from the ESP32's Wi-Fi network (not `localhost`).

**MQTT mode** (`USE_MQTT 1`):
```cpp
static const char* MQTT_BROKER_HOST = "192.168.1.50";
static const uint16_t MQTT_BROKER_PORT = 1883;
```
Must point at the same broker your backend connects to
(`MQTT_BROKER_URL` in `backend/.env`). Topics are derived automatically as
`eshield/<DEVICE_ID>/telemetry`, `/status`, `/relay/cmd` — matching the
backend's defaults, so you don't need to change `MQTT_TOPIC_TELEMETRY` /
`MQTT_TOPIC_STATUS` in `backend/.env` unless you already customized them.

Recommended path: bring the device up in HTTP mode first (fewer moving
parts — no broker needed), confirm telemetry appears in the app, then switch
to MQTT if you want it.

## 6. Backend environment variables required

None new. Your existing `backend/.env` already has everything needed:
`DEVICE_INGEST_SECRET` (HTTP mode) and/or `MQTT_BROKER_URL` (MQTT mode). If
you haven't set up a broker yet and want MQTT, see `docs/SETUP.md` for
Firebase/Mosquitto-style setup notes already in your repo.

## 7. Device ID / load ID / location ID

```cpp
static const char* DEVICE_ID     = "ESHIELD-NODE-01";
static const char* LOAD_ID       = "demo-ceiling-fan";
static const char* LOCATION_ID   = "demo-bedroom";
static const char* LOCATION_NAME = "Bedroom";
static const char* LOAD_NAME     = "Ceiling Fan";
```

Defaults match `simulator/.env.example` so the app shows data under the same
device/location/load it already knows about. Change `LOAD_ID`/`LOCATION_ID`
to real Firestore `loads/{id}` and `locations/{id}` documents once you've
created them (see `backend/routes/loads.js`), or leave the demo IDs while
testing.

## 8. Sensor calibration procedure

The firmware performs **real** ADC sampling and RMS math — but the
conversion from raw ADC counts to volts/amps depends on constants specific
to your exact sensor boards. Do this with the ESP32 running and Serial
Monitor open (`pio device monitor`):

**Voltage offset (`VOLTAGE_OFFSET_ADC`):**
1. Power the ZMPT101B module but leave its primary (mains) side
   disconnected/open.
2. Add a temporary `Serial.println(analogRead(PIN_ZMPT101B));` in `loop()`
   (or watch it settle near a constant value) — record the average raw ADC
   reading. That's your new `VOLTAGE_OFFSET_ADC`.

**Voltage calibration (`VOLTAGE_CALIBRATION`):**
1. Connect the ZMPT101B to a known, safe mains source and measure the
   *actual* RMS mains voltage with a trusted multimeter (e.g. 230.0V).
2. With `VOLTAGE_OFFSET_ADC` set correctly, read the firmware's computed
   `rmsVoltage` from Serial output.
3. `VOLTAGE_CALIBRATION_new = VOLTAGE_CALIBRATION_old * (multimeter_reading / firmware_rmsVoltage)`.
4. Repeat once to confirm it converges.

**Current offset (`CURRENT_OFFSET_ADC`):**
1. With absolutely no load current flowing through the ACS712 (open
   circuit), record the raw ADC average the same way as voltage offset.

**Current sensitivity (`CURRENT_SENSITIVITY`):**
1. Start from your ACS712 variant's datasheet sensitivity (5A board:
   0.185 V/A, 20A board: 0.100 V/A, 30A board: 0.066 V/A) as the initial
   value.
2. Apply a known load current (measured with a clamp meter or known
   resistive load, e.g. a 100W bulb ≈ 0.43A at 230V) and compare against
   firmware's `rmsCurrent`.
3. `CURRENT_SENSITIVITY_new = CURRENT_SENSITIVITY_old * (firmware_rmsCurrent / clampmeter_reading)`.

Re-flash after each constant change (or use PlatformIO's Serial Monitor to
confirm before committing to a full re-test cycle).

**Do not** calibrate current offset with a load connected — that would
teach the firmware to treat real current draw as "zero," masking genuine
load.

## 9–12. Compile / upload / monitor

```bash
# from esp32/ directory
pio run                       # compile
pio run --target upload       # flash (ESP32 connected via USB)
pio device monitor             # serial monitor, 115200 baud
```

Or in VS Code with the PlatformIO extension: open the `esp32/` folder,
use the PlatformIO sidebar's Build / Upload / Monitor buttons (they run the
same commands above).

## 13. Expected serial output

```
=== E-SHIELD ESP32 firmware starting ===
[setup] Sampling task launched on Core 0. Core 1 (this loop) handles comms/OLED.
[wifi] Connected, IP: 192.168.1.87
[telemetry] V=231.4 I=0.412 P=94.8 anomaly=0.031 status=ONLINE
[http] POST http://192.168.1.50:4000/api/telemetry/ingest -> 200
[telemetry] V=230.9 I=0.409 P=93.7 anomaly=0.028 status=ONLINE
[http] POST http://192.168.1.50:4000/api/telemetry/ingest -> 200
```

If sensors are disconnected/saturated, `status=SENSOR_ERROR` appears instead
and V/I in the printed line will be near the raw offset (uncalibrated,
meaningless) — the OLED will show "SENSOR ERROR / Check wiring" rather than
a fabricated reading.

## 14. Expected OLED output

```
E-SHIELD
WiFi: OK

V: 230.9 V
I: 0.41 A
P: 93.7 W

NORMAL
```

Bottom line cycles through `NORMAL` / `WARNING` / `CRITICAL` /
`SENSOR ERROR` based on the same local thresholds that drive LEDs/buzzer.

## 15. Expected mobile-app output

With the backend and app already running (per `docs/SETUP.md`) and the app
in **Live mode** (not Demo mode — see `SettingsScreen.js`), switch to the
device matching `DEVICE_ID`:
- Home screen shows live V/I/P updating roughly once per second.
- `isSimulated` badge does **not** appear (that's simulator-only).
- WaveformScreen renders your real waveform shape once telemetry with
  `waveformSamples` arrives.
- If Wi-Fi/backend goes down or the ESP32 loses power, the app shows
  "SENSOR DISCONNECTED / DATA UNAVAILABLE" after ~15s (existing
  `CONNECTION_TIMEOUT_MS` in `useTelemetry.js`) — it will never silently
  show stale or simulated data instead.

## 16. Troubleshooting

| Symptom | Check |
|---|---|
| ESP32 won't connect to Wi-Fi | SSID/password typos; 2.4GHz network (ESP32 doesn't do 5GHz); router allows new device connections |
| HTTP POST returns 401 | `DEVICE_INGEST_SECRET` mismatch between firmware and `backend/.env` |
| HTTP POST times out / fails | `BACKEND_URL` unreachable from ESP32's network — don't use `localhost`; use the backend machine's LAN IP; check firewall |
| MQTT won't connect | Broker host/port wrong; broker requires auth but `MQTT_USERNAME`/`PASSWORD` empty; broker not actually running |
| App shows nothing / stays DISCONNECTED | Confirm app is in **Live mode**, not Demo mode; confirm `activeDeviceId` in the app matches firmware `DEVICE_ID` exactly |
| OLED blank | I2C address (try scanning — some SSD1306 boards are 0x3D); SDA/SCL wiring swapped |
| V/I readings look wrong but stable | Calibration constants — see section 8 |
| V/I readings jump around wildly / SENSOR_ERROR constantly | Loose ADC wiring, sensor board browning out, or ADC pin exceeding 0–3.3V — check with a multimeter before reconnecting |
| Relay never trips in testing | `RELAY_CONNECTED` is `false` by default (safety default) — set `true` only once hardware is actually wired |

## 17. Every modification made to your existing project

**None.** `backend/`, `frontend/`, `simulator/`, `firebase/`, and `docs/`
are byte-for-byte unchanged from your upload. Only the new `esp32/` folder
was added, built to speak the schema/transport your existing code already
implements.
