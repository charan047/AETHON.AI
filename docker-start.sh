#!/usr/bin/env bash
# =============================================================================
# AETHON — one-command Docker boot + migrate + Playwright verification
# =============================================================================
# Usage:
#   chmod +x docker-start.sh
#   ./docker-start.sh
#
# What it does:
#   1. Builds images and starts the full stack (postgres via local-db profile)
#   2. Waits for Redis and Postgres to be healthy
#   3. Runs Alembic migrations inside backend-1
#   4. Waits for the API gateway (/api/health) and Flower (port 5555)
#   5. Runs the Playwright browser tests against the live Docker stack
# =============================================================================

set -euo pipefail

# ── colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[aethon]${NC} $*"; }
success() { echo -e "${GREEN}[aethon]${NC} $*"; }
warn()    { echo -e "${YELLOW}[aethon]${NC} $*"; }
die()     { echo -e "${RED}[aethon] ERROR:${NC} $*" >&2; exit 1; }

# ── helpers ───────────────────────────────────────────────────────────────────
wait_for_url() {
  local url="$1" label="${2:-$1}" timeout="${3:-120}" interval=3 elapsed=0
  info "Waiting for ${label} …"
  until curl -sf --max-time 5 "$url" >/dev/null 2>&1; do
    if (( elapsed >= timeout )); then
      die "Timed out after ${timeout}s waiting for ${label}"
    fi
    sleep "$interval"
    (( elapsed += interval ))
  done
  success "${label} is up"
}

wait_for_container_healthy() {
  local service="$1" timeout="${2:-90}" interval=3 elapsed=0
  info "Waiting for container '${service}' to be healthy …"
  until [ "$(docker compose ps --format json "$service" 2>/dev/null \
             | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Health',''))" 2>/dev/null)" = "healthy" ]; do
    if (( elapsed >= timeout )); then
      warn "Container '${service}' health check timed out — continuing anyway"
      return 0
    fi
    sleep "$interval"
    (( elapsed += interval ))
  done
  success "Container '${service}' is healthy"
}

# ── 0. preflight ──────────────────────────────────────────────────────────────
command -v docker  >/dev/null 2>&1 || die "docker not found"
command -v curl    >/dev/null 2>&1 || die "curl not found"
command -v node    >/dev/null 2>&1 || die "node not found (needed for Playwright)"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

info "Starting AETHON Docker stack …"
echo ""

# ── 1. build + start ──────────────────────────────────────────────────────────
info "Building images and starting services (this may take a few minutes the first time) …"
docker compose --profile local-db up -d --build

# ── 2. wait for infra dependencies ───────────────────────────────────────────
# Give Docker a moment to register health checks
sleep 5

wait_for_container_healthy "redis"
wait_for_container_healthy "postgres"

# Fallback: wait for postgres TCP even if healthcheck not configured
info "Confirming Postgres port 5433 is accepting connections …"
elapsed=0
until docker compose exec -T postgres pg_isready -U platform_user -d platform_db >/dev/null 2>&1; do
  if (( elapsed >= 60 )); then
    die "Postgres did not become ready in 60s"
  fi
  sleep 3
  (( elapsed += 3 ))
done
success "Postgres is accepting connections"

# ── 3. run Alembic migrations ─────────────────────────────────────────────────
info "Running Alembic migrations inside backend-1 …"
docker compose exec -T backend-1 alembic upgrade head
success "Migrations complete"

# ── 4. wait for application endpoints ────────────────────────────────────────
# Health check through the full nginx → backend chain
wait_for_url "http://localhost/api/health"    "API gateway (nginx → backends)" 120
wait_for_url "http://localhost:8000/health"   "nginx load-balancer :8000"       60
wait_for_url "http://localhost:5555"          "Flower (Celery monitor) :5555"   60

echo ""
success "All services are up and healthy!"
echo ""

# ── 5. Playwright browser verification ───────────────────────────────────────
info "Running Playwright e2e tests against the live Docker stack …"
cd "$SCRIPT_DIR/frontend"

# Install browsers if this is the first run
if ! npx playwright --version >/dev/null 2>&1; then
  info "Installing Playwright browsers …"
  npx playwright install --with-deps chromium
fi

npx playwright test --config=playwright.docker.config.ts

echo ""
success "Playwright run complete. See frontend/playwright-report/index.html for the HTML report."
echo ""
info "Stack is still running. To stop it:"
echo "  docker compose --profile local-db down"
