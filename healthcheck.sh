#!/bin/bash
# Simplified health check - only check if app responds

# Simply check if the /ready endpoint responds
# This is the most reliable indicator that everything is working
if curl -fsSL --max-time 3 http://127.0.0.1:3000/ready > /dev/null 2>&1; then
    echo "[HEALTH] OK: Application is ready"
    exit 0
else
    echo "[HEALTH] FAIL: Application not responding on /ready endpoint" >&2
    exit 1
fi

