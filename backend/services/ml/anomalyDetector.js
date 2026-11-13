/**
 * Device-specific statistical anomaly detection.
 *
 *  - Welford's online algorithm keeps running mean / variance per channel
 *    (numerically stable, O(1) memory, suitable for an MCU-class stream).
 *  - During the learning phase every sample updates the profile.
 *  - After learning the profile is frozen and each new sample is scored with
 *    z = (x - mean) / max(std, floor).
 *
 * Deterministic electrical safety limits live in evaluateSafetyLimits() and are
 * completely independent of any learned or ML behaviour.
 */
const cfg = require('./config');
const { NOMINAL_VOLTAGE } = require('../healthScoreService');
const { THRESHOLDS } = require('../alertService');

const CHANNELS = ['voltage', 'current', 'power'];
// std floors: absolute (sensor resolution) and relative-to-mean, so a flat-lined
// or very steady load cannot produce infinite z-scores from tiny noise.
const FLOORS = {
  voltage: { abs: 0.5, rel: 0.005 },
  current: { abs: 0.01, rel: 0.02 },
  power: { abs: 0.5, rel: 0.02 },
};

class Welford {
  constructor() {
    this.n = 0;
    this.mean = 0;
    this.m2 = 0;
  }
  push(x) {
    this.n += 1;
    const d = x - this.mean;
    this.mean += d / this.n;
    this.m2 += d * (x - this.mean);
  }
  get variance() {
    return this.n > 1 ? this.m2 / (this.n - 1) : 0;
  }
  get std() {
    return Math.sqrt(this.variance);
  }
  toJSON() {
    return { n: this.n, mean: this.mean, m2: this.m2 };
  }
  static from(o) {
    const w = new Welford();
    w.n = o.n; w.mean = o.mean; w.m2 = o.m2;
    return w;
  }
}

function stdWithFloor(channel, w) {
  const f = FLOORS[channel];
  return Math.max(w.std, f.abs, f.rel * Math.abs(w.mean));
}

/** Create an empty profile. */
function newProfile(deviceId, mode) {
  return {
    deviceId,
    mode,
    stats: { voltage: new Welford(), current: new Welford(), power: new Welford() },
    ranges: { voltage: [Infinity, -Infinity], current: [Infinity, -Infinity], power: [Infinity, -Infinity] },
    learningElapsedSec: 0,
    learningStartedAt: null,
    lastSampleTs: null,
    complete: false,
    completedAt: null,
    applianceClass: null,
    identificationStatus: null,
    samples: 0,
  };
}

/** Feed one sample into the learning phase. Returns true when learning just completed. */
function learn(profile, sample) {
  if (profile.learningStartedAt === null) profile.learningStartedAt = sample.timestamp;
  if (profile.lastSampleTs !== null) {
    const dt = (sample.timestamp - profile.lastSampleTs) / 1000;
    if (dt > 0) profile.learningElapsedSec += Math.min(dt, cfg.LEARNING_MAX_GAP_SEC);
  }
  profile.lastSampleTs = sample.timestamp;

  for (const ch of CHANNELS) {
    const x = sample[ch];
    if (typeof x !== 'number' || !Number.isFinite(x)) continue;
    profile.stats[ch].push(x);
    profile.ranges[ch][0] = Math.min(profile.ranges[ch][0], x);
    profile.ranges[ch][1] = Math.max(profile.ranges[ch][1], x);
  }
  profile.samples += 1;

  if (profile.learningElapsedSec >= cfg.LEARNING_SECONDS && profile.samples >= cfg.LEARNING_MIN_SAMPLES) {
    profile.complete = true;
    profile.completedAt = sample.timestamp;
    return true;
  }
  return false;
}

/** z-scores of a sample against a COMPLETED profile. */
function score(profile, sample) {
  const z = {};
  let zMax = 0;
  let worst = null;
  for (const ch of CHANNELS) {
    const x = sample[ch];
    const w = profile.stats[ch];
    if (typeof x !== 'number' || !Number.isFinite(x) || w.n < 2) continue;
    z[ch] = (x - w.mean) / stdWithFloor(ch, w);
    if (Math.abs(z[ch]) > zMax) {
      zMax = Math.abs(z[ch]);
      worst = ch;
    }
  }
  return {
    z,
    zMax,
    worstChannel: worst,
    anomalyScore: Math.min(1, zMax / cfg.ANOMALY_Z_FULL_SCALE),
    exceeds: zMax >= cfg.ANOMALY_Z_THRESHOLD,
  };
}

/** Deterministic safety limits — reuses the thresholds already used by the alert rule engine. */
function evaluateSafetyLimits(sample) {
  const violations = [];
  if (typeof sample.voltage === 'number') {
    const dev = (sample.voltage - NOMINAL_VOLTAGE) / NOMINAL_VOLTAGE;
    if (dev >= THRESHOLDS.voltageSurgePct) violations.push('OVERVOLTAGE');
    else if (dev <= -THRESHOLDS.voltageSagPct) violations.push('UNDERVOLTAGE');
  }
  if (typeof sample.current === 'number' && sample.current >= THRESHOLDS.overcurrentAmps) violations.push('OVERCURRENT');
  if (typeof sample.power === 'number' && sample.power >= cfg.SAFETY_MAX_POWER_W) violations.push('OVERLOAD');
  return violations;
}

/** Summary suitable for Firestore (learnedProfiles/{deviceId}). */
function profileSummary(profile) {
  const out = {
    deviceId: profile.deviceId,
    mode: profile.mode,
    applianceClass: profile.applianceClass,
    identificationStatus: profile.identificationStatus,
    learningDurationSec: Math.round(profile.learningElapsedSec),
    sampleCount: profile.samples,
    complete: profile.complete,
    completedAt: profile.completedAt,
    updatedAt: Date.now(),
  };
  for (const ch of CHANNELS) {
    const w = profile.stats[ch];
    out[`${ch}Mean`] = w.n ? w.mean : null;
    out[`${ch}Variance`] = w.n > 1 ? w.variance : null;
    out[`${ch}Min`] = Number.isFinite(profile.ranges[ch][0]) ? profile.ranges[ch][0] : null;
    out[`${ch}Max`] = Number.isFinite(profile.ranges[ch][1]) ? profile.ranges[ch][1] : null;
    out[`${ch}Count`] = w.n;
    out[`${ch}M2`] = w.m2;
  }
  return out;
}

function profileFromSummary(s) {
  const p = newProfile(s.deviceId, s.mode);
  for (const ch of CHANNELS) {
    p.stats[ch] = Welford.from({ n: s[`${ch}Count`] || 0, mean: s[`${ch}Mean`] || 0, m2: s[`${ch}M2`] || 0 });
    p.ranges[ch] = [s[`${ch}Min`] ?? Infinity, s[`${ch}Max`] ?? -Infinity];
  }
  p.learningElapsedSec = s.learningDurationSec || 0;
  p.samples = s.sampleCount || 0;
  p.complete = !!s.complete;
  p.completedAt = s.completedAt || null;
  p.applianceClass = s.applianceClass || null;
  p.identificationStatus = s.identificationStatus || null;
  p.learningStartedAt = p.samples ? 1 : null;
  return p;
}

module.exports = {
  Welford, CHANNELS, newProfile, learn, score, evaluateSafetyLimits, profileSummary, profileFromSummary,
};
