# hexqz

Real-time quiz platform. Create quizzes, control the pace, players join via QR code on their phones. No accounts needed.

## Features

- **Admin-paced or Auto-mode** — host controls when to advance, or let the quiz run automatically
- **Speed-based scoring** — points scale from 1000 (instant answer) to 0 (at time limit), rewarding faster responses
- **QR code join** — participants scan QR and go straight to name entry (no manual code needed)
- **Multiple question types** — single/multiple choice, true/false, free text, numeric, estimation, multi-part
- **Team support** — optional team names for group play
- **Live scoreboard** — animated scoreboard between questions with round winner highlight and medals
- **Display View** — dedicated projector/big-screen view at `/display/:sessionId` for showing questions and scores
- **Get Ready countdown** — 5-second countdown before each question
- **Timer bar** — visual countdown in player and display views
- **Early close** — question closes immediately when all players have answered
- **Expandable results** — tap any player on the results page to see their answers per question (correct/wrong/points)
- **Self-healing connections** — survives WiFi drops, backgrounded tabs, network switches
- **Themed quizzes** — 10 preset themes with dark/light mode, or custom accent color
- **Per-quiz branding** — custom colors and logos per quiz
- **Session naming** — optional name when creating sessions
- **Session history** — view past results, export as CSV
- **Multi-quiz** — run multiple quizzes simultaneously
- **Version tracking** — build hash shown in admin dashboard footer for easy deploy verification

## Quick Start

```bash
git clone https://github.com/Hex29A/HexQz.git
cd HexQz
cp .env.example .env
# Edit .env — at minimum set ADMIN_SECRET
docker compose up -d
```

Open `http://localhost:3042` — that's it.

## Running with Dockge

[Dockge](https://github.com/louislam/dockge) is a self-hosted Docker Compose manager with a web UI.

### Option A: Pre-built image (recommended)

Uses the auto-built image from GitHub Container Registry. Supports Dockge's **Update** button.

1. In Dockge, click **"+ Compose"**
2. Name it `hexqz`
3. Paste this compose file:

```yaml
services:
  quiz:
    image: ghcr.io/hex29a/hexqz:latest
    ports:
      - "3042:3042"
    volumes:
      - ./data:/app/data
      - ./uploads:/app/uploads
    environment:
      - NODE_ENV=production
      - PORT=3042
      - DB_PATH=/app/data/hexqz.sqlite
      - BASE_URL=https://your-domain.com
      - ADMIN_SECRET=change-me-to-something-secret
      - PLATFORM_NAME=hexqz
    restart: unless-stopped
```

4. Edit the environment variables (at minimum `ADMIN_SECRET` and `BASE_URL`)
5. Click **Deploy**

To update: click the **Update** button in Dockge — it pulls the latest image automatically.

> **Note:** The GHCR package may default to private. If Dockge can't pull the image, go to GitHub → Your profile → Packages → hexqz → Package settings → Change visibility to **Public**.

### Option B: Build from source

Clone the repo into your Dockge stacks directory:

```bash
cd /opt/stacks
git clone https://github.com/Hex29A/HexQz.git hexqz
cd hexqz
cp .env.example .env
# Edit .env — set ADMIN_SECRET and BASE_URL
```

To update: `git pull && docker compose up -d --build` in the stack directory.

## How It Works

1. Admin opens `/admin`, logs in, creates a quiz with questions
2. Admin starts a session → gets a join code and QR code
3. Participants scan QR or enter the 6-character code at the root URL
4. They enter a display name (and optional team) → land in the lobby
5. Admin clicks "Start" → "Get Ready!" countdown appears for 5 seconds
6. Question appears on all screens with a timer bar counting down
7. Players answer → points awarded based on speed (faster = more points)
8. After time expires (or all players answer), correct answer is revealed
9. Round result shows the round winner, then the live scoreboard with medals
10. Admin clicks "Continue" (or auto-mode advances automatically) → next question
11. After the last question, the final results screen shows with winner animation

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3042` | Server port |
| `BASE_URL` | auto-detected | Public URL for QR codes (set when behind reverse proxy) |
| `ADMIN_SECRET` | — | Master password for `/admin` dashboard. Dashboard disabled if unset. |
| `PLATFORM_NAME` | `hexqz` | Shown on landing page when no quiz is active |
| `PLATFORM_LOGO_URL` | — | Platform logo URL |
| `DB_PATH` | `data/hexqz.sqlite` | SQLite database file path |

## Question Types

| Type | Description |
|---|---|
| Single Choice | Tap one answer (A/B/C/D). Points based on speed. |
| Multiple Choice | Select multiple answers + submit. Points based on speed if all correct. |
| True / False | Two buttons. Points based on speed if correct. |
| Free Text | Text input, auto-matched case-insensitively against accepted answers. |
| Numeric | Number input, correct if within ±tolerance. |
| Estimation | Number input, ranked by proximity to correct value. Top scores by closeness. |
| Multi-Part | Multiple fields (e.g. Artist + Song), scored per part. |

## Updating

When a commit is pushed to `main`, GitHub Actions builds a multi-arch Docker image (amd64 + arm64) and pushes it to `ghcr.io/hex29a/hexqz:latest`.

- **Dockge (image mode)**: Click the **Update** button to pull the latest image, then restart.
- **Docker CLI**: `docker compose pull && docker compose up -d`
- **Verify**: After updating, check the admin dashboard (`/admin`) — the build hash is shown in the bottom-right corner.

## Development

```bash
make dev
```

Runs server (with hot reload) and client (Vite dev server) in parallel.

## Stress Testing

A Docker-based stress testing tool is included in `stress-test/`. See [stress-test/README.md](stress-test/README.md) for details.

```bash
cd stress-test
./run-test.sh 100  # Simulate 100 concurrent players
```

## Tech Stack

- **Backend**: Node.js + Express + Socket.io
- **Database**: SQLite (better-sqlite3)
- **Frontend**: React + Vite + Tailwind CSS
- **Deployment**: Docker

## License

MIT
