#!/bin/bash
set -e

# Start NGINX in the background
nginx

# Wait for NGINX to fully start
sleep 1

# Build the app at container start (so .env is loaded)
npm run build

# Start the NestJS application in the foreground
node dist/main.js