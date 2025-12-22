#!/bin/bash
# Certificate Flow Test Script
# Tests the complete certificate acquisition and distribution flow

set -e

echo "=========================================="
echo "Certificate Flow Test Suite"
echo "=========================================="
echo ""

# Configuration
API_URL="${API_URL:-http://localhost:3000}"
API_KEY="${API_KEY:-}"

if [ -z "$API_KEY" ]; then
    echo "❌ API_KEY environment variable not set"
    echo "Please set API_KEY with a valid API key"
    exit 1
fi

AUTH_HEADER="X-API-Key: $API_KEY"

echo "Using API URL: $API_URL"
echo ""

# Test 1: Check cluster health
echo "Test 1: Checking cluster health..."
CLUSTER_STATS=$(curl -s -H "$AUTH_HEADER" "$API_URL/cluster/stats")
echo "✓ Cluster stats: $CLUSTER_STATS"
echo ""

# Test 2: Check leader status
echo "Test 2: Checking leader status..."
LEADER_STATUS=$(curl -s -H "$AUTH_HEADER" "$API_URL/cluster/leader/status")
echo "✓ Leader status: $LEADER_STATUS"

# Extract leader info
IS_HEALTHY=$(echo "$LEADER_STATUS" | jq -r '.status')
if [ "$IS_HEALTHY" = "healthy" ]; then
    echo "✅ Leader election is healthy"
else
    echo "⚠️  Leader election has issues: $IS_HEALTHY"
fi
echo ""

# Test 3: Get active nodes
echo "Test 3: Getting active nodes..."
NODES=$(curl -s -H "$AUTH_HEADER" "$API_URL/cluster/nodes")
NODE_COUNT=$(echo "$NODES" | jq -r '.count')
echo "✓ Active nodes: $NODE_COUNT"
echo "$NODES" | jq -r '.nodes[] | "  - \(.hostname) (\(.ipAddress)) [Leader: \(.isLeader)]"'
echo ""

# Test 4: List current certificates
echo "Test 4: Listing current certificates..."
CERTS=$(curl -s "$API_URL/certificates")
CERT_COUNT=$(echo "$CERTS" | jq -r 'length')
echo "✓ Current certificates: $CERT_COUNT"

if [ "$CERT_COUNT" -gt 0 ]; then
    echo "$CERTS" | jq -r '.[] | "  - \(.domains) (expires: \(.expiresAt), status: \(.status))"'
fi
echo ""

# Test 5: Check OCSP support
echo "Test 5: Checking OCSP support..."
OCSP_CHECK=$(curl -s "$API_URL/certificates/health/ocsp-check")
echo "✓ OCSP check result:"
echo "$OCSP_CHECK" | jq '.'
echo ""

# Test 6: Trigger certificate sync on all nodes
echo "Test 6: Triggering certificate sync..."
SYNC_RESULT=$(curl -s -X POST "$API_URL/certificates/sync")
echo "✓ Sync result: $SYNC_RESULT"

SYNCED_COUNT=$(echo "$SYNC_RESULT" | jq -r '.syncedCount // 0')
SYNC_ERRORS=$(echo "$SYNC_RESULT" | jq -r '.errors // [] | length')

if [ "$SYNC_ERRORS" -eq 0 ]; then
    echo "✅ Sync completed successfully ($SYNCED_COUNT certificates synced)"
else
    echo "⚠️  Sync completed with $SYNC_ERRORS error(s)"
    echo "$SYNC_RESULT" | jq -r '.errors'
fi
echo ""

# Test 7: Validate domain resolution (if domain provided)
if [ -n "$TEST_DOMAIN" ]; then
    echo "Test 7: Validating domain: $TEST_DOMAIN..."
    DOMAIN_CHECK=$(curl -s "$API_URL/certificates/validate/$TEST_DOMAIN")
    echo "✓ Domain validation result:"
    echo "$DOMAIN_CHECK" | jq '.'

    IS_VALID=$(echo "$DOMAIN_CHECK" | jq -r '.resolvable // false')
    if [ "$IS_VALID" = "true" ]; then
        echo "✅ Domain $TEST_DOMAIN is resolvable"
    else
        echo "❌ Domain $TEST_DOMAIN is NOT resolvable"
    fi
    echo ""
fi

# Test 8: Test manual certificate renewal trigger (if cert ID provided)
if [ -n "$TEST_CERT_ID" ]; then
    echo "Test 8: Testing manual certificate renewal for cert $TEST_CERT_ID..."
    RENEW_RESULT=$(curl -s -X POST -H "$AUTH_HEADER" "$API_URL/certificates/renew/$TEST_CERT_ID")
    echo "✓ Renewal result: $RENEW_RESULT"
    echo ""
fi

# Test 9: Test cluster reload broadcast
echo "Test 9: Testing cluster reload broadcast..."
RELOAD_RESULT=$(curl -s -X POST -H "$AUTH_HEADER" "$API_URL/cluster/reload?broadcast=true")
echo "✓ Reload result: $RELOAD_RESULT"

BROADCAST=$(echo "$RELOAD_RESULT" | jq -r '.broadcast')
if [ "$BROADCAST" = "true" ]; then
    echo "✅ Reload broadcasted to cluster"
else
    echo "⚠️  Reload was local only"
fi
echo ""

# Test 10: Verify cluster consistency
echo "Test 10: Verifying cluster consistency..."

# Wait a few seconds for sync to propagate
echo "Waiting 5 seconds for sync to propagate..."
sleep 5

# Check leader status again
FINAL_LEADER_STATUS=$(curl -s -H "$AUTH_HEADER" "$API_URL/cluster/leader/status")
FINAL_STATUS=$(echo "$FINAL_LEADER_STATUS" | jq -r '.status')
ISSUES=$(echo "$FINAL_LEADER_STATUS" | jq -r '.issues | length')

if [ "$FINAL_STATUS" = "healthy" ] && [ "$ISSUES" -eq 0 ]; then
    echo "✅ Cluster is consistent and healthy"
else
    echo "⚠️  Cluster has issues:"
    echo "$FINAL_LEADER_STATUS" | jq -r '.issues[]'
fi
echo ""

# Summary
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo "Cluster Nodes: $NODE_COUNT"
echo "Certificates: $CERT_COUNT"
echo "Leader Status: $FINAL_STATUS"
echo "Consistency Issues: $ISSUES"
echo ""

if [ "$FINAL_STATUS" = "healthy" ] && [ "$ISSUES" -eq 0 ]; then
    echo "✅ All tests passed! Certificate flow is working correctly."
    exit 0
else
    echo "⚠️  Some issues detected. Please review the logs."
    exit 1
fi

