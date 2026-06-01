#!/bin/bash

set -e

echo "🚀 HexQz Stress Test"
echo "=============================="
echo ""

if [[ "$1" == "--parallel" ]]; then
  shift
  echo "📊 Running parallel multi-session stress test..."
  echo ""
  docker compose --profile testing run --rm stress-test node parallel-stress-test.js "$@"
else
  NUM_PLAYERS=${1:-50}
  BASE_URL=${2:-http://quiz:3042}
  echo "📊 Test Configuration:"
  echo "   Players: $NUM_PLAYERS"
  echo "   Target: $BASE_URL"
  echo ""
  docker compose --profile testing run --rm stress-test --auto "$NUM_PLAYERS" "$BASE_URL"
fi
