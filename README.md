# hexqz

Real-time quiz platform. Create quizzes, control the pace, players join via QR code on their phones. No accounts needed.

## Features

- **Admin-paced** — host controls when to advance questions
- **QR code join** — participants scan and play on their phones
- **Multiple question types** — single/multiple choice, true/false, free text, numeric, estimation
- **Team support** — optional team names for group play
- **Live scoreboard** — scores update after each question
- **Self-healing connections** — survives WiFi drops, backgrounded tabs, network switches
- **Per-quiz branding** — custom colors and logos per quiz
- **Session history** — view past results, export as CSV
- **Multi-quiz** — run multiple quizzes simultaneously

## Quick Start

```bash
git clone https://github.com/Hex29A/HexQz.git
cd HexQz
cp .env.example .env
docker compose up -d
```

Open `http://localhost:3042` — that's it.

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
