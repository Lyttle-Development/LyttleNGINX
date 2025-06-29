#!/bin/bash
set -e

# Start NGINX in the foreground (so reloads work and container stays alive)
nginx -g "daemon off;"

# Wait for NGINX to fully start
sleep 1

# Build the app at container start (so .env is loaded)
npm run docker:setup

# Start the NestJS application in the foreground
node dist/main.js