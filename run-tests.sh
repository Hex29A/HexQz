#!/bin/sh
# Runs the server test suite in a node:20 container (no node needed on the host).
set -e
cd "$(dirname "$0")"
docker run --rm -v "$PWD/server:/app" -w /app node:20-alpine sh -c "npm install --no-audit --no-fund --loglevel=error >/dev/null && npm test"
