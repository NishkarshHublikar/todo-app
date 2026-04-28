#!/usr/bin/env bash
# smoke-test.sh — Run after `docker compose up --build -d`
# Usage: ./smoke-test.sh [base_url]   (default: http://localhost:3001)
set -euo pipefail

BASE="${1:-http://localhost:3001}"
PASS=0; FAIL=0
TEST_EMAIL="smoketest_$(date +%s)@example.com"
TEST_PASS="testpass123"
TOKEN=""; TODO_ID=""

green() { echo -e "\033[32m✅ $1\033[0m"; }
red()   { echo -e "\033[31m❌ $1\033[0m"; }

check() {
  if [[ "$3" == "$2" ]]; then green "$1 (HTTP $3)"; PASS=$((PASS+1));
  else red "$1 — expected HTTP $2, got $3. Body: $4"; FAIL=$((FAIL+1)); fi
}

req() {
  local method="$1" path="$2" body="${3:-}"
  local headers=(-H "Content-Type: application/json")
  [[ -n "$TOKEN" ]] && headers+=(-H "Authorization: Bearer $TOKEN")
  local resp; resp=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE$path" "${headers[@]}" ${body:+-d "$body"})
  HTTP_BODY=$(echo "$resp" | head -n -1)
  HTTP_STATUS=$(echo "$resp" | tail -n 1)
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  TodoApp Smoke Tests → $BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⏳ Waiting for backend..."
for i in $(seq 1 20); do
  curl -sf "$BASE/health" > /dev/null 2>&1 && { green "Backend is up"; break; }
  [[ $i -eq 20 ]] && { red "Backend did not start. Aborting."; exit 1; }
  sleep 3
done
echo ""

req GET /health
check "GET /health" "200" "$HTTP_STATUS" "$HTTP_BODY"

req POST /auth/register "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}"
check "POST /auth/register" "201" "$HTTP_STATUS" "$HTTP_BODY"
TOKEN=$(echo "$HTTP_BODY" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
[[ -z "$TOKEN" ]] && { red "No token — aborting"; exit 1; }

req POST /auth/login "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}"
check "POST /auth/login" "200" "$HTTP_STATUS" "$HTTP_BODY"
TOKEN=$(echo "$HTTP_BODY" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

req GET /auth/me
check "GET /auth/me" "200" "$HTTP_STATUS" "$HTTP_BODY"

req POST /todos '{"task":"Smoke test task"}'
check "POST /todos" "201" "$HTTP_STATUS" "$HTTP_BODY"
TODO_ID=$(echo "$HTTP_BODY" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)

req GET /todos
check "GET /todos" "200" "$HTTP_STATUS" "$HTTP_BODY"

req PUT "/todos/$TODO_ID" '{"task":"Updated","completed":true}'
check "PUT /todos/:id" "200" "$HTTP_STATUS" "$HTTP_BODY"

req DELETE "/todos/$TODO_ID"
check "DELETE /todos/:id" "200" "$HTTP_STATUS" "$HTTP_BODY"

TOKEN=""
req GET /todos
check "GET /todos unauthenticated (expect 401)" "401" "$HTTP_STATUS" "$HTTP_BODY"

req POST /auth/register "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}"
check "Duplicate register (expect 409)" "409" "$HTTP_STATUS" "$HTTP_BODY"

req POST /auth/login "{\"email\":\"$TEST_EMAIL\",\"password\":\"wrongpassword\"}"
check "Bad password (expect 401)" "401" "$HTTP_STATUS" "$HTTP_BODY"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Results: $PASS/$((PASS+FAIL)) passed"
[[ $FAIL -gt 0 ]] && { red "$FAIL failed"; exit 1; } || green "All tests passed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
