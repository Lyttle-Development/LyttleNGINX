#!/bin/bash
set -e

# Start NGINX in the background
nginx

# Wait for NGINX to fully start
sleep 1

# Start the NestJS application in the foreground
node dist/main.js