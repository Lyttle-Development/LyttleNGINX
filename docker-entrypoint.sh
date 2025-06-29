#!/bin/bash
set -e

# Start NGINX in the background
sudo nginx

# Wait for NGINX to fully start
sleep 1

# Build the app at container start (so .env is loaded)
sudo npm run docker:setup

# Start the NestJS application in the foreground
sudo node dist/main.js