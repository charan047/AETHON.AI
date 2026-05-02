#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BASE_URL="${BASE_URL:-http://localhost:8000}"
REPORT_DIR="${SCRIPT_DIR}/reports"
mkdir -p "$REPORT_DIR"

echo "=== SCENARIO 1: Baseline (10 users, 60 seconds) ==="
locust -f locustfile.py --headless \
  --users 10 --spawn-rate 2 \
  --run-time 60s \
  --host "$BASE_URL" \
  --html "${REPORT_DIR}/baseline_report.html" \
  --csv "${REPORT_DIR}/baseline"

echo "=== SCENARIO 2: Normal Load (50 users, 120 seconds) ==="
locust -f locustfile.py --headless \
  --users 50 --spawn-rate 5 \
  --run-time 120s \
  --host "$BASE_URL" \
  --html "${REPORT_DIR}/normal_report.html" \
  --csv "${REPORT_DIR}/normal"

echo "=== SCENARIO 3: Stress Test (200 users, 180 seconds) ==="
locust -f locustfile.py --headless \
  --users 200 --spawn-rate 10 \
  --run-time 180s \
  --host "$BASE_URL" \
  --html "${REPORT_DIR}/stress_report.html" \
  --csv "${REPORT_DIR}/stress"

echo "=== SCENARIO 4: Spike Test (sudden 500 users) ==="
locust -f locustfile.py --headless \
  --users 500 --spawn-rate 500 \
  --run-time 60s \
  --host "$BASE_URL" \
  --html "${REPORT_DIR}/spike_report.html" \
  --csv "${REPORT_DIR}/spike"

echo "Results in ${REPORT_DIR}"
