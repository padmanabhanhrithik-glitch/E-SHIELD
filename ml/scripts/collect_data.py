#!/usr/bin/env python3
"""
Record REAL labeled measurements from a running E-SHIELD backend.

The backend writes every real ESP32 packet of the chosen device into
dataset/raw/<CLASS>__<DEVICE>__<SESSION>.csv while a session is active.
Packets flagged isSimulated (DEMO) are refused by the backend.

Examples
    python scripts/collect_data.py start  --device DEVICE_001 --label CHARGER_90W
    python scripts/collect_data.py status
    python scripts/collect_data.py stop   --device DEVICE_001
    # start, wait, stop in one go (5 minutes):
    python scripts/collect_data.py record --device DEVICE_001 --label CHARGER_90W --minutes 5

Each start->stop is one SESSION. Record several sessions per appliance (unplug / replug,
different times) - training splits by session so the test set is truly unseen.
"""
import argparse
import json
import os
import sys
import time
import urllib.request

BACKEND = os.environ.get("BACKEND_URL", "http://localhost:4000")
SECRET = os.environ.get("DEVICE_INGEST_SECRET", "")


def call(method, path, body=None):
    req = urllib.request.Request(BACKEND + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", "X-Device-Secret": SECRET})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}") | {"httpStatus": e.code}
    except Exception as e:  # noqa: BLE001
        sys.exit(f"Cannot reach backend {BACKEND}: {e}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["start", "stop", "status", "record"])
    ap.add_argument("--device")
    ap.add_argument("--label", help="appliance class, e.g. CHARGER_90W (A-Z, 0-9, _)")
    ap.add_argument("--minutes", type=float, default=5)
    ap.add_argument("--backend")
    a = ap.parse_args()
    global BACKEND
    if a.backend:
        BACKEND = a.backend

    if a.action == "status":
        print(json.dumps(call("GET", "/api/ml/collection"), indent=2))
    elif a.action == "stop":
        if not a.device: sys.exit("--device required")
        print(json.dumps(call("POST", "/api/ml/collection/stop", {"deviceId": a.device}), indent=2))
    else:
        if not (a.device and a.label): sys.exit("--device and --label required")
        r = call("POST", "/api/ml/collection/start", {"deviceId": a.device, "applianceClass": a.label})
        print(json.dumps(r, indent=2))
        if not r.get("ok"): sys.exit(1)
        if a.action == "record":
            end = time.time() + a.minutes * 60
            try:
                while time.time() < end:
                    time.sleep(10)
                    s = call("GET", "/api/ml/collection")
                    sess = [x for x in s.get("sessions", []) if x["deviceId"] == a.device]
                    print(f"  rows so far: {sess[0]['rows'] if sess else '?'}   ({int(end - time.time())}s left)")
            except KeyboardInterrupt:
                print("interrupted - stopping session")
            print(json.dumps(call("POST", "/api/ml/collection/stop", {"deviceId": a.device}), indent=2))


if __name__ == "__main__":
    main()
