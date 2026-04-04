#!/usr/bin/env bash
# scripts/health-check.sh
#
# Starts PostgreSQL, Redis, and Kafka via Docker Compose and waits until
# all three report a "healthy" status.  Exits 0 on success, 1 on timeout.
#
# Usage:
#   ./scripts/health-check.sh               # wait up to 120s (default)
#   TIMEOUT=180 ./scripts/health-check.sh   # custom timeout

set -euo pipefail

COMPOSE_FILE="$(cd "$(dirname "$0")/.." && pwd)/docker-compose.yml"
TIMEOUT="${TIMEOUT:-120}"
SERVICES=(postgres redis kafka)

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

info()    { echo -e "${YELLOW}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }

# ── Start infra services (not api/web) ────────────────────────────────────────
info "Starting infrastructure services (postgres, redis, zookeeper, kafka)..."
docker compose -f "$COMPOSE_FILE" up -d postgres redis zookeeper kafka

# ── Poll until healthy ────────────────────────────────────────────────────────
wait_healthy() {
  local service="$1"
  local start elapsed status
  start=$(date +%s)

  info "Waiting for $service to become healthy..."
  while true; do
    elapsed=$(( $(date +%s) - start ))
    if [ "$elapsed" -ge "$TIMEOUT" ]; then
      echo ""
      error "$service did not become healthy within ${TIMEOUT}s"
      docker compose -f "$COMPOSE_FILE" logs --tail=30 "$service"
      return 1
    fi

    # docker compose ps JSON: field is "Health" in newer versions
    status=$(docker compose -f "$COMPOSE_FILE" ps --format json "$service" 2>/dev/null \
      | python3 -c "
import sys, json
raw = sys.stdin.read().strip()
if not raw:
    print(''); exit()
try:
    data = json.loads(raw)
except:
    print(''); exit()
# May be a list or a single object
if isinstance(data, list):
    print(data[0].get('Health', '') if data else '')
else:
    print(data.get('Health', ''))
" 2>/dev/null || echo "")

    if [ "$status" = "healthy" ]; then
      echo ""
      success "$service is healthy  (${elapsed}s)"
      return 0
    fi

    echo -ne "\r  ${service}: ${status:-starting...}  (${elapsed}s elapsed)   "
    sleep 3
  done
}

# ── Run health checks sequentially ────────────────────────────────────────────
FAILED=0
for svc in "${SERVICES[@]}"; do
  wait_healthy "$svc" || FAILED=1
done

echo ""
if [ "$FAILED" -eq 0 ]; then
  success "All infrastructure services are healthy!"
  echo ""
  docker compose -f "$COMPOSE_FILE" ps postgres redis zookeeper kafka
  exit 0
else
  error "One or more services failed to become healthy. See logs above."
  exit 1
fi
