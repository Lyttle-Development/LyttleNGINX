#!/bin/bash
# Simplified health check - only check if app responds

# Check if the /ready endpoint responds with a 200 status
# Use --connect-timeout for faster failure and --max-time for overall timeout
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 --max-time 4 http://127.0.0.1:3000/ready 2>/dev/null)

if [ "$HTTP_CODE" = "200" ]; then
    echo "[HEALTH] OK: Application is ready (HTTP $HTTP_CODE)"
    exit 0
else
    echo "[HEALTH] FAIL: Application not responding properly (HTTP $HTTP_CODE)" >&2
    exit 1
fi

