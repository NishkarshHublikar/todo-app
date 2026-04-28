#!/usr/bin/env bash
# setup-dev.sh — First-time local dev setup
# Run once after cloning: ./setup-dev.sh
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}▶ $1${NC}"; }
warn()  { echo -e "${YELLOW}⚠  $1${NC}"; }

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  TodoApp — Local Dev Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ─── Check prerequisites ──────────────────────────────────────────────────────
for cmd in docker node npm; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: '$cmd' is not installed. Please install it and re-run."
    exit 1
  fi
done

info "Prerequisites OK (docker, node, npm)"

# ─── Create .env from example if it doesn't exist ────────────────────────────
if [[ ! -f backend/.env ]]; then
  cp backend/.env.example backend/.env
  info "Created backend/.env from .env.example"
  warn "Open backend/.env and fill in GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET,"
  warn "RAZORPAY_KEY_ID, and RAZORPAY_KEY_SECRET before running the app."
else
  info "backend/.env already exists — skipping copy"
fi

# ─── Install backend deps locally (for IDE autocomplete / linting) ────────────
info "Installing backend dependencies..."
(cd backend && npm ci)

# ─── Docker Compose up ────────────────────────────────────────────────────────
echo ""
info "Starting stack with Docker Compose..."
docker compose up --build -d

# ─── Wait for backend health ──────────────────────────────────────────────────
echo ""
info "Waiting for backend to be healthy..."
MAX=30
COUNT=0
until curl -sf http://localhost:3001/health > /dev/null 2>&1; do
  COUNT=$((COUNT + 1))
  if [[ $COUNT -ge $MAX ]]; then
    echo "ERROR: Backend did not become healthy after ${MAX} seconds."
    echo "Check logs: docker compose logs backend"
    exit 1
  fi
  printf "."
  sleep 2
done
echo ""

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Stack is up!"
echo ""
echo "  Frontend  →  http://localhost:8080"
echo "  Backend   →  http://localhost:3001"
echo "  Health    →  http://localhost:3001/health"
echo ""
echo "  Logs:  docker compose logs -f"
echo "  Stop:  docker compose down"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
