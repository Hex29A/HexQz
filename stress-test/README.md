# HexQz Stress Testing

Test your quiz platform with multiple concurrent virtual players.

## Quick Start (Docker - Recommended)

```bash
# Run complete end-to-end test with 50 players
AUTO_START=true docker compose --profile testing run --rm stress-test --auto 50 http://nginx

# Or use the convenience script
./stress-test/run-test.sh 50
```

## Usage

```bash
docker compose --profile testing run --rm stress-test <joinCode> <numPlayers> [baseUrl]
```

### Parameters

- `joinCode`: The 6-character session join code
- `numPlayers`: Number of virtual players to simulate (1-1000)
- `baseUrl`: Base URL of your quiz server

### Examples

```bash
node stress-test.js ABC123 50 http://localhost:3042
node stress-test.js XYZ789 100 https://quiz.example.com
```

## Parallel Testing

```bash
# Run 8 parallel sessions with 10 players each
ADMIN_SECRET=secret node parallel-stress-test.js --auto-advance

# Custom configuration
ADMIN_SECRET=secret node parallel-stress-test.js --sessions 4 --players 20 --auto-advance
```

## What It Does

1. Validates the join code
2. Registers all virtual players
3. Connects each player via WebSocket
4. Automatically answers questions with random answers
5. Simulates realistic timing
6. Reports statistics
