/*
 * E-SHIELD ESP32 - COMPLETE LIVE SENSOR FIRMWARE
 * ------------------------------------------------
 * ZMPT101B + ACS712 -> ESP32 -> E-SHIELD Backend
 *
 * REAL SENSOR MODE ONLY
 * No simulated telemetry.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <math.h>

#if __has_include("secrets.h")
#include "secrets.h"
#else
#define ESHIELD_WIFI_SSID "STJC_GENTS"
#define ESHIELD_WIFI_PASSWORD "admin@123"
#define ESHIELD_BACKEND_URL "http://172.16.12.73:4000/api/telemetry/ingest"
#define ESHIELD_DEVICE_SECRET "ESHIELD_ESP32_2026_SECURE"
#endif

// ================================================================
// DEVICE
// ================================================================

static const char* WIFI_SSID = ESHIELD_WIFI_SSID;
static const char* WIFI_PASSWORD = ESHIELD_WIFI_PASSWORD;

static const char* BACKEND_URL = ESHIELD_BACKEND_URL;
static const char* DEVICE_INGEST_SECRET = ESHIELD_DEVICE_SECRET;

static const char* DEVICE_ID = "ESHIELD-NODE-01";
static const char* LOAD_ID = "demo-ceiling-fan";
static const char* LOCATION_ID = "demo-bedroom";
static const char* LOCATION_NAME = "Bedroom";
static const char* LOAD_NAME = "Ceiling Fan";

#define USE_MQTT 0

// ================================================================
// PINS
// ================================================================

#define PIN_ACS712   34
#define PIN_ZMPT101B 35

#define PIN_OLED_SDA 21
#define PIN_OLED_SCL 22
#define OLED_I2C_ADDR 0x3C

#define PIN_LED_GREEN 26
#define PIN_LED_RED   27
#define PIN_BUZZER    25
#define PIN_RELAY     33

static const bool RELAY_CONNECTED = false;
static const bool RELAY_ACTIVE_LOW = true;

// ================================================================
// ADC
// ================================================================

static const float ADC_VREF = 3.3f;
static const int ADC_MAX_COUNTS = 4095;

static const float VOLTAGE_CALIBRATION = 0.4145f;
static const float CURRENT_SENSITIVITY = 0.0850f;
static const float NO_AC_VOLTAGE_THRESHOLD = 30.0f;

// ================================================================
// SAMPLING
// ================================================================

static const int SAMPLE_RATE_HZ = 1000;
static const int SAMPLE_PERIOD_US = 1000;

static const int WINDOW_SAMPLES = 100;
static const int WAVEFORM_SEND_POINTS = 64;

// ================================================================
// VALIDATION
// ================================================================

static const float MIN_VOLTAGE = 180.0f;
static const float MAX_VOLTAGE = 260.0f;

static const float MIN_CURRENT = 0.02f;
static const float MAX_CURRENT = 32.0f;

static const float MIN_FREQUENCY = 45.0f;
static const float MAX_FREQUENCY = 55.0f;

static const float MIN_CREST = 1.05f;
static const float MAX_CREST = 3.50f;

static const float MIN_AC_PEAK_COUNTS = 35.0f;

static const int REQUIRED_VALID_WINDOWS = 3;
static const int REQUIRED_INVALID_WINDOWS = 3;

// ================================================================
// PROTECTION
// ================================================================

static const float LOCAL_OVERCURRENT_TRIP_A = 15.0f;
static const float LOCAL_ANOMALY_TRIP_SCORE = 0.85f;
static const int LOCAL_TRIP_CONSEC_WINDOWS = 2;

// ================================================================
// OBJECTS
// ================================================================

Adafruit_SSD1306 display(128, 64, &Wire, -1);

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

portMUX_TYPE metricsMux = portMUX_INITIALIZER_UNLOCKED;

// ================================================================
// METRICS
// ================================================================

struct Metrics {

  bool valid = false;
  bool sensorError = true;

  float rmsVoltage = 0.0f;
  float rmsCurrent = 0.0f;

  float realPower = 0.0f;
  float apparentPower = 0.0f;

  float powerFactor = 0.0f;
  bool powerFactorValid = false;

  float frequency = 0.0f;
  float crestFactor = 0.0f;
  float thdPercent = 0.0f;
  float anomalyScore = 0.0f;

  float startupPeak = 0.0f;
  int startupDecayMs = 0;

  float energyKwh = 0.0f;

  float waveform[WAVEFORM_SEND_POINTS] = {0};

  bool tripped = false;

  unsigned long lastUpdateMs = 0;
};

Metrics g_metrics;

volatile bool g_relayTripped = false;
volatile bool g_relayCommandIsolate = false;
volatile bool g_relayCommandRestore = false;

// ================================================================
// ENERGY
// ================================================================

static double g_energyWh = 0.0;
static unsigned long g_lastEnergyMs = 0;

// ================================================================
// STARTUP
// ================================================================

static bool g_startupActive = false;
static float g_startupPeak = 0.0f;
static unsigned long g_startupStartMs = 0;

// ================================================================
// SENSOR STATE
// ================================================================

static int g_goodWindows = 0;
static int g_badWindows = 0;
static bool g_sensorOnline = false;

// ================================================================
// ADC
// ================================================================

static inline int readAdc(int pin) {
  return analogRead(pin);
}

// ================================================================
// FREQUENCY ESTIMATION
// ================================================================

static float estimateFrequency(
    const float* v,
    int n) {

  if (n < 60) {
    return NAN;
  }

  double mean = 0.0;

  for (int i = 0; i < n; i++) {
    mean += v[i];
  }

  mean /= n;

  float centered[WINDOW_SAMPLES];

  double rmsSum = 0.0;

  for (int i = 0; i < n; i++) {

    centered[i] =
        v[i] - (float)mean;

    rmsSum +=
        (double)centered[i] *
        centered[i];
  }

  float rms =
      sqrtf(
          rmsSum / n
      );

  if (!isfinite(rms) || rms < 15.0f) {
    return NAN;
  }

  int minLag =
      (int)(1000.0f / 55.0f);

  int maxLag =
      (int)(1000.0f / 45.0f);

  float bestCorr = -1.0f;
  int bestLag = 0;

  for (
      int lag = minLag;
      lag <= maxLag;
      lag++
  ) {

    double xy = 0.0;
    double xx = 0.0;
    double yy = 0.0;

    for (
        int i = 0;
        i < n - lag;
        i++
    ) {

      float a = centered[i];
      float b = centered[i + lag];

      xy +=
          (double)a * b;

      xx +=
          (double)a * a;

      yy +=
          (double)b * b;
    }

    if (
        xx < 1.0 ||
        yy < 1.0
    ) {
      continue;
    }

    float corr =
        xy /
        sqrtf(
            (float)(xx * yy)
        );

    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (
      bestLag <= 0 ||
      bestCorr < 0.25f
  ) {
    return NAN;
  }

  float frequency =
      1000.0f /
      (float)bestLag;

  if (
      frequency < 45.0f ||
      frequency > 55.0f
  ) {
    return NAN;
  }

  return frequency;
}

// ================================================================
// WAVEFORM PROCESSING
// ================================================================

static bool processWaveform(
    const int* rawV,
    const int* rawI,
    float* vOut,
    float* iOut,
    float& voltageMean,
    float& currentMean,
    float& peakV,
    float& peakI) {

  double sumV = 0.0;
  double sumI = 0.0;

  for (int i = 0; i < WINDOW_SAMPLES; i++) {

    sumV += rawV[i];
    sumI += rawI[i];
  }

  voltageMean =
      (float)(
          sumV /
          WINDOW_SAMPLES
      );

  currentMean =
      (float)(
          sumI /
          WINDOW_SAMPLES
      );

  double initialV2 = 0.0;
  double initialI2 = 0.0;

  for (int i = 0; i < WINDOW_SAMPLES; i++) {

    float v =
        rawV[i] -
        voltageMean;

    float current =
        rawI[i] -
        currentMean;

    initialV2 +=
        (double)v * v;

    initialI2 +=
        (double)current *
        current;
  }

  float initialVrms =
      sqrtf(
          initialV2 /
          WINDOW_SAMPLES
      );

  float initialIrms =
      sqrtf(
          initialI2 /
          WINDOW_SAMPLES
      );

  if (
      !isfinite(initialVrms) ||
      !isfinite(initialIrms)
  ) {
    return false;
  }

  float vLimit =
      max(
          initialVrms * 4.0f,
          40.0f
      );

  float iLimit =
      max(
          initialIrms * 4.0f,
          40.0f
      );

  peakV = 0.0f;
  peakI = 0.0f;

  for (int i = 0; i < WINDOW_SAMPLES; i++) {

    float v =
        rawV[i] -
        voltageMean;

    float current =
        rawI[i] -
        currentMean;

    if (fabsf(v) > vLimit) {
      v = constrain(
          v,
          -vLimit,
          vLimit
      );
    }

    if (fabsf(current) > iLimit) {
      current = constrain(
          current,
          -iLimit,
          iLimit
      );
    }

    vOut[i] = v;
    iOut[i] = current;

    if (fabsf(v) > peakV) {
      peakV = fabsf(v);
    }

    if (fabsf(current) > peakI) {
      peakI = fabsf(current);
    }
  }

  return true;
}

// ================================================================
// VALIDATION
// ================================================================

static bool validateSensor(
    float voltage,
    float current,
    float frequency,
    float crest,
    float peakV) {

  if (!isfinite(voltage) ||
      !isfinite(current) ||
      !isfinite(frequency) ||
      !isfinite(crest)) {

    return false;
  }

  if (
      voltage < MIN_VOLTAGE ||
      voltage > MAX_VOLTAGE
  ) {
    return false;
  }

  if (
      current < MIN_CURRENT ||
      current > MAX_CURRENT
  ) {
    return false;
  }

  if (
      frequency < MIN_FREQUENCY ||
      frequency > MAX_FREQUENCY
  ) {
    return false;
  }

  if (
      crest < MIN_CREST ||
      crest > MAX_CREST
  ) {
    return false;
  }

  if (
      peakV <
      MIN_AC_PEAK_COUNTS
  ) {
    return false;
  }

  return true;
}

// ================================================================
// SENSOR SAMPLING TASK
// ================================================================

void samplingTask(void*) {

  static int rawV[WINDOW_SAMPLES];
  static int rawI[WINDOW_SAMPLES];

  static float vSamples[WINDOW_SAMPLES];
  static float iSamples[WINDOW_SAMPLES];

  int index = 0;

  // IMPORTANT:
  // Use FreeRTOS delay instead of a tight timing loop.
  // This prevents IDLE0 starvation and the ESP32 task watchdog reset.
  for (;;) {

    rawV[index] = readAdc(PIN_ZMPT101B);
    rawI[index] = readAdc(PIN_ACS712);

    index++;

    if (index < WINDOW_SAMPLES) {
      vTaskDelay(pdMS_TO_TICKS(1));
      continue;
    }

    index = 0;

    // ------------------------------------------------------------
    // PROCESS
    // ------------------------------------------------------------

    float meanV = 0.0f;
    float meanI = 0.0f;
    float peakV = 0.0f;
    float peakI = 0.0f;

    bool processed = processWaveform(
        rawV,
        rawI,
        vSamples,
        iSamples,
        meanV,
        meanI,
        peakV,
        peakI
    );

    if (!processed) {
      g_sensorOnline = false;
      vTaskDelay(pdMS_TO_TICKS(1));
      continue;
    }

    // ------------------------------------------------------------
    // RMS
    // ------------------------------------------------------------

    double sumV2 = 0.0;
    double sumI2 = 0.0;
    double sumVI = 0.0;

    for (int i = 0; i < WINDOW_SAMPLES; i++) {
      sumV2 += (double)vSamples[i] * vSamples[i];
      sumI2 += (double)iSamples[i] * iSamples[i];
      sumVI += (double)vSamples[i] * iSamples[i];
    }

    float rmsCountsV =
        sqrtf(sumV2 / WINDOW_SAMPLES);

    float rmsCountsI =
        sqrtf(sumI2 / WINDOW_SAMPLES);

    float countsToVolts =
        ADC_VREF / ADC_MAX_COUNTS;

    float rmsVoltage =
        rmsCountsV * VOLTAGE_CALIBRATION;

    float rmsCurrent =
        (rmsCountsI * countsToVolts) /
        CURRENT_SENSITIVITY;

    // ------------------------------------------------------------
    // CREST
    // ------------------------------------------------------------

    float crest =
        rmsCountsV > 0.001f
        ? peakV / rmsCountsV
        : 0.0f;

    // ------------------------------------------------------------
    // FREQUENCY
    // ------------------------------------------------------------

    float frequency =
        estimateFrequency(vSamples, WINDOW_SAMPLES);

    // ------------------------------------------------------------
    // POWER
    // ------------------------------------------------------------

    float realPowerCounts =
        sumVI / WINDOW_SAMPLES;

    float realPower =
        realPowerCounts *
        VOLTAGE_CALIBRATION *
        (countsToVolts / CURRENT_SENSITIVITY);

    float apparentPower =
        rmsVoltage * rmsCurrent;

    float powerFactor = 0.0f;

    bool pfValid =
        rmsCurrent > 0.03f;

    if (pfValid) {
      powerFactor =
          constrain(
              fabsf(realPower) /
              max(apparentPower, 0.001f),
              0.0f,
              1.0f
          );
    }

    // ------------------------------------------------------------
    // NO-AC DETECTION
    // ------------------------------------------------------------

    if (rmsVoltage < NO_AC_VOLTAGE_THRESHOLD) {
      rmsVoltage = 0.0f;
      rmsCurrent = 0.0f;
      realPower = 0.0f;
      apparentPower = 0.0f;
      powerFactor = 0.0f;
      frequency = 0.0f;
      crest = 0.0f;
    }

    // ------------------------------------------------------------
    // DEBUG
    // ------------------------------------------------------------

    static unsigned long debugCounter = 0;
    debugCounter++;

    if (debugCounter % 5 == 0) {
      Serial.print("[LIVE MEASUREMENT] V=");
      Serial.print(rmsVoltage, 2);
      Serial.print(" V | I=");
      Serial.print(rmsCurrent, 3);
      Serial.print(" A | F=");

      if (isfinite(frequency)) {
        Serial.print(frequency, 2);
      } else {
        Serial.print("INVALID");
      }

      Serial.print(" Hz | PF=");
      Serial.print(powerFactor, 3);
      Serial.print(" | Peak=");
      Serial.println(peakV, 1);
    }

    // ------------------------------------------------------------
    // VALIDATION
    // ------------------------------------------------------------

    bool valid =
        validateSensor(
            rmsVoltage,
            rmsCurrent,
            frequency,
            crest,
            peakV
        );

    if (valid) {
      g_goodWindows++;
      g_badWindows = 0;

      if (g_goodWindows >= REQUIRED_VALID_WINDOWS) {
        g_sensorOnline = true;
      }
    } else {
      g_badWindows++;
      g_goodWindows = 0;

      if (g_badWindows >= REQUIRED_INVALID_WINDOWS) {
        g_sensorOnline = false;
      }
    }

    bool publishable =
        valid && g_sensorOnline;

    // ------------------------------------------------------------
    // INVALID SENSOR
    // ------------------------------------------------------------

    if (!publishable) {
      portENTER_CRITICAL(&metricsMux);

      g_metrics.valid = false;
      g_metrics.sensorError = true;
      g_metrics.rmsVoltage = 0.0f;
      g_metrics.rmsCurrent = 0.0f;
      g_metrics.realPower = 0.0f;
      g_metrics.apparentPower = 0.0f;
      g_metrics.frequency = 0.0f;
      g_metrics.powerFactor = 0.0f;
      g_metrics.powerFactorValid = false;
      g_metrics.crestFactor = 0.0f;
      g_metrics.anomalyScore = 0.0f;
      g_metrics.thdPercent = 0.0f;
      g_metrics.tripped = g_relayTripped;

      portEXIT_CRITICAL(&metricsMux);

      vTaskDelay(pdMS_TO_TICKS(1));
      continue;
    }

    // ------------------------------------------------------------
    // ANOMALY
    // ------------------------------------------------------------

    float anomaly = 0.0f;

    if (frequency >= 45.0f && frequency <= 55.0f) {

      float omega =
          2.0f * PI * frequency /
          SAMPLE_RATE_HZ;

      double sumSin = 0.0;
      double sumCos = 0.0;

      for (int i = 0; i < WINDOW_SAMPLES; i++) {
        sumSin +=
            iSamples[i] *
            sinf(omega * i);

        sumCos +=
            iSamples[i] *
            cosf(omega * i);
      }

      float amplitude =
          sqrtf(
              sumSin * sumSin +
              sumCos * sumCos
          ) *
          2.0f /
          WINDOW_SAMPLES;

      float phase =
          atan2f(sumSin, sumCos);

      double residualEnergy = 0.0;
      double fundamentalEnergy = 0.0;

      for (int i = 0; i < WINDOW_SAMPLES; i++) {

        float fundamental =
            amplitude *
            sinf(omega * i + phase);

        float residual =
            iSamples[i] - fundamental;

        residualEnergy +=
            (double)residual * residual;

        fundamentalEnergy +=
            (double)fundamental * fundamental;
      }

      if (fundamentalEnergy > 1.0) {
        anomaly =
            constrain(
                (float)(
                    residualEnergy /
                    fundamentalEnergy
                ),
                0.0f,
                1.0f
            );
      }
    }

    float thd =
        constrain(
            sqrtf(anomaly) * 100.0f,
            0.0f,
            100.0f
        );

    // ------------------------------------------------------------
    // STARTUP
    // ------------------------------------------------------------

    if (!g_startupActive && rmsCurrent > 0.15f) {
      g_startupActive = true;
      g_startupPeak = rmsCurrent;
      g_startupStartMs = millis();

    } else if (g_startupActive) {

      if (rmsCurrent > g_startupPeak) {
        g_startupPeak = rmsCurrent;
      }

      if (millis() - g_startupStartMs > 500) {
        g_startupActive = false;
      }
    }

    // ------------------------------------------------------------
    // ENERGY
    // ------------------------------------------------------------

    unsigned long now = millis();

    if (g_lastEnergyMs != 0) {
      float hours =
          (now - g_lastEnergyMs) /
          3600000.0f;

      if (realPower > 0) {
        g_energyWh += realPower * hours;
      }
    }

    g_lastEnergyMs = now;

    // ------------------------------------------------------------
    // WAVEFORM
    // ------------------------------------------------------------

    float waveform[WAVEFORM_SEND_POINTS];

    for (int i = 0; i < WAVEFORM_SEND_POINTS; i++) {
      int source =
          (i * WINDOW_SAMPLES) /
          WAVEFORM_SEND_POINTS;

      waveform[i] =
          peakV > 0.1f
          ? vSamples[source] / peakV
          : 0.0f;
    }

    // ------------------------------------------------------------
    // PROTECTION
    // ------------------------------------------------------------

    static int badProtectionWindows = 0;

    bool protectionFault =
        rmsCurrent >= LOCAL_OVERCURRENT_TRIP_A ||
        anomaly >= LOCAL_ANOMALY_TRIP_SCORE;

    if (protectionFault) {
      badProtectionWindows++;
    } else {
      badProtectionWindows = 0;
    }

    if (
        RELAY_CONNECTED &&
        badProtectionWindows >= LOCAL_TRIP_CONSEC_WINDOWS &&
        !g_relayTripped
    ) {
      digitalWrite(
          PIN_RELAY,
          RELAY_ACTIVE_LOW ? LOW : HIGH
      );

      g_relayTripped = true;
    }

    if (
        RELAY_CONNECTED &&
        g_relayCommandRestore
    ) {
      digitalWrite(
          PIN_RELAY,
          RELAY_ACTIVE_LOW ? HIGH : LOW
      );

      g_relayTripped = false;
      g_relayCommandRestore = false;
    }

    if (
        RELAY_CONNECTED &&
        g_relayCommandIsolate
    ) {
      digitalWrite(
          PIN_RELAY,
          RELAY_ACTIVE_LOW ? LOW : HIGH
      );

      g_relayTripped = true;
      g_relayCommandIsolate = false;
    }

    // ------------------------------------------------------------
    // SAVE METRICS
    // ------------------------------------------------------------

    portENTER_CRITICAL(&metricsMux);

    g_metrics.valid = true;
    g_metrics.sensorError = false;
    g_metrics.rmsVoltage = rmsVoltage;
    g_metrics.rmsCurrent = rmsCurrent;
    g_metrics.realPower = realPower;
    g_metrics.apparentPower = apparentPower;
    g_metrics.frequency = frequency;
    g_metrics.powerFactor = powerFactor;
    g_metrics.powerFactorValid = pfValid;
    g_metrics.crestFactor = crest;
    g_metrics.anomalyScore = anomaly;
    g_metrics.thdPercent = thd;
    g_metrics.startupPeak = g_startupPeak;

    g_metrics.startupDecayMs =
        g_startupActive
        ? (int)(millis() - g_startupStartMs)
        : 0;

    g_metrics.energyKwh =
        (float)(g_energyWh / 1000.0);

    memcpy(
        g_metrics.waveform,
        waveform,
        sizeof(waveform)
    );

    g_metrics.tripped = g_relayTripped;
    g_metrics.lastUpdateMs = millis();

    portEXIT_CRITICAL(&metricsMux);

    // Explicitly yield after the complete processing window.
    vTaskDelay(pdMS_TO_TICKS(1));
  }
}

// ================================================================
// WIFI
// ================================================================

static unsigned long lastWifiAttempt = 0;

void connectWifi() {

  if (
      WiFi.status() ==
      WL_CONNECTED
  ) {
    return;
  }

  if (
      millis() -
      lastWifiAttempt <
      10000
  ) {
    return;
  }

  lastWifiAttempt =
      millis();

  Serial.println();
  Serial.println(
      "[wifi] Connecting..."
  );

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);

  WiFi.begin(
      WIFI_SSID,
      WIFI_PASSWORD
  );

  unsigned long start =
      millis();

  while (
      WiFi.status() !=
          WL_CONNECTED &&
      millis() - start <
          20000
  ) {

    delay(500);

    Serial.print(".");
  }

  Serial.println();

  if (
      WiFi.status() ==
      WL_CONNECTED
  ) {

    Serial.println(
        "[wifi] CONNECTED"
    );

    Serial.print(
        "[wifi] IP: "
    );

    Serial.println(
        WiFi.localIP()
    );

    Serial.print(
        "[wifi] RSSI: "
    );

    Serial.print(
        WiFi.RSSI()
    );

    Serial.println(
        " dBm"
    );

  } else {

    Serial.print(
        "[wifi] Failed. Status="
    );

    Serial.println(
        (int)WiFi.status()
    );
  }
}

// ================================================================
// JSON
// ================================================================

size_t buildTelemetry(
    char* buffer,
    size_t size,
    const Metrics& m) {

  StaticJsonDocument<4096> doc;

  doc["isSimulated"] = false;
  doc["deviceId"] = DEVICE_ID;
  doc["loadId"] = LOAD_ID;
  doc["locationId"] = LOCATION_ID;
  doc["locationName"] = LOCATION_NAME;
  doc["loadName"] = LOAD_NAME;

  doc["voltage"] = m.rmsVoltage;
  doc["rmsVoltage"] = m.rmsVoltage;

  doc["current"] = m.rmsCurrent;
  doc["rmsCurrent"] = m.rmsCurrent;

  doc["power"] = m.realPower;
  doc["energy"] = m.energyKwh;

  doc["frequency"] = m.frequency;
  doc["powerFactor"] = m.powerFactor;
  doc["crestFactor"] = m.crestFactor;

  doc["thd"] = m.thdPercent;
  doc["anomalyScore"] = m.anomalyScore;

  doc["startupPeak"] = m.startupPeak;
  doc["startupDecayTime"] =
      m.startupDecayMs;

  JsonArray waveform =
      doc.createNestedArray(
          "waveformSamples"
      );

  for (
      int i = 0;
      i < WAVEFORM_SEND_POINTS;
      i++
  ) {

    waveform.add(
        m.waveform[i]
    );
  }

  doc["status"] =
      m.tripped
      ? "ISOLATED"
      : "ONLINE";

  return serializeJson(
      doc,
      buffer,
      size
  );
}

// ================================================================
// HTTP
// ================================================================

void sendTelemetry(
    const char* json,
    size_t length) {

  HTTPClient http;

  http.begin(
      BACKEND_URL
  );

  http.addHeader(
      "Content-Type",
      "application/json"
  );

  http.addHeader(
      "X-Device-Secret",
      DEVICE_INGEST_SECRET
  );

  http.setTimeout(3000);

  int code =
      http.POST(
          (
              uint8_t*)json,
          length
      );

  Serial.print(
      "[HTTP] Backend response: "
  );

  Serial.println(
      code
  );

  http.end();
}

// ================================================================
// STATUS
// ================================================================

enum Status {
  NORMAL,
  WARNING,
  CRITICAL,
  SENSOR_ERROR
};

Status getStatus(
    const Metrics& m) {

  if (
      !m.valid ||
      m.sensorError
  ) {
    return SENSOR_ERROR;
  }

  if (
      m.tripped ||
      m.rmsCurrent >=
          LOCAL_OVERCURRENT_TRIP_A ||
      m.anomalyScore >=
          LOCAL_ANOMALY_TRIP_SCORE
  ) {
    return CRITICAL;
  }

  if (
      m.anomalyScore >=
      0.4f
  ) {
    return WARNING;
  }

  return NORMAL;
}

// ================================================================
// OUTPUTS
// ================================================================

void updateOutputs(
    Status status) {

  bool normal =
      status == NORMAL;

  digitalWrite(
      PIN_LED_GREEN,
      normal
          ? HIGH
          : LOW
  );

  digitalWrite(
      PIN_LED_RED,
      normal
          ? LOW
          : HIGH
  );

  static unsigned long lastBuzz = 0;
  static bool buzzerState = false;

  if (
      status == WARNING ||
      status == CRITICAL
  ) {

    unsigned long interval =
        status == CRITICAL
        ? 300
        : 1000;

    if (
        millis() -
        lastBuzz >
        interval
    ) {

      lastBuzz =
          millis();

      buzzerState =
          !buzzerState;

      digitalWrite(
          PIN_BUZZER,
          buzzerState
              ? HIGH
              : LOW
      );
    }

  } else {

    digitalWrite(
        PIN_BUZZER,
        LOW
    );

    buzzerState = false;
  }
}

// ================================================================
// OLED
// ================================================================

void updateDisplay(
    const Metrics& m,
    Status status,
    bool wifi) {

  display.clearDisplay();

  display.setTextSize(1);
  display.setTextColor(
      SSD1306_WHITE
  );

  display.setCursor(
      0,
      0
  );

  display.println(
      "E-SHIELD LIVE"
  );

  display.print(
      "WiFi: "
  );

  display.println(
      wifi
      ? "OK"
      : "OFF"
  );

  if (
      !m.valid ||
      m.sensorError
  ) {

    display.setCursor(
        0,
        24
    );

    display.println(
        "SENSOR ERROR"
    );

    display.println(
        "DATA UNAVAILABLE"
    );

  } else {

    display.setCursor(
        0,
        20
    );

    display.printf(
        "V: %.1f V\n",
        m.rmsVoltage
    );

    display.printf(
        "I: %.2f A\n",
        m.rmsCurrent
    );

    display.printf(
        "P: %.1f W\n",
        m.realPower
    );

    display.printf(
        "F: %.1f Hz\n",
        m.frequency
    );
  }

  display.setCursor(
      0,
      56
  );

  switch (status) {

    case NORMAL:
      display.print(
          "NORMAL"
      );
      break;

    case WARNING:
      display.print(
          "WARNING"
      );
      break;

    case CRITICAL:
      display.print(
          "CRITICAL"
      );
      break;

    default:
      display.print(
          "DATA UNAVAILABLE"
      );
      break;
  }

  display.display();
}

// ================================================================
// SETUP
// ================================================================

void setup() {

  Serial.begin(
      115200
  );

  delay(500);

  Serial.println();
  Serial.println(
      "================================"
  );

  Serial.println(
      " E-SHIELD LIVE SENSOR FIRMWARE"
  );

  Serial.println(
      "================================"
  );

  pinMode(
      PIN_LED_GREEN,
      OUTPUT
  );

  pinMode(
      PIN_LED_RED,
      OUTPUT
  );

  pinMode(
      PIN_BUZZER,
      OUTPUT
  );

  digitalWrite(
      PIN_LED_GREEN,
      LOW
  );

  digitalWrite(
      PIN_LED_RED,
      HIGH
  );

  digitalWrite(
      PIN_BUZZER,
      LOW
  );

  if (
      RELAY_CONNECTED
  ) {

    pinMode(
        PIN_RELAY,
        OUTPUT
    );

    digitalWrite(
        PIN_RELAY,
        RELAY_ACTIVE_LOW
        ? HIGH
        : LOW
    );
  }

  // ------------------------------------------------------------
  // ADC
  // ------------------------------------------------------------

  analogReadResolution(
      12
  );

  analogSetPinAttenuation(
      PIN_ZMPT101B,
      ADC_11db
  );

  analogSetPinAttenuation(
      PIN_ACS712,
      ADC_11db
  );

  // ------------------------------------------------------------
  // OLED
  // ------------------------------------------------------------

  Wire.begin(
      PIN_OLED_SDA,
      PIN_OLED_SCL
  );

  if (
      display.begin(
          SSD1306_SWITCHCAPVCC,
          OLED_I2C_ADDR
      )
  ) {

    display.clearDisplay();

    display.setTextSize(1);
    display.setTextColor(
        SSD1306_WHITE
    );

    display.setCursor(
        0,
        0
    );

    display.println(
        "E-SHIELD"
    );

    display.println(
        "LIVE SENSOR MODE"
    );

    display.println();
    display.println(
        "Starting..."
    );

    display.display();
  }

  // ------------------------------------------------------------
  // WIFI
  // ------------------------------------------------------------

  WiFi.mode(
      WIFI_STA
  );

  // ------------------------------------------------------------
  // SENSOR TASK
  // ------------------------------------------------------------

  xTaskCreatePinnedToCore(
      samplingTask,
      "sensor_sampling",
      10000,
      NULL,
      2,
      NULL,
      0
  );

  Serial.println(
      "[setup] Sensor sampling started."
  );
}

// ================================================================
// LOOP
// ================================================================

void loop() {

  connectWifi();

  bool wifiConnected =
      WiFi.status() ==
      WL_CONNECTED;

  Metrics snapshot;

  portENTER_CRITICAL(
      &metricsMux
  );

  snapshot =
      g_metrics;

  portEXIT_CRITICAL(
      &metricsMux
  );

  Status status =
      getStatus(
          snapshot
      );

  updateOutputs(
      status
  );

  updateDisplay(
      snapshot,
      status,
      wifiConnected
  );

  static unsigned long lastTelemetry = 0;

  unsigned long now =
      millis();

  // ------------------------------------------------------------
  // VALID LIVE DATA ONLY
  // ------------------------------------------------------------

  if (
      wifiConnected &&
      snapshot.valid &&
      !snapshot.sensorError &&
      snapshot.rmsVoltage >= MIN_VOLTAGE &&
      snapshot.rmsVoltage <= MAX_VOLTAGE &&
      snapshot.rmsCurrent >= MIN_CURRENT &&
      snapshot.rmsCurrent <= MAX_CURRENT &&
      snapshot.frequency >= MIN_FREQUENCY &&
      snapshot.frequency <= MAX_FREQUENCY &&
      now -
      lastTelemetry >=
      1000
  ) {

    lastTelemetry =
        now;

    static char json[
        4096
    ];

    size_t length =
        buildTelemetry(
            json,
            sizeof(json),
            snapshot
        );

    sendTelemetry(
        json,
        length
    );
  }

  delay(20);
}