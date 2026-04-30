# hexqz

Real-time quiz platform. Create quizzes, control the pace, players join via QR code on their phones. No accounts needed.

## Features

- **Admin-paced** — host controls when to advance questions
- **QR code join** — participants scan and play on their phones
- **Multiple question types** — single/multiple choice, true/false, free text, numeric, estimation
- **Team support** — optional team names for group play
- **Live scoreboard** — scores update after each question
- **Self-healing connections** — survives WiFi drops, backgrounded tabs, network switches
- **Themed quizzes** — 10 preset themes (Synthwave, Star Trek, Emerald, etc.) with dark/light mode
- **Per-quiz branding** — custom colors and logos per quiz
- **Session history** — view past results, export as CSV
- **Multi-quiz** — run multiple quizzes simultaneously

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

To update: click the **Update** button in Dockge — it pulls the latest image automatically. This works because the image is published to GHCR via GitHub Actions on every push to `main`. Dockge's Update button runs `docker compose pull` under the hood, which checks the registry for a newer version of the `latest` tag.

> **Note:** The GHCR package may default to private. If Dockge can't pull the image, go to GitHub → Your profile → Packages → hexqz → Package settings → Change visibility to **Public**.

### Option B: Build from source

Clone the repo into your Dockge stacks directory:

```bash
cd /opt/stacks  # or wherever your Dockge stacks directory is
git clone https://github.com/Hex29A/HexQz.git hexqz
cd hexqz
cp .env.example .env
# Edit .env — set ADMIN_SECRET and BASE_URL
```

The stack will appear automatically in Dockge's UI. Click **Up** to start it.

To update: `git pull && docker compose up -d --build` in the stack directory.

## How It Works

1. Admin opens `/admin`, logs in, creates a quiz with questions
2. Admin starts a session → gets a join code and QR code
3. Participants scan QR or enter the 6-character code at the root URL
4. They enter a display name (and optional team) → land in the lobby
5. Admin clicks "Start" → first question appears on all phones
6. Players answer → admin sees live answer count → clicks "Next"
7. Scores update after each question → final scoreboard at the end

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3042` | Server port |
| `BASE_URL` | auto-detected | Public URL for QR codes (set when behind reverse proxy) |
| `ADMIN_SECRET` | — | Master password for `/admin` dashboard. Dashboard disabled if unset. |
| `PLATFORM_NAME` | `hexqz` | Shown on landing page when no quiz is active |
| `PLATFORM_LOGO_URL` | — | Platform logo URL |

## Development

```bash
make dev
```

Runs server (with hot reload) and client (Vite dev server) in parallel.

## Tech Stack

- **Backend**: Node.js + Express + Socket.io
- **Database**: SQLite (better-sqlite3)
- **Frontend**: React + Vite + Tailwind CSS
- **Deployment**: Docker

## License

MIT
