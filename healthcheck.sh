#!/bin/bash

RESPONSE=$(curl -sS --connect-timeout 2 --max-time 4 -w "\n%{http_code}" \
  http://127.0.0.1:3000/health/ready 2>/dev/null)

HTTP_CODE=$(printf '%s\n' "$RESPONSE" | tail -n 1)
BODY=$(printf '%s\n' "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ] && printf '%s' "$BODY" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'; then
    echo "[HEALTH] OK: readiness probe passed"
    exit 0
fi

echo "[HEALTH] FAIL: readiness probe failed (HTTP $HTTP_CODE)" >&2
if [ -n "$BODY" ]; then
    printf '%s\n' "$BODY" >&2
fi
exit 1

